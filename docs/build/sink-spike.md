# Sink spike (A8) — first custom rows into local ClickHouse via `substreams-sink-sql from-proto`

> **Superseded by §6 (A9, same day): the blocker below is fixed.** `VaultFlow.direction` is now a
> `string` instead of a proto3 enum, the package was rebuilt, and the §1 command lands 171 `vault_flows`
> rows (42 of them in the gate's 200-block window) plus 2 `share_value_observations` rows. §1–§5 are kept
> verbatim as the record of the enum blocker.

Status 2026-09-10 (A8): **partial kill.** The primary command (`map_events`, full range) crashes
deterministically. Root cause isolated to a sink bug on the proto3 enum field `VaultFlow.direction`.
The enum-free half of the same package (`map_share_value_observations`) works end to end, including
restart-safety and both views. `vault_flows` and `vaults` were never populated by any run in this
session — that is the finding, not something fixed here (no package rebuild, per brief).

Repository on branch `main`. Spkg used (built in A7, not rebuilt here):
`packages/erc4626-flows/erc4626-flows-v0.1.0.spkg`. Sink: `substreams-sink-sql` 4.13.1 at `~/.local/bin`.
ClickHouse: container `vaultflows-ch`, server `26.8.2.7`, native TCP 9000, HTTP 8123.
Endpoint: `base-mainnet.streamingfast.io:443`, `--network base`.

## 1. Primary command — `map_events`, range 51092254:51093002

```bash
set -a; source .env; set +a
substreams-sink-sql from-proto "$CLICKHOUSE_DSN" \
  packages/erc4626-flows/erc4626-flows-v0.1.0.spkg map_events \
  -e "$SUBSTREAMS_ENDPOINT" --network base \
  -s 51092254 -t 51093002 \
  --bytes-encoding 0xhex \
  --clickhouse-cursor-file-path runs/live/clickhouse-cursor.txt
```

No `--limit-processed-blocks`-style flag exists on `from-proto` (checked `--help`); irrelevant anyway —
748 blocks is far under any processed-blocks guard, and none was hit.

Ran twice (brief: fail twice → record and move on). Both attempts:

| Attempt | Exit | Wall clock | Result |
|---|---|---|---|
| 1 | 2 | 20s | `panic: interface conversion: interface {} is protoreflect.EnumNumber, not int32` |
| 2 (retry) | 2 | 31s | identical panic, identical message |

Both crashes happened on the **first** block that carries a `VaultFlow` row (block 51092263, the first
Deposit in the known 42-row window), inside
`db_proto/sql/click_house/accumulator_inserter.go:224` → `(*AccumulatorInserter).insert`. Tables
(`vault_flows`, `share_value_observations`, `vaults`, `share_transfers`, `_blocks_`) were created
successfully both times (table DDL logged, `CREATE TABLE IF NOT EXISTS ...`); zero rows were written to
any of them in either attempt; no cursor file was ever created (`runs/live/clickhouse-cursor.txt` does
not exist). This is a hard, reproducible blocker in `substreams-sink-sql` 4.13.1's from-proto ClickHouse
inserter when a message has a populated proto3 `enum` field (`FlowDirection direction = 12` in
`VaultFlow`, DDL column `direction Int32`) — not a bug in the package or the manifest, and not fixable
without either a sink patch or changing the proto's `direction` field away from `enum` (which needs a
rebuild, out of scope for this brief).

**42 vault_flows rows and 2 share_value_observations rows via this exact command: NOT achieved.**
`vault_flows` and `vaults` (also emitted by `map_events`) stayed at 0 rows; the observation rows in the
same range were never reached because the crash aborts the whole process before later blocks are read.

## 2. Root-cause isolation (diagnostic, same spkg, no rebuild)

To confirm the panic is enum-specific rather than a general from-proto/DSN/schema problem, ran the
same spkg against `map_share_value_observations` (no enum field in `ShareValueObservation`) over
51092998:51093002 (contains the known observation at block 51093000), separate cursor file
`runs/live/diag-observations-cursor.txt`:

```bash
substreams-sink-sql from-proto "$CLICKHOUSE_DSN" \
  packages/erc4626-flows/erc4626-flows-v0.1.0.spkg map_share_value_observations \
  -e "$SUBSTREAMS_ENDPOINT" --network base -s 51092998 -t 51093002 \
  --bytes-encoding 0xhex \
  --clickhouse-cursor-file-path runs/live/diag-observations-cursor.txt
```

