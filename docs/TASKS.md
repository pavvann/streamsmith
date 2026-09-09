# TASKS — master tracker (owner: Claude orchestrator)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · **M**ust / **S**hould / **C**ould · owner: **P**=Pawan, **O**=orchestrator, **A1..An**=sub-agents. Deadline **Sept 13 12:00 EDT (21:30 IST)**. Freeze **Sept 11 23:59 IST**. Kill criterion **Sept 10 12:00 IST**: one custom-module row Graph Market → sink.

## 0. Accounts, access, money (Pawan; unblockers)
- [x] T0.1 M O · Public repo github.com/pavvann/streamsmith created and pushed Sept 9.
- [ ] T0.2 M P · `substreams auth` device login (Graph Market streaming key) → `SUBSTREAMS_API_TOKEN` in `.env`. Accept: `substreams run` returns blocks. dep: T1.1
- [ ] T0.3 M P · Graph Market Portal device-code login for hosted sink (via `thegraph-market-api` skill flow). Accept: `ListDeployments` succeeds. dep: T1.1
- [ ] T0.4 M P · ClickHouse Cloud trial: service, db `vaultflows`, sink user (DDL) + read-only user; HTTPS + native endpoints in `.env`. Accept: remote `SELECT 1`, DDL, insert, read. (Local Docker ClickHouse covers dev until then.)
- [ ] T0.5 M P · Privy dashboard: (1) app → App ID + secret; (2) Wallets › Authorization keys › two keys (treasurer, agent), save private keys; (3) Wallet infrastructure › Earn › deploy fee wrapper for Gauntlet USDC Prime and Steakhouse Prime Instant → two `vault_id`s; (4) Gas sponsorship › App pays › Base. Fill apps/vaultpilot/.env. Accept: `pnpm --filter @ethonline26/vaultpilot spike` passes.
- [ ] T0.6 S P · Privy: attempt Organization creation; report gated or not. Fallback: plain business-owned wallet.
- [ ] T0.7 M P · Base wallet: ~50 USDC + ~$5 ETH; address in `.env`. Accept: balances visible on Basescan.
- [ ] T0.8 M P · Microphone + 1080p screen capture ready for Sept 12.
- [ ] T0.9 S P · Team: confirm 1 or 2 humans; if 2, assign Dev B (infra/Privy).

## 1. Toolchain and spikes (Sept 9)
- [!] T0.11 M P+O · **Host disk ~1.6 GB free.** Pawan approves cleanup; orchestrator runs: `rm -rf ~/.cache/*` (3.8G), `rm -rf ~/Library/Caches/*` (5.0G), `brew cleanup`, `pnpm store prune`, empty Trash; Pawan checks ~/Downloads, ~/Movies. Target ≥15 GB free. Plan B: GitHub Codespace (needs `gh auth refresh -s codespace`).
- [x] T1.1 M A1 · (done Sept 9: rustc 1.98.1, substreams 1.22.0, buf 1.72.0, substreams-sink-sql 4.13.1; see docs/build/toolchain.md) Install Rust stable + `wasm32-unknown-unknown`, `substreams` CLI, `buf`, `substreams-sink-sql`; pin versions in `docs/build/toolchain.md`. Accept: `cargo build --target wasm32-unknown-unknown` on Pinax erc4626 succeeds.
- [~] T1.2 M A1 · (cloned; prebuilt spkg usable; own build BLOCKED by disk; erc4626 not on registry → import by URL) Clone `pinax-network/substreams-evm`, build `erc4626` and `erc20` packages, record module names/outputs/proto paths. Accept: `.wasm` built; `substreams info` prints modules.
- [!] T1.3 M A1 · (BLOCKED: Docker I/O errors from full disk; replaced by ClickHouse Cloud for dev, see T0.4) Local ClickHouse in Docker (`vaultflows` db, sink user, ro user). Accept: `SELECT 1` over HTTP.
- [!] T1.4 M A1 · (BLOCKED on T0.2 token) `substreams run` Pinax erc4626 on Base for a 200-block historical range containing pinned-vault activity. Accept: real Deposit/Withdraw rows. dep: T0.2, T2.2
- [ ] T1.5 M A1 · Self-managed `substreams-sink-sql` (from-proto, ClickHouse) with Pinax erc4626 → local CH; cursor persistence; restart resumes. Accept: row count grows; restart no duplicates. dep: T1.4
- [ ] T1.6 M A2 · Hosted sink spike on Graph Market with Pinax's published package → ClickHouse Cloud. Time-box 90 min. Accept: rows grow, head advances. Fail → T1.5 is the deploy path. dep: T0.3, T0.4
- [ ] T1.7 M A1 · Block-context `eth_call` spike: in a module, at two historical processed blocks, batch `decimals()`, `convertToAssets(10^d)`, `totalAssets()`, `totalSupply()` for one pinned vault. Accept: deterministic block-specific values on rerun; documented in `docs/build/substreams-facts.md`. dep: T1.2, T0.2
- [~] T1.8 M A3 · (code ready: `pnpm --filter @ethonline26/vaultpilot spike`; waits on T0.5 keys + fee-wrapper vault ids) Privy spike: server wallet, additional signer + policy (`earn` restricted to 2 vault ids + cap), read both pinned vault positions, allowed vs denied call. Accept: denial observed; Earn reachable. dep: T0.5
- [ ] T1.9 M O · Record spike outcomes → choose `deploymentMode`, Privy control model. Update PROJECT.md §8/§11.

