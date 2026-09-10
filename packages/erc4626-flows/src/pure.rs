//! Pure functions: parameter parsing, address/hash normalization, fixed-point decimal formatting,
//! execution-rate math and deterministic row ids. No host calls, so everything here runs under
//! `cargo test` on the native target.

use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};
use std::str::FromStr;

/// Base mainnet. Used when the params string omits `chain_id`.
pub const DEFAULT_CHAIN_ID: u32 = 8453;
/// Fractional digits emitted for rate columns (decimal128 scale 18 in the sink).
pub const RATE_SCALE: u32 = 18;
/// Upper bound accepted from `decimals()`; anything larger marks the vault non-compliant.
pub const MAX_DECIMALS: u32 = 36;
/// Sentinel for numeric string columns that are not computable (the sink rejects empty strings).
pub const ZERO: &str = "0";
/// `VaultFlow.direction` values. The contract field is a plain string (not a proto3 enum) because
/// `substreams-sink-sql` 4.13.1 `from-proto` panics on a populated enum field; see proto/vaultflows.proto.
pub const DIRECTION_DEPOSIT: &str = "deposit";
pub const DIRECTION_WITHDRAW: &str = "withdraw";

/// Returns the input when it is a non-empty unsigned decimal string, otherwise `"0"`.
pub fn or_zero(raw: &str) -> String {
    match parse_uint(raw) {
        Some(v) => v.to_string(),
        None => ZERO.to_string(),
    }
}

/// Module configuration decoded from the urlencoded `params` string, e.g.
/// `vaults[]=0x…&vaults[]=0x…&interval=1800&chain_id=8453`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Lowercase, 0x-prefixed, de-duplicated, in declaration order.
    pub vaults: Vec<String>,
    /// Sampling interval in blocks; observations are taken when `block_number % interval == 0`.
    pub interval: u64,
    pub chain_id: u32,
}

impl Params {
    pub fn is_configured(&self, vault_lowercase_hex: &str) -> bool {
        self.vaults.iter().any(|v| v == vault_lowercase_hex)
    }
}

pub fn parse_params(raw: &str) -> Result<Params, String> {
    let mut vaults: Vec<String> = Vec::new();
    let mut interval: Option<u64> = None;
    let mut chain_id: Option<u32> = None;

    for pair in raw.split('&') {
        if pair.trim().is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let key = percent_decode(key)?;
        let value = percent_decode(value)?;
        match key.as_str() {
            "vaults[]" | "vaults" | "vault" => {
                for candidate in value.split(',') {
                    let candidate = candidate.trim();
                    if candidate.is_empty() {
                        continue;
                    }
                    let address = normalize_address(candidate)?;
                    if !vaults.contains(&address) {
                        vaults.push(address);
                    }
                }
            }
            "interval" => {
                interval = Some(
                    value
                        .trim()
                        .parse::<u64>()
                        .map_err(|_| format!("interval: not an unsigned integer: {value:?}"))?,
                );
            }
            "chain_id" => {
                chain_id = Some(
                    value
                        .trim()
                        .parse::<u32>()
                        .map_err(|_| format!("chain_id: not an unsigned integer: {value:?}"))?,
                );
            }
            other => return Err(format!("unknown parameter {other:?}")),
        }
    }

    let interval = interval.ok_or_else(|| "interval: missing".to_string())?;
    if interval == 0 {
        return Err("interval: must be >= 1".to_string());
    }
    if vaults.is_empty() {
        return Err("vaults[]: at least one vault address is required".to_string());
    }
    Ok(Params {
        vaults,
        interval,
        chain_id: chain_id.unwrap_or(DEFAULT_CHAIN_ID),
    })
}

/// Minimal percent-decoding (`%XX` and `+`), enough for query-string style params.
pub fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                if i + 2 >= bytes.len() {
                    return Err(format!("bad percent escape in {input:?}"));
                }
                let hex_pair = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .map_err(|_| format!("bad percent escape in {input:?}"))?;
                let byte = u8::from_str_radix(hex_pair, 16)
                    .map_err(|_| format!("bad percent escape in {input:?}"))?;
                out.push(byte);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| format!("params are not valid UTF-8: {input:?}"))
}

/// Accepts `0x`-prefixed or bare 40-hex-char addresses in any case; returns lowercase `0x…`.
pub fn normalize_address(input: &str) -> Result<String, String> {
    let bare = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
        .unwrap_or(input);
    if bare.len() != 40 || !bare.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("not a 20-byte hex address: {input:?}"));
    }
    Ok(format!("0x{}", bare.to_ascii_lowercase()))
}

