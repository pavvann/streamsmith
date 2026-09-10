# Substreams facts for erc4626-flows / Streamsmith

Facts only. Every item cites a file in `vendor/substreams-skills` (pinned clone: commit `8ccccf24f6eeba1f1b1f4db3c0d9d0c95a548293`, 2026-09-09, skills `metadata.version: 1.6.0`) or an upstream URL fetched on 2026-09-09. Items marked **UNVERIFIED** were not confirmed against a primary source.

Skill files read: `skills/substreams-dev/SKILL.md` (+ `references/manifest-spec.md`, `module-types.md`, `patterns.md`, `block-filtering.md`, `networks.md`), `skills/substreams-ethereum/SKILL.md` (+ `references/rpc-and-tokens.md`), `skills/substreams-sql/SKILL.md` (+ `references/clickhouse-patterns.md`), `skills/substreams-hosted-sink/SKILL.md`, `skills/thegraph-market-api/SKILL.md`, `skills/substreams-testing/SKILL.md` (+ `references/unit-testing.md`, `integration-testing.md`, `firecore-tools.md`), `examples/README.md`, `EVAL.md`, `SKILL_DEVELOPMENT.md`.

---

## (a) Manifest `params:` — mechanism and how a module reads it

**Declaration.** A module opts in with a `params: string` input; the value is set at manifest top level under `params:` keyed by module name, or per request with `-p`.

- `skills/substreams-dev/references/manifest-spec.md`: "### Parameter Inputs / Runtime parameters: `inputs: - params: string`" and "Usage: `substreams run map_token_transfers -p map_token_transfers=0xa0b86a33e6...`".
- Upstream `docs/references/substreams-components/modules/parameterized-modules.md` (streamingfast/substreams, develop): "First, you need to add the `params` field as an input. Note that it's always a string and it's always the first input for the module" and the manifest form `params:\n  map_params: 1f98431c8ad98523631ae4a59f267346ea31f984`.
- Per-network values: same doc, "## Parameters Per Network … `networks:\n  <NETWORK-NAME>:\n    params:\n      <MODULE-NAME>: "value"`".

**Reading it in Rust.** The handler receives the string as its first argument.

- Upstream parameterized-modules.md: `pub fn map_pools_created(params: String, block: Block) -> Result<Pools, Error> { let factory_address = Hex::decode(params).unwrap(); … }`.
- Multi-value params: same doc, "To pass multiple parameters, you can encode them as a URL-encoded query string, i.e. `param1=value1&param2=value2`" decoded with `serde_qs`; vectors as `address[]=aaa..aaa&address[]=bbb..bbb&amount=100`. `skills/substreams-dev/references/patterns.md` shows the JSON alternative (`serde_json::from_str(&params)` with `-p 'map_filtered_events={"contracts":[…]}'`).

**Implication for erc4626-flows.** Vault list + `K` (sampling interval) go in as one `params` string on the observation module (and on the flows filter if we filter by vault). Case matters: `block-filtering.md` line ~293: "Match keys exactly — **0x-prefixed lowercase hex** (EVM addresses copied in checksum/mixed case will not match)". Streamsmith must lowercase the addresses from `streamsmith.yaml` before hashing/passing them.

**Hosted deploy carries params too.** `skills/thegraph-market-api/SKILL.md` `message ExecutionConfig { … string parameters = 5; … }` — so the deployed parameter string is recordable in the receipt (`parametersHash`).

**Trap.** `block-filtering.md` ~line 290: "**You MUST override the params query.** Every `filtered_*` module ships a *default* params filter … If you don't override it you silently emit the default's data, not yours." Relevant only if we import `ethereum-common`'s `filtered_events`; the Pinax `erc4626` module has no params.

---

## (b) `eth_call` / `RpcBatch` — at which block does a call execute?

**The skills do not state the block context.** `skills/substreams-ethereum/references/rpc-and-tokens.md` and `SKILL.md` cover batching/caching only. The rule comes from upstream docs and the Firehose host code:

- Upstream `docs/how-to-guides/develop-your-own-substreams/evm/eth-calls.md` (streamingfast/substreams): "**Important:** All `eth_call` operations are executed at the **specific block hash** being processed by your Substreams module, not at the latest block state. This guarantees **deterministic execution** across all runs … The RPC endpoint automatically uses the block hash of the block being processed, so you never need to specify a block number".
- Host implementation, `streamingfast/firehose-ethereum` `substreams/rpccalls.go` (develop):
  ```go
  blockAge := time.Since(blockTimestamp.AsTime())
  var blockRef *rpc.BlockRef
  if numberDuration != 0 && blockAge > numberDuration {
      blockRef = rpc.BlockNumber(blockNumber)
  } else {
      blockRef = rpc.BlockHash(blockHash)
  }
  if fallbackDuration != 0 {
      if blockAge > fallbackDuration {
          blockRef = rpc.LatestBlock
      }
  }
  ```
  and `const EthCallFallbackDurationEnvVar = "ETH_CALL_FALLBACK_TO_LATEST_DURATION"`.

**So:** default = state at the exact block hash being processed (post-block state of that block). Two operator-side overrides exist: an "old block → use block number" mode and an "old block → use `latest`" mode, both keyed off block age and set from the server context (`reqctx/context.go` keys `ethCallFallbackToLatestDuration`, `ethCallUseBlockNumberDuration`; no client header exists for them in `reqctx/headers.go`). **UNVERIFIED:** whether StreamingFast/Pinax Base endpoints set `ETH_CALL_FALLBACK_TO_LATEST_DURATION` (if set, historical `convertToAssets()` samples older than the threshold would silently be evaluated at head — non-deterministic and wrong). The gate's `deterministic_rerun` assertion is the runtime check for this; a mismatch between reruns or an `assets_per_share` that does not move across the backfill is the symptom.

**Failure semantics** (`rpc-and-tokens.md`): "`decode` returns `Option` — it is `None` for a reverted call or a non-compliant return"; `execute() → Result<_, String>`; "Call reverts at that block (contract not yet deployed) → `None` → Skip; a later block will populate the store". `substreams-ethereum/core/src/rpc.rs`: `if response.failed { return None; }`. Also: "Defaulting `decimals` to 18 for a 6-decimal token misprices by 10¹². If a default is load-bearing … surface it as a field (`decimals_resolved: bool`)" → our `meta_valid` / `call_status` fields.

**Cost rules** (`SKILL.md` "Enrichment: eth_call / RpcBatch"): batch into one `RpcBatch`; cache in a `set_if_not_exists` store; never a `HashMap` in a map handler; "`responses[i]` corresponds to `.add(…)` call order".

---

## (c) Store patterns for first-sight caching

Canonical three-module pattern, `rpc-and-tokens.md` "The cache-store pattern (three modules)": **map (fetch, in-block `HashSet` dedup) → store (`updatePolicy: set_if_not_exists`, `valueType: proto:<Type>`) → map (consume, `mode: get`, `store.get_last(&key)`)**.

- Store handler imports that are "load-bearing": `use substreams::prelude::StoreSetIfNotExistsProto; use substreams::store::{StoreNew, StoreSetIfNotExists};` and `store.set_if_not_exists(0, &entry.pool, entry.tokens.as_ref().unwrap());`.
- "`set_if_not_exists` is the point: the first block that sees a pool pays the RPC, every later block reads the store for free."
- "A `HashMap` inside a map handler is **rebuilt from empty on every block** … Cross-block memoization must be a **store**."
- Consumer: `use substreams::store::{StoreGet, StoreGetProto}; … match store.get_last(&key) { Some(t) => t, None => continue }`.
- Update policies (`manifest-spec.md`): `set`, `set_if_not_exists`, `add`, `append`, `max`, `min`; value types `string|bytes|int64|bigint|float64|bigdecimal|proto:Type`. Store access modes: default, `mode: get`, `mode: deltas`.
- Key format must match writer and reader ("Key must match what map_pool_tokens / store_pool_tokens wrote (same 0x policy)").

**For erc4626-flows:** `map_vault_probe` (on first sight of a vault address in a Deposit/Withdraw log: batch `asset()`, `decimals()`, `totalAssets()`, `convertToAssets(10^dec)`, then `decimals()` on the asset) → `store_vault_meta` (`set_if_not_exists`, keyed by lowercase `0x` vault) → `map_vault_flows` (consumes store; `meta_valid=false` when store miss or probe failed). Note the store is written from the probe result at the *probing block*; per `set_if_not_exists` a failed probe should **not** be written (or a later block cannot retry), consistent with "Skip; a later block will populate the store".

