# Run 20260912T103328Z-vipc — Graph Market hosted cut-over

The run that promotes the **hosted** deployment of `erc4626-flows` v0.1.0 to a Deployment Receipt.
The earlier run `20260910T234439Z-1fr9` records the self-managed sink into database `vaultflows`;
that run and its receipt are untouched and remain valid for the fallback path.

| Deployment | `depnywi036749442f3c55e7` on The Graph Market (Portal API HostedService) |
|---|---|
| Package | `https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0`, output module `map_events` |
| Module hash | `8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a` (unchanged from the self-managed run) |
| Sink | ClickHouse Cloud, database `vaultflows_hosted`, from-proto, port 9440 secure |
| Start block | 51001200 |

## What is in here

| File | How it was produced |
|---|---|
| `views.json` | `streamsmith deploy views --database vaultflows_hosted` — the two statements of `packages/erc4626-flows/sql/views.sql` applied with the admin credential (the sink user has no grants in this database). Both views return rows for both configured vaults. |
| `deploy.json` | `streamsmith deploy hosted --attach --deployment-id …` — read-only. `GetDeploymentState` for the state, `Logs` for the execution config the running pod reports, ClickHouse for head and row counts, `https://mainnet.base.org` for the chain head. No `Deploy`, `UpdateDeploymentConfig` or `CreateDeployment` call was made: all three restart or duplicate a running pod. |
| `schema.rendered.sql` | `streamsmith schema-render --spkg … --database vaultflows_hosted` — the from-proto DDL derived offline from the spkg's proto descriptors. |
| `schema.sql` | `streamsmith schema-dump --database vaultflows_hosted` — `SHOW CREATE TABLE` against the live hosted database. Byte-identical to the rendered file; sha256 `89f106091e7bdd69b025018f24ecdea75d7f0a8acc9e0087eccd3d1287a20e48`. |
| `gate.json` | `streamsmith gate --reuse-runs --skip-build` — 16/16 fail-level assertions passed, 18 assertions recorded. |
| `primary.jsonl`, `primary_rerun.jsonl`, `observation.jsonl` | Reused, see below. |

## What was reused, and why that is honest

The gate's three `substreams run` outputs were **copied verbatim** from run
`20260910T234439Z-1fr9` rather than re-streamed:

| File | sha256 | Range |
|---|---|---|
| `primary.jsonl` | `0427751af12525b7110cf932b57d427dc3c0d15fa77d1c2b2beb548859ac451c` | 51092254:51092454 |
| `primary_rerun.jsonl` | `0427751af12525b7110cf932b57d427dc3c0d15fa77d1c2b2beb548859ac451c` | 51092254:51092454 |
| `observation.jsonl` | `0290741338143c7ba17532516a967ad7de04a67bc2f5c03578230779ec5b4343` | 51092998:51093002 |

The output of a Substreams module over a fixed block range is a function of the module and the
range. The module hash the hosted pod reports (`8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`, in
`deploy.json` under `executionConfig.outputModuleHash`) is the same hash the earlier run gated, and
the ranges are the ones `specs/gate.yaml` pins, so the same bytes are the correct evidence for this
run. `--skip-build` keeps the same spkg for the same reason.

Everything else in `gate.json` was re-evaluated from scratch against those bytes, including the two
assertions that call a live RPC endpoint (`log_index_matches_rpc` against `eth_getTransactionReceipt`
and `observation_matches_reference` against `convertToAssets` at block 51093000).

## Receipt

`receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json` — `deploymentMode: graph-market-hosted`,
validates against `specs/receipt.schema.json`.

It carries no `mcpManifestHash`: no MCP server has been generated from it yet, because at the time
of the run the hosted sink was still catching up from its start block and the freshness gate
(`maxLagBlocks` 300) refuses. `runs/live/cloud/mcp-live-probe-hosted.txt` records what a server
generated from this receipt does answer, and what it refuses.