/// Lowercase `0x`-prefixed hex of raw bytes (addresses, hashes).
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

/// Block ids from the Substreams clock are hex without prefix on EVM chains; normalize to `0x…` lowercase.
pub fn normalize_hash(input: &str) -> String {
    let bare = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
        .unwrap_or(input);
    format!("0x{}", bare.to_ascii_lowercase())
}

/// Decodes a lowercase `0x…` address string into its 20 bytes.
pub fn address_bytes(address: &str) -> Result<Vec<u8>, String> {
    let bare = address.strip_prefix("0x").unwrap_or(address);
    let bytes = hex::decode(bare).map_err(|e| format!("bad address {address:?}: {e}"))?;
    if bytes.len() != 20 {
        return Err(format!("bad address length {}: {address:?}", bytes.len()));
    }
    Ok(bytes)
}

pub fn parse_uint(raw: &str) -> Option<BigUint> {
    BigUint::from_str(raw.trim()).ok()
}

pub fn pow10(exp: u32) -> BigUint {
    BigUint::from(10u32).pow(exp)
}

/// `raw / 10^decimals` as a decimal string with trailing fractional zeros trimmed ("197.373726", "1", "0").
pub fn format_units(raw: &BigUint, decimals: u32) -> String {
    if decimals == 0 {
        return raw.to_string();
    }
    let divisor = pow10(decimals);
    let int_part = raw / &divisor;
    let frac_part = raw % &divisor;
    if frac_part.is_zero() {
        return int_part.to_string();
    }
    let frac = format!("{:0>width$}", frac_part, width = decimals as usize);
    format!("{}.{}", int_part, frac.trim_end_matches('0'))
}

/// `scaled / 10^scale` as a decimal string with exactly `scale` fractional digits.
pub fn format_fixed(scaled: &BigUint, scale: u32) -> String {
    if scale == 0 {
        return scaled.to_string();
    }
    let divisor = pow10(scale);
    let int_part = scaled / &divisor;
    let frac_part = scaled % &divisor;
    format!(
        "{}.{:0>width$}",
        int_part,
        frac_part,
        width = scale as usize
    )
}

/// Normalizes a raw token amount (decimal string) by `decimals`. `None` when `raw` is not an unsigned integer.
pub fn normalize_amount(raw: &str, decimals: u32) -> Option<String> {
    parse_uint(raw).map(|v| format_units(&v, decimals))
}

/// `(num_raw / 10^num_decimals) / (den_raw / 10^den_decimals)` scaled by `10^scale`, floor-rounded.
/// `None` when the denominator is zero.
pub fn ratio_scaled(
    num_raw: &BigUint,
    num_decimals: u32,
    den_raw: &BigUint,
    den_decimals: u32,
    scale: u32,
) -> Option<BigUint> {
    if den_raw.is_zero() {
        return None;
    }
    let numerator = num_raw * pow10(den_decimals) * pow10(scale);
    let denominator = den_raw * pow10(num_decimals);
    Some(numerator / denominator)
}

/// Assets per share implied by one flow: `assets_normalized / shares_normalized`, 18 fractional digits.
/// `None` when shares are zero or either amount fails to parse.
pub fn execution_rate(
    assets_raw: &str,
    asset_decimals: u32,
    shares_raw: &str,
    share_decimals: u32,
) -> Option<String> {
    let assets = parse_uint(assets_raw)?;
    let shares = parse_uint(shares_raw)?;
    ratio_scaled(&assets, asset_decimals, &shares, share_decimals, RATE_SCALE)
        .map(|r| format_fixed(&r, RATE_SCALE))
}

/// `convertToAssets(10^shareDecimals)` result normalized by the asset's decimals, 18 fractional digits.
pub fn normalize_rate(raw: &str, asset_decimals: u32) -> Option<String> {
    let value = parse_uint(raw)?;
    // value / 10^asset_decimals, rendered with RATE_SCALE digits: value * 10^RATE_SCALE / 10^asset_decimals
    let scaled = ratio_scaled(&value, asset_decimals, &BigUint::from(1u32), 0, RATE_SCALE)?;
    Some(format_fixed(&scaled, RATE_SCALE))
}

pub fn is_sample_block(block_number: u64, interval: u64) -> bool {
    interval > 0 && block_number % interval == 0
}