---

## (d) From-proto SQL sink rules for ClickHouse

Source: `skills/substreams-sql/SKILL.md` + `references/clickhouse-patterns.md` ("Verified against the built-in SQL sink in `substreams` **v1.20.2** and ClickHouse **26.6.1**").

1. **Mode selection is by output type.** "The mode is **auto-detected from the output module's proto type** — `sf.substreams.sink.database.v1.DatabaseChanges` selects Database Changes, anything else selects from-proto. There is no `from-proto` subcommand and no mode flag." Hosted ClickHouse: "**Rule: on ClickHouse, always use a proto-typed output module (From proto definition).**" (Database Changes crash-loops: `driver clickhouse does not support reorg handling…`).
2. **Annotations are required.** `import "sf/substreams/sink/sql/schema/v1/schema.proto"; // proto package is bare 'schema'`; each table message: `option (schema.table) = { name: "…" clickhouse_table_options: { order_by_fields: [...] partition_fields: [...] } }`. "`clickhouse_table_options` **REQUIRED for ClickHouse**, ignored by Postgres"; "`order_by_fields` … **>= 1 required**".
3. **Exactly one primary key.** "**from-proto supports at most ONE `primary_key: true` field per table message.** … `multiple field mark has primary keys are not supported` … There are **no composite primary keys in from-proto** — … synthesize a single unique key column (e.g. `id = "{tx_hash}-{log_index}"`)."
4. **PK must prefix ORDER BY.** "**`order_by_fields[0]` must be the `primary_key: true` field.** Extra sort columns follow it." Error otherwise: `Primary key must be a prefix of the sorting key`.
5. **Generated DDL** (never hand-written): `ENGINE = ReplacingMergeTree(_version_, _deleted_) PRIMARY KEY (<pk>) ORDER BY (<order_by_fields>) PARTITION BY (<partition_fields>)`; injected columns `_block_number_`, `_block_timestamp_`, `_version_`, `_deleted_` (last two ClickHouse-only). "`PARTITION BY toYYYYMM(_block_timestamp_)` is auto-prepended unless you declare a `_block_timestamp_` partition field yourself." Stick to `toYYYYMM` (`toStartOfMonth` silently ignored; `toYYYYDD` emits `toYYYYMMDD`).
6. **Wide numerics.** `(schema.field) = { convertTo: { uint256{} } }`; options `int128{}`, `uint128{}`, `int256{}`, `uint256{}`, `decimal128{scale: N}`, `decimal256{scale: N}` — "maps a proto `string` to a wide numeric column".
7. **Insert-only; reorgs via tombstones.** "from-proto on ClickHouse handles undos by **inserting tombstones** … `_deleted_ = true` … **always filter `_deleted_ = 0`** in queries and materialized views."
8. **Cursor is a local file, not a DB table.** "The ClickHouse from-proto cursor is a local file — default `cursor.txt`, set via `--cursor-file-path`. The schema hash is likewise a local file under `--sink-info-folder`." (Table `cursors` exists only for Database Changes; Postgres from-proto uses `_cursor_`.) Self-managed deployments must mount both on durable storage.
9. **Schema evolution is a stub.** "DDL is `CREATE TABLE IF NOT EXISTS` and **the migration path is an unimplemented stub**. On a proto change the sink detects drift, does nothing, and streams against the **old** table … Symptom: `NO_SUCH_COLUMN_IN_TABLE`." Fix: drop tables / hosted `ResetDeployment` with `drop_schema: true`. → The public contract must be final before deploy; the gate's descriptor-hash check is the guard.
10. **Naming.** Column named `index` breaks (`SYNTAX_ERROR (62)`); everything else tested fine unquoted.
11. **Manifest bits.** `protobuf: descriptorSets: - module: buf.build/streamingfast/substreams-sink-sql` ("Without `descriptorSets`, the build cannot resolve `sf/substreams/sink/sql/schema/v1/schema.proto`"), `excludePaths: [sf/substreams, google]`; `sink: module:` optional for from-proto CLI runs but `setup` "REQUIRES `sink: module:`".
12. **Ops.** DSN `clickhouse://user:pw@host:9440/db?secure=true` (HTTP 8123/8443 rejected; port defaults to 5432 even for ClickHouse — set it). Smoke tests: `--block-batch-size=1` (default 25); `--batch-block-flush-interval` is a Database Changes flag only.

