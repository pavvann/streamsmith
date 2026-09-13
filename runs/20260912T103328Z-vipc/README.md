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

`mcpManifestHash` was bound into it on Sept 13, once the hosted sink had caught up: `streamsmith mcp`
regenerated `packages/mcp-vaultflows` from this receipt and wrote the manifest's sha256
(`bf2e2ad3f61c46505d4d08e2c2e0d9935e33c917934651262666269a558eaeee`) back into it, giving
receiptHash `b34d21c85084fb906e4e90c0d3da4a12f6f7ae0428b319c0e30009dd20e9a5f1`. The record of that
step is `mcp.json` (and the generator's full output in `mcp.log.json`) in this directory.
`runs/live/cloud/mcp-live-probe-hosted.txt` records what the resulting server answers, and what it
refuses.

## Catch-up at the time of the run

The hosted pod started at 10:25:28Z from block 51,001,200. Measured over a 5-minute window
(`max(number)` in `vaultflows_hosted._blocks_` against `eth_blockNumber` at https://mainnet.base.org):

| | head | chain head | lag |
|---|---|---|---|
| 10:52:25Z | 51,026,764 | 51,210,499 | 183,735 |
| 10:57:26Z | 51,031,267 | 51,210,649 | 179,382 |

4,503 blocks in 301 s = ~898 blocks/min processed; the chain advanced 150 blocks in the same window,
so the gap closes at ~868 blocks/min net and reaching the 300-block freshness limit takes about
3.4 h from 10:57Z.

It did: by 2026-09-13T08:35Z the sink head was 51,249,575 against a chain head of 51,249,585 — a lag
of 10 blocks. The deployment has been the pipeline behind the shipped MCP server and the Vaultpilot
dashboard since.