/// Converts a `decimals()` result to `u32`, rejecting absurd values so `10^decimals` stays bounded.
pub fn decimals_from_u64(value: u64) -> Option<u32> {
    if value > MAX_DECIMALS as u64 {
        return None;
    }
    value.to_u32()
}

/// `"{chain_id}-{block_number}-{log_index}"`; log_index is block-wide (Firehose Log.blockIndex), so it is unique per block.
pub fn flow_id(chain_id: u32, block_number: u64, log_index: u32) -> String {
    format!("{chain_id}-{block_number}-{log_index}")
}

pub fn observation_id(chain_id: u32, block_number: u64, vault: &str) -> String {
    format!("{chain_id}-{block_number}-{vault}")
}

pub fn vault_id(chain_id: u32, vault: &str) -> String {
    format!("{chain_id}-{vault}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAUNTLET: &str = "0x050ce30b927da55177a4914ec73480238bad56f0";
    const STEAKHOUSE: &str = "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9";
    const PARAMS: &str = "vaults[]=0x050ce30b927da55177a4914ec73480238bad56f0&vaults[]=0xbeef0e0834849acc03f0089f01f4f1eeb06873c9&interval=1800&chain_id=8453";

    #[test]
    fn parses_the_frozen_params_string() {
        let p = parse_params(PARAMS).unwrap();
        assert_eq!(p.vaults, vec![GAUNTLET.to_string(), STEAKHOUSE.to_string()]);
        assert_eq!(p.interval, 1800);
        assert_eq!(p.chain_id, 8453);
        assert!(p.is_configured(GAUNTLET));
        assert!(!p.is_configured("0x0000000000000000000000000000000000000000"));
    }

    #[test]
    fn accepts_percent_encoded_brackets_and_mixed_case_addresses() {
        let raw = "vaults%5B%5D=0x050cE30b927Da55177A4914EC73480238BAD56f0&vaults%5B%5D=0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9&interval=1800";
        let p = parse_params(raw).unwrap();
        assert_eq!(p.vaults, vec![GAUNTLET.to_string(), STEAKHOUSE.to_string()]);
        assert_eq!(p.chain_id, DEFAULT_CHAIN_ID);
    }

    #[test]
    fn dedupes_vaults_and_accepts_comma_lists() {
        let raw = format!("vaults={GAUNTLET},{STEAKHOUSE},{GAUNTLET}&interval=10");
        let p = parse_params(&raw).unwrap();
        assert_eq!(p.vaults.len(), 2);
    }

    #[test]
    fn rejects_bad_params() {
        assert!(
            parse_params("vaults[]=0x050ce30b927da55177a4914ec73480238bad56f0").is_err(),
            "missing interval"
        );
        assert!(
            parse_params("vaults[]=0x050ce30b927da55177a4914ec73480238bad56f0&interval=0").is_err(),
            "zero interval"
        );
        assert!(parse_params("interval=1800").is_err(), "no vaults");
        assert!(
            parse_params("vaults[]=0x1234&interval=1800").is_err(),
            "short address"
        );
        assert!(
            parse_params("vaults[]=0xzz50ce30b927da55177a4914ec73480238bad56f0&interval=1800")
                .is_err(),
            "non-hex"
        );
        assert!(
            parse_params(&format!("vaults[]={GAUNTLET}&interval=1800&foo=1")).is_err(),
            "unknown key"
        );
        assert!(
            parse_params(&format!("vaults[]={GAUNTLET}&interval=abc")).is_err(),
            "non-numeric interval"
        );
    }

    #[test]
    fn normalizes_addresses_and_hashes() {
        assert_eq!(
            normalize_address("050cE30b927Da55177A4914EC73480238BAD56f0").unwrap(),
            GAUNTLET
        );
        assert_eq!(bytes_to_hex(&[0xbe, 0xef]), "0xbeef");
        assert_eq!(
            normalize_hash("E05B627F4D4C392CB2CC577AC21421B6C3D09B4F3C0B397532E292177E7BD089"),
            "0xe05b627f4d4c392cb2cc577ac21421b6c3d09b4f3c0b397532e292177e7bd089"
        );
        assert_eq!(normalize_hash("0xabc"), "0xabc");
        assert_eq!(address_bytes(GAUNTLET).unwrap().len(), 20);
        assert!(address_bytes("0x1234").is_err());
    }

    #[test]
    fn formats_units_with_trimmed_fraction() {
        assert_eq!(normalize_amount("197373726", 6).unwrap(), "197.373726");
        assert_eq!(normalize_amount("1000000", 6).unwrap(), "1");
        assert_eq!(normalize_amount("0", 6).unwrap(), "0");
        assert_eq!(normalize_amount("5", 6).unwrap(), "0.000005");
        assert_eq!(
            normalize_amount("189647169910852085674", 18).unwrap(),
            "189.647169910852085674"
        );
        assert_eq!(normalize_amount("42", 0).unwrap(), "42");
        assert!(normalize_amount("-1", 6).is_none());
        assert!(normalize_amount("0x10", 6).is_none());
    }

    #[test]
    fn execution_rate_matches_the_recorded_flows() {
        // Gauntlet Deposit, block 51,092,263: 197.373726 USDC for 189.647169910852085674 shares.
        assert_eq!(
            execution_rate("197373726", 6, "189647169910852085674", 18).unwrap(),
            "1.040741742113947472"
        );
        // Steakhouse Withdraw, block 51,092,316: 2.210001 USDC for 2.125180826770979130 shares.
        assert_eq!(
            execution_rate("2210001", 6, "2125180826770979130", 18).unwrap(),
            "1.039911979329258999"
        );
        assert!(execution_rate("1", 6, "0", 18).is_none(), "zero shares");
        assert!(execution_rate("x", 6, "1", 18).is_none(), "unparseable");
        // equal decimals, exact ratio
        assert_eq!(
            execution_rate("2000", 18, "1000", 18).unwrap(),
            "2.000000000000000000"
        );
    }

    #[test]
    fn normalizes_convert_to_assets_result_as_a_rate() {
        // convertToAssets(1e18) = 1,040,742 raw USDC (6 decimals) -> 1.040742 assets per whole share.
        assert_eq!(
            normalize_rate("1040742", 6).unwrap(),
            "1.040742000000000000"
        );
        assert_eq!(normalize_rate("0", 6).unwrap(), "0.000000000000000000");
        assert!(normalize_rate("nope", 6).is_none());
    }

    #[test]
    fn sample_block_predicate() {
        assert!(is_sample_block(49_276_800, 1800));
        assert!(is_sample_block(51_093_000, 1800));
        assert!(!is_sample_block(51_092_263, 1800));
        assert!(!is_sample_block(10, 0));
    }

    #[test]
    fn ids_follow_the_proto_comments() {
        assert_eq!(flow_id(8453, 51_092_263, 406), "8453-51092263-406");
        assert_eq!(
            observation_id(8453, 51_093_000, GAUNTLET),
            format!("8453-51093000-{GAUNTLET}")
        );
        assert_eq!(vault_id(8453, GAUNTLET), format!("8453-{GAUNTLET}"));
    }

    #[test]
    fn or_zero_never_returns_empty() {
        assert_eq!(or_zero(""), "0");
        assert_eq!(or_zero("abc"), "0");
        assert_eq!(or_zero("-5"), "0");
        assert_eq!(or_zero("007"), "7");
        assert_eq!(or_zero("197373726"), "197373726");
    }

    #[test]
    fn direction_values_match_the_contract() {
        // proto/vaultflows.proto: `string direction = 12` holds exactly `deposit` or `withdraw`, lowercase.
        assert_eq!(DIRECTION_DEPOSIT, "deposit");
        assert_eq!(DIRECTION_WITHDRAW, "withdraw");
        for d in [DIRECTION_DEPOSIT, DIRECTION_WITHDRAW] {
            assert!(!d.is_empty());
            assert_eq!(d, d.to_lowercase());
        }
        assert_ne!(DIRECTION_DEPOSIT, DIRECTION_WITHDRAW);
    }

    #[test]
    fn decimals_bounds() {
        assert_eq!(decimals_from_u64(18), Some(18));
        assert_eq!(decimals_from_u64(6), Some(6));
        assert_eq!(decimals_from_u64(0), Some(0));
        assert_eq!(decimals_from_u64(37), None);
        assert_eq!(decimals_from_u64(u64::MAX), None);
    }

    #[test]
    fn percent_decode_rejects_truncated_escape() {
        assert!(percent_decode("abc%4").is_err());
        assert_eq!(percent_decode("a+b").unwrap(), "a b");
        assert_eq!(percent_decode("%5B%5D").unwrap(), "[]");
    }
}
