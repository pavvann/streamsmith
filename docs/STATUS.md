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

## Current state (Sept 11, ~13:00)
**Read in this order:** this file (bottom-up), docs/TASKS.md (tracker with `[x]`/`[~]`/`[!]`), docs/SUBMISSION.md (gates), docs/RECORDING.md (Sept 12 protocol), README.md.

Everything that does not require an operator account or funds is built, green (streamsmith 106 tests, mcpgen 80, vaultpilot 113; CI green) and committed. The pipeline is live: the package is published (substreams.dev `erc4626-flows` v0.1.0, module hash 8e4892cf…); a self-managed sink feeds ClickHouse Cloud steadily at lag 200–250 (pid file runs/live/cloud/sink.pid); the receipt receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json records gate 18/18; the MCP answers live with provenance; Vaultpilot's decision service and redesigned UI run against cloud data (`--source cloud`; start command in apps/vaultpilot/README.md); the contract is frozen at tag `contract-v1`; the blind one-prompt rehearsal passed (docs/build/rehearsal-1.md).

**Pending operator steps** (all independent of each other):
1. Fund the treasury wallet `0xcdC8B69799bCb135C04A1052b918787125571fDC` with ~50 USDC on Base, then run `pnpm --filter @ethonline26/vaultpilot demo:deposit --amount 25 --execute` into the lower-growth vault, then `demo:rotate --execute` if the differential exceeds 2 bps.
2. Confirm Privy gas sponsorship (App pays, on Base).
3. Book the recording slot for Sept 12.
4. Optional hosted Graph Market redeploy: a new device login (POST PortalApi/DeviceAuthorize; save the FULL DeviceToken response to .portal-token.json), then runs/live/cloud/redeploy-hosted.sh.

**Next work once the wallet is funded:** deposit + rotation with real tx hashes, surfaced in the ledger and the UI. Sept 12: stage a fresh directory and the `vaultflows_rec` database per docs/RECORDING.md, then record the one-prompt run and the video. Sept 13 before 12:00 EDT: submit (Graph both tracks + Privy both tracks, Start Fresh).

**Project conventions:** each workstream is specified by a brief in specs/briefs/ before it starts; money-moving commands run only on an explicit operator instruction; banned words in all copy: yield, APY, share price, TVL, risk.