---

## (e) Hosted sink — Portal API sequence

Source: `skills/substreams-hosted-sink/SKILL.md` and `skills/thegraph-market-api/SKILL.md`. `BASE_URL` default `https://admin.streamingfast.io`; every method is `POST {BASE_URL}/{Service}/{Method}` with JSON; services `sf.portalapi.v1.PortalApi` (auth/billing) and `sf.portalapi.v1.HostedService` (deployments). Requests prefer snake_case; responses often camelCase ("accept both").

**Device-code auth (RFC 8628)** — `thegraph-market-api` Part 1:
1. `POST …/PortalApi/DeviceAuthorize` `{"client_name"?: string}` → `deviceCode` (secret, never print), `userCode`, `verificationUri` (`https://thegraph.market/device`), `verificationUriComplete`, `interval`, `expiresIn` (int64 as JSON **strings**).
2. Show URL + user code; **stop and wait for the human** ("do **not** background-poll").
3. After confirmation: `POST …/PortalApi/DeviceToken` `{"device_code": …}` once → `status` ∈ `DEVICE_TOKEN_STATUS_{PENDING,SLOW_DOWN,DENIED,EXPIRED,APPROVED}`; on APPROVED capture `access_token`, `refresh_token`, `organization_id`. `device_code` is single-use; unknown code → HTTP 400 `invalid_argument`.
4. Call APIs with `Authorization: Bearer <access_token>`; token pinned to one `organization_id` ("Every request's `organization_id` **must match**").
5. `POST …/PortalApi/RefreshToken` `{"refresh_token": …}` before/after expiry; handshake ~10 min; refresh cap ~8 h.
Mutations need OWNER/ADMIN role.

**Deploy sequence (ClickHouse, from-proto)** — hosted-sink "Workflow" + market-api "Deploy this spkg…":
0. Quality gate: skill mandates offering a `substreams run … -o jsonl` check before any deploy (`OUTPUT_TEST_STATUS`). Our `gate.yaml` run satisfies this.
1. Public spkg: `substreams publish` then `spkg.url = https://api.substreams.dev/v1/packages/<name>/<version>` (prefer `url` over `substreams_dev_id`; "Verify the URL returns a binary `.spkg`").
2. Auth as above.
3. `POST …/HostedService/CreateDeployment` `{"organization_id"}` → `deployment_id` ("server-generated — typically a UUID; … Never invent the id").
4. Secret: human opens `https://thegraph.market/sinks/<deployment_id>/secret?output=clickhouse` and enters the DB password (never in chat/API). After they confirm: `POST …/HostedService/HasDeploymentSecret` `{"deployment_id","organization_id","key":"clickhouse_password"}` → `{ "exists": bool }` (call once; no poll).
5. Attach DB: **ClickHouse has no `DeployDatabase` spec** — "`DeployDatabaseRequest` … `postgres_spec` … Postgres only; there is no clickhouse_spec. For ClickHouse, put connection fields in Deploy's `outputConfig.clickhouse` instead."
6. `POST …/HostedService/Deploy`:
   ```json
   {"deployment_id": "<id>", "name": "erc4626-flows base ch", "organization_id": "<org>", "use_stored_secret": true,
    "deployment_request": {"sink_sql_deployment": {
       "spkg": {"url": "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0"},
       "network": "base", "replica": 1,
       "execution_config": {"start_block": 51001200, "output_module": "map_events",
                            "module_output_type": "proto:vaultflows.v1.Events", "parameters": "<params string>"},
       "outputConfig": {"clickhouse": {"server": "…", "port": 9440, "user": "default", "database": "default", "secure": true}}}}}
   ```
   Field names per `SinkSqlDeployment { spkg=1; outputConfig=60 (camelCase in JSON); execution_config=3; replica=2; network=4 }`, `ExecutionConfig { start_block; stop_block; output_module; filters; parameters; module_output_type }`, `Clickhouse { server; port; user; password; database; secure }`. "**`Deploy` may return HTTP 200 + empty `{}`** — treat as success and follow up with `GetDeploymentState`." Serverless DB cold start → retry 2–3× with 30–60 s waits. **UNVERIFIED:** the exact `network` string the hosted runner expects for Base (`substreams-dev/references/networks.md` lists `base`; hosted examples show only `ethereum-mainnet`/`solana`).
