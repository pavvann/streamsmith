# Contract notes for `specs/vaultflows.proto` (A2b, 2026-09-10)

Field-by-field semantics of the public contract, the deterministic id scheme, the params encoding, the fee-wrapper
consequence, the banned-word check and the unverified list. Every rule cites a file or URL. **UNVERIFIED** marks
items not confirmed against a primary source. Companion files: `specs/streamsmith.yaml` (configuration),
`specs/gate.yaml` (what the gate asserts), `docs/build/vaults.md` (vault facts), `docs/build/substreams-facts.md`.

Sink code was read at `streamingfast/substreams` branch `develop` (raw.githubusercontent.com, 2026-09-10) and
cross-checked at tags `v1.22.0` (local CLI) and `v1.20.2` (the version the SQL skill says it verified against):
`sink/sql/db_proto/sql/schema/{table,column}.go` and `sink/sql/db_proto/sql/click_house/{types,dialect,decimal,integer,accumulator_inserter}.go`.

## 1. From-proto sink rules the proto must satisfy (and how it does)

| Rule | Source | Status in `vaultflows.proto` |
|---|---|---|
| Exactly one `primary_key: true` per table message | SQL skill SKILL.md "Hard rule: exactly one primary key"; `table.go`: `multiple field mark has primary keys are not supported` | one `id` per table |
| `order_by_fields[0]` must be the primary key | SQL skill "PK must prefix ORDER BY"; ClickHouse `Primary key must be a prefix of the sorting key` | every table starts `order_by_fields` with `id` |
| `clickhouse_table_options` with >= 1 `order_by_fields` required | SQL skill "Table options"; `clickhouse-patterns.md` | present on all four tables |
| Partition on `toYYYYMM(_block_timestamp_)` only (`toStartOfMonth` ignored, `toYYYYDD` mis-emitted in v1.20.2) | `clickhouse-patterns.md` "Upstream bugs" | `partition_fields: [{ name: "_block_timestamp_", function: toYYYYMM }]` |
| Scalar type mapping: string->String, uint32->UInt32, uint64->UInt64, bool->Bool, enum->Int32, bytes->String; string+`convertTo` -> UInt256 / Decimal128(scale) | upstream `docs/references/sql/proto-annotations.md` "Type Mappings"; `click_house/types.go` `MapFieldType` (`EnumKind -> TypeInteger32`) | only these kinds are used |
| **Message-typed fields that are not `google.protobuf.Timestamp` and not `inline: true` are silently skipped** | `schema/table.go` `processColumns`: `if !isTimestamp && !isInline { continue }`; `types.go` would `panic("Message type not supported")` if reached | `CallStatus` removed; flags flattened to `call_ok` + `call_error` (see "Proto changes by A2b") |
| `inline: true` exists (`Column.inline = 6`, since <= v1.20.2) but renders a ClickHouse `Nested(...)` column (arrays) and is undocumented in the skill and the upstream reference | `schema.proto` v1.20.2 line 121; `column.go` `NewColumn`; `dialect.go` `Nested(%s)` | not used (arrays would make `call_ok` awkward to filter on) |
| **Empty string in a `convertTo` column panics the sink** (unless the field has the `optional` keyword) | `click_house/decimal.go` `"empty string cannot be converted to decimal"`, `integer.go` `"... to uint256"`, `accumulator_inserter.go` `panic(fmt.Sprintf("failed to convert string to decimal128 ..."))`, guarded only by `column.IsOptional && stringValue == ""` | numeric strings are never empty; `"0"` + flag convention (section 4) |
| Fractional digits beyond `scale` are truncated, fewer are zero-padded; Decimal128(18) range is `|x| < 10^20` | `decimal.go` `StringToDecimal128` ("Truncate if too many decimal places"; `10^38` bound) | contract caps fractional digits at 18 |
| Injected columns `_block_number_`, `_block_timestamp_`, `_version_`, `_deleted_` (last two ClickHouse-only); tables are `ReplacingMergeTree(_version_, _deleted_)`; reorgs insert tombstones; **always filter `_deleted_ = 0`** | SQL skill "Injected columns", "Reorg handling"; `dialect.go` | no proto field uses these names; views must filter `_deleted_ = 0` (`streamsmith.yaml` sink.views comment) |
| `_row_id_` is added only to tables with no `order_by_fields` | `proto-annotations.md` "ClickHouse-Specific Options"; `dialect.go` `hasDefaultOrderBy` | not applicable (all tables declare `order_by_fields`) |
| ClickHouse identifiers are emitted **unquoted**; `index` is broken, `from` verified fine, `to` untested | `clickhouse-patterns.md` "Column naming"; `dialect.go` `fmt.Sprintf("%s %s", f.Name, fieldType)` | `ShareTransfer.from`/`to` renamed `from_owner`/`to_owner` |
| Schema evolution is a stub: any column change after deploy needs drop + recreate / `ResetDeployment drop_schema` | SQL skill "Schema evolution" | contract frozen; `gate.yaml` `descriptor_hash_match` + `spec_unmodified` |
| The sink annotations import path is `sf/substreams/sink/sql/schema/v1/schema.proto`, proto package bare `schema` | SQL skill "From proto definition" | `import "sf/substreams/sink/sql/schema/v1/schema.proto"`; options `(schema.table)`, `(schema.field)` |
| **BSR module `buf.build/streamingfast/substreams-sink-sql` is retired**; the file now lives in `buf.build/streamingfast/substreams` | `buf ls-files buf.build/streamingfast/substreams-sink-sql` -> only `deprecated/substreams_sink_sql/v1/moved.proto` ("The SQL sink definitions live in buf.build/streamingfast/substreams"); `buf ls-files buf.build/streamingfast/substreams` lists `sf/substreams/sink/sql/schema/v1/schema.proto` (2026-09-10) | `streamsmith.yaml` sink.descriptorSets corrected; offline copy at `packages/streamsmith/proto-deps/` |