## 2. Public contract (frozen before the recorded run)
- [x] T2.1 M A2 · (docs/build/substreams-facts.md) Read Pinax `erc4626` proto + README; read skills `substreams-dev`, `substreams-ethereum`, `substreams-sql`, `substreams-hosted-sink`, `thegraph-market-api`; write `docs/build/substreams-facts.md` (params mechanism, eth_call block context, from-proto sink rules, hosted-sink API calls, registry publish). Facts with source paths only.
- [x] T2.2 M A2 · (docs/build/vaults.md; gate range 51092254:+200; startBlock 49276800; fee-wrapper consequence) Resolve pinned vaults: on-chain addresses on Base for Privy Earn "Gauntlet USDC Prime" and "Steakhouse Prime" (Morpho MetaMorpho), their Privy Earn vault ids, share decimals, asset (USDC) decimals; a recent block range with activity. Sources cited. → `docs/build/vaults.md`
- [x] T2.3 M A2+A2b · (proto reviewed vs from-proto rules: CallStatus flattened to call_ok/call_error, non-empty numeric strings, ids `{chain}-{block}-{logIndex}`, from_owner/to_owner; buf lint clean) `specs/vaultflows.proto`: `VaultFlow`, `ShareValueObservation`, `ShareTransfer` (optional), `CallStatus`; documented field semantics; versioned package name.
- [x] T2.4 M A2+A2b · (gate.yaml: 19 assertions incl. descriptor_hash_match, deterministic_rerun, observation at block 51093000; exit codes 0/10/20/30) `specs/streamsmith.yaml` (chain 8453, vaults, `sampleIntervalBlocks: 1800`, sink target, package name) + `specs/gate.yaml` (build, run range, assertions: rows>0, known-vault-present, rpc-success≥threshold, deterministic rerun, descriptor-hash-match).
- [x] T2.5 M A2 · `specs/prompt.md`: the verbatim one-human-instruction (from PROJECT.md §5).
- [ ] T2.6 M O · Freeze: tag `contract-v1` after review. NOTE: `buf.build/streamingfast/substreams-sink-sql` is retired; use `buf.build/streamingfast/substreams` (A5 manifest must change).

## 3. erc4626-flows package (Sept 10; hand-built reference first, then generated)
- [~] T3.0 M A5 · Rust package compiled in **GitHub Actions** (disk workaround): workflow builds wasm, packs spkg, uploads artifact; iterate until green.
- [ ] T3.1 M A1 · Manifest importing Pinax `erc4626` (and `erc20` if T3.6), params wiring, protos from `specs/vaultflows.proto`.
- [ ] T3.2 M A1 · `store_vault_meta`: first-sight probe `asset()`, `decimals()`, asset `decimals()`, `totalAssets()`, `convertToAssets()`; non-compliant → dropped; cached.
- [ ] T3.3 M A1 · `map_flows`: caller/owner/receiver, raw + normalized amounts (only if meta valid), `deposit_execution_rate`/`withdraw_execution_rate`, flags.
- [ ] T3.4 M A1 · `map_share_value_observations`: `block.number % K == 0`, per configured vault: `convertToAssets(10^d)`, `totalAssets`, `totalSupply`, status; point-in-time only.
- [ ] T3.5 M A1 · Tests: zero shares, decimal bounds, RPC partial failure, known Morpho events, deterministic replay, `convertToAssets` reconciliation at cited blocks.
- [ ] T3.6 S A1 · `map_share_transfers`: ERC-20 Transfer of vault shares excluding mint/burn paired with Deposit/Withdraw. Drop if it fights.
- [ ] T3.7 M A1 · Sink `schema.sql` (from-proto): `vault_flows`, `share_value_observations`, `vaults`; deterministic ids; ORDER BY per SQL skill; views `vault_flows_24h`, `share_value_growth`.
- [ ] T3.8 M A1 · Gate script (`packages/streamsmith/scripts/gate`) executes `specs/gate.yaml`; deterministic exit codes.
- [ ] T3.9 M A1 · Publish `erc4626-flows` v0.1.0 to registry (reference build, may be superseded by generated build). Accept: importable via `use`.
- [ ] T3.10 M A1 · Deploy (hosted or self-managed per T1.9); backfill ~6 weeks; verify live head. **Kill checkpoint Sept 10 12:00 IST: one custom row in sink.**
- [ ] T3.11 M A1 · Reconcile one vault end to end vs `convertToAssets` at cited blocks. Accept: within rounding.
- [ ] T3.12 S A1 · Package README: semantics, params, caveats (fee spread, virtual offset, heuristic validation), composition example.