7. `POST …/HostedService/GetDeploymentState` `{"deployment_id","organization_id"}` → `deployment_state { resource_state; deployment_state ∈ DEPLOYMENT_STATE_{DEPLOYING,DEPLOYED,DELETED,ERROR}; replica; ready_replicas; healthy_replicas; crashloopbackoff; execution_states[] { pod_name; cursor; state ∈ STATE_{INITIATING,CATCHING_UP,LIVE,FAILING}; current_block; head_block; head_block_time_drift (seconds) } }` — this is the receipt's `headBlock`/`lag` source.
8. Diagnostics: `GetDeploymentEvents` (`limit`), `Logs` (`tail_lines`, `previous`), `ListDeployments`. Ops: `SetReplica` (count 0 = pause), `UpdateDeploymentConfig` (new `spkg.url`), `ResetDeployment` (`drop_schema`), `Undeploy`.
Also: "Assuming StreamingFast provides the database — it does **not**." We bring our own ClickHouse (Cloud: port 9440 + `secure: true`).

---

## (f) Pack / publish commands

`skills/substreams-dev/SKILL.md` "Publishing":
```bash
substreams registry verify ./substreams.yaml   # optional preflight
substreams build
substreams publish ./substreams.yaml --yes     # or path to .spkg
```
- `version_exists` → bump `package.version` (`v0.1.0` → `v0.1.1`), rebuild, publish. Name collision → unique `package.name` or `--team-slug`.
- Web URL `https://substreams.dev/packages/<name>/<version>`; binary `https://api.substreams.dev/v1/packages/<name>/<version>`.
- `substreams build` = "Full WASM + spkg" (`substreams protogen` = bindings only). Prereqs: `substreams`, `buf`, `rustup target add wasm32-unknown-unknown`. Data-plane auth: `substreams auth` or `SUBSTREAMS_API_KEY` / `SUBSTREAMS_API_TOKEN` (distinct from Portal Bearer).
- Manifest hygiene (`manifest-spec.md`): set `package.url` + `package.description`, ship sibling `README.md`, do not use `package.doc`. Registry README must have title, one-line description, Overview, Modules table, Prerequisites, Quick Start with a real `substreams run` range.
- Registry search: `GET https://substreams.dev/v1/registry/packages?query=…` (public, rate-limited; `429` + `Retry-After`).
- **Pinax `erc4626` is NOT on the registry:** `GET https://spkg.io/v1/packages/erc4626/v0.1.0` → 302 → `/v1/files/erc4626-v0.1.0.spkg` → **404**; `https://api.substreams.dev/v1/packages/erc4626/v0.1.0` → 404 (checked 2026-09-09). Importable copy: `https://raw.githubusercontent.com/pinax-network/substreams-evm/970a665e15619de8ad7f686bd89412a1030d46dc/spkg/erc4626-v0.1.0.spkg` (549,261 bytes, sha256 `72e1e7fdc1977029a754deb219ed2fe954c1934cd0324bfe6be0eef16456287b`; contains `erc4626.v1.{Events,Transaction,Log,Call,Deposit,Withdraw}`; `main` at that SHA dated 2026-07-09). Its manifest declares `network: mainnet` and module `map_events` with no `initialBlock` (`erc4626/substreams.yaml`).

---

## (g) Testing skill — structure of tests and fixtures

`skills/substreams-testing/SKILL.md` + references:
- Pyramid: `cargo test` unit (`substreams::testing::map!`, `clock("…")`, 0.7.4+, `#[cfg(test)]`-only, "no official store mock") → `substreams build` → `substreams run -s <start> -t +N <module> -o jsonl` on a small range → optional `--test-file tests/assertions.yaml` / golden JSONL diff → `--production-mode` parity.
- Fixtures: real protobuf blocks via `firecore tools firehose-single-block-client <endpoint> <block> -o bytes --bytes-encoding=base64 > tests/fixtures/eth_<n>.binpb.b64`; load with `prost::Message::decode` (`integration-testing.md` `load_block_b64("tests/fixtures/eth_17000000.binpb.b64")`). "Prefer **protobuf bytes** fixtures over hand-rolled JSON of full blocks."
- `--test-file` shape (`.yaml`/`.jsonl`/`.csv`): each case `module`, `block` (absolute, inside the run range), `path` (gojq), `expect` (string), optional `op` (`float`), `args`. Run: `substreams run substreams.yaml <module> -s A -t +N --test-file tests/assertions.yaml --test-verbose`. Store assertions need debug store outputs.
- Golden: `substreams run … -o jsonl > out.jsonl; test -s out.jsonl`; diff after "envelope strip + hex normalization" (EVAL.md "How tasks were run").
- CI: keep default tests offline; network tests `#[ignore]`; no hosted calls in PR jobs without secrets.
- Handler construction gotchas: `Block` has no top-level `timestamp_seconds`/`parent_hash` (on `header`); log amounts as 32-byte big-endian.
- The example projects in `examples/` ship **no** `tests/` directories (checked: `find examples -type d -name tests` → none); structure above is prescriptive from the skill, not observed in examples.