`buf lint` (STANDARD, `PACKAGE_DIRECTORY_MATCH` excepted because docs/PROJECT.md section 5 fixes the path `specs/vaultflows.proto`): clean. `buf build`: OK. Normalized descriptor hash: `11b959fc25edfb3c135d6cc39119df8bb0b442b1b245e999c6912483a1fc2c8b` (algorithm in `specs/gate.yaml` `descriptorHash`).

Cross-check against `specs/receipt.schema.json`: `protoDescriptorHash` = the hash above (algorithm defined in gate.yaml); `parameters.vaults` pattern `^0x[0-9a-f]{40}$` matches the lowercase convention; `parameters.sampleIntervalBlocks` = `ShareValueObservation.sample_interval_blocks`; `parameters.chainId` = every table's `chain_id`; `gate.ranges` `^\d+:\d+$` = gate.yaml `start:stop` (stop exclusive); `outputModule` = `map_events`.

## 2. Field-by-field semantics

Common to every table: `chain_id` is 8453 (Base; `streamsmith.yaml` chainId). `block_number`, `block_hash`, `block_timestamp` come from the Substreams clock (`sf.substreams.v1.Clock`; `block_timestamp` in unix seconds, UInt64). Addresses and hashes are lowercase `0x` hex. ClickHouse types are from the mapping table above.

### `Events` (root, not a table)
| Field | # | Meaning |
|---|---|---|
| `vault_flows` | 1 | -> table `vault_flows` |
| `share_value_observations` | 2 | -> table `share_value_observations` |
| `vaults` | 3 | -> table `vaults` |
| `share_transfers` | 4 | -> table `share_transfers` (may stay empty in v0.1.0) |

Only messages with `(schema.table)` become tables (`schema.proto`: "Only message with the option will be converted to database table"); `Events` itself has none. A single block may carry rows for several tables; the module that emits `Events` is `map_events` (`streamsmith.yaml` outputModule).

### `FlowDirection` (enum, stored as Int32 in ClickHouse, TEXT in Postgres)
`FLOW_DIRECTION_UNSPECIFIED = 0` (never emitted), `FLOW_DIRECTION_DEPOSIT = 1` for ERC-4626 `Deposit(sender, owner, assets, shares)`, `FLOW_DIRECTION_WITHDRAW = 2` for `Withdraw(sender, receiver, owner, assets, shares)` (signatures per Pinax `vendor/substreams-evm/proto/v1/erc4626.proto`; `enum.go`: "PostgreSQL declares the column TEXT, ClickHouse declares it Int32").

