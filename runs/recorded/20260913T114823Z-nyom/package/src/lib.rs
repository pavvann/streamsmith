//! erc4626-flows — normalized ERC-4626 vault activity on Base.
//!
//! Module graph (see substreams.yaml):
//!
//!   erc4626:map_events  (imported, topic0-matched Deposit/Withdraw for every vault on the chain)
//!        |                                   |
//!   store_vault_seen (set_if_not_exists)     |
//!        | deltas = addresses first seen in this block
//!   map_vault_probe ---> store_vault_meta (set_if_not_exists, cached decimals/asset)
//!        |                                   | get
//!        |                              map_flows
//!        |                                   |
//!        |       map_share_value_observations|
//!        \-----------------+-----------------/
//!                      map_events   (single from-proto sink module)
//!
//! Every eth_call is paid once per vault at first sight (map_vault_probe) or once per vault per
//! sampled block (map_share_value_observations). map_flows never calls out: it reads the cache.

mod abi;
mod pb;

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use substreams::errors::Error;
use substreams::pb::substreams::Clock;
use substreams::scalar::BigInt;
use substreams::store::{
    DeltaInt64, Deltas, StoreGet, StoreGetProto, StoreNew, StoreSetIfNotExists,
    StoreSetIfNotExistsInt64, StoreSetIfNotExistsProto,
};
use substreams::Hex;
use substreams_ethereum::rpc::RpcBatch;

use pb::erc4626::v1 as erc4626;
use pb::vaultflows::v1 as vf;

/// Decimal128(18) in the ClickHouse sink: at most 18 fractional digits, or the sink truncates.
const DECIMAL_SCALE: u32 = 18;

// ---------------------------------------------------------------------------------------------
// configuration (manifest `params:`, urlencoded serde_qs form)
// ---------------------------------------------------------------------------------------------

struct Config {
    /// lowercase 0x-prefixed, in the order given
    vaults: Vec<String>,
    interval: u64,
    chain_id: u32,
}

