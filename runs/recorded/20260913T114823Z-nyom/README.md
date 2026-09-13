# Recorded one-prompt run — `20260913T114823Z-nyom`

One human message. No follow-ups. The package in `package/` was written from the prompt alone,
passed the frozen gate, was published to the substreams.dev registry as `erc4626-flows` **v0.1.1**,
deployed into a ClickHouse database, received its typed MCP tools, and ended with a Deployment
Receipt. Every file in this folder is a copy of what the run produced, in a standalone directory
outside this repository.

| | |
|---|---|
| Run id | `20260913T114823Z-nyom` |
| Baseline | commit `453bbbc28e3904110d107c20f9123a9fa3c32d9f`, tag `clean-start`, **112 tracked files**, clean tree |
| Final commit | `37ac4dd4579b343e2d2919f4e3d55ea5f917fe48` — 60 files changed, 10,487 insertions, 0 deletions |
| Gate | **passed**, exit code 0 — 18 assertions recorded, 18 passed (16 fail-severity, 2 warn-severity) |
| Published | [`substreams.dev/packages/erc4626-flows/v0.1.1`](https://substreams.dev/packages/erc4626-flows/v0.1.1) |
| Output module hash | `22c9d75e3161308ee9690d9fa1012eca10ac6ef3` (`map_events`) |
| Deployed | self-managed `substreams-sink-sql` into ClickHouse database `vaultflows_rec` |
| Receipt | [`receipt/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json`](receipt/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json), also at [`receipts/`](../../../receipts/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json) |

## What the human typed

One message, and nothing after it: the path [`specs/prompt.md`](../../../specs/prompt.md). That file
is byte-identical here and in the recording directory — sha256
`30cd50952be8df76ad2d886eb8a334ec006db565f9f2fb140f0a313d05be02e0`, the same value `manifest.json`
records as `promptHash`. It asks for a reusable Base pipeline for ERC-4626 vault activity against the
public contract in `specs/vaultflows.proto`, forbids touching the schema, tests or gate, and says to
work autonomously until the gate passes, then publish, deploy, generate the MCP tools and write the
receipt — or stop with evidence rather than weaken a requirement.

No second message was sent. The run directory is the whole record of what followed.

## The baseline it started from

`clean-start` held 112 tracked files and nothing that could be copied into an answer:

| | files |
|---|---|
| `specs/` | 5 — `vaultflows.proto` (the contract), `gate.yaml`, `streamsmith.yaml`, `receipt.schema.json`, `prompt.md` |
| `packages/` | 103 — `streamsmith` and `mcpgen` only |
| workspace | 4 — `.gitignore`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |

There was no `packages/erc4626-flows` at the baseline; the whole package in `package/` is the run's
output. Against this repository, `specs/vaultflows.proto`, `specs/prompt.md` and
`specs/receipt.schema.json` are byte-identical; `specs/streamsmith.yaml` and `specs/gate.yaml` differ
only in the package version (`v0.1.1`, because `v0.1.0` was already on the registry) and in the sink
target (`vaultflows_rec`, self-managed), so the live databases were never a fallback for this run.

The independence shows in the module hash. This run's `map_events` hashes to
`22c9d75e3161308ee9690d9fa1012eca10ac6ef3`; the reference package in this repository hashes to
`8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`. Same contract, same parameters, same gate — different
code.

## Timeline, from the run files

| UTC | step | file |
|---|---|---|
| `11:48:26.567Z` | run manifest opened | `manifest.json` `startedAt` |
| `11:48:41.619Z` | gate started | `gate.json` `startedAt` |
| `11:49:58.108Z` | gate finished, exit 0 | `gate.json` `finishedAt` |
| `11:50:29.951Z` | publish recorded | `publish.json` `createdAt` |
| `11:50:35.707Z` | registry accepted v0.1.1 | `publish.json` `registryPublishedAt` |
| `11:51:12.792Z` | sink started against `vaultflows_rec` | `deploy.json` `deployedAt` |
| `11:53:14.257Z` | sink head and row counts read back | `deploy.json` `checkedAt` |
| `11:53:17.927Z` | Deployment Receipt written | receipt `createdAt` |
| `11:53:25.919Z` | MCP server generated, `mcpManifestHash` bound | `mcp.json` `createdAt` |
| `11:58:17.370Z` | the package's two views applied | `deploy.json` `views.appliedAt` |

All timestamps are 2026-09-13. First to last is **9 min 51 s**; run manifest to receipt is
**4 min 51 s**. `sink.log` covers `11:51:13.535Z` to `12:06:25.978Z` (its own lines are stamped
`+0530`) and ends with a graceful shutdown once the run was over.

This window covers the promotion pipeline — gate, publish, deploy, views, MCP, receipt. The
authoring that preceded it is not timestamped by these files; what proves it is the diff:
`git/diff-clean-start-HEAD.stat` and `git/one-prompt-run.patch` show every line the run added on top
of the baseline.

## Gate

`gate.json` — `status: passed`, `exitCode: 0`, `passed: true`. 18 assertions, all 18 passed: 16 at
fail severity (any one of them red stops the run) and 2 at warn severity (the two that call a live
RPC endpoint). Ranges gated: `51092254:51092454` twice (primary and a byte-identical rerun) and
`51092998:51093002` for the fixed-interval observations.

Assertions include: the contract descriptor is unmodified and matches the built `.spkg`; parameters
equal `streamsmith.yaml`; both configured vaults appear with valid metadata and successful
`convertToAssets` calls; four reference flows are present; log indices match
`eth_getTransactionReceipt`; the observation grid is exactly one sample per vault at block
51,093,000 and matches a live `eth_call`; 48/48 configured-vault rows report `call_ok`; ids are
unique; addresses are lowercase hex; the rerun is byte-identical to the primary; every output line
decodes as `vaultflows.v1.Events` with unknown fields rejected; and the banned-words check is clean.

### Build attempts

**One.** `build.log` records a single `substreams build` invocation — `# exit 0 in 27056ms`, cwd
`packages/erc4626-flows` — and `gate.json` `build` agrees (`code: 0`, `skipped: false`, both expected
outputs present). That is the gate's build of the finished package; the compiler output it captured
is the one that produced the published `.spkg`.

## Publish

`substreams registry publish … --yes`, exit 0 (`publish.log`, `publish.json`).

| | |
|---|---|
| Package | `erc4626-flows` **v0.1.1**, network `base` |
| Web | https://substreams.dev/packages/erc4626-flows/v0.1.1 |
| API | https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.1 (`urlVerified: true`) |
| Output module | `map_events` → `proto:vaultflows.v1.Events`, hash `22c9d75e3161308ee9690d9fa1012eca10ac6ef3` |
| `packageHash` | `b9089b3f7eefb8db75b9c828e5a5b3d0bcafad00b8bfa53893add10dbcad0dca` |

The one registry warning was cosmetic: `Image (package.image) is not set`.

## Deploy

`deploy.json` — `deploymentMode: self-managed-sink`, `substreams-sink-sql from-proto` into ClickHouse
Cloud database **`vaultflows_rec`**, `--final-blocks-only`, start block 51,001,200, endpoint
`base-mainnet.streamingfast.io:443`. The live `vaultflows` and `vaultflows_hosted` databases were not
touched by this run.

Rows at the moment the deploy record was written (`checkedAt 11:53:14.257Z`, sink head block
51,006,830 against a chain head of 51,255,523 — the sink was still backfilling from its start block):

| table | rows |
|---|---|
| `vault_flows` | 1,041 |
| `share_value_observations` | 2 |
| `vaults` | 177 |
| `share_transfers` | 0 |
| `_blocks_` | 1,030 |

Both views in `package/sql/views.sql` were applied at `11:58:17.370Z`: `vault_flows_24h` and
`share_value_growth`. `schema.sql` is the live `SHOW CREATE TABLE` dump and `schema-rendered.sql` is
the DDL derived offline from the `.spkg` proto descriptors; the two are byte-identical.

## Receipt

[`receipt/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json`](receipt/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json),
copied verbatim — byte-identical to the recording directory's copy and to
[`receipts/`](../../../receipts/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json) in this repository.

| hash | value |
|---|---|
| receipt (canonical JSON, what `mcp.json` records as `receiptHash`) | `5c7234c5197d41027e40366c8bff461a5b85db40636f26b75928a5ce66fd33fb` |
| receipt file (sha256 of the bytes on disk) | `e5ae2142eaa4e184ab6692d3f85c54ad864d051b368d25d7f04e7e9b538ab6f3` |
| `outputModuleHash` | `22c9d75e3161308ee9690d9fa1012eca10ac6ef3` |
| `packageHash` | `b9089b3f7eefb8db75b9c828e5a5b3d0bcafad00b8bfa53893add10dbcad0dca` |
| `protoDescriptorHash` | `ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9` |
| `parametersHash` | `baa6ae91bb4047064c246d4541b33c8cf91c6e6a867be766a16c5be9524100cd` |
| `sinkSchemaHash` | `2043459f95d14e830d084d3f09b5b179aed5149fcd422da74d4648f44de38357` |
| `mcpManifestHash` | `28078fe9a36797e645c7f0aefb32b7eddb1e0e84df6bc9aca89b373750391822` |

`mcpManifestHash` is the sha256 of the generated server's `manifest.json`, written back into the
receipt after `mcpgen` ran (`mcp.json`, full generator output in `mcp.log.json`). That round trip is
what lets the generated tools refuse to answer from a database whose schema no longer matches the
receipt they were built from.

## What is in this folder

| path | what it is |
|---|---|
| `manifest.json` | run manifest: prompt hash, spec hashes, tool versions, starting commit and tag |
| `gate.json` | the gate report — 18 assertions, ranges, build record, RPC cross-checks |
| `build.log` | the single `substreams build` invocation and its compiler output |
| `primary.jsonl`, `primary_rerun.jsonl`, `observation.jsonl` | the three gated `substreams run` outputs |
| `primary.stderr.log`, `primary_rerun.stderr.log`, `observation.stderr.log` | their usage reports and trace ids |
| `publish.json`, `publish.log` | the registry publish and its raw output |
| `deploy.json` | sink configuration, head and row counts, applied views, cursor position |
| `sink.log` | the sink process log, from schema creation to graceful shutdown |
| `schema.sql`, `schema-rendered.sql` | the live schema dump and the offline render of the same DDL |
| `mcp.json`, `mcp.log.json` | MCP generation and the hash binding back into the receipt |
| `receipt/` | the Deployment Receipt, verbatim |
| `package/` | the generated package's full source tree, minus `target/` and the `.spkg` |
| `git/` | baseline and final commit hashes, the diff stat, and the full patch |

## What was not copied, and why

| not copied | why |
|---|---|
| `erc4626-flows-v0.1.1.spkg` | build output, 826,487 bytes — sha256 `b9089b3f7eefb8db75b9c828e5a5b3d0bcafad00b8bfa53893add10dbcad0dca`, the same value the receipt records as `packageHash`. Fetch it from the registry URL above. |
| `packages/erc4626-flows/target/` | Rust build directory, ~422 MB of compiler artifacts. |
| `sinkinfo/` | the sink's schema-hash bookkeeping file, rewritten on every sink start. |
| `clickhouse-cursor.txt` | the sink's resumption cursor, rewritten continuously. `deploy.json` keeps the cursor value as it stood at `11:53:13.172Z`. |
| `sink.pid` | a process id from the machine that ran the sink. |
| `.keep` | an empty placeholder the run directory no longer needs here. |

Nothing exceeded the 5 MB per-file limit, so nothing was dropped for size. There is no video or
terminal cast: none was captured, and no recording hash is claimed anywhere. The evidence is this
directory, the diff against `clean-start`, and the published package.

## What was scrubbed

Text files were copied byte-for-byte except for two substitutions, applied to eight files:

1. the recording directory's absolute filesystem path → `<recording-dir>`
2. the ClickHouse Cloud hostname in the sink connection string → `<clickhouse-host>` (the password
   was already masked as `***` by the tool that wrote the record, and the receipt and `deploy.json`
   both keep `hostFingerprint`, the sha256 of `host:port`, which is the verifiable identity)

| file | path substitutions | host substitutions |
|---|---|---|
| `build.log` | 2 | 0 |
| `deploy.json` | 5 | 1 |
| `mcp.json` | 10 | 0 |
| `mcp.log.json` | 13 | 0 |
| `publish.json` | 2 | 0 |
| `publish.log` | 1 | 0 |
| `sink.log` | 1 | 0 |
| `git/one-prompt-run.patch` | 30 | 1 |

A third substitution applies to `git/one-prompt-run.patch` alone: the `From:` mail header
`git format-patch` writes carries the committer's name and personal address, and reads
`<author redacted>` here. The commit's own `Subject`, `Date`, trailer and body are untouched.

No hash, number, block range, timestamp or identifier was altered. The receipt, `gate.json`,
`manifest.json`, the three `.jsonl` outputs, the stderr logs, both `.sql` files and every file under
`package/` contained neither pattern and are byte-identical to the originals.

One consequence is worth stating plainly: `git/one-prompt-run.patch` carries `index <blob>..<blob>`
lines from the recording repository, and the four hunks that were scrubbed (`deploy.json`,
`mcp.json`, `mcp.log.json`, `publish.json`) no longer hash to the blob ids printed above them. The
patch still applies and still shows every line the run wrote; the unscrubbed original is
reproducible with `git format-patch clean-start..HEAD --stdout` at commit
`37ac4dd4579b343e2d2919f4e3d55ea5f917fe48` of the recording directory. `diff-clean-start-HEAD.stat`
needed no scrubbing and is unmodified.