### `VaultFlow` -> `vault_flows` (one row per Deposit/Withdraw log on a configured vault)
| Field | # | Type (CH) | Semantics |
|---|---|---|---|
| `id` | 1 | String, PK | `"{chain_id}-{block_number}-{log_index}"`, e.g. `8453-51092263-406` (section 3) |
| `chain_id` | 2 | UInt32 | 8453 |
| `block_number` | 3 | UInt64 | block containing the log |
| `block_hash` | 4 | String | hash of that block |
| `block_timestamp` | 5 | UInt64 | unix seconds |
| `tx_hash` | 6 | String | transaction hash (Pinax `Transaction.hash`, hex-encoded) |
| `log_index` | 7 | UInt32 | receipt log index **within the block** (Firehose `Log.blockIndex`, surfaced as Pinax `Log.block_index`); equals `logIndex` of `eth_getLogs`, e.g. 406 for the first Gauntlet deposit in vaults.md |
| `vault` | 8 | String | emitting contract (Pinax `Log.address`), lowercase; always in the configured list |
| `caller` | 9 | String | event `sender` (Pinax `Deposit.sender` / `Withdraw.sender`): the address that called deposit/mint/withdraw/redeem, often a router or the fee wrapper |
| `owner` | 10 | String | `Deposit.owner` (shares minted to) or `Withdraw.owner` (shares burned from) |
| `receiver` | 11 | String | `Withdraw.receiver` (assets sent to); on a deposit set equal to `owner` |
| `direction` | 12 | Int32 | 1 deposit, 2 withdraw |
| `assets_raw` | 13 | UInt256 | event `assets`, asset base units (USDC has 6 decimals). Deposit: includes any entry fee; Withdraw: net of exit fee (EIP-4626, Pinax README "Fee spread") |
| `shares_raw` | 14 | UInt256 | event `shares`, share base units (both vaults: 18 decimals, vaults.md) |
| `assets_normalized` | 15 | Decimal128(18) | `assets_raw / 10^asset_decimals`; `"0"` when `meta_valid` is false |
| `shares_normalized` | 16 | Decimal128(18) | `shares_raw / 10^share_decimals`; `"0"` when `meta_valid` is false |
| `asset_decimals` | 17 | UInt32 | `decimals()` of `asset()` from the first-sight probe; 0 when `meta_valid` is false |
| `share_decimals` | 18 | UInt32 | vault `decimals()`; 0 when `meta_valid` is false |
| `execution_rate` | 19 | Decimal128(18) | `assets_normalized / shares_normalized` for this single flow, asset units per whole share; deposit-implied or withdraw-implied per `direction`; `"0"` when `shares_raw == 0` or `meta_valid` is false. Expected about 1.04 for both vaults (vaults.md) |
| `meta_valid` | 20 | Bool | true when the vault passed the first-sight probe (`asset()`, `decimals()`, `asset.decimals()`, `totalAssets()`, `convertToAssets()`) and fields 15-19 are populated |
| *(reserved 21 `call_status`)* | | | was `CallStatus`; dropped by the sink (section 1) |
| `call_ok` | 22 | Bool | status of the probe this row relied on: every call returned and decoded |
| `call_error` | 23 | String | empty when `call_ok`; else short reason, e.g. `convertToAssets: reverted` |

Rows are emitted only for vaults in the configured list (`streamsmith.yaml` `vaults`, passed via params). Non-compliant addresses never produce rows (they appear in `vaults` with `compliant = false`).

### `ShareValueObservation` -> `share_value_observations` (one row per configured vault per sampled block)
| Field | # | Type (CH) | Semantics |
|---|---|---|---|
| `id` | 1 | String, PK | `"{chain_id}-{block_number}-{vault}"` |
| `chain_id` | 2 | UInt32 | 8453 |
| `block_number` | 3 | UInt64 | sampled block; `block_number % sample_interval_blocks == 0` |
| `block_hash` | 4 | String | hash of the sampled block (the state the calls executed against) |
| `block_timestamp` | 5 | UInt64 | unix seconds |
| `vault` | 6 | String | configured vault, lowercase |
| `sample_interval_blocks` | 7 | UInt32 | 1800 (`streamsmith.yaml` sampleIntervalBlocks; 1800 x 2.000 s = 1 h, vaults.md block-time check) |
| `assets_per_share_raw` | 8 | UInt256 | `convertToAssets(10^share_decimals)` at this block's state, in asset base units (e.g. 1040743 at block 51093000 for Gauntlet, gate.yaml); `"0"` when `call_ok` is false |
| `assets_per_share_normalized` | 9 | Decimal128(18) | `assets_per_share_raw / 10^asset_decimals` (assets per whole share); `"0"` when `call_ok` is false |
| `total_assets_raw` | 10 | UInt256 | `totalAssets()`; `"0"` when `call_ok` is false |
| `total_supply_raw` | 11 | UInt256 | `totalSupply()` of the share token; `"0"` when `call_ok` is false |
| *(reserved 12 `call_status`)* | | | |
| `call_ok` | 13 | Bool | true only if `convertToAssets`, `totalAssets`, `totalSupply` all returned and decoded |
| `call_error` | 14 | String | empty when `call_ok`; else names the failed call |