impl Config {
    fn is_configured(&self, vault: &str) -> bool {
        self.vaults.iter().any(|v| v == vault)
    }
    fn is_sample_block(&self, block_number: u64) -> bool {
        block_number % self.interval == 0
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            match u8::from_str_radix(&input[i + 1..i + 3], 16) {
                Ok(b) => {
                    out.push(b);
                    i += 3;
                    continue;
                }
                Err(_) => {}
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn is_address(s: &str) -> bool {
    s.len() == 42
        && s.starts_with("0x")
        && s[2..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn parse_params(raw: &str) -> Result<Config, Error> {
    let mut vaults: Vec<String> = Vec::new();
    let mut interval: Option<u64> = None;
    let mut chain_id: Option<u32> = None;

    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some(kv) => kv,
            None => return Err(anyhow::anyhow!("params: \"{}\" is not a key=value pair", pair)),
        };
        let key = percent_decode(key);
        let value = percent_decode(value);
        match key.trim_end_matches("[]") {
            "vaults" => {
                let address = value.trim().to_ascii_lowercase();
                if !is_address(&address) {
                    return Err(anyhow::anyhow!(
                        "params: vault \"{}\" is not a lowercase 0x-prefixed 20-byte address",
                        value
                    ));
                }
                if !vaults.contains(&address) {
                    vaults.push(address);
                }
            }
            "interval" => {
                interval = Some(value.parse::<u64>().map_err(|_| {
                    anyhow::anyhow!("params: interval \"{}\" is not an integer", value)
                })?)
            }
            "chain_id" => {
                chain_id = Some(value.parse::<u32>().map_err(|_| {
                    anyhow::anyhow!("params: chain_id \"{}\" is not an integer", value)
                })?)
            }
            other => return Err(anyhow::anyhow!("params: unknown key \"{}\"", other)),
        }
    }

    if vaults.is_empty() {
        return Err(anyhow::anyhow!("params: no vaults[] entries"));
    }
    let interval = interval.ok_or_else(|| anyhow::anyhow!("params: interval is missing"))?;
    if interval == 0 {
        return Err(anyhow::anyhow!("params: interval must be > 0"));
    }
    let chain_id = chain_id.ok_or_else(|| anyhow::anyhow!("params: chain_id is missing"))?;
    if chain_id == 0 {
        return Err(anyhow::anyhow!("params: chain_id must be > 0"));
    }
    Ok(Config { vaults, interval, chain_id })
}

// ---------------------------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------------------------

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", Hex::encode(bytes))
}

/// Clock.id is the block hash as bare lowercase hex; the contract wants it 0x-prefixed.
fn block_hash_of(clock: &Clock) -> String {
    let id = clock.id.trim_start_matches("0x").to_ascii_lowercase();
    format!("0x{}", id)
}

fn block_timestamp_of(clock: &Clock) -> u64 {
    clock.timestamp.as_ref().map(|t| t.seconds.max(0) as u64).unwrap_or(0)
}

fn pow10(exponent: u32) -> BigInt {
    BigInt::from(10).pow(exponent)
}

/// `value / 10^decimals` as a plain non-negative decimal string, truncated to at most 18
/// fractional digits and with trailing fractional zeros removed. Never returns "".
fn scaled_string(value: &BigInt, decimals: u32) -> String {
    let digits = value.to_string();
    let digits = digits.trim_start_matches('-').to_string();
    if decimals == 0 {
        return digits;
    }
    let width = decimals as usize;
    let padded = if digits.len() <= width {
        format!("{}{}", "0".repeat(width + 1 - digits.len()), digits)
    } else {
        digits
    };
    let split = padded.len() - width;
    let integer = &padded[..split];
    let mut fraction = &padded[split..];
    if fraction.len() > DECIMAL_SCALE as usize {
        fraction = &fraction[..DECIMAL_SCALE as usize];
    }
    let fraction = fraction.trim_end_matches('0');
    if fraction.is_empty() {
        integer.to_string()
    } else {
        format!("{}.{}", integer, fraction)
    }
}

/// Assets per whole share implied by one flow: (assets_raw / 10^asset_dec) / (shares_raw / 10^share_dec),
/// truncated to 18 fractional digits. "0" when shares_raw is zero.
fn execution_rate(assets_raw: &BigInt, shares_raw: &BigInt, asset_dec: u32, share_dec: u32) -> String {
    if shares_raw.to_string() == "0" {
        return "0".to_string();
    }
    let numerator = assets_raw.clone() * pow10(share_dec + DECIMAL_SCALE);
    let denominator = shares_raw.clone() * pow10(asset_dec);
    let scaled = numerator / denominator;
    scaled_string(&scaled, DECIMAL_SCALE)
}

fn parse_uint(value: &str) -> Option<BigInt> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    BigInt::from_str(value).ok()
}

// ---------------------------------------------------------------------------------------------
// the metadata / state probe (the only eth_call site)
// ---------------------------------------------------------------------------------------------

struct Probe {
    asset: String,
    asset_decimals: u32,
    share_decimals: u32,
    name: String,
    symbol: String,
    total_assets: Option<BigInt>,
    total_supply: Option<BigInt>,
    assets_per_share: Option<BigInt>,
    /// every call the contract names as part of the probe returned and decoded
    ok: bool,
    /// empty when ok, else the first call that did not
    error: String,
}

/// asset(), decimals(), asset.decimals(), totalAssets(), totalSupply(), convertToAssets(10^decimals),
/// plus the best-effort name()/symbol(). Two round trips: the second batch needs the first's decimals.
fn probe_vault(address: &[u8]) -> Probe {
    let mut probe = Probe {
        asset: String::new(),
        asset_decimals: 0,
        share_decimals: 0,
        name: String::new(),
        symbol: String::new(),
        total_assets: None,
        total_supply: None,
        assets_per_share: None,
        ok: false,
        error: String::new(),
    };

    let first = match RpcBatch::new()
        .add(abi::erc4626::functions::Asset {}, address.to_vec())
        .add(abi::erc4626::functions::Decimals {}, address.to_vec())
        .add(abi::erc4626::functions::TotalAssets {}, address.to_vec())
        .add(abi::erc4626::functions::TotalSupply {}, address.to_vec())
        .add(abi::erc4626::functions::Name {}, address.to_vec())
        .add(abi::erc4626::functions::Symbol {}, address.to_vec())
        .execute()
    {
        Ok(responses) => responses,
        Err(err) => {
            probe.error = format!("eth_call batch failed: {}", err);
            return probe;
        }
    };

    let asset = RpcBatch::decode::<_, abi::erc4626::functions::Asset>(&first.responses[0]);
    let share_decimals = RpcBatch::decode::<_, abi::erc4626::functions::Decimals>(&first.responses[1]);
    probe.total_assets = RpcBatch::decode::<_, abi::erc4626::functions::TotalAssets>(&first.responses[2]);
    probe.total_supply = RpcBatch::decode::<_, abi::erc4626::functions::TotalSupply>(&first.responses[3]);
    probe.name = RpcBatch::decode::<_, abi::erc4626::functions::Name>(&first.responses[4]).unwrap_or_default();
    probe.symbol = RpcBatch::decode::<_, abi::erc4626::functions::Symbol>(&first.responses[5]).unwrap_or_default();

    let asset = match asset {
        Some(bytes) if bytes.len() == 20 => bytes,
        _ => {
            probe.error = "asset: reverted".to_string();
            return probe;
        }
    };
    probe.asset = hex0x(&asset);
    let share_decimals = match share_decimals {
        Some(value) => value.to_u64() as u32,
        None => {
            probe.error = "decimals: reverted".to_string();
            return probe;
        }
    };
    if share_decimals > 36 {
        probe.error = format!("decimals: {} out of range", share_decimals);
        return probe;
    }
    probe.share_decimals = share_decimals;

    let second = match RpcBatch::new()
        .add(abi::erc4626::functions::Decimals {}, asset.clone())
        .add(
            abi::erc4626::functions::ConvertToAssets { shares: pow10(share_decimals) },
            address.to_vec(),
        )
        .execute()
    {
        Ok(responses) => responses,
        Err(err) => {
            probe.error = format!("eth_call batch failed: {}", err);
            return probe;
        }
    };

    let asset_decimals = RpcBatch::decode::<_, abi::erc4626::functions::Decimals>(&second.responses[0]);
    probe.assets_per_share =
        RpcBatch::decode::<_, abi::erc4626::functions::ConvertToAssets>(&second.responses[1]);

    let asset_decimals = match asset_decimals {
        Some(value) => value.to_u64() as u32,
        None => {
            probe.error = "asset.decimals: reverted".to_string();
            return probe;
        }
    };
    if asset_decimals > 36 {
        probe.error = format!("asset.decimals: {} out of range", asset_decimals);
        return probe;
    }
    probe.asset_decimals = asset_decimals;

    if probe.total_assets.is_none() {
        probe.error = "totalAssets: reverted".to_string();
        return probe;
    }
    if probe.total_supply.is_none() {
        probe.error = "totalSupply: reverted".to_string();
        return probe;
    }
    if probe.assets_per_share.is_none() {
        probe.error = "convertToAssets: reverted".to_string();
        return probe;
    }

    probe.ok = true;
    probe
}

/// The two decimals a flow row needs, plus the status of the probe the row relied on.
#[derive(Clone)]
struct CachedMeta {
    asset_decimals: u32,
    share_decimals: u32,
    ok: bool,
    error: String,
}

impl CachedMeta {
    fn from_meta(meta: &vf::VaultMeta) -> Self {
        CachedMeta {
            asset_decimals: meta.asset_decimals,
            share_decimals: meta.share_decimals,
            ok: meta.call_ok,
            error: meta.call_error.clone(),
        }
    }
    fn from_probe(probe: &Probe) -> Self {
        CachedMeta {
            asset_decimals: probe.asset_decimals,
            share_decimals: probe.share_decimals,
            ok: probe.ok,
            error: probe.error.clone(),
        }
    }
    fn unavailable() -> Self {
        CachedMeta { asset_decimals: 0, share_decimals: 0, ok: false, error: "vault metadata: unavailable".to_string() }
    }
}

// ---------------------------------------------------------------------------------------------
// modules
// ---------------------------------------------------------------------------------------------

/// First-sight ledger over every address that emits a matching Deposit/Withdraw. The value is a
/// marker only — the block is read from the Clock by map_vault_probe, which sees this store's
/// deltas in the very block a key is created.
#[substreams::handlers::store]
fn store_vault_seen(events: erc4626::Events, store: StoreSetIfNotExistsInt64) {
    for transaction in &events.transactions {
        for log in &transaction.logs {
            if log.log.is_none() {
                continue;
            }
            store.set_if_not_exists(0, hex0x(&log.address), &1);
        }
    }
}

/// One VaultMeta row per address, the first time that address is ever observed.
#[substreams::handlers::map]
fn map_vault_probe(
    params: String,
    clock: Clock,
    seen: Deltas<DeltaInt64>,
) -> Result<vf::Events, Error> {
    let config = parse_params(&params)?;
    let mut events = vf::Events::default();

    for delta in seen.deltas.iter() {
        if delta.operation != substreams::pb::substreams::store_delta::Operation::Create {
            continue;
        }
        let vault = delta.key.to_ascii_lowercase();
        if !is_address(&vault) {
            continue;
        }
        let address = match Hex::decode(&vault[2..]) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let probe = probe_vault(&address);
        events.vaults.push(vf::VaultMeta {
            id: format!("{}-{}", config.chain_id, vault),
            chain_id: config.chain_id,
            vault: vault.clone(),
            first_seen_block: clock.number,
            asset: probe.asset.clone(),
            asset_decimals: probe.asset_decimals,
            share_decimals: probe.share_decimals,
            name: probe.name.clone(),
            symbol: probe.symbol.clone(),
            compliant: probe.ok,
            in_configured_list: config.is_configured(&vault),
            call_ok: probe.ok,
            call_error: probe.error.clone(),
        });
    }

    Ok(events)
}

/// Cache of the probe result, keyed by vault address, written once per vault.
///
/// Only a *compliant* probe is cached. `set_if_not_exists` is permanent, so caching a probe that
/// failed (an RPC hiccup on the one block a vault was first seen) would pin `meta_valid = false` on
/// that vault for the life of the store. Leaving the key absent instead lets `map_flows` fall back
/// to a live probe for the configured vaults; the VaultMeta row itself is still emitted with
/// `compliant = false`, as the contract requires.
#[substreams::handlers::store]
fn store_vault_meta(events: vf::Events, store: StoreSetIfNotExistsProto<vf::VaultMeta>) {
    for meta in &events.vaults {
        if meta.compliant {
            store.set_if_not_exists(0, &meta.vault, meta);
        }
    }
}

/// Deposit / Withdraw facts for the configured vaults, normalized from the cached metadata.
#[substreams::handlers::map]
fn map_flows(
    params: String,
    clock: Clock,
    events: erc4626::Events,
    meta_store: StoreGetProto<vf::VaultMeta>,
) -> Result<vf::Events, Error> {
    let config = parse_params(&params)?;
    let block_hash = block_hash_of(&clock);
    let block_timestamp = block_timestamp_of(&clock);
    let mut out = vf::Events::default();
    // In-block memo only: one store read (and at most one repair probe) per vault per block.
    let mut cache: HashMap<String, CachedMeta> = HashMap::new();

    for transaction in &events.transactions {
        let tx_hash = hex0x(&transaction.hash);
        for log in &transaction.logs {
            let vault = hex0x(&log.address);
            if !config.is_configured(&vault) {
                continue;
            }
            let (direction, caller, owner, receiver, assets, shares) = match &log.log {
                Some(erc4626::log::Log::Deposit(deposit)) => (
                    "deposit",
                    hex0x(&deposit.sender),
                    hex0x(&deposit.owner),
                    hex0x(&deposit.owner),
                    deposit.assets.clone(),
                    deposit.shares.clone(),
                ),
                Some(erc4626::log::Log::Withdraw(withdraw)) => (
                    "withdraw",
                    hex0x(&withdraw.sender),
                    hex0x(&withdraw.owner),
                    hex0x(&withdraw.receiver),
                    withdraw.assets.clone(),
                    withdraw.shares.clone(),
                ),
                None => continue,
            };

            let assets_raw = parse_uint(&assets);
            let shares_raw = parse_uint(&shares);

            // Cache hit is the normal path. A miss only happens for a vault whose first-sight probe
            // did not succeed (or whose very first flow lands in the same block as the probe), and
            // is repaired here with a live probe rather than emitting an unusable row.
            let meta = match cache.get(&vault) {
                Some(entry) => entry.clone(),
                None => {
                    let entry = match meta_store.get_last(&vault) {
                        Some(m) if m.compliant => CachedMeta::from_meta(&m),
                        _ => match Hex::decode(&vault[2..]) {
                            Ok(address) => CachedMeta::from_probe(&probe_vault(&address)),
                            Err(_) => CachedMeta::unavailable(),
                        },
                    };
                    cache.insert(vault.clone(), entry.clone());
                    entry
                }
            };

            let meta_valid = meta.ok && assets_raw.is_some() && shares_raw.is_some();
            let (call_ok, call_error) = (meta.ok, meta.error.clone());
            let (asset_decimals, share_decimals) =
                if meta_valid { (meta.asset_decimals, meta.share_decimals) } else { (0, 0) };

            let (assets_normalized, shares_normalized, rate) = match (meta_valid, &assets_raw, &shares_raw) {
                (true, Some(a), Some(s)) => (
                    scaled_string(a, asset_decimals),
                    scaled_string(s, share_decimals),
                    execution_rate(a, s, asset_decimals, share_decimals),
                ),
                _ => ("0".to_string(), "0".to_string(), "0".to_string()),
            };

            out.vault_flows.push(vf::VaultFlow {
                id: format!("{}-{}-{}", config.chain_id, clock.number, log.block_index),
                chain_id: config.chain_id,
                block_number: clock.number,
                block_hash: block_hash.clone(),
                block_timestamp,
                tx_hash: tx_hash.clone(),
                log_index: log.block_index,
                vault: vault.clone(),
                caller,
                owner,
                receiver,
                direction: direction.to_string(),
                assets_raw: assets_raw.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "0".to_string()),
                shares_raw: shares_raw.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "0".to_string()),
                assets_normalized,
                shares_normalized,
                asset_decimals,
                share_decimals,
                execution_rate: rate,
                meta_valid,
                call_ok,
                call_error,
            });
        }
    }

    Ok(out)
}

