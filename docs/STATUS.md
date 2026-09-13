# STATUS

A dated record of what was built, what it measured, and what is still open. Times are IST.

## Sept 9
- Done: repo scaffold, TASKS.md, AI-USAGE, feedback stubs. Plan v2 settled (docs/PROJECT.md). Bazantic dropped; two sponsors.
- Started: A1 toolchain + Pinax build + local ClickHouse + sink; A2 contract + facts + vault resolution; A3 Privy facts + Vaultpilot server skeleton.
- Pending operator steps: `substreams auth`, Privy app keys, Base wallet funding, ClickHouse Cloud (not needed until the hosted-sink spike).
- A1 done: toolchain installed and pinned; Pinax repo cloned, prebuilt erc4626 spkg usable. Own builds and Docker blocked — not enough free space on the host (1.6 GB) for a Rust workspace build or the ClickHouse image. Pinax erc4626 is not on substreams.dev → import by pinned raw-GitHub URL. from-proto ClickHouse needs schema annotations in our proto (carried into A2).
- Decision: ClickHouse Cloud is the dev+demo database (Docker off the critical path).
- A3 done: Privy facts (391 lines, cited) + Vaultpilot server skeleton; typecheck passes; spike exits cleanly listing missing env. Corrections: policy methods are `earn_deposit`/`earn_withdraw`; vault ids are per-app after a dashboard fee-wrapper step; rolling daily caps unsupported for Earn (app-side); Organizations/quorums not gated; Dashboard manual approvals are Enterprise-gated.

## Sept 10 (00:40)
- A2 delivered facts, vaults, proto, yaml, prompt (committed). gate.yaml + contract notes deferred → A2b.
- Receipt schema v1 written (specs/receipt.schema.json).
- Wave 2 started: A2b (gate + notes + proto review), A4 (Streamsmith TS core: gate/publish/deploy/receipt/manifest/SKILL), A5 (Rust package + CI build in GitHub Actions).
- Kill-criterion (one custom row in a sink by 12:00) at risk without a streaming token; revised target 18:00.

## Sept 10 (13:00)
- A5 done: erc4626-flows compiles green in GitHub Actions (rust 1.88, wasm 46 s), 13 unit tests, spkg artifact. Merged to main (ff).
- A2b done: gate.yaml (19 assertions), contract notes, proto fixes. Committed.
- A4 stopped mid-refactor; WIP committed. Continued as A4b (finish CLI, align to gate.yaml, plugin packaging).
- A6 started: mcpgen (proto+receipt-driven MCP with fail-closed checks) + views.sql.
- Free space on the host rose to 12 GB, so local builds became possible. A7 started: local Docker ClickHouse + local Rust build + spkg hash vs CI.
- A7 done: local ClickHouse up; Rust 1.88 toolchain; local build green (35 s). Finding: the spkg sha256 is NOT reproducible (proto file order random, wasm host-dependent) → the receipt gains `outputModuleHash` (required) and `moduleHashes`; packageHash is documented as artifact identity only. Cargo.lock committed. Still no token → no live run.
- 13:40: **first live custom-module output** — map_share_value_observations at block 51093000 returns both vaults with assets_per_share 1040743 / 1039913, an exact match to the on-chain reference. Historical eth_call determinism confirmed. Primary map_events range running (store backfill from 49276800).
- Privy App ID + secret placed in apps/vaultpilot/.env (gitignored). Authorization keys and fee-wrapper vault ids still outstanding.
- 13:55: the primary run was refused by the CLI guard (store prep from 49276800 needs 3.6M processed blocks; the free tier allows 7M). Decision: startBlock/initialBlock → 51001200 (a multiple of 1800, ~2.7 days back). Rebuilt (10 s). Re-ran the primary with `--limit-processed-blocks 0`. Contract still unfrozen; A4b/A6 fixtures to follow.

## Sept 10 (18:40)
- Live evidence regenerated into runs/live/ (committed).
- Primary gate range live: 42 VaultFlow rows, an exact match to the on-chain reference; stores cached (182k blocks).
- A4b/A6 stopped mid-work; WIP committed (streamsmith typecheck green, 48/65 tests; mcpgen 57/58, one tsc error). Continued as A4c (streamsmith), A6b (mcpgen), A8 (sink spike into local ClickHouse = kill criterion).
- 19:30: A8 sink spike — **first custom rows in ClickHouse** (2 share_value_observations, exact values, restart-safe, views work). vault_flows blocked: substreams-sink-sql 4.13.1 (latest) panics on proto3 enums. Decision: `direction` enum → string, carried by A9 through proto/Rust/gate/evidence/sink.
- 20:10: ClickHouse Cloud provisioned and verified (sink/ro users). Privy treasurer + agent authorization keys received and stored. The Privy spike still needed the two fee-wrapper vault_ids + gas sponsorship.
- 20:35: Privy spike PASS (wallet 0xcdC8…fDC, policy, agent signer, positions, denials). A6b done: mcpgen + generated MCP green (73 tests, 7 tools, fail-closed chain). Solo team confirmed.
- 20:55: ETHGlobal registration done; fee-wrapper addresses recorded (10% fee → disclose). Competitor noted: Sourcemark (Graph+Hedera+Bazantic paid read layer with a provenance gate) → sharpen the messaging: lead with "one prompt → deployed ERC-4626 pipeline → money moved", receipt/refusal as the supporting trust mechanism.

