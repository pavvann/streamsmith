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
