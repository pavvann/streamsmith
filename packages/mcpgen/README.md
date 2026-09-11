# mcpgen

Generates a **fail-closed MCP server** from three inputs that already exist in a Streamsmith run:

1. the package's **public proto contract** (`specs/vaultflows.proto`): every message with `option (schema.table)` is a
   ClickHouse table, its fields are the columns, the `convertTo` annotations give the wide numeric types;
2. the **Deployment Receipt** (`specs/receipt.schema.json`): package hash, output-module hash, parameters (the pinned
   vault list), sink schema hash, deployment mode and id;
3. the **views** (`packages/erc4626-flows/sql/views.sql`), annotated so the generator knows each view's columns and
   optional trailing window. `parseViews` returns one single-statement `ddl` per view, because ClickHouse over HTTP
   rejects a multi-statement body with *Multi-statements are not allowed* (code 62): whoever applies the file must
   send one request per view. mcpgen itself never writes to ClickHouse.

Output: a runnable TypeScript package (stdio MCP, `@modelcontextprotocol/sdk` + `zod`) whose tools are typed from the
contract, whose SQL is read-only and parameterized, and which **refuses to answer** when the live deployment no longer
matches the receipt. `packages/mcp-vaultflows` is the checked-in output for `fixtures/receipt.example.json`.

```bash
pnpm --filter @ethonline26/mcpgen generate          # fixture receipt -> packages/mcp-vaultflows
# or explicitly
node bin/mcpgen.js generate --receipt <receipt.json> --proto specs/vaultflows.proto \
     --views packages/erc4626-flows/sql/views.sql --out packages/mcp-vaultflows [--semantics semantics/default.yaml]
```

The **last stdout line is exactly** `{"manifest": "<absolute path to manifest.json>"}` (Streamsmith's `mcp` step reads
it and stores `sha256(manifest.json)` as `receipt.mcpManifestHash`). Diagnostics go to stderr. Exit codes: 0 ok, 1
generation error (bad receipt / proto / views / semantics), 2 usage.

## How this differs from a generic ClickHouse MCP

| generic "run SQL over ClickHouse" MCP | mcpgen output |
|---|---|
| one `query(sql)` tool; the model writes SQL | one **semantic tool per table and per view** (`vault_flows`, `share_value_growth`, `recent_share_migration`, ...), argument schemas generated from the contract |
| free-form strings | **closed sets**: `vault` is a zod enum of the receipt's `parameters.vaults`; `direction` is the closed value set declared in the semantics overlay; `windowHours` and `limit` are bounded integers (limit <= 500) |
| string concatenation | **parameterized SQL only**: `{vault:String}` placeholders + `param_*`, identifiers from the manifest and regex-validated; `readonly=1`, `max_execution_time`, 10 s client timeout (a credential whose ClickHouse *profile* is already read-only refuses per-query settings with `Code: 164`: detected once, after which none are sent and `provenance.clickhouse.settingsMode` says so) |
| answers whatever the database holds | **fail-closed**: on startup and every 60 s the server re-reads the receipt, compares the live `system.columns` set against the contract, measures lag against an independent RPC, and refuses with a structured reason when anything drifted |
| no context | **provenance in every response**: package hash, output-module hash, parameters hash, proto descriptor hash, sink schema hash, deployment mode/id, sink head, chain head, lag, observed window, time of the last verification |

The generator does not run `protoc` or `buf`: `src/proto.ts` is a small proto3 parser for the contract subset (top-level
messages, scalar/enum fields, `repeated`/`optional`, `reserved`, text-format options). Nested messages, `oneof`, `map`,
`extend`, `service` are rejected with a clear error (see the file header for the full list).

### Closed-set filters follow the contract's representation, not the semantics file

`semantics/default.yaml` declares only the *names* a filter accepts (`direction: [deposit, withdraw]`). How each name
is **stored** is resolved from the proto by `resolveFilterValues` (`src/manifest.ts`):

| column in the contract | bound as | SQL |
|---|---|---|
| `string direction` | `{direction:String}`, value = the name | `direction = 'deposit'` |
| enum-backed `Int32` | `{direction:Int32}`, value = the proto enum's number | `direction = 1` |

Anything else is a generation error instead of a guess. This matters because the mismatch is silent: comparing a
`String` column to `1` parses fine and matches no rows. `vaultflows.v1` deliberately has **no enum fields** —
`substreams-sink-sql` 4.13.1 `from-proto` panics on a populated proto3 enum (`interface {} is
protoreflect.EnumNumber, not int32`), so `VaultFlow.direction` is a `String` holding exactly `deposit` / `withdraw` —
but the enum path is kept and tested so the generator works for contracts that do use enums.

