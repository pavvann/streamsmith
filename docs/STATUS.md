# STATUS

## Sept 9 (IST night)
- Done: repo scaffold, TASKS.md, AI-USAGE, feedback stubs. Plan v2 approved (docs/PROJECT.md). Bazantic dropped; two sponsors.
- Running: A1 toolchain + Pinax build + local ClickHouse + sink; A2 contract + facts + vault resolution; A3 Privy facts + Vaultpilot server skeleton.
- Blocked on Pawan: GitHub push, `substreams auth`, Privy app keys, Base wallet funding, ClickHouse Cloud (not needed until hosted-sink spike).
- A1 done: toolchain installed and pinned; Pinax repo cloned, prebuilt erc4626 spkg usable; own builds and Docker BLOCKED by full disk (1.6 GB free). Pinax erc4626 not on substreams.dev → import by pinned raw-GitHub URL. from-proto ClickHouse needs schema annotations in our proto (forwarded to A2).
- Decision: ClickHouse Cloud is the dev+demo database (Docker off the critical path). Disk cleanup needs Pawan's approval.
- A3 done: Privy facts (391 lines, cited) + Vaultpilot server skeleton; typecheck passes; spike exits cleanly listing missing env. Corrections: policy methods are `earn_deposit`/`earn_withdraw`; vault ids are per-app after a dashboard fee-wrapper step; rolling daily caps unsupported for Earn (app-side); Organizations/quorums not gated; Dashboard manual approvals are Enterprise-gated.

## Sept 10 (IST 00:40)
- A2 delivered before being cut off by the spend limit: facts, vaults, proto, yaml, prompt (committed). Missing gate.yaml + contract notes → A2b.
- Receipt schema v1 written (specs/receipt.schema.json).
- Wave 2 launched: A2b (gate + notes + proto review), A4 (Streamsmith TS core: gate/publish/deploy/receipt/manifest/SKILL), A5 (Rust package + CI build in GitHub Actions).
- Still waiting on Pawan: disk cleanup approval, `substreams auth`, ClickHouse Cloud, Privy dashboard, wallet funding. Kill-criterion (one custom row in sink by 12:00 IST) is AT RISK without the token; honest revised target: 18:00 IST.

## Sept 10 (IST 13:00)
- A5 done: erc4626-flows compiles green in GitHub Actions (rust 1.88, wasm 46 s), 13 unit tests, spkg artifact. Merged to main (ff).
- A2b done: gate.yaml (19 assertions), contract notes, proto fixes. Committed.
- A4 killed by spend limit mid-refactor; WIP committed. Relaunched as A4b (finish CLI, align to gate.yaml, plugin packaging).
- A6 launched: mcpgen (proto+receipt-driven MCP with fail-closed checks) + views.sql.
- Still blocked on Pawan: disk cleanup approval (1.5 GB free), `substreams auth`, ClickHouse Cloud, Privy dashboard, wallet funding. No live streaming possible yet → kill-criterion slipped; new target for first live row: as soon as the token lands.
- 13:20 IST: Pawan approved cleanup; caches + Docker VM data + cargo registry removed; 12 GB free. A7 launched: local Docker ClickHouse + local Rust build + spkg hash vs CI.
- A7 done: local ClickHouse up; Rust 1.88 toolchain; local build green (35 s). Finding: spkg sha256 is NOT reproducible (proto file order random, wasm host-dependent) → receipt gains `outputModuleHash` (required) and `moduleHashes`; packageHash documented as artifact identity only. Cargo.lock committed. Still no token → no live run.
- 13:40 IST: **first live custom-module output**: map_share_value_observations at block 51093000 returns both vaults with assets_per_share 1040743 / 1039913 = exact on-chain reference. Historical eth_call determinism confirmed. Primary map_events range running (store backfill from 49276800).
- Privy App ID + secret in apps/vaultpilot/.env (gitignored). Waiting on authorization keys and fee-wrapper vault ids.
- 13:55 IST: primary run refused by CLI guard (needs 3.6M processed blocks for store prep from 49276800; free tier is 7M). Decision: startBlock/initialBlock → 51001200 (multiple of 1800, ~2.7 days back). Rebuilt (10 s). Re-running primary with --limit-processed-blocks 0. Contract still unfrozen; A4b/A6 told to update fixtures.