## Sept 10 (22:10)
- A4c done: Streamsmith green (75/75), real E2E on live data (gate 18/18, receipt, mcp, views). A9 done: enum→string, 171 flow rows in local ClickHouse (kill criterion met). A6b done: mcpgen green.
- Published erc4626-flows v0.1.0 to substreams.dev; Portal login done; hosted deployment `depdehi448c87998ebb763b` created, awaiting ClickHouse secret entry.
- A10 (Vaultpilot) stopped mid-task; WIP committed as-is: apps/vaultpilot decision service / executor / UI.
- 22:40: the hosted Deploy was accepted but crash-looped — `param for module "vaults[]": module not found`. `execution_config.parameters` expects `<module>=<value>` pairs, not the raw param string. Fix, in one call: re-Deploy (or UpdateDeploymentConfig) with `parameters` OMITTED, because the published spkg already carries the `params:` defaults from the manifest; then GetDeploymentState until STATE_LIVE; then verify rows in ClickHouse Cloud as the `ro` user. Deployment id `depdehi448c87998ebb763b`; org id in .env.

## Sept 11 (05:20)
- The Portal token expired (refresh rejected), so the hosted redeploy needs a fresh device login.
- Self-managed sink → ClickHouse Cloud running (pid in runs/live/cloud/sink.pid), tables created, backfilling from 51001200 with `--final-blocks-only`.
- A10b started to finish Vaultpilot.
- 05:55: all packages green (streamsmith 88, mcpgen 73, vaultpilot 113; root typecheck ok; CI green). Cloud backfill at lag ~57k; share_value_growth answering (both vaults ≈ +0.02% over 42 observed hours, 12 samples). demo:denied verified live.
- 06:15: the gate PASSES 18/18 on live data including the RPC cross-checks (tx receipts + convertToAssets at 51093000). The MCP probed against cloud refuses correctly (`check_unavailable`), but for a fixable reason — the readonly profile rejects per-query settings → A13. A `deploy status` JSON bug → A12. Backfill lag 39k, ~4k blocks/min.

## Sept 11 (06:45) — pipeline live end to end
- Cloud sink steady at lag 200–250 blocks (final-blocks mode). `deploy status` fixed (A12). MCP runtime fixed for the readonly profile (A13).
- Real Deployment Receipt: receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json (gate 18/18, module hash 8e4892cf…, deploymentMode self-managed-sink, sinkSchemaHash 6d57b7cd…, mcpManifestHash bound).
- Live MCP against cloud: pipeline_status ok (receipt matches, schema ok, lag 228); share_value_growth: both vaults ≈ +0.037% over 79 observed hours / 43 samples; vault_flows_24h real numbers. Evidence: runs/live/cloud/mcp-live-probe.txt.
- 07:45: the A14 blind rehearsal PASSED (gate 18/18 on the first gate attempt; 3 build-time traps found). `contract-v1` tagged. A16 fixing the traps + offline schema hash + observedWindow.hours. README/ARCHITECTURE/SUBMISSION written.
- 12:30: Vaultpilot UI redesigned (A17, two rounds); screenshot docs/build/ui-redesign.png. Runs locally on :3000 against cloud data.

## Sept 12 — Graph Market hosted deployment live

- Hosted deployment `depnywi036749442f3c55e7` created on The Graph Market and `DEPLOYMENT_STATE_DEPLOYED` /
  `STATE_CATCHING_UP` from start block 51001200, writing to a second ClickHouse Cloud database
  `vaultflows_hosted` on the same service. The self-managed sink into `vaultflows` keeps running as the
  fallback; the two never write to the same database.
- Root cause of the first hosted attempt's failure, and why a reconfigure could not repair it:
  `docs/build/sink-spike.md` §7.2. The fix is a fresh deployment with no `execution_config.parameters`;
  the pod log confirms `params []`.
- New Streamsmith command `deploy hosted --attach --deployment-id ID`: records a deployment that is already
  running from read-only Portal calls (`GetDeploymentState`, `Logs`) plus the sink's database and an
  independent chain head. `Deploy`, `UpdateDeploymentConfig` and `CreateDeployment` all restart or duplicate
  a running pod, so none of them can be used to produce evidence about one.