Exit 0, 22s, `substreams ended correctly, reached your stop block {"last_block_seen": "#51093000 ..."}`.
**2 rows written to `share_value_observations`** — exactly the expected count and values (from
`runs/live/README.md`'s prior jsonl evidence): `assets_per_share_normalized` 1.040743 (vault
`0x050c...56f0`) and 1.039913 (vault `0xbeef...73c9`), both `call_ok = true`, ids
`8453-51093000-0x050ce30b927da55177a4914ec73480238bad56f0` and
`8453-51093000-0xbeef0e0834849acc03f0089f01f4f1eeb06873c9`. This isolates the crash to the
enum-bearing `VaultFlow` message specifically.

## 3. Verification (ClickHouse, HTTP, user `ro`)

`SHOW TABLES` (`vaultflows`): `_blocks_`, `share_transfers`, `share_value_growth`, `share_value_observations`,
`vault_flows`, `vault_flows_24h`, `vaults` (views added in step 4).

| Table | Count |
|---|---|
| `vault_flows` | **0** (blocked, see §1) |
| `share_value_observations` | **2** |
| `vaults` | 0 |
| `share_transfers` | 0 (optional table, expected empty per proto comment) |

`_blocks_` is from-proto's block-scoped table (`number, hash, timestamp, version, deleted`) — **not** a
cursor table; the brief's "cursor table" doesn't exist in from-proto mode. Resumption is driven entirely
by the file at `--clickhouse-cursor-file-path`. Content after the diagnostic run:
`number = 51093000`, `hash = 9c6e8b7f6f72707960744b44d390bad2ecdc7a96b16420338b6ce10777dc29bb`,
`timestamp = 2026-09-09 17:35:47`, `deleted = false`.

## 4. Views (`packages/erc4626-flows/sql/views.sql`)

`curl --data-binary @views.sql` over HTTP 8123 failed: `Code: 62. DB::Exception: Syntax error
(Multi-statements are not allowed) ...` — ClickHouse's HTTP interface rejects a body with two
statements. Not a views.sql problem; applied instead with the native multi-statement client:

```bash
docker exec -i vaultflows-ch clickhouse-client --user sink --password sinkpass \
  --database vaultflows --multiquery < packages/erc4626-flows/sql/views.sql
```

Exit 0, both views created. Query results:

- `share_value_growth` — **2 rows** (one per vault; `observation_count = 1` each since only one sample
  exists): vault `0x050c...56f0` → first/last block 51093000, `assets_per_share_normalized` 1.040743,
  `growth = 0`, `observed_hours = 0`; vault `0xbeef...73c9` → 1.039913, `growth = 0`.
- `vault_flows_24h` — **0 rows**, no error (reads the empty `vault_flows` table; `max(block_timestamp)`
  over 0 rows is NULL, so the NULL-comparison WHERE filters everything out — clean, non-crashing
  degradation, not a bug).

## 5. Restart-safety

Not testable on the primary command — both attempts crashed before writing a cursor, so there is nothing
to resume from (both attempts are identical cold starts: 0 rows before, 0 rows after, both times).

Tested on the working diagnostic pipeline instead (same DSN, same mechanism, same version):

| | Before | After | Notes |
|---|---|---|---|
| Run 1 | 0 | 2 | cold start, `fetched cursor {"block": "None"}` |
| Run 2 (same command, same cursor file) | 2 | 2 | `fetched cursor {"block": "#51093000 ..."}`, `restarting_at`, `resolved_start_block: 51093001`, ended immediately (0 new blocks in range) |

No duplication; the cursor file correctly advanced resumption past the last processed block.

## Facts for the gate

- `deploymentMode: self-managed-sink` is **not proven** for the full `map_events` contract as shipped:
  a proto3 enum field makes `substreams-sink-sql` 4.13.1 `from-proto` panic on every VaultFlow-bearing
  block, 100% reproducible (2/2), zero workaround available without a rebuild.
- It **is proven** for the enum-free subset (`share_value_observations`, its views, and restart-safety)
  end to end against the same package, same endpoint, same ClickHouse container.
- Fix needed (not applied): either (a) a `substreams-sink-sql` patch to handle
  `protoreflect.EnumNumber` in `accumulator_inserter.go`'s scalar-insert path, or (b) change
  `VaultFlow.direction` from a proto3 `enum` to `uint32`/`int32` in `specs/vaultflows.proto` (breaks the
  frozen contract; needs a rebuild + gate re-approval).

## 6. After enum→string (A9) — the flow rows land

Status 2026-09-10 (A9): **unblocked.** `VaultFlow.direction` is now `string direction = 12` (values exactly
`deposit` / `withdraw`, field number kept); `enum FlowDirection` is gone from the contract. The package was
rebuilt and the exact command of §1 was rerun against the same container. **No panic, exit 0, rows in
`vault_flows`.** New identities:

| Item | Value |
|---|---|
| Normalized descriptor hash (`specs/vaultflows.proto`, spec side and spkg side) | `ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9` (was `11b959fc25edfb…`) |
| `map_events` module hash | `8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a` (was `1f9e1dff75f677a6493655ab5e9126384b045459`) |
| spkg sha256 / bytes | `662fdd37f94927e9a1bacb5756d6142eb0ab8811b78db0b115475ea2e03093b0`, 938,832 bytes |
| wasm sha256 / bytes | `fe3e1fa4efe402f4166b81b2ccfa3e3a346274d09b09fc1eef3ffce657325a53`, 423,580 bytes |
| ClickHouse column | `direction String` (position 16, was `direction Int32`) — `system.columns` |

Tables and stale views were dropped first (the sink recreates its own tables; `sql/views.sql` was **not**
applied — it still reads `direction = 1/2` and it is owned elsewhere), and the cursor file was deleted:

```bash
rm -f runs/live/clickhouse-cursor.txt
docker exec vaultflows-ch clickhouse-client --user sink --password sinkpass --database vaultflows --multiquery -q "
DROP VIEW IF EXISTS vault_flows_24h; DROP VIEW IF EXISTS share_value_growth;
DROP TABLE IF EXISTS vault_flows; DROP TABLE IF EXISTS share_value_observations;
DROP TABLE IF EXISTS vaults; DROP TABLE IF EXISTS share_transfers; DROP TABLE IF EXISTS _blocks_;"
```

Then, verbatim §1 (same DSN, same flags, `substreams-sink-sql` 4.13.1):

```bash
set -a; source .env; set +a
substreams-sink-sql from-proto "$CLICKHOUSE_DSN" \
  packages/erc4626-flows/erc4626-flows-v0.1.0.spkg map_events \
  -e "$SUBSTREAMS_ENDPOINT" --network base \
  -s 51092254 -t 51093002 \
  --bytes-encoding 0xhex \
  --clickhouse-cursor-file-path runs/live/clickhouse-cursor.txt
```

| Run | Exit | Wall clock | Resumed from | `vault_flows` after | `share_value_observations` after | `_blocks_` max after |
|---|---|---|---|---|---|---|
| 1 (cold, empty tables) | 0 | 48 s | cursor absent | 167 | 0 | 51092994 |
| 2 (same command) | 0 | 5 s | `#51092994` → start 51092995 | 169 | 0 | 51092998 |
| 3 (same command) | 0 | 4 s | `#51092998` → start 51092999 | **171** | **2** | 51093000 |
| 4 (same command) | 0 | 5 s | `#51093000` → start 51093001 | 171 (unchanged) | 2 (unchanged) | 51093000 (unchanged) |

Logs: `runs/live/sink-a9-run{1,2,3,4}.err`. Every run logged
`substreams ended correctly, reached your stop block {"last_block_seen": "#51093000 ..."}`.

### Final table state (user `ro`, native client)

| Table | Count | Note |
|---|---|---|
| `vault_flows` | **171** (171 distinct `id`s) | blocks 51092263–51093000; `deposit` 129, `withdraw` 42; `call_ok` and `meta_valid` true on 171/171 |
| `share_value_observations` | **2** | block 51093000, both configured vaults, `call_ok` true |
| `vaults` | 1 | chain-wide first-sight row |
| `share_transfers` | 0 | optional table, expected empty in v0.1.0 |
| `_blocks_` | 128 | one row per block that carried data; max 51093000 |

**On the "42 rows" expectation.** 42 is the count for the **gate's 200-block primary window**
(51092254–51092453, `specs/gate.yaml` `runs.primary`), not for the sink range of §1, which is 748 blocks
(51092254–51093001) and legitimately contains 171 flows. Both are verified:

```sql
SELECT count() FROM vault_flows WHERE block_number BETWEEN 51092254 AND 51092453;   -- 42
SELECT vault, direction, count() FROM vault_flows
WHERE block_number BETWEEN 51092254 AND 51092453 GROUP BY vault, direction;
--  0x050c…56f0 deposit 33 | 0x050c…56f0 withdraw 7 | 0xbeef…73c9 deposit 1 | 0xbeef…73c9 withdraw 1
```

That is exactly the split docs/build/vaults.md records for the window. The sink range total was independently
cross-checked with the CLI over the same range (`substreams run … map_events -s 51092254 -t 51093002 -o jsonl
--limit-processed-blocks 0`, 25 s, exit 0): 128 lines, **171** `vaultFlows`, **2** `shareValueObservations`,
1 `vaults`, 171 distinct flow ids — identical to what ClickHouse holds. **Nothing in the range is missing and
nothing is duplicated.**

Sample rows (the two gate reference flows, `direction` now a string):