## Sept 10 (IST 18:40)
- Session restarted (spend limit). Scratchpad wiped; live evidence regenerated into runs/live/ (committed).
- Primary gate range live: 42 VaultFlow rows, exact match to on-chain reference; stores cached (182k blocks).
- A4b/A6 died mid-work; WIP committed (streamsmith typecheck green, 48/65 tests; mcpgen 57/58, one tsc error).
- New standing rule: sub-agents on Sonnet only. Relaunched A4c (streamsmith), A6b (mcpgen), A8 (sink spike into local ClickHouse = kill criterion) on Sonnet.
- Still need from Pawan: Privy auth keys ×2 + fee-wrapper vault ids ×2 + gas sponsorship; ClickHouse Cloud; Base wallet funding; ETHGlobal registration; team size.
- 19:30 IST: A8 sink spike: **first custom rows in ClickHouse** (2 share_value_observations, exact values, restart-safe, views work). vault_flows blocked: substreams-sink-sql 4.13.1 (latest) panics on proto3 enums. Decision: `direction` enum → string. A9 (Opus) carrying it through proto/Rust/gate/evidence/sink. A4c/A6b told. Rule refined: sub-agents default Opus, Sonnet for low-stakes.
- 20:10 IST: ClickHouse Cloud provisioned and verified (sink/ro users). Privy treasurer + agent authorization keys received and stored. Privy spike still waits on the two fee-wrapper vault_ids + gas sponsorship.
- 20:35 IST: Privy spike PASS (wallet 0xcdC8…fDC, policy, agent signer, positions, denials). A6b done: mcpgen + generated MCP green (73 tests, 7 tools, fail-closed chain). Solo team confirmed.
- 20:55 IST: ETHGlobal registration done; fee-wrapper addresses recorded (10% fee → disclose). Competitor noted: Sourcemark (Graph+Hedera+Bazantic paid read layer with provenance gate) → sharpen messaging: lead with 'one prompt → deployed ERC-4626 pipeline → money moved', receipt/refusal as supporting trust mechanism.

## Sept 10 (IST 22:10)
- A4c done: Streamsmith green (75/75), real E2E on live data (gate 18/18, receipt, mcp, views). A9 done: enum→string, 171 flow rows in local ClickHouse (kill criterion met). A6b done: mcpgen green.
- Published erc4626-flows v0.1.0 to substreams.dev; Portal login done; hosted deployment depdehi448c87998ebb763b created, awaiting ClickHouse secret entry by Pawan.
- Usage 58% at 21:40 IST; no new agents; A10 (Vaultpilot) still running.

