//! eth_call batches. Every call runs at the state of the block being processed (Firehose pins the
//! block hash), so results are deterministic per block. Only compiled into the wasm path at runtime;
//! on the native target `RpcBatch::execute` is unimplemented, so nothing here is unit-tested directly.

use crate::abi::vault::functions as vault_fn;
use crate::pure::{bytes_to_hex, decimals_from_u64};
use substreams::scalar::BigInt;
use substreams_ethereum::pb::eth::rpc::RpcResponse;
use substreams_ethereum::rpc::RpcBatch;

/// Result of the first-sight metadata probe for one vault address.
#[derive(Debug, Default, Clone)]
pub struct VaultProbe {
    /// Lowercase 0x asset address; empty when `asset()` failed.
    pub asset: String,
    pub asset_decimals: Option<u32>,
    pub share_decimals: Option<u32>,
    pub total_assets: Option<String>,
    /// `convertToAssets(10^share_decimals)` as a decimal string.
    pub assets_per_share: Option<String>,
    pub name: String,
    pub symbol: String,
    /// One short entry per required call that failed; empty means compliant.
    pub errors: Vec<String>,
}

impl VaultProbe {
    pub fn compliant(&self) -> bool {
        self.errors.is_empty()
    }
    pub fn error_string(&self) -> String {
        self.errors.join("; ")
    }
}

/// Point-in-time read of one configured vault at a sampled block.
#[derive(Debug, Default, Clone)]
pub struct VaultObservation {
    pub share_decimals: Option<u32>,
    pub asset_decimals: Option<u32>,
    pub assets_per_share: Option<String>,
    pub total_assets: Option<String>,
    pub total_supply: Option<String>,
    pub errors: Vec<String>,
}

impl VaultObservation {
    /// ok only if convertToAssets, totalAssets and totalSupply all decoded (asset decimals are a bonus).
    pub fn ok(&self) -> bool {
        self.assets_per_share.is_some() && self.total_assets.is_some() && self.total_supply.is_some()
    }
    pub fn error_string(&self) -> String {
        self.errors.join("; ")
    }
}

fn shares_one_whole(share_decimals: u32) -> BigInt {
    BigInt::from(10u64).pow(share_decimals)
}

fn decode_uint(response: &RpcResponse) -> Option<String> {
    RpcBatch::decode::<BigInt, vault_fn::TotalAssets>(response).map(|v| v.to_string())
}

fn decode_decimals(response: &RpcResponse) -> Option<u32> {
    RpcBatch::decode::<BigInt, vault_fn::Decimals>(response).and_then(|v| decimals_from_u64(v.to_u64()))
}

fn decode_address(response: &RpcResponse) -> Option<Vec<u8>> {
    RpcBatch::decode::<Vec<u8>, vault_fn::Asset>(response).filter(|a| a.len() == 20 && a.iter().any(|b| *b != 0))
}

fn decode_string<F>(response: &RpcResponse) -> String
where
    F: substreams_ethereum::rpc::RPCDecodable<String> + substreams_ethereum::Function,
{
    RpcBatch::decode::<String, F>(response).unwrap_or_default()
}

/// Two round trips: (asset, decimals, totalAssets, name, symbol) then (asset.decimals, convertToAssets(10^dec)).
/// The second depends on the first, so this is the minimum for the probe the contract describes.
pub fn probe_vault(vault: &[u8]) -> VaultProbe {
    let mut out = VaultProbe::default();

    let first = RpcBatch::new()
        .add(vault_fn::Asset {}, vault.to_vec())
        .add(vault_fn::Decimals {}, vault.to_vec())
        .add(vault_fn::TotalAssets {}, vault.to_vec())
        .add(vault_fn::Name {}, vault.to_vec())
        .add(vault_fn::Symbol {}, vault.to_vec())
        .execute();

    let first = match first {
        Ok(r) if r.responses.len() == 5 => r,
        Ok(r) => {
            out.errors.push(format!("rpc: expected 5 responses, got {}", r.responses.len()));
            return out;
        }
        Err(e) => {
            out.errors.push(format!("rpc: {e}"));
            return out;
        }
    };

    let asset = decode_address(&first.responses[0]);
    if asset.is_none() {
        out.errors.push("asset: failed".to_string());
    }
    out.share_decimals = decode_decimals(&first.responses[1]);
    if out.share_decimals.is_none() {
        out.errors.push("decimals: failed".to_string());
    }
    out.total_assets = decode_uint(&first.responses[2]);
    if out.total_assets.is_none() {
        out.errors.push("totalAssets: failed".to_string());
    }
    out.name = decode_string::<vault_fn::Name>(&first.responses[3]);
    out.symbol = decode_string::<vault_fn::Symbol>(&first.responses[4]);

    // Second batch: only the calls whose inputs we now have.
    let mut second = RpcBatch::new();
    let mut asset_decimals_idx: Option<usize> = None;
    let mut convert_idx: Option<usize> = None;
    let mut next = 0usize;
    if let Some(asset_addr) = &asset {
        out.asset = bytes_to_hex(asset_addr);
        second = second.add(vault_fn::Decimals {}, asset_addr.clone());
        asset_decimals_idx = Some(next);
        next += 1;
    }
    if let Some(dec) = out.share_decimals {
        second = second.add(
            vault_fn::ConvertToAssets {
                shares: shares_one_whole(dec),
            },
            vault.to_vec(),
        );
        convert_idx = Some(next);
        next += 1;
    } else {
        out.errors.push("convertToAssets: skipped (decimals unavailable)".to_string());
    }

    if next == 0 {
        return out;
    }

    match second.execute() {
        Ok(r) if r.responses.len() == next => {
            if let Some(i) = asset_decimals_idx {
                out.asset_decimals = decode_decimals(&r.responses[i]);
                if out.asset_decimals.is_none() {
                    out.errors.push("asset.decimals: failed".to_string());
                }
            }
            if let Some(i) = convert_idx {
                out.assets_per_share = RpcBatch::decode::<BigInt, vault_fn::ConvertToAssets>(&r.responses[i]).map(|v| v.to_string());
                if out.assets_per_share.is_none() {
                    out.errors.push("convertToAssets: failed".to_string());
                }
            }
        }
        Ok(r) => out.errors.push(format!("rpc: expected {next} responses, got {}", r.responses.len())),
        Err(e) => out.errors.push(format!("rpc: {e}")),
    }
    out
}