Semantics: a point-in-time read; **never interpolated** between samples (docs/PROJECT.md 4.2). eth_calls execute at the processed block hash (substreams-facts.md (b): "All `eth_call` operations are executed at the specific block hash being processed"), so the row is reproducible; `gate.yaml` `observation_matches_reference` checks it against an archive-RPC read. Rows are emitted even when the calls fail, with `call_ok = false`, so gaps are visible rather than silent. "Observed-window share-value growth over N hours, blocks X-Y" is a downstream derivation over two of these rows (`streamsmith.yaml` view `share_value_growth`).

### `VaultMeta` -> `vaults` (one row per address ever seen emitting a matching Deposit/Withdraw)
| Field | # | Type (CH) | Semantics |
|---|---|---|---|
| `id` | 1 | String, PK | `"{chain_id}-{vault}"` |
| `chain_id` | 2 | UInt32 | 8453 |
| `vault` | 3 | String | the emitting address, lowercase |
| `first_seen_block` | 4 | UInt64 | block at which the first-sight probe ran (first matching log at or after the module's initialBlock) |
| `asset` | 5 | String | `asset()`; empty if the probe failed (plain String column, empty allowed). Expected `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (Base USDC) for both configured vaults |
| `asset_decimals` | 6 | UInt32 | `decimals()` of the asset (6 for USDC); 0 if the probe failed |
| `share_decimals` | 7 | UInt32 | vault `decimals()` (18 for both); 0 if the probe failed |
| `name` | 8 | String | `name()` if decodable (`Gauntlet USDC Prime`, `Steakhouse Prime USDC`), else empty |
| `symbol` | 9 | String | `symbol()` if decodable (`gtusdcp`, `steakUSDC`), else empty |
| `compliant` | 10 | Bool | heuristic: all probe calls succeeded and decoded (docs/PROJECT.md 4.2 "Labeled heuristic") |
| `in_configured_list` | 11 | Bool | address is in the params vault list |
| *(reserved 12 `call_status`)* | | | |
| `call_ok` | 13 | Bool | every probe call returned and decoded (equals `compliant` in v0.1.0) |
| `call_error` | 14 | String | empty when `call_ok`; else the first failed call |

Because the probe runs once at first sight (store `set_if_not_exists`, substreams-facts.md (c)) and both vaults were active long before the gate ranges, **no `vaults` rows are expected inside the gate ranges**; they are emitted near `startBlock` 51001200 during the backfill. The gate therefore only uses this table for the success ratio when rows happen to be present.

### `ShareTransfer` -> `share_transfers` (optional; share migration between owners)
| Field | # | Type (CH) | Semantics |
|---|---|---|---|
| `id` | 1 | String, PK | `"{chain_id}-{block_number}-{log_index}"` |
| `chain_id` .. `log_index` | 2-7 | as in VaultFlow | |
| `vault` | 8 | String | share token = vault address |
| `from_owner` | 9 | String | ERC-20 Transfer `from`; never `0x0` (mints paired with Deposit are excluded) |
| `to_owner` | 10 | String | ERC-20 Transfer `to`; never `0x0` (burns paired with Withdraw are excluded) |
| `shares_raw` | 11 | UInt256 | transferred shares, base units |
| `shares_normalized` | 12 | Decimal128(18) | `shares_raw / 10^share_decimals`; `"0"` when `meta_valid` is false |
| `share_decimals` | 13 | UInt32 | |
| `meta_valid` | 14 | Bool | |

Vocabulary: this is "share migration", never "collateral reuse" (docs/PROJECT.md 4.2).

## 3. Deterministic id scheme

| Table | id | Example |
|---|---|---|
| `vault_flows`, `share_transfers` | `{chain_id}-{block_number}-{log_index}` | `8453-51092263-406` |
| `share_value_observations` | `{chain_id}-{block_number}-{vault}` | `8453-51093000-0x050ce30b927da55177a4914ec73480238bad56f0` |
| `vaults` | `{chain_id}-{vault}` | `8453-0x050ce30b927da55177a4914ec73480238bad56f0` |

Rules: decimal integers without padding; `vault` lowercase `0x` hex; separator `-`; no other components. `log_index` is the block-wide receipt index, unique per block, so `tx_hash` is not part of the id (it remains a column). The id is the single `primary_key` and `order_by_fields[0]`, so a replay or restart re-inserts the same key and `ReplacingMergeTree(_version_, _deleted_)` collapses duplicates on merge; queries still filter `_deleted_ = 0`. `gate.yaml` `ids_unique` checks format, component equality and uniqueness; `log_index_matches_rpc` checks the block-wide property against `eth_getLogs` values (warn until observed once).

## 4. Numeric string rules

- `*_raw`: `^[0-9]+$`, value < 2^256 (sink `StringToUInt256`).
- `*_normalized`, `execution_rate`: `^[0-9]+(\.[0-9]{1,18})?$`, integer part <= 20 digits (Decimal128(18): `|x| < 10^20`, `decimal.go`). Digits beyond 18 fractional places would be silently truncated by the sink, so the module must not emit them.
- **Never empty.** Not computable -> `"0"` and the flag (`meta_valid` / `call_ok`) is false. Consumers must gate on the flag; a genuine zero (e.g. a zero-`assets` deposit, legal on-chain) is distinguishable because the flag is true. Reason: empty string panics the ClickHouse from-proto inserter (section 1).
- `gate.yaml` `numeric_strings_valid` enforces all of the above on the run output.

## 5. Params encoding and how modules parse it

- Value (`streamsmith.yaml` params.value, also `packages/erc4626-flows/substreams.yaml` `params:` for each module with a `params` input):
  `vaults[]=0x050ce30b927da55177a4914ec73480238bad56f0&vaults[]=0xbeef0e0834849acc03f0089f01f4f1eeb06873c9&interval=1800&chain_id=8453`
- Encoding: URL-encoded query string, multi-valued key as `name[]=`, per upstream `parameterized-modules.md` ("To pass multiple parameters, you can encode them as a URL-encoded query string ... `address[]=aaa..aaa&address[]=bbb..bbb&amount=100`", decoded with `serde_qs`) as cited in substreams-facts.md (a).
- Declaration: `inputs: - params: string` must be the **first** input of each module that uses it (same source: "it's always a string and it's always the first input for the module"); the handler receives it as its first argument (`fn map_x(params: String, ...)`).
- Parsing (Rust): `serde_qs::from_str::<Params>(&params)` into `struct Params { vaults: Vec<String>, interval: u64, chain_id: u32 }`; then lowercase every vault and compare log addresses as lowercase `0x` hex (block-filtering.md: "Match keys exactly - 0x-prefixed lowercase hex"). `interval` is `sample_interval_blocks`; `chain_id` fills `chain_id`. Unknown or missing keys are a module error, not a default (a defaulted vault list would silently emit nothing).
- Every module receives the **same** string, so the observation module and the flow filter cannot disagree.
- Hosted deploy: the same string goes in `ExecutionConfig.parameters` (substreams-facts.md (a)/(e)); the receipt records `parametersHash = sha256(canonical JSON {vaults: sorted lowercase, sampleIntervalBlocks, chainId})` (`receipt.schema.json`). The params string and `parametersHash` are two encodings of the same three values; `gate.yaml` `params_match` ties the built package's string to `streamsmith.yaml`, and Streamsmith derives both from `streamsmith.yaml`, never by hand.
- Changing the vault list (e.g. adding the fee wrappers, section 6) changes the string, the hash, and therefore requires a new package version and receipt (`streamsmith.yaml` comment: "Do not change before the recorded run without re-tagging").

## 6. Fee-wrapper consequence and Vaultpilot self-exclusion

From `docs/build/vaults.md` "Design-changing consequence": Privy Earn deposits go through a **fee wrapper**, "a lightweight Vault V2 that deposits into the main Morpho Vault V2" (Morpho docs, https://docs.morpho.org/developers/earn/concepts/fee-wrapper), deployed per app in the Privy Dashboard; Privy's `vault_address` is the wrapper, not `0x050c...`/`0xbeef...`. Wrappers are not listed on app.morpho.org.

What this means for the contract and for Vaultpilot:

1. **Underlying-vault rows.** A Privy deposit is expected (UNVERIFIED, inferred from the architecture) to produce a `Deposit` on the underlying vault with `caller`/`owner` = the wrapper (or its adapter), and a `Deposit` on the wrapper with `owner` = the Privy wallet. Only the first is a `vault_flows` row today, because `vault` must be in the configured list. The row is indistinguishable from any other depositor's row except by `owner`/`caller`.
2. **Self-exclusion rule for the outflow guardrail** (docs/PROJECT.md 4.3 "exclusion of our own withdrawals from the guardrail"): Vaultpilot must ignore `vault_flows` rows where `owner`, `receiver` or `caller` is in its own address set = {both wrapper addresses from Privy `get-vault-details.vault_address`, the Privy business wallet address}, compared lowercase. Until A3 records the wrapper addresses (vaults.md "Action for A3/human"), the set is incomplete and the guardrail may count Vaultpilot's own withdrawals as external outflow; disclose this in the UI rather than lowering the threshold.
3. **Configured list.** Adding the wrapper addresses to `streamsmith.yaml` `vaults` makes wrapper-level flows (owner = Privy wallet) first-class rows and lets `in_configured_list` distinguish them; per section 5 this is a params change (new version + receipt). The observation module should keep sampling the **underlying** vaults (the growth signal); position accounting uses wrapper shares (vaults.md).
4. **Rates.** A wrapper takes a cut of generated returns; its own `convertToAssets` differs from the underlying's. Do not mix wrapper and underlying `share_value_observations` rows in one growth window; the `vault` column keys them.
5. Fee spread: `execution_rate` on deposits includes any entry fee and on withdrawals is net of exit fee (EIP-4626; Pinax README). Vaultpilot should compare like with like (deposit-implied vs deposit-implied) or use `share_value_observations`.

## 7. Interaction with the module layout (A5's `packages/erc4626-flows/substreams.yaml`)

- Stores `store_vault_seen` and `store_vault_meta` have `initialBlock: 51001200`; a `substreams run -s 51092254` must backfill them server-side (substreams-testing SKILL.md: "Always pin `initialBlock` near the test window ... so cold runs do not backfill from genesis"). First gate run: ~1.8M blocks of backfill, then cached by the server for identical module hashes. `gate.yaml` sets a 3600 s timeout on `primary` for this reason.
- Consequence for assertions: `meta_valid` will be true for configured-vault flows in the gate range (first sight happened during backfill), and `vaults` rows will not appear in the range (section 2, VaultMeta).
- The manifest's `descriptorSets: - module: buf.build/streamingfast/substreams-sink-sql` points at the retired BSR module (section 1). UNVERIFIED whether `substreams build` still resolves it; if the build fails with an unresolved `sf/substreams/sink/sql/schema/v1/schema.proto`, switch to `buf.build/streamingfast/substreams` (as `streamsmith.yaml` now says) or a local `importPaths` copy.
- `excludePaths: [sf/substreams, ...]` keeps `schema.proto` out of the spkg's `proto_files`; the gate's descriptor comparison works at the `FileDescriptorProto` level with the extension registry supplied from `proto-deps`, so this is fine (gate.yaml `descriptorHash.algorithm`).

## 8. Banned-word check

Scope: `specs/vaultflows.proto`, `specs/streamsmith.yaml`, `specs/gate.yaml`, this file, and the package's `substreams.yaml` / `README.md` (module `doc:` strings end up in `substreams info`). Terms: the five listed under docs/PROJECT.md 4.2 "Banned words". Regexes (bracketed letter so the definition does not match itself, case-insensitive): `y[i]eld`, `\b[A]PY\b`, `share [p]rice`, `\b[T]VL\b`, `\b[r]isk`. Result on 2026-09-10 for proto, streamsmith.yaml, gate.yaml and this file: zero matches. Approved vocabulary: "execution rate", "share value", "observed-window share-value growth over N hours, blocks X-Y", "share migration".

Note: the Pinax README and spkg doc string use one of the banned terms for `assets / shares`; do not copy that wording into our package doc (it would fail `gate.yaml` `banned_words` if placed in `packages/erc4626-flows/substreams.yaml` or its README).

## 9. Unverified items

1. Firehose `Log.blockIndex` on the Base endpoint equals the `eth_getLogs` `logIndex` (needed for `log_index` semantics and the id scheme). Gate: `log_index_matches_rpc` (warn).
2. Whether `base-mainnet.streamingfast.io:443` sets `ETH_CALL_FALLBACK_TO_LATEST_DURATION` / `ethCallUseBlockNumberDuration` (substreams-facts.md (b)). Gate: `observation_matches_reference` (warn) and `deterministic_rerun` (fail).
3. Base Firehose detail level (EXTENDED vs BASE) on that endpoint; affects Pinax's `logs_with_calls()` vs receipt-logs path, not the emitted fields.
4. On-chain footprint of a Privy fee-wrapper deposit (which contract emits which `Deposit`, and with which `owner`). Confirm with the first real Privy deposit.
5. Whether `substreams build` still resolves `descriptorSets: buf.build/streamingfast/substreams-sink-sql` (retired module) or needs `buf.build/streamingfast/substreams`.
6. Exact JSON keys of `substreams info --json` used by `params_match` / `spkg_metadata`; the `sf.substreams.v1.Package` decode path is the primary definition.
7. Default `.spkg` filename produced by `substreams build` for `package.name: erc4626-flows` (expected `erc4626-flows-v0.1.0.spkg`).
8. That protobuf-es (`@bufbuild/protobuf`) `toJson` with an extension registry renders `[schema.table]`/`[schema.field]` byte-identically to buf's protojson; the gate's self-check (`descriptorHash.algorithm`) turns a mismatch into an error rather than a false pass.
9. Whether bare `to` breaks ClickHouse `CREATE TABLE` (untested in the skill's list); avoided by the rename, so no longer load-bearing.
10. Hosted runner sink version; the sink rules above were read on `develop` and matched at `v1.22.0` and `v1.20.2`.

## 10. streamsmith.yaml changes by A2b

- `sink.descriptorSets`: `buf.build/streamingfast/substreams-sink-sql` -> `buf.build/streamingfast/substreams`, with a comment citing the retired module's `moved.proto`. Reason: section 1, last row. No other value changed; `parametersHash` inputs (vaults, sampleIntervalBlocks, chainId) are untouched.

## 11. Proto changes by A2b

All field numbers of retained fields are unchanged. Removed numbers are `reserved` (number and name) so they cannot be reused with a different type.

1. **Removed `message CallStatus` and every `CallStatus call_status` field; added `bool call_ok` + `string call_error` scalars.**
   `VaultFlow`: `call_status = 21` -> `reserved 21; reserved "call_status";` + `call_ok = 22`, `call_error = 23`.
   `ShareValueObservation`: `call_status = 12` -> reserved + `call_ok = 13`, `call_error = 14`.
   `VaultMeta`: `call_status = 12` -> reserved + `call_ok = 13`, `call_error = 14`.
   Reason: `sink/sql/db_proto/sql/schema/table.go` `processColumns` skips message-typed fields that are not `Timestamp` or `inline` (`if !isTimestamp && !isInline { continue }`), so the column would silently not exist in ClickHouse; `inline: true` would create a `Nested(ok Bool, error String)` array column, which is undocumented and awkward to filter.
2. **Numeric-string convention: `""` -> `"0"` when not computable** (header "Conventions" and per-field comments for `assets_normalized`, `shares_normalized`, `execution_rate`, `assets_per_share_raw`, `assets_per_share_normalized`, `total_assets_raw`, `total_supply_raw`, `ShareTransfer.shares_normalized`; `asset_decimals`/`share_decimals` documented as 0 when `meta_valid` is false). Reason: `click_house/decimal.go` / `integer.go` return `"empty string cannot be converted ..."` and `accumulator_inserter.go` panics on it unless the field is proto3 `optional`.
3. **Id scheme for `VaultFlow` and `ShareTransfer`: `"{chain_id}-{block_number}-{tx_hash}-{log_index}"` -> `"{chain_id}-{block_number}-{log_index}"`.** Reason: `log_index` is block-wide (Firehose `Log.blockIndex`), so the extra 66 characters add nothing but sorting-key size; `tx_hash` stays a column. Observation and VaultMeta ids unchanged.
4. **`ShareTransfer.from` -> `from_owner` (9), `to` -> `to_owner` (10).** Reason: the ClickHouse dialect emits unquoted identifiers; `to` is a ClickHouse keyword not covered by the skill's verified-safe list; renaming both keeps the pair symmetric and makes "owner" explicit.
5. Header comment: added the ids table, the never-empty rule, the flattening rationale, the enum storage note, `from_owner`/`to_owner` in the address list; `ShareValueObservation` comment states that failed rows are still emitted with `call_ok = false`; `log_index` comment states block-wide.
6. `buf lint` (STANDARD minus `PACKAGE_DIRECTORY_MATCH`) clean; `buf build` OK; hash `11b959fc25edfb3c135d6cc39119df8bb0b442b1b245e999c6912483a1fc2c8b`.

Sync state at commit `4158d86` (2026-09-10): `packages/erc4626-flows/proto/vaultflows.proto` is byte-identical to `specs/vaultflows.proto`, `src/pb/vaultflows.v1.rs` was regenerated (`call_ok` present, no `CallStatus`), and `src/lib.rs` uses `call_ok`/`call_error` and the `"0"` convention. The spec rewrite itself was committed inside that commit. Still open in the package: `substreams.yaml` `descriptorSets` names the retired module (section 7).

## 12. Proto changes by A9 — `FlowDirection` enum → `string direction`

Executed 2026-09-10. One change, one reason:

**`enum FlowDirection` deleted; `VaultFlow.direction` is now `string direction = 12`** (field number kept, so
no `reserved` entry is needed and no other field number moved). Accepted values are exactly `deposit` and
`withdraw` — lowercase, never empty. Rust side: `pure::DIRECTION_DEPOSIT` / `pure::DIRECTION_WITHDRAW`.

Reason (measured, not inferred): `substreams-sink-sql` 4.13.1 `from-proto` panics on a populated proto3 enum
field — `panic: interface conversion: interface {} is protoreflect.EnumNumber, not int32` in
`db_proto/sql/click_house/accumulator_inserter.go:224` — on the first block carrying a `VaultFlow` row, 2/2
reproducible (docs/build/sink-spike.md §1). The enum blocked every `vault_flows` and `vaults` row from ever
reaching ClickHouse. With the string, the same command lands the rows (sink-spike.md §6); the ClickHouse column
is `direction String` instead of `direction Int32`.

Header comment updated accordingly: the old line "Enums are stored as Int32 in ClickHouse (TEXT in Postgres):
FlowDirection 1 = DEPOSIT, 2 = WITHDRAW" is replaced by a statement that the contract has **no** enum fields and
why. The `execution_rate` comment now says `deposit` / `withdraw` instead of DEPOSIT / WITHDRAW.

### Descriptor hash run (the algorithm of specs/gate.yaml `descriptorHash`)

Workspace: a temp dir holding `specs/vaultflows.proto` plus
`packages/streamsmith/proto-deps/sf/substreams/sink/sql/schema/v1/schema.proto` at its import path, with a
`buf.yaml` v2 using `STANDARD` minus `PACKAGE_DIRECTORY_MATCH` (the gate's `contract.lint`).

```bash
buf lint --path vaultflows.proto            # exit 0, no findings (buf 1.72.0)
buf build --as-file-descriptor-set --exclude-source-info -o -#format=json \
  | python3 descriptor_hash.py vaultflows.v1     # the referenceScript, verbatim from specs/gate.yaml
```

| Side | Command | sha256 |
|---|---|---|
| spec, before the change | as above on the enum contract | `11b959fc25edfb3c135d6cc39119df8bb0b442b1b245e999c6912483a1fc2c8b` (reproduced the committed value exactly, so the pipeline is the same one A2b ran) |
| spec, after the change | as above | **`ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9`** |
| spec, after, without `--exclude-source-info` | same | `ce7f78…d5f9` (identical) |
| spkg, after the change | `buf build packages/erc4626-flows/erc4626-flows-v0.1.0.spkg#format=binpb --as-file-descriptor-set -o -#format=json \| python3 descriptor_hash.py vaultflows.v1` | `ce7f78…d5f9` (identical → gate `descriptor_hash_match` passes) |

`specs/gate.yaml` `descriptorHash.expectedSpecSha256` was updated to `ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9`
(the old value is kept in a comment above it), and the `reference_flows_present` rows now read
`direction: "deposit"` / `direction: "withdraw"`. Nothing else in gate.yaml changed.

### Carried through

- `packages/erc4626-flows/proto/vaultflows.proto` re-copied from `specs/vaultflows.proto` (byte-identical,
  `cmp` clean — CI enforces this).
- `src/pb/vaultflows.v1.rs` regenerated with `substreams protogen` (4 s): `pub direction: ::prost::alloc::string::String`.
- `src/lib.rs`: `FlowDirection` import dropped; the match arms produce `DIRECTION_DEPOSIT.to_string()` /
  `DIRECTION_WITHDRAW.to_string()`; the struct literal is `direction,` (was `direction as i32`).
- `src/pure.rs`: the two constants plus a unit test asserting the exact strings; `cargo test --all-targets`
  14 passed / 0 failed (was 13).
- `substreams build` 5 s, `substreams pack` < 2 s; new `map_events` module hash
  `8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`, spkg sha256 `662fdd37f94927e9a1bacb5756d6142eb0ab8811b78db0b115475ea2e03093b0`.
- Live evidence in `runs/live/` regenerated with the new spkg; the primary file is line-for-line identical to
  the pre-change recording once `FLOW_DIRECTION_DEPOSIT`/`_WITHDRAW` are rewritten to `deposit`/`withdraw`
  (34 lines, 42 rows, same ids/amounts/log indexes/rates), so the change is provably confined to that field.

### Consumers that still reference the enum (owned by other agents, not touched here)

`packages/erc4626-flows/sql/views.sql` (`direction = 1` / `= 2`), `packages/mcpgen` (`enumMap`, its
`proto.test.ts` / `livedata.test.ts` expectations) and `packages/streamsmith` (`test/jsonl.test.ts`,
`fixtures/vaultflows.fds.json`). They need `direction = 'deposit'` / `'withdraw'` and no enum table.