- Run `20260912T103328Z-vipc`: views applied to `vaultflows_hosted` (both return rows for both vaults);
  `schema-render` equals `schema-dump` byte for byte (sha256 `89f10609…`); gate 16/16 fail-level assertions
  passed reusing the recorded stream output of run `20260910T234439Z-1fr9` (same module hash, same ranges);
  receipt `receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json` with
  `deploymentMode: graph-market-hosted`, valid against `specs/receipt.schema.json`.
- MCP probe against the hosted database (`runs/live/cloud/mcp-live-probe-hosted.txt`): provenance reports
  `graph-market-hosted`, the receipt matches the manifest, the live column set matches the receipt's schema
  hash, the `ro` credential is detected as a read-only profile and no per-query settings are sent, a tampered
  receipt produces `receipt_mismatch`, and the data tools refuse with `stale_data` while the sink is still
  catching up.
- Vaultpilot dry run with the cloud source pointed at `vaultflows_hosted` and the hosted receipt: the pipeline
  stamp shows `mode graph-market-hosted` with the receipt hashes, and the decision service holds with
  `pipeline_refused (stale_data)` and `stale_pipeline` — the fail-closed rule working as specified.
- Catch-up measured over a 5-minute window (`max(number)` in `vaultflows_hosted._blocks_` against
  `eth_blockNumber` at https://mainnet.base.org): 10:52:25Z head 51,026,764 lag 183,735 → 10:57:26Z head
  51,031,267 lag 179,382. The sink processes ~898 blocks/min and closes the gap at ~868 blocks/min net,
  so reaching the 300-block freshness limit takes about 3.4 h from 10:57Z.
- **Open when written, closed on Sept 13:** the hosted sink had not caught up yet, so
  `packages/mcp-vaultflows` and the dashboard still read `vaultflows`. See the Sept 13 entry.

## Sept 13 — hosted deployment is the live pipeline

- The hosted sink reached the chain head. Measured through the shipped tools: sink head 51,249,575
  against chain head 51,249,585, a lag of 10 blocks / ~20 s, inside the 300-block freshness limit.
- `packages/mcp-vaultflows` regenerated with `streamsmith mcp` from the hosted receipt: the manifest now
  carries `deploymentMode: graph-market-hosted`, `deploymentId: depnywi036749442f3c55e7` and
  `sinkSchemaHash 89f10609…`, and its sha256 `bf2e2ad3…` is bound back into
  `receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json` as `mcpManifestHash` (receiptHash
  `b34d21c8…`, still valid against `specs/receipt.schema.json`). Tool set, argument schemas and the
  column-set hash are unchanged; the record of the run is `runs/20260912T103328Z-vipc/mcp.json`.
- Live stdio probe of that package against `vaultflows_hosted` as the read-only user
  (`runs/live/cloud/mcp-live-probe-hosted.txt`): `pipeline_status` verified with the receipt matching the
  manifest and the live column set matching the receipt's schema hash; `share_value_growth` both vaults
  ≈ +0.064% over a 135-hour, 94-observation window; `vault_flows_24h` with a window ending 21 s behind the
  wall clock; the metadata probe answering for both receipt-pinned vaults. Two refusals recorded with the
  same package: a receipt copy with one hash zeroed gives `receipt_mismatch` while the schema check and the
  lag are still fine, and a zero lag allowance gives `stale_data` while the receipt and schema are still
  fine.
- Vaultpilot's cloud source switched to the hosted pipeline (`CH_CLOUD_DATABASE=vaultflows_hosted` plus the
  manifest and receipt paths, in the app's gitignored `.env`). Dry run `agent:once --source cloud`: pipeline
  verified, head 51,249,692, lag 2, stamp `mode graph-market-hosted` with the receipt hashes; both vaults
  observed for 136 h / 95 observations with growth 6.468 and 6.4636 bps; decision **hold**, reason
  `no_position` — the business wallet still holds nothing in either approved vault. Nothing was executed.
- The self-managed sink into `vaultflows` keeps running as the fallback with its own receipt; neither
  deployment writes to the other's database.

## Sept 13 — recorded one-prompt run

- Run `20260913T114823Z-nyom`, in a separate directory staged per docs/RECORDING.md §A with no
  `packages/erc4626-flows` in it. Baseline commit tagged `clean-start`: 112 tracked files — 5 spec files,
  103 files of `streamsmith` and `mcpgen`, 4 workspace files — and a clean tree. `specs/vaultflows.proto`,
  `specs/prompt.md` and `specs/receipt.schema.json` are byte-identical to this repository's;
  `specs/streamsmith.yaml` and `specs/gate.yaml` differ only in the package version (v0.1.1, because
  v0.1.0 is taken on the registry) and in the sink target (`vaultflows_rec`, self-managed), so the live
  `vaultflows` and `vaultflows_hosted` databases were never reachable from that directory.
- One message was typed — the path `specs/prompt.md`, sha256 `30cd5095…`, the value the run manifest
  records as `promptHash` — and nothing after it.
- Result: gate **18/18 passed, exit 0** (16 fail-severity, 2 warn-severity, both RPC cross-checks green);
  `build.log` records a single `substreams build`, exit 0 in 27.1 s; `erc4626-flows` **v0.1.1** published
  to substreams.dev (`packageHash b9089b3f…`, `.spkg` 826,487 bytes); self-managed `substreams-sink-sql`
  into `vaultflows_rec` with both views applied; MCP server generated and its manifest sha256
  `28078fe9…` bound back into the receipt (canonical receiptHash `5c7234c5…`).
- The output module hash is `22c9d75e3161308ee9690d9fa1012eca10ac6ef3` against the reference package's
  `8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a` — same contract, same parameters, same gate, independently
  written code, which is the point of the exercise.
- Timing from the run files: manifest `11:48:26.567Z` → receipt `11:53:17.927Z` (4 min 51 s), views
  applied `11:58:17.370Z` (9 min 51 s end to end). At the deploy record the sink was still backfilling
  from block 51,001,200: head 51,006,830, 1,041 flow rows, 177 vaults, 2 observations, 1,030 blocks.
- Sealed into `runs/recorded/20260913T114823Z-nyom/` — run records, the generated package source
  (no `target/`, no `.spkg`; its sha256 and size are in the folder README), the receipt, and the diff
  stat and full patch against `clean-start` (60 files, 10,487 insertions). Absolute machine paths and the
  ClickHouse hostname are replaced with placeholders; the folder README lists every substitution file by
  file. No screen or terminal capture was taken, so no recording hash is claimed anywhere.

## Current state (Sept 13)
**Read in this order:** this file (bottom-up), docs/TASKS.md (tracker with `[x]`/`[~]`/`[!]`), docs/SUBMISSION.md (gates), docs/RECORDING.md (recording protocol), README.md.

Everything that does not require an operator account or funds is built, green and committed. The package is published (substreams.dev `erc4626-flows` v0.1.0, module hash 8e4892cf…) and runs through two deployments: hosted on The Graph Market (`depnywi036749442f3c55e7` → `vaultflows_hosted`, receipt receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json, caught up at single-digit block lag) and self-managed (`substreams-sink-sql` → `vaultflows`, pid file runs/live/cloud/sink.pid, steady at lag 200–250, receipt receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json with gate 18/18). The hosted deployment is the live pipeline: the shipped MCP server is generated from its receipt and answers off `vaultflows_hosted` with provenance, and Vaultpilot's decision service and redesigned UI read the same database (`--source cloud`; start command in apps/vaultpilot/README.md). The self-managed sink is the fallback. The contract is frozen at tag `contract-v1`; the blind one-prompt rehearsal passed (docs/build/rehearsal-1.md), and the recorded one-prompt run is done and sealed in runs/recorded/20260913T114823Z-nyom/ — gate 18/18, `erc4626-flows` v0.1.1 published (module hash 22c9d75e…), sink into `vaultflows_rec`, receipt receipts/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json.

**Pending operator steps** (all independent of each other):
1. Fund the treasury wallet `0xcdC8B69799bCb135C04A1052b918787125571fDC` with ~50 USDC on Base, then run `pnpm --filter @ethonline26/vaultpilot demo:deposit --amount 25 --execute` into the lower-growth vault, then `demo:rotate --execute` if the differential exceeds 2 bps.
2. Fund the wallet with a small ETH balance on Base for gas (transactions are not sponsored).
3. Record the demo video per docs/RECORDING.md §C. The one-prompt run itself is already done and sealed in runs/recorded/20260913T114823Z-nyom/, so the video can cut to its artifacts rather than re-running it.
4. Delete the superseded hosted deployment `depdehi448c87998ebb763b` from the Graph Market UI. It is the failed first attempt; no delete endpoint is called from this repository.

**Next work once the wallet is funded:** deposit + rotation with real tx hashes, surfaced in the ledger and the UI. Then the video. Sept 13 before 12:00 EDT: submit (Graph both tracks + Privy both tracks, Start Fresh).

**Project conventions:** each workstream is specified by a brief in specs/briefs/ before it starts; money-moving commands run only on an explicit operator instruction; banned words in all copy: yield, APY, share price, TVL, risk.