## 4. Streamsmith plugin (Sept 11)
- [ ] T4.1 M A4 · Plugin skeleton: `plugin.json`, `SKILL.md` (routes code-gen to official skills; owns promotion), install docs.
- [ ] T4.2 M A4 · `gate` generalization: parse `gate.yaml`, structured JSON results.
- [ ] T4.3 M A4 · `publish`: pack + registry publish; capture package hash + timestamp.
- [ ] T4.4 M A4 · `deploy`: hosted (Portal API) and self-managed modes; poll head/lag; `deploymentMode` recorded.
- [ ] T4.5 M A4 · Deployment Receipt generator (schema in PROJECT.md §4.1): hashes (package, proto descriptor, params, sink schema, MCP manifest), deployment, range, head, lag, gate evidence, timestamps.
- [ ] T4.6 M A4 · MCP generator from protobuf descriptors + receipt: typed read-only tools, parameterized SQL, limits/timeouts, provenance in every response, fail-closed on schema/lag mismatch (real check).
- [ ] T4.7 M A4 · Run manifest + case-study writer (`runs/<id>/manifest.json`, `case-studies/`).
- [ ] T4.8 M A4 · Clean end-to-end rehearsal from a fresh directory, no human follow-up; fix tooling; restore clean baseline.

## 5. MCP for vault flows (Sept 11)
- [ ] T5.1 M A4 · Generate `packages/mcp-vaultflows`; tools `vault_flows`, `share_value_growth`, `recent_share_migration` (if T3.6), `pipeline_status`.
- [ ] T5.2 M A4 · Hand-tune descriptions/SQL for the demo question; windows; limits.
- [ ] T5.3 M A4 · Register in Claude Code/Desktop; verify demo question end to end; verify refusal on forced stale lag and on schema mismatch.

## 6. Vaultpilot (Sept 11)
- [~] T6.1 M A3 · (skeleton committed; methods are earn_deposit/earn_withdraw; daily cap app-side) Server (TS): Privy client, business wallet, agent authorization key as additional signer, policy JSON (earn → 2 vault ids, per-action cap, daily aggregation), revocation path documented.
- [ ] T6.2 M A3 · Earn deposit / withdraw / position for both vault ids; capture tx hashes. dep: T0.7
- [ ] T6.3 M A3 · Decision service: observed-window share-value growth (min 24h obs), min differential, outflow guardrail, cooldown, staleness refusal via `pipeline_status`, `maxWithdraw`, self-action exclusion, idempotency, intermediate-failure handling (withdraw ok → deposit fail ⇒ idle + alert).
- [ ] T6.4 M A3 · One-screen UI (Next.js): position, two observations + exact window, decision + rule, policy result, provenance, tx links, control/revocation info.
- [ ] T6.5 M A3 · Demo: denied unapproved vault, then approved below-cap action from live signal. Initial funding into the lower-growth vault.
- [ ] T6.6 C A3 · Intents for above-cap actions only if Earn path supports it first try.

## 7. Evidence, docs, video, submission (Sept 12–13)
- [ ] T7.1 M A5 · Package + plugin + MCP READMEs.
- [ ] T7.2 M O · Root README: thesis (PROJECT.md §1), diagram (Mermaid + PNG), sponsor mapping with file refs, live endpoints.
- [ ] T7.3 M P+O · Forensic one-prompt run: clean tag, `git status/HEAD/tag/date -u` on screen, asciinema + screen capture, transcript, manifest, diff, uncut hash. dep: T4.8, T2.6
- [ ] T7.4 M P · Video 3:30 per PROJECT.md §7; 1080p; human voice; test-upload by Sept 12 night.
- [ ] T7.5 M O · `AI-USAGE.md` final; `specs/` complete; feedback docs final.
- [ ] T7.6 M O · `docs/STATUS.md` daily.
- [ ] T7.7 M P+O · Clean-room verification (fresh container): links, package import, MCP install, deployment status, video playback.
- [ ] T7.8 M P · Submission form: partners = The Graph (both tracks) + Privy (both tracks); Start Fresh pool; repo; video; per-partner "how we used it" + feedback text. Submit before 12:00 EDT Sept 13. No force pushes after.

## 8. Hygiene (continuous)
- [ ] T8.1 M O · Commit every logical unit with meaningful messages; never a single dump.
- [ ] T8.2 M O · Secrets only in `.env`; `.env.example` in every package; secret scan before each push.
- [ ] T8.3 M O · Licenses: MIT for our code; respect Pinax/StreamingFast licenses on imports.
- [ ] T8.4 S O · Friction logged to `feedback/*.md` as it happens.

## Won't
Bazantic, ERC-8004 module, Chainlink, Arc, Hedera, quorum ceremony, token, landing page.
- [ ] T0.10 M P · Register the project + team on the ETHGlobal ETHOnline 2026 dashboard (title, tagline, repo link); confirm Start Fresh pool.
