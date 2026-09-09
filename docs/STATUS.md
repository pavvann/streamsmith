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