| id | block_number | direction | vault | assets_raw | shares_raw | execution_rate |
|---|---|---|---|---|---|---|
| `8453-51092263-406` | 51092263 | `deposit` | `0x050c…56f0` | 197373726 | 189647169910852085674 | 1.040741742113947472 |
| `8453-51092316-163` | 51092316 | `withdraw` | `0xbeef…73c9` | 2210001 | 2125180826770979130 | 1.039911979329258999 |

Observation rows: `assets_per_share_raw` 1040743 / 1039913, `assets_per_share_normalized` 1.040743 / 1.039913 —
the same values A2b read with `convertToAssets(1e18)` at block 51093000, and the same values §2's diagnostic run
produced before the contract change.

### Restart-safety

Run 4 is the restart-safety check: cursor `#51093000`, `resolved_start_block: 51093001`, no new data blocks,
exit 0, **all counts unchanged and `count() == countDistinct(id)`** — no duplication on replay. The
ReplacingMergeTree + deterministic-id design also means the re-read of blocks 51092995–51093000 in runs 2 and 3
did not duplicate anything (171 rows / 171 distinct ids after three overlapping runs).

### New finding: from-proto does not flush the tail of a bounded range in one pass

Runs 1–3 above are one range processed three times because **each run stops at the stop block without
committing the data blocks still sitting in its batch** (`--block-batch-size`, default 25). It is not data
loss: the cursor file only ever advances to what was actually committed (run 1 committed through 51092994 and
its cursor said `#51092994`), so a rerun picks the tail up exactly where it stopped, with no gap and no
duplicate. But a single bounded run of `from-proto` cannot be assumed to have written the last blocks of its
range — the observation rows at 51093000 (the last data block before `-t 51093002`) needed the third run to
land. Practical rules: either set the stop block well past the last block you care about, or rerun the same
command until the counts stop changing (a no-op rerun is the proof). Nothing in `--help` or the v4.13.1 README
mentions this.

### Gate status change

`deploymentMode: self-managed-sink` is now **proven for the full `map_events` contract**: all four tables
created by the sink, 171 flow rows + 2 observation rows + 1 vault row landed through
`substreams-sink-sql from-proto` into the local ClickHouse container, restart-safe, with the enum removed from
the contract. §1's blocker is resolved by the contract change, not by a sink patch — `substreams-sink-sql`
4.13.1 still panics on any populated proto3 enum field.

## §7 ClickHouse Cloud via self-managed sink (Sept 11, 05:13 IST)
Command (from repo root, `.env` sourced):
```bash
substreams-sink-sql from-proto "$CH_CLOUD_SINK_DSN" packages/erc4626-flows/erc4626-flows-v0.1.0.spkg map_events \
  -e base-mainnet.streamingfast.io:443 --network base -s 51001200 --final-blocks-only --bytes-encoding 0xhex \
  --clickhouse-cursor-file-path runs/live/cloud/cursor.txt --clickhouse-sink-info-folder runs/live/cloud/sinkinfo
```
DSN: `clickhouse://sink:<pw>@<host>:9440/vaultflows?secure=true`. No stop block (live tail). Tables created 05:13:27Z+05:30, then backfill from 51001200.

**Finding (cost one failed run):** the sink stores a per-schema "sink info" file (`vaultflows_schema_hash.txt`) in `--clickhouse-sink-info-folder` (default: cwd). A file left by the LOCAL run made the CLOUD run read `sink_info: {schema_hash: 07a6ec95…}`, skip `CREATE TABLE`, and die on `Table vaultflows._blocks_ does not exist` at block 51001204. Always give each target database its own sink-info folder. Streamsmith's `deploy` self-managed mode must pass this flag (open item for the CLI).

Hosted deployment `depdehi448c87998ebb763b`: first Deploy crash-looped on `param for module "vaults[]"` (raw params string passed to `execution_config.parameters`; the spkg already carries the manifest defaults, so omit the field). Retry blocked on an expired Portal token (refresh window ~8 h); needs a new device login.

### §7.1 Backfill telemetry (05:32 IST)
Rate ≈ 4,050 blocks/min against ClickHouse Cloud (ap-south-1) with `--final-blocks-only`; 77k blocks in 19 min; ETA to live ≈ 17 min from a 146k-block start gap. Row counts at block 51,078,275: vault_flows 8,971 · share_value_observations 22 · vaults 493 (chain-wide first-sight meta).
**Column names in the sink's block table are `number, hash, timestamp, version, deleted`** (table `_blocks_`), not `_block_number_`; data tables carry injected `_block_number_`, `_block_timestamp_`, `_version_`, `_deleted_`. Anything computing head/lag from `_blocks_` must use `max(number)`.