/// One ShareValueObservation per configured vault on every block of the sampling grid.
#[substreams::handlers::map]
fn map_share_value_observations(params: String, clock: Clock) -> Result<vf::Events, Error> {
    let config = parse_params(&params)?;
    let mut out = vf::Events::default();
    if !config.is_sample_block(clock.number) {
        return Ok(out);
    }
    let block_hash = block_hash_of(&clock);
    let block_timestamp = block_timestamp_of(&clock);
    let mut emitted: HashSet<String> = HashSet::new();

    for vault in &config.vaults {
        if !emitted.insert(vault.clone()) {
            continue;
        }
        let address = match Hex::decode(&vault[2..]) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let probe = probe_vault(&address);
        let (assets_per_share_raw, assets_per_share_normalized, total_assets_raw, total_supply_raw) =
            if probe.ok {
                let per_share = probe.assets_per_share.clone().unwrap_or_else(|| BigInt::from(0));
                (
                    per_share.to_string(),
                    scaled_string(&per_share, probe.asset_decimals),
                    probe.total_assets.clone().unwrap_or_else(|| BigInt::from(0)).to_string(),
                    probe.total_supply.clone().unwrap_or_else(|| BigInt::from(0)).to_string(),
                )
            } else {
                ("0".to_string(), "0".to_string(), "0".to_string(), "0".to_string())
            };

        out.share_value_observations.push(vf::ShareValueObservation {
            id: format!("{}-{}-{}", config.chain_id, clock.number, vault),
            chain_id: config.chain_id,
            block_number: clock.number,
            block_hash: block_hash.clone(),
            block_timestamp,
            vault: vault.clone(),
            sample_interval_blocks: config.interval as u32,
            assets_per_share_raw,
            assets_per_share_normalized,
            total_assets_raw,
            total_supply_raw,
            call_ok: probe.ok,
            call_error: probe.error.clone(),
        });
    }

    Ok(out)
}

/// The single from-proto sink module.
#[substreams::handlers::map]
fn map_events(
    flows: vf::Events,
    observations: vf::Events,
    probes: vf::Events,
) -> Result<vf::Events, Error> {
    Ok(vf::Events {
        vault_flows: flows.vault_flows,
        share_value_observations: observations.share_value_observations,
        vaults: probes.vaults,
        // Share migration is part of the public contract but carries no rows in v0.1.x:
        // the upstream extractor this package composes with emits Deposit/Withdraw only.
        share_transfers: Vec::new(),
    })
}