/// Two round trips for the whole configured list: (decimals, asset) per vault, then
/// (asset.decimals, convertToAssets(10^dec), totalAssets, totalSupply) per vault. Failed vaults are
/// still returned, in input order, so callers can emit a row with `ok=false`.
pub fn observe_vaults(vaults: &[Vec<u8>]) -> Vec<VaultObservation> {
    let mut out: Vec<VaultObservation> = vec![VaultObservation::default(); vaults.len()];
    if vaults.is_empty() {
        return out;
    }

    let mut first = RpcBatch::new();
    for v in vaults {
        first = first.add(vault_fn::Decimals {}, v.clone()).add(vault_fn::Asset {}, v.clone());
    }
    let mut assets: Vec<Option<Vec<u8>>> = vec![None; vaults.len()];
    match first.execute() {
        Ok(r) if r.responses.len() == vaults.len() * 2 => {
            for (i, obs) in out.iter_mut().enumerate() {
                obs.share_decimals = decode_decimals(&r.responses[2 * i]);
                if obs.share_decimals.is_none() {
                    obs.errors.push("decimals: failed".to_string());
                }
                assets[i] = decode_address(&r.responses[2 * i + 1]);
                if assets[i].is_none() {
                    obs.errors.push("asset: failed".to_string());
                }
            }
        }
        Ok(r) => {
            for obs in out.iter_mut() {
                obs.errors.push(format!("rpc: expected {} responses, got {}", vaults.len() * 2, r.responses.len()));
            }
            return out;
        }
        Err(e) => {
            for obs in out.iter_mut() {
                obs.errors.push(format!("rpc: {e}"));
            }
            return out;
        }
    }

    // Second batch with per-vault index bookkeeping.
    struct Slots {
        asset_decimals: Option<usize>,
        convert: Option<usize>,
        total_assets: usize,
        total_supply: usize,
    }
    let mut second = RpcBatch::new();
    let mut slots: Vec<Slots> = Vec::with_capacity(vaults.len());
    let mut next = 0usize;
    for (i, v) in vaults.iter().enumerate() {
        let mut s = Slots {
            asset_decimals: None,
            convert: None,
            total_assets: 0,
            total_supply: 0,
        };
        if let Some(a) = &assets[i] {
            second = second.add(vault_fn::Decimals {}, a.clone());
            s.asset_decimals = Some(next);
            next += 1;
        }
        if let Some(dec) = out[i].share_decimals {
            second = second.add(
                vault_fn::ConvertToAssets {
                    shares: shares_one_whole(dec),
                },
                v.clone(),
            );
            s.convert = Some(next);
            next += 1;
        } else {
            out[i].errors.push("convertToAssets: skipped (decimals unavailable)".to_string());
        }
        second = second.add(vault_fn::TotalAssets {}, v.clone());
        s.total_assets = next;
        next += 1;
        second = second.add(vault_fn::TotalSupply {}, v.clone());
        s.total_supply = next;
        next += 1;
        slots.push(s);
    }

    match second.execute() {
        Ok(r) if r.responses.len() == next => {
            for (i, s) in slots.iter().enumerate() {
                let obs = &mut out[i];
                if let Some(idx) = s.asset_decimals {
                    obs.asset_decimals = decode_decimals(&r.responses[idx]);
                    if obs.asset_decimals.is_none() {
                        obs.errors.push("asset.decimals: failed".to_string());
                    }
                }
                if let Some(idx) = s.convert {
                    obs.assets_per_share =
                        RpcBatch::decode::<BigInt, vault_fn::ConvertToAssets>(&r.responses[idx]).map(|v| v.to_string());
                    if obs.assets_per_share.is_none() {
                        obs.errors.push("convertToAssets: failed".to_string());
                    }
                }
                obs.total_assets = decode_uint(&r.responses[s.total_assets]);
                if obs.total_assets.is_none() {
                    obs.errors.push("totalAssets: failed".to_string());
                }
                obs.total_supply =
                    RpcBatch::decode::<BigInt, vault_fn::TotalSupply>(&r.responses[s.total_supply]).map(|v| v.to_string());
                if obs.total_supply.is_none() {
                    obs.errors.push("totalSupply: failed".to_string());
                }
            }
        }
        Ok(r) => {
            for obs in out.iter_mut() {
                obs.errors.push(format!("rpc: expected {next} responses, got {}", r.responses.len()));
            }
        }
        Err(e) => {
            for obs in out.iter_mut() {
                obs.errors.push(format!("rpc: {e}"));
            }
        }
    }
    out
}