## STOPPED at 64% usage (Sept 10, ~22:20 IST) — RESUME HERE
Done and committed: contract (proto/gate/yaml/receipt schema), erc4626-flows package (CI + local green, published to substreams.dev v0.1.0), Streamsmith CLI (75 tests), mcpgen + generated MCP (73 tests), Privy wallet/policy/signer live (spike pass), ClickHouse Cloud provisioned (db vaultflows, users sink/ro), local ClickHouse holds 171 flows + 2 observations via self-managed sink, Portal login + hosted deployment `depdehi448c87998ebb763b` created.
In progress (A10 stopped mid-task, WIP committed as-is): apps/vaultpilot decision service / executor / UI — check `pnpm typecheck` + `pnpm test` state in the commit message below.
Next steps, in order:
1. Pawan enters ClickHouse `default` password at https://thegraph.market/sinks/depdehi448c87998ebb763b/secret?output=clickhouse → orchestrator: HasDeploymentSecret → Deploy (user default, db vaultflows, port 9440 secure, network "base", start 51001200, params from specs/streamsmith.yaml, spkg url https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0) → GetDeploymentState until LIVE → apply views (streamsmith deploy views) → receipt with deploymentMode graph-market-hosted. Fallback: self-managed sink on a VPS to ClickHouse Cloud.
2. Confirm Privy gas sponsorship (App pays, Base); fund 0xcdC8B69799bCb135C04A1052b918787125571fDC with ~50 USDC; run `pnpm demo:denied`, `pnpm demo:deposit --amount 25`.
3. Relaunch A10 (Opus) from the WIP to finish Vaultpilot (decision, executor, UI, tests).
4. Point mcp-vaultflows at ClickHouse Cloud; run the fail-closed demo (force stale lag, schema mismatch).
5. Sept 11: clean-tag `contract-v1`, forensic one-prompt rehearsal from a fresh dir, freeze at midnight. Sept 12: README/diagram/video. Sept 13 submit before 12:00 EDT.
Standing rules: sub-agents on Opus (Sonnet for low-stakes), never Fable; stop at 65% usage; commit WIP after every agent report.
- 22:40 IST: hosted Deploy accepted but crash-looped: `param for module "vaults[]": module not found` — `execution_config.parameters` expects `<module>=<value>` pairs, not the raw param string. FIX (one call): re-Deploy (or UpdateDeploymentConfig) with `parameters` OMITTED — the published spkg already carries the `params:` defaults from the manifest — then GetDeploymentState until STATE_LIVE, then verify rows in ClickHouse Cloud (`ro` user). Deployment id depdehi448c87998ebb763b, org in .env. Not executed: usage budget reached (64%).

## Sept 11 (IST 05:20) — resumed (Pawan asleep; Opus for agents)
- Portal token expired (refresh rejected) → hosted redeploy needs a fresh device login (code issued, expires in 10 min; reissue on wake).
- Self-managed sink → ClickHouse Cloud running (pid in runs/live/cloud/sink.pid), tables created, backfilling from 51001200 with --final-blocks-only. Monitor active.
- A10b (Opus) relaunched to finish Vaultpilot.
- 05:55 IST: all packages green (streamsmith 88, mcpgen 73, vaultpilot 113; root typecheck ok; CI green). Cloud backfill at lag ~57k, share_value_growth view answering (both vaults ≈ +0.02% over 42 observed hours, 12 samples). demo:denied verified live. Next: backfill live → gate vs cloud → tag contract-v1 → receipt → MCP against cloud → fail-closed demo.
- 06:15 IST: gate PASSES 18/18 on live data incl. RPC cross-checks (tx receipts + convertToAssets at 51093000). MCP probed against cloud: refuses correctly (check_unavailable) but for a fixable reason (ro profile rejects settings) → A13. `deploy status` JSON bug → A12. Backfill lag 39k, ~4k blocks/min.

## Sept 11 (IST 06:45) — PIPELINE LIVE END TO END
- Cloud sink steady at lag 200–250 blocks (final-blocks mode). deploy status fixed (A12). MCP runtime fixed for readonly profile (A13).
- Real Deployment Receipt: receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json (gate 18/18, module hash 8e4892cf…, deploymentMode self-managed-sink, sinkSchemaHash 6d57b7cd…, mcpManifestHash bound).
- Live MCP against cloud: pipeline_status ok (receipt matches, schema ok, lag 228); share_value_growth: both vaults ≈ +0.037% over 79 observed hours / 43 samples; vault_flows_24h real numbers. Evidence: runs/live/cloud/mcp-live-probe.txt.
- Remaining before freeze (tonight IST): fund wallet → demo:deposit → demo:rotate; contract-v1 tag; forensic one-prompt rehearsal in a fresh dir; hosted redeploy when Pawan re-logs in (script ready).
