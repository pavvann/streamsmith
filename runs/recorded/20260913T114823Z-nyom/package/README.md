# erc4626-flows

Normalized ERC-4626 vault activity on Base (chain id 8453), emitted as one `vaultflows.v1.Events`
message per block for a ClickHouse `from-proto` sink.

## Overview

The package turns raw ERC-4626 `Deposit` / `Withdraw` logs into settled, normalized facts for a
configured set of vaults, and samples each vault's `convertToAssets` on a fixed block grid so a
consumer can read the assets-per-share series without interpolating anything. Decimals, the
underlying asset and the compliance verdict come from a one-time metadata probe per vault, cached in
a store, so the hot path issues no `eth_call` at all. Every row carries a deterministic id, so
replays and restarts are idempotent.

The public output contract is `proto/vaultflows.proto` (identical to `specs/vaultflows.proto` in the
parent repository); the gate compares the normalized protobuf-descriptor hash of the built package
against it.

## Modules

| Module | Kind | Output | Description |
|---|---|---|---|
| `store_vault_seen` | store (`set_if_not_exists`, `int64`) | — | First-sight ledger of every address that emits a matching `Deposit`/`Withdraw` on the chain. |
| `map_vault_probe` | map | `proto:vaultflows.v1.Events` | On the block a vault is first seen, probes `asset()`, `decimals()`, `asset.decimals()`, `totalAssets()`, `totalSupply()`, `convertToAssets()` and emits one `VaultMeta` row. |
| `store_vault_meta` | store (`set_if_not_exists`, `proto:vaultflows.v1.VaultMeta`) | — | Cache of the probe result, keyed by vault address. |
| `map_flows` | map | `proto:vaultflows.v1.Events` | `VaultFlow` rows for the configured vaults, normalized from the cached decimals. No RPC. |
| `map_share_value_observations` | map | `proto:vaultflows.v1.Events` | One `ShareValueObservation` per configured vault at every block where `block_number % interval == 0`. |
| `map_events` | map | `proto:vaultflows.v1.Events` | **The sink module.** Merges the three producers into a single message. |

`map_events` is the only module a sink or consumer needs to stream.

### Tables

`map_events` emits four repeated fields, one ClickHouse table each: `vault_flows`,
`share_value_observations`, `vaults`, `share_transfers`. `share_transfers` is part of the contract
but carries no rows in v0.1.x — the upstream extractor this package composes with emits
`Deposit`/`Withdraw` only, and share migration is not in scope for this version.

## Parameters

Three modules take the same `params` string (serde_qs / urlencoded form), set as manifest defaults:

```
vaults[]=<address>&vaults[]=<address>&interval=<blocks>&chain_id=<id>
```

* `vaults[]` — repeated, lowercase `0x`-prefixed 20-byte addresses, matched exactly.
* `interval` — sampling grid in blocks (1800 ≈ 1 hour on Base).
* `chain_id` — written into every row and into every row id.

Override with `-p map_flows=…` (and the same for `map_vault_probe` /
`map_share_value_observations`) to point the package at a different vault set.

## Prerequisites

* `substreams` CLI ≥ 1.22, `buf`, Rust with the `wasm32-unknown-unknown` target.
* A Substreams data-plane token (`SUBSTREAMS_API_TOKEN` or `SUBSTREAMS_API_KEY`).

## Quick start

```bash
substreams build

# 200 blocks around a busy window (42 Deposit/Withdraw logs on the two configured vaults)
substreams run -e base-mainnet.streamingfast.io:443 \
  erc4626-flows-v0.1.1.spkg map_events \
  -s 51092254 -t 51092454 --network base -o jsonl --limit-processed-blocks 0

# a block on the sampling grid (51093000 = 28385 x 1800): one observation per configured vault
substreams run -e base-mainnet.streamingfast.io:443 \
  erc4626-flows-v0.1.1.spkg map_events \
  -s 51092998 -t 51093002 --network base -o jsonl --limit-processed-blocks 0
```

`--limit-processed-blocks 0` is required: the CLI refuses any request that would process more than
10,000 blocks, and the stores prepare from `initialBlock` (51001200).

## Conventions

* Addresses and hashes are lowercase `0x` hex.
* `*_raw` are uint256 decimal digit strings; `*_normalized` and `execution_rate` are non-negative
  decimal strings with at most 18 fractional digits.
* A numeric string is never empty. When a value is not computable (`meta_valid` false, `call_ok`
  false, or a zero divisor) it is `"0"` and the accompanying flag says so — the ClickHouse
  `from-proto` sink panics on an empty string for a `convertTo` column.
* Nothing is interpolated between observations.
* Vocabulary: *execution rate* (assets per share implied by one flow), *share value* (assets per
  share observed by `convertToAssets` at a sampled block), *share migration* (transfer of shares
  between owners).
