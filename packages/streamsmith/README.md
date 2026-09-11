# Streamsmith

Promotion pipeline for a Substreams package. Streamsmith does not write Substreams code — it proves that a package
that already builds is correct, ships it, and emits a **Deployment Receipt** that a fail-closed MCP server verifies
before it answers a single question.

```
gate ──► publish ──► deploy ──► receipt ──► mcp ──► manifest / casestudy
 │           │          │          │          │
 │           │          │          │          └─ mcpManifestHash bound back into the receipt
 │           │          │          └─ receipts/<pkg>-<version>-<runId>.json (specs/receipt.schema.json)
 │           │          └─ runs/<id>/deploy.json + packages/erc4626-flows/sql/views.sql applied
 │           └─ runs/<id>/publish.json (exact command, spkg sha256)
 └─ runs/<id>/gate.json (every assertion, ranges, tool versions)
```

The subject package is `packages/erc4626-flows` (ERC-4626 deposit/withdraw flows and sampled share-value
observations on Base, chain id 8453). The public contract is `specs/vaultflows.proto`; the gate is
`specs/gate.yaml`; the receipt shape is `specs/receipt.schema.json`. **Streamsmith never modifies `specs/*`** — a
changed contract changes `descriptorHash.expectedSpecSha256` and the gate fails on purpose.

## Install and run

```bash
pnpm install
pnpm --filter @ethonline26/streamsmith streamsmith --help
pnpm --filter @ethonline26/streamsmith typecheck
pnpm --filter @ethonline26/streamsmith test
pnpm --filter @ethonline26/streamsmith fixtures   # re-copy fixtures from the real proto / spkg / live runs
```

Node >= 20, run from the repo root. `--run-id` defaults to `runs/CURRENT` (written by `new-run`) or
`STREAMSMITH_RUN_ID`. `--json` makes any command print machine-readable output. External binaries used, never
vendored: `substreams` (1.22.0), `buf` (1.72.0), optionally `substreams-sink-sql`.

## Commands

| Command | What it does |
|---|---|
| `new-run` | mints a run id, creates `runs/<id>/`, records it in `runs/CURRENT` |
| `gate` | executes `specs/gate.yaml`: build → 3 runs → 18 assertions → `runs/<id>/gate.json` |
| `publish` | `substreams registry publish` (`--dry-run` records the command and the spkg sha256) |
| `deploy hosted` | The Graph Market Portal API `sink_sql` deployment, polled to LIVE. `--params` only when given explicitly (the spkg carries the manifest defaults); `--update --deployment-id ID` reconfigures instead of creating; on `unauthenticated` retries once via `RefreshToken` (`PORTAL_REFRESH_TOKEN`), then prints the `deploy login` instruction |
| `deploy self-managed` | `substreams-sink-sql from-proto` (or `substreams sink clickhouse`) against your own DB. `--final-blocks-only` on by default (`--no-final-blocks-only` to opt out); cursor file and `--clickhouse-sink-info-folder` default under `runs/<runId>/` so a folder from a prior run against a different database can't make the sink skip `CREATE TABLE` |
| `deploy views` | applies `packages/erc4626-flows/sql/views.sql` (or `--views FILE`, resolved against `--root`, not cwd) once the base tables exist, one statement per HTTP request; a missing file is an error only when `--views` is given explicitly |
| `deploy status` \| `stop` \| `login` | live head/lag, teardown, device-code login (tokens are never stored). With `--clickhouse-url` this works even with no `runs/<id>/deploy.json`: head from `_blocks_`, chain head from `--rpc-url`, lag, row counts per table |
| `schema-dump` | `SHOW CREATE TABLE` for the receipt's tables, normalized, for `sinkSchemaHash` |
| `receipt` \| `receipt verify` | assembles / validates the receipt against `specs/receipt.schema.json` |
| `mcp` | runs `pnpm --filter @ethonline26/mcpgen generate …`, binds `mcpManifestHash` into the receipt |
| `manifest start\|finish`, `casestudy` | the AI-usage record for the submission |
| `hash descriptor\|spkg\|sql\|params\|file` | the individual hashes, for debugging a mismatch |

### Exit codes

`gate` uses the codes declared in `specs/gate.yaml`: **0** every `severity: fail` assertion passed · **10** the build
step failed (non-zero exit, timeout, or a missing `expectedOutputs` entry) · **20** a run failed (non-zero exit,
timeout, zero jsonl lines, unparseable jsonl) · **30** a `severity: fail` assertion failed. `severity: warn`
assertions (`log_index_matches_rpc`, `observation_matches_reference`) are recorded and **never** change the exit
code. **1** is a usage or config error; **40** means a hosted deploy is waiting for a human to stage the ClickHouse
password on the Portal secret page.

Every `substreams run` the gate issues carries `--limit-processed-blocks 0`: the CLI refuses any request that would
process more than 10,000 blocks, and preparing stores from `initialBlock` far exceeds that.

## Environment variables

See `.env.example`. Summary:

| Variable | Used by | Notes |
|---|---|---|
| `SUBSTREAMS_API_TOKEN` (or `SUBSTREAMS_API_KEY`) | `gate`, `publish`, self-managed sink | data-plane JWT from `substreams auth`; without it the gate's runs exit 20 with `Unauthenticated` |
| `PORTAL_TOKEN`, `PORTAL_ORG_ID` | `deploy hosted`, `deploy status/stop` | Portal API bearer — a different credential from the data-plane token |
| `PORTAL_REFRESH_TOKEN` | `deploy hosted` | optional; on an `unauthenticated` Portal response, tried once via `RefreshToken` before falling back to the `deploy login` instruction |
| `CLICKHOUSE_URL` | `deploy views`, `deploy status`, `schema-dump` | HTTP endpoint; `CLICKHOUSE_RO_HTTP_URL` is accepted as the legacy name |
| `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | same | merged into `CLICKHOUSE_URL` when it carries no credentials; never logged (URLs are redacted) |
| `CLICKHOUSE_DATABASE` (or `CLICKHOUSE_DB`) | same | falls back to `specs/streamsmith.yaml` `sink.connection.database` |
| `BASE_RPC_URL` | `gate` warn-level checks | defaults to `https://mainnet.base.org`; `gate --offline` skips the RPC entirely |

## What the receipt binds

`receipts/<packageName>-<version>-<runId>.json`, validated against `specs/receipt.schema.json` before it is written:

- **`outputModuleHash`** — the Substreams module hash of the output module, from `substreams info <spkg> --json`.
  This is the **reproducible identity**: rebuilding identical source on the same toolchain reproduces it.
  `moduleHashes` carries the same for every module.
- **`packageHash`** — sha256 of the exact `.spkg` bytes. This is **artifact identity, not source identity**: an
  `.spkg` embeds its proto files in a nondeterministic order and the wasm is host-dependent, so rebuilding identical
  source produces a *different* `packageHash`. Use `outputModuleHash` for any reproducibility claim.
- **`protoDescriptorHash`** — sha256 of the normalized `FileDescriptorSet` of `specs/vaultflows.proto`, computed by
  the algorithm written out in `specs/gate.yaml` `descriptorHash` (whose embedded Python script is the oracle the
  test suite compares against).
- **`parametersHash`** and **`parameters`** — canonical JSON of the vault list, sampling interval and chain id.
- **`sinkSchemaHash`** — sha256 of the normalized DDL actually applied to the sink (`schema-dump`).
- **`deploymentMode`** (`graph-market-hosted` or `self-managed-sink`), `deploymentId`, `endpoint`, `startBlock`,
  `headBlock`, `lagBlocks`, `lagSeconds`, and `sink.hostFingerprint` (sha256 of `host:port` — never the DSN). For
  self-managed, `receipt --deploy-json <file>` reads these straight from `deploy status --json`'s output (any
  `runs/<id>/deploy.json`-shaped file works); `outputModuleHash`/`moduleHashes` come from `substreams info <spkg>
  --json` on the spkg being receipted, independent of `--deploy-json`.
- **`gate`** — `passed`, the block `ranges` that were run, every assertion with its `detail`, and tool versions.
- **`mcpManifestHash`** — sha256 of the manifest `@ethonline26/mcpgen` generated, written back by `streamsmith mcp`.

## The fail-closed contract the MCP implements

`checkReceiptAgainstLive(receipt, live, policy)` (exported from `@ethonline26/streamsmith/receipt`) is the pure
check the generated MCP server runs **before every answer**. It refuses when:

- the live `.spkg` hash, sink schema hash, output module hash, descriptor hash or parameters hash differs from the
  receipt (each refusal names the field and both values);
- the live package hash or sink schema hash cannot be read at all (`requirePackageHash` / `requireSchemaHash`);
- lag cannot be computed, or exceeds `maxLagBlocks` (default 1800 blocks ≈ 1 h on Base) / `maxLagSeconds`.

On success it returns the provenance every answer must carry: the five hashes, the deployment mode, head block,
chain head and lag. No answer without provenance; no answer when the deployment no longer matches what was gated.

## Layout

```
src/cli.ts              argument parsing and the command switch
src/config/             specs/gate.yaml and specs/streamsmith.yaml loaders
src/gate/               run.ts (orchestrator), assertions.ts (one evaluator per assertion),
                        jsonl.ts (protojson envelopes), contract.ts (descriptor-driven decode), rpc.ts
src/proto/descriptor.ts normalized descriptor hash (spec side and spkg side) + `substreams info`
src/deploy/             portal.ts, hosted.ts, selfManaged.ts, clickhouse.ts, views.ts, rpc.ts
src/receipt.ts          assemble, validate, hash, and the fail-closed check
src/mcp.ts              delegation to @ethonline26/mcpgen
skills/streamsmith/     the Claude Code skill; .claude-plugin/plugin.json packages it
fixtures/               fixtures/live/ holds real endpoint output; `pnpm fixtures` refreshes everything
```

## Tests

`pnpm test` runs entirely offline. `substreams build` (cargo) and `substreams run` (paid endpoint) are always faked;
`buf` and `substreams info` / `substreams pack` are used for real when installed, and the affected tests skip when
they are not. Two suites are worth knowing about:

- `test/live-runs.test.ts` — every assertion in `specs/gate.yaml` evaluated against the **real** output of the two
  recorded live runs (`runs/live/`, mirrored into `fixtures/live/`), including the 42 vault-flow rows and the two
  observations at block 51093000. Nothing in it is hand-written.
- `test/yaml.test.ts` — regression guard: `specs/gate.yaml` writes addresses and tx hashes unquoted, and the `yaml`
  package's default schema resolves `0x…` as a hex **integer**, which silently broke every address comparison. The
  loader drops the HEX/OCT `int` tags (`src/util/yaml.ts`) instead of quoting the frozen spec file.