---

## (h) Case-study format in the repo

Path: `vendor/substreams-skills/examples/` — **16** directories (`T1.1-block-stats`, `T1.2-usdc-transfers`, `T2.1-nft-mints`, `T2.2-univ2-swaps`, `T2.3-sql-sink`, `T3.1-univ3-usd-price`, `T3.2-cross-dex-volume`, `T4.1-whale-activity`, `T4.2-uniswap-db`, `T5.1`–`T5.4` Solana, `T6.1-eth-univ2-no-abi`, `T6.2-sol-marinade-no-idl`, `T7.1-sink-sql-deploy`) plus `examples/README.md` index and `/EVAL.md` summary.

Index (`examples/README.md`): tables per chain family with columns **Example | Skill(s) | Result** ("Build · Run · 100% match"), a "Cautionary tales (vague prompts)" table, and a model note ("All runs use `claude-sonnet-4-6`").

Per-case `README.md` structure (observed in T2.3, T3.1, T7.1):
1. `# T<n>.<m> — <Title> (<Chain>)`
2. Header lines: `**Skill(s) exercised:**`, `**Model:**`, `**Result:**` (Build OK · Run OK · Correctness % · trials)
3. `## Goal`
4. `## Prompt` (verbatim blockquote, or "Not reproduced here")
5. `## What the skill provided` (bullets of skill content that mattered)
6. `## Files` (links to `substreams.yaml`, `Cargo.toml`, `build.rs`, `proto/…`, `src/lib.rs`, `schema.sql`, `deployment-notes.md`)
7. `## Reproduce` (`substreams build` + a real `substreams run … -s … -t +100 -o jsonl`)
8. optional `## Notes` / `> **Historical note:**` callouts.
Ops-only cases (T7.1) add `deployment-notes.md` ("agent's actual deployment writeup, including the issues encountered + fix sequence"). `EVAL.md` scores three mechanical axes: Build, Run, Correctness (golden diff), and lists "Known rough edges". Streamsmith's `Record` step should emit this exact shape (title, header triple, Goal, Prompt, What the skill provided, Files, Reproduce, Notes).

---

## Other facts that touch the design

- Base network id for manifests: `skills/substreams-dev/references/networks.md` line 19: "`base` - Base Chain".
- `sf.ethereum.type.v2.Block` "is a **well-known source** — it needs NO `imports:` entry" (`manifest-spec.md`).
- "Always pin `initialBlock` near the test window … so cold runs do not backfill from genesis" (`substreams-testing/SKILL.md`).
- Pinax `erc4626` uses `logs_with_calls()` with a fallback to `receipt().logs()` when `trx.calls.is_empty()` (`erc4626/src/lib.rs`); `Log.call` is "only available on chains with DetailLevel: EXTENDED" (`proto/v1/erc4626.proto`). **UNVERIFIED:** Base Firehose detail level on the endpoint we will use.
- Pinax README (`erc4626/README.md`): "the `Deposit` event's `assets` includes any entry fee, while `Withdraw` reports the assets received *after* exit fees. So the `assets / shares` rate implied by deposits vs. withdrawals differs by exactly the vault's fee spread" — this is why `VaultFlow.execution_rate` is labeled deposit- or withdraw-implied. Also: "share decimals can exceed the underlying's decimals … The module does not normalize decimals; that belongs in the serving layer" — our package does the normalization, gated by `meta_valid`. Also: "a non-4626 contract could in principle emit a same-signature event. Disambiguate downstream by … a one-shot `asset()` probe" → our first-sight probe.