## Fail-closed contract of the generated server

Every 60 s (`CHECK_INTERVAL_SECONDS`) and once at startup:

| check | refusal `reason` | `expected` / `actual` |
|---|---|---|
| receipt on disk (`RECEIPT_PATH`) still has the `packageHash`, `outputModuleHash`, `parametersHash`, `protoDescriptorHash`, `sinkSchemaHash` the server was generated for | `receipt_mismatch` | the differing fields |
| `system.columns` of the expected tables, hashed with `runtime/schemahash.ts` (names + types; injected sink columns `_block_number_`, `_block_timestamp_`, `_version_`, `_deleted_` by name only) equals `manifest.expectedSchema.columnSetHash` | `schema_mismatch` | both column sets, both hashes, and a diff (missing tables/columns, unexpected columns, type mismatches) |
| `eth_chainId` of `BASE_RPC_URL` equals the receipt's chain | `chain_mismatch` | chain ids |
| `eth_blockNumber - max(_block_number_)` <= `MAX_LAG_BLOCKS` (default 300, about 10 min on Base) | `stale_data` | limit vs lag/head/chain head |
| any of the above could not be evaluated, or the last completed check is older than 3 intervals | `check_unavailable` | which checks ran, the errors |

Data tools return `{ refused: true, reason, detail, expected, actual, checkedAt, provenance }` with `isError: true`;
they never fall back to unverified data. `pipeline_status` always answers and carries the same verdict.
`recent_share_migration` answers `{ unavailable: true, reason: "share_transfers not populated in v0.1.0" }` while the
optional table is empty. Successful responses: `{ tool, source, rowCount, truncated, columns, rows, arguments, provenance }`.

## Layout

```
src/proto.ts       proto3 parser + from-proto type mapping (tables, columns, injected columns)
src/views.ts       views.sql annotation parser (-- @view / @description / @column / @window, /*@window*/ marker)
src/receipt.ts     receipt validation (JSON-Schema subset against specs/receipt.schema.json + zod)
src/semantics.ts   optional overlay: tool names, descriptions, enum filters, empty-table behaviour (semantics/default.yaml)
src/manifest.ts    tool specs + manifest (expected column sets, hashes, policy)
src/emit.ts        writes the package: manifest.json, receipt.json, src/tools.generated.ts, src/server.ts, src/runtime/*, README, package.json
runtime/           copied verbatim into every generated server: sql builder, ClickHouse HTTP client, RPC head, guardian, tool handlers
fixtures/          receipt.example.json (valid against specs/receipt.schema.json) + vaultflows_schema_hash.txt (evidence)
```

Determinism: identical inputs produce byte-identical output (no timestamps, no absolute paths), so `mcpManifestHash`
is reproducible. `pnpm test` (73 tests) covers the proto parser on the real contract, the views parser, the
no-interpolation property of the SQL builder, every refusal path against a fake ClickHouse/RPC, manifest determinism,
the CLI's last line, a stdio smoke test of the generated server, the banned-word rule, and `test/livedata.test.ts`:
the recorded **live** output of the package (`runs/live/*.jsonl`) cross-checked against the contract — every
protojson key maps (lowerCamelCase -> snake_case) onto a column the generator derived, every column `views.sql`
reads exists in the table it reads it from, every literal a view compares a column to matches that column's
ClickHouse type, and no view or generated tool ever uses the configured start block as a window bound.

### The fixture receipt

`fixtures/receipt.example.json` is the input for the checked-in `packages/mcp-vaultflows`. Real, recorded values:
`outputModuleHash` / `moduleHashes` (`substreams info` of the local build, `docs/build/toolchain.md`),
`packageHash` (sha256 of that build's spkg — per-build by construction, which is why `outputModuleHash` is the
identity the fail-closed check leans on), `protoDescriptorHash` (`specs/gate.yaml`), `parametersHash` (recomputed
canonically by the test), `startBlock` 51001200, the gate ranges (`runs/live/`) and the endpoint. `sinkSchemaHash`,
`deploymentId` and `sink.hostFingerprint` are fixture values: no DDL was dumped from a deployed sink yet.
`fixtures/vaultflows_schema_hash.txt` is the sink's own 16-hex schema-hash file from the local run (`--sink-info-folder`,
substreams-facts (d) 8) — a different thing from `receipt.sinkSchemaHash` (sha256 of the applied DDL); a test pins it
against the value the sink logged in `runs/live/sink-run1b.err`.

## Requirements

Node >= 22.18 (the CLI and the generated server run TypeScript through Node's native type stripping; no build step),
pnpm. Dependencies: `@modelcontextprotocol/sdk`, `zod`, `yaml`.
