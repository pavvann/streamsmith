# Sink spike (A8) — first custom rows into local ClickHouse via `substreams-sink-sql from-proto`

Status 2026-09-10 (A8): **partial kill.** The primary command (`map_events`, full range) crashes
deterministically. Root cause isolated to a sink bug on the proto3 enum field `VaultFlow.direction`.
The enum-free half of the same package (`map_share_value_observations`) works end to end, including
restart-safety and both views. `vault_flows` and `vaults` were never populated by any run in this
session — that is the finding, not something fixed here (no package rebuild, per brief).

Repo `/Users/pawan/Code/hacks/ethonline26`, branch `main`. Spkg used (built by A7, not rebuilt here):
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
