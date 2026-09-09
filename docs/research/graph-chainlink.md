# Cluster: The Graph ($15K) + Chainlink ($2.5K) — Research & Idea Seeds

ETHOnline 2026 · Sept 4–16 (submissions close **Sun Sept 13, 12:00 pm EDT** per ETHGlobal rules page — check the dashboard; effectively ~9 build days, not 12) · Research date: Sept 4, 2026.
Everything below was checked against live docs/repos today; "verify" flags mark things that need a day-1 smoke test.

---

## 0. TL;DR — facts that change what's buildable

1. **Chainlink Confidential Workflows is a month old (TS/Go SDK v1.18.0, Aug 6 2026; CLI v1.29.0, Aug 7) and in invite-only private beta — but the local simulator runs it without enrollment, and the prize explicitly accepts "a Confidential Workflow simulation using the CRE CLI."** You still need a free CRE account + `cre login` to simulate. Only AWS Nitro / `us-west-2` is a registered TEE. Templates were edited Sep 1–3 (TEE-constraint API changed, secret count compressed) — expect API churn.
2. **The Graph x402 pay-per-query is live (May 2026):** `POST https://gateway.thegraph.com/api/x402/subgraphs/id/{id}`, $0.01 USDC per query on **Base** (mainnet) or **Base Sepolia** (`testnet.gateway.thegraph.com`), no API key. Official client: `@graphprotocol/client-x402` (CLI, programmatic, and typed graph-client fetch). This makes "an agent that pays for its own data" a 30-minute integration, not a project.
3. **Agent0 / ERC-8004 subgraphs are the best cross-sponsor bridge in the whole prize sheet.** One shared schema on 9 networks (ETH, Base, BSC, Polygon, Monad + Sepolia, Base Sepolia, BSC Chapel, Monad Testnet). Indexed fields include `x402Support`, `mcpEndpoint`, `a2aEndpoint`, `ens`, `did`, `agentWallet`, feedback `score 0–100`, and **`proofOfPayment{From,To,ChainId,TxHash}`** parsed from IPFS feedback files. Repo active (last commit Mar 2026). Registry contracts on Sepolia/Base Sepolia: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. SDK `agent0-sdk@1.7.0` registers agents & gives feedback in ~5 lines.
4. **Messari Standardized Subgraphs are the named "standardized schema" but the repo's last commit is March 2025.** 384 decentralized-network deployments across 11 schemas (lending 95, dex-amm 56, bridge 55, yield-aggregator 15, perps 15…). Many will be stale or failed. Day-1 job: query `_meta { block { number } hasIndexingErrors }` on every candidate and build on the healthy subset. The staleness itself is a product opportunity (see Idea 1).
5. **Composable Substreams already cover ERC-4626 events** (`pinax-network/substreams-evm/erc4626`: Deposit/Withdraw by topic0, no aggregation, deliberately "downstream derivations"). Contributing a *flows/share-price/TVL* module on top is exactly the prize's example and is not yet done. No ERC-8004 Substreams package exists on substreams.dev.
6. **"One prompt → deployed pipeline" = Substreams SKILLs (9 skills, v1.6.0, Aug 17 2026) + The Graph Market hosted sink (beta, July 2026).** Hosted sink runs the sink only; **you must supply a publicly reachable Postgres/ClickHouse** (ClickHouse Cloud trial works). The skill has a hard "run `substreams run` quality gate before deploy" rule that the agent must follow on camera.
7. **What The Graph judges said after ETHGlobal Lisbon 2026:** every standardized-subgraph team independently built "a registry mapping schemas to deployments" — they called it *the missing piece*. They rewarded provenance (pinned deployment IDs, freshness gating, "unavailable" over unverified), streaming over polling, and use beyond DeFi. Prior winners: deeptrace (lending MCP over Messari), atlas (86 standardized deployments + Substreams gRPC + x402 + MCP/SKILL), Am I cooked (wallet risk scanner), Pista (Substreams anomaly detection), EQLTY (multi-agent Uniswap v4 with Substreams).
8. **Chainlink CRE quotas bite inside the enclave:** 5 HTTP calls/execution, 100 KB response, 10 KB request, 5 secrets per execution, 5 KB report payload, 5 min execution, cron ≥30 s. GraphQL to The Graph from a TEE must be compact and paginated by design.
9. **Chain overlap that matters:** The Graph indexes **Arc + Arc testnet** (subgraphs), Base Sepolia, Sepolia, Monad (substreams only) — but **not Hedera**. CRE supports Sepolia, Base Sepolia, Arb Sepolia, **Arc testnet**, Monad, 24 mainnets, 31 testnets; Solana write-only. ERC-8004 contracts are **not** deployed on Hedera testnet (Agent0 config is empty). So a Hedera bridge = identity/reputation on Base Sepolia, payment on Hedera, linked through the feedback `proofOfPayment` fields.
10. **Amp is enterprise/"Request a Demo" only. Do not build on it.** Token API is now branded Pinax (api.pinax.network, JWT) — usable, but weaker as "a Graph product" than Subgraphs/Substreams/MCP/x402.
11. **Submission rules:** max 3 partner prizes per project (The Graph counts as 1 even across its 3 tracks); a project is either Start Fresh or Continuity, never both; video 2–4 min, ≥720p, real voice (no AI voiceover), no music-only; AI tool usage must be attributed in the repo; single-commit repos may be disqualified.

---

## 1. The Graph — research notes

### 1.1 Prize anatomy and what the qualifiers tell you

| Track | $ | Must have | Judges' tell |
|---|---|---|---|
| Composable / Standardized | $5K (2.5/1.5/1) | (a) compose ≥2 Graph products OR build meaningfully on a standardized schema; (b) **live** data from Studio/Gateway/Market; (c) "one subgraph, no composition" is disqualified; (d) authoring/extending a standardized subgraph or a reusable composable Substreams module counts | "Make the standards leverage clear: show what became easier because a shared schema or composed product was used." → demo must show the *same query* hitting N protocols/chains, or the *same pipeline* on N chains. |
| AI Tooling / AI Use Case — **Start Fresh** | $5K | Graph is load-bearing; live data; "meaningful work with the data: reasoning, decisions, automation, or NL interface, not just printing a raw query"; tooling must be "reusable infrastructure, not a single end-user app"; README/SKILL.md judges can run | They list what they want built: "new or extended MCP servers, agent SKILLs, x402 payment tooling, A2A integrations, framework plugins, or client configs" and agents: "research assistants, trading and execution agents, portfolio copilots, risk monitors." Featured sub-challenge: one prompt → deployed Substreams pipeline using the SKILLs. |
| AI Tooling / AI Use Case — **Continuity** | $5K | Same, but extending an existing OSS repo/product; document pre-existing work; "Extending The Graph's own AI Suite (improving an existing MCP server or SKILL) fits." | A separate pool with the same money and almost certainly fewer entrants. |

### 1.2 Subgraph MCP (mature, hosted, Rust, Apache-2.0)
- Remote: `https://subgraphs.mcp.thegraph.com/sse` (SSE via `npx mcp-remote --header "Authorization:Bearer <GATEWAY_API_KEY>"`). Local build: `graphops/subgraph-mcp` (Rust 1.75+, env `GATEWAY_API_KEY`). Last commit June 2025 — stable, not actively evolving → a good Continuity target *or* something to wrap rather than fork.
- Tools: `search_subgraphs_by_keyword`, `get_top_subgraph_deployments` (by contract address + chain), `get_schema_by_{deployment_id,subgraph_id,ipfs_hash}`, `execute_query_by_{deployment_id,subgraph_id,ipfs_hash}`, `get_deployment_30day_query_counts`. One resource `graphql://subgraph` with usage instructions.
- Claude Code config is the standard `mcpServers` JSON; Cursor/Cline/Claude Desktop pages exist. Time to first query: **~10 min** (need a Studio API key; free plan exists — verify current free query quota).
- Gap: no schema *classification*, no freshness/health, no x402 path, no standardized-schema awareness. `PaulieB14/subgraph-registry` (Graph advocate) is prior art for classification + reliability score + x402 URLs — study it, don't clone it.

### 1.3 SKILLs
- **Subgraph SKILLs** (`PaulieB14/subgraphs-skills`, MIT): `subgraph-dev`, `subgraph-optimization`, `subgraph-testing`. Install `claude plugins add PaulieB14/subgraphs-skills`. Pure knowledge skills; no MCP, no deploy automation.
- **Substreams SKILLs** (`streamingfast/substreams-skills`, default branch `master`, v1.6.0 Aug 17 2026): `substreams-dev`, `substreams-ethereum`, `substreams-solana`, `substreams-sql`, `substreams-sink`, `substreams-sink-deploy-local`, `substreams-hosted-sink`, `thegraph-market-api`, `substreams-testing`. Install:
  ```bash
  claude plugin marketplace add streamingfast/substreams-skills
  claude plugin install substreams-dev@streamingfast-substreams
  ```
  16 example case studies of "agent built end-to-end from a prompt" (14 working, 2 cautionary). Hosted sink = Portal API `HostedService` (device-code OAuth, deploy public `.spkg` URL, attach *your* Postgres/ClickHouse, `GetDeploymentState` for lag). Only Postgres (CDC or from-proto) and ClickHouse (from-proto) are supported.
- **Chainlink also ships agent skills** (docs → "Chainlink Developer Agent Skills"; there's a `smartcontractkit/chainlink-agents-hackathon-skills` pack) — install both on day 1, it is how you go fast.

### 1.4 Messari Standardized Subgraphs
- 11 schema families (docs): Generic 3.0.0, DEX AMM 1.3.2, DEX AMM Extended 4.0.1 (concentrated liquidity), DEX Aggregator, **Lending/CDP 3.1.0**, **Yield Aggregator 1.3.1**, NFT Marketplace, Network, Bridge, Perps, Options. Shared entities: `Protocol`, `Token`, `Market`/`LiquidityPool`/`Vault`, `Account`, `Position`, daily/hourly snapshots (`FinancialsDailySnapshot`, `MarketDailySnapshot`, `UsageMetricsDailySnapshot`), standardized revenue fields.
- Live-on-network deployments (from `deployment/deployment.json`, 384 total): lending includes aave-v3 (12 chains incl. **base**), compound-v3 (eth/polygon/arb/**base**), moonwell (**base**), seamless (**base**), venus, benqi, morpho? (no — Morpho not in Messari list), zerolend, spark? (verify). DEX: uniswap-v3 (eth/arb/**base**/bsc/celo/op/polygon), sushiswap, curve, balancer-v2, pancakeswap-v3, velodrome, camelot. Yield: yearn-v2, convex, arrakis, gamma, aura, ribbon, badger. Bridge: stargate (8 chains), across-v2, hop, cbridge, arbitrum/optimism bridges.
- **Risk:** repo last commit 2025-03-25. Expect a meaningful fraction to have `hasIndexingErrors` or lag. Whatever you build must *gate on freshness* and say so — Lisbon judges rewarded exactly that.
- Time to first useful cross-protocol query: **1–2 h** (finding the live IDs is the work; `get_top_subgraph_deployments` + Explorer help).

### 1.5 Agent0 / ERC-8004 Subgraphs (fresh, cross-chain, agent-native)
- Subgraph IDs (gateway `…/api/subgraphs/id/<ID>` with Bearer key, or `/api/x402/subgraphs/id/<ID>`): ETH `FV6RR6y13rsnCxBAicKuQEwDp8ioEGiNaWaZUmvr1F8k`, Base `43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb`, BSC `D6aWqowLkWqBgcqmpNKXuNikPkob24ADXCciiP8Hvn1K`, Polygon `9q16PZv1JudvtnCAf44cBoxg82yK9SSsFvrjCY9xnneF`, Monad `4tvLxkczjhSaMiqRrCV1EyheYHyJ7Ad8jub1UUyukBjg`, **Sepolia `6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT`**, **Base Sepolia `4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u`**, BSC Chapel `BTjind17gmRZ6YhT9peaCM13SvWuqztsmqyfjpntbg3Z`, Monad Testnet `8iiMH9sj471jbp7AwUuuyBXvPJqCEsobuHBeUEKQSxhU`.
- Schema (repo `agent0lab/subgraph`): `Agent{id "chainId:agentId", owner, agentWallet, operators, registrationFile, feedback[], validations[], totalFeedback, lastActivity}`, `AgentRegistrationFile{name, description, active, x402Support, supportedTrusts, mcpEndpoint/mcpVersion/mcpTools, a2aEndpoint/a2aSkills, oasfSkills/Domains, ens, did}`, `Feedback{value, tag1, tag2, clientAddress, isRevoked, feedbackFile}`, `FeedbackFile{text, mcpTool, a2aSkills, proofOfPaymentFromAddress/ToAddress/ChainId/TxHash}`, `Validation{validatorAddress, response 0–100, status PENDING|COMPLETED|EXPIRED}`, `Protocol{identityRegistry, reputationRegistry, validationRegistry}`. Off-chain IPFS/HTTPS files are indexed via File Data Sources — no client-side IPFS fetch.
- Same query works on every chain; only the endpoint changes → this *is* a standardized schema, and it's the one sponsors (Hedera, ENS, Ledger, Arc) keep naming. ENSIP-25 (`agent-registration[<registry>][<agentId>]` text record) + ENSIP-26 (`agent-endpoint[mcp]`) tie ENS names to ERC-8004 ids.
- Time to first query + first registered test agent on Base Sepolia: **~1 h**.

### 1.6 Composable Substreams
- `streamingfast/substreams-chain-modules`: `dex/` (bancor-v3, uniswap-v4, velodrome), `lending/` (compound-v3, inverse, liquity, maple-v2, morpho-blue, yearn-v2), `nft/`, `payment/superfluid`, `staking/`. Per-protocol packages, not one shared proto — the "standardization" is thin here.
- `pinax-network/substreams-evm`: primitives `erc20/{transfers,tokens,balances,supply}`, `native/`, `erc1155/`, **`erc4626/`** (Deposit/Withdraw only), `dex/` (Uniswap v1–v4 + 15 protocols), `dex-nfts/`, and aggregator packages `evm-dex`, `evm-transfers` (includes **x402 authorizations**), `evm-balances`, `evm-supply`, `evm-nfts`, `evm-contracts`, `blocks` with ClickHouse/Postgres sinks. Chains: ETH, Base, BSC, Polygon, Arbitrum, Optimism, Avalanche, Tron.
- Composition = `imports:` in `substreams.yaml` + `use:` of a module from an `.spkg`; publish to substreams.dev. The Graph Market free tier: 7M blocks + 5 GiB egress, no card.
- Time to first custom module streaming: **2–4 h** (Rust toolchain, `substreams` CLI, `substreams auth`). Hosted-sink deploy: **+2–4 h** including standing up ClickHouse Cloud.

### 1.7 x402 pay-per-query (live)
```bash
npm i @graphprotocol/client-x402
export X402_PRIVATE_KEY=0x…   # wallet holding USDC on Base (or Base Sepolia)
npx graphclient-x402 "{ agents(first:5){ id owner } }" \
  --endpoint https://gateway.thegraph.com/api/x402/subgraphs/id/43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb --chain base
```
```ts
import { createGraphQuery } from '@graphprotocol/client-x402'
const query = createGraphQuery({ endpoint: 'https://gateway.thegraph.com/api/x402/subgraphs/id/<ID>', chain: 'base' })
const result = await query('{ … }')
```
Typed path: `.graphclientrc.yml` with `customFetch: '@graphprotocol/client-x402'` + `X402_CHAIN`. USDC: Base `0x8335…2913`, Base Sepolia `0x036C…CF7e`. Flow: 402 → sign USDC payload → retry with payment header → facilitator verifies → data. **Verify** whether `testnet.gateway.thegraph.com` serves mainnet-published subgraphs (likely only the testnet protocol's subgraphs); plan on Base mainnet with ~$2 of USDC = 200 queries.

### 1.8 Market / Token API / Amp
- The Graph Market (StreamingFast): Substreams + Firehose on 71 networks, JWT auth, free tier above, hosted sinks (beta). Portal API is scriptable (the `thegraph-market-api` skill does device-code login and deployments for the agent).
- Token API: now `api.pinax.network/v1` (balances/transfers/holders/NFTs/DEX, has an "x402 Discovery" endpoint); `pinax-network/mcp-token-api` is archived (June 2026), successor `@pinax/mcp` → `https://mcp.pinax.network`. Fine as a secondary product to "compose," weak as the centrepiece.
- Amp: enterprise, demo-request only. Skip.

---

## 2. Chainlink CRE Confidential Workflows — research notes

### 2.1 Model
A CRE workflow (TS or Go, compiled to WASM) registers handlers. `handlerInTee(trigger, fn, teeConstraint)` runs `fn` inside an AWS Nitro enclave with a `TeeRuntime` instead of `Runtime`:
- `runtime.getSecret({id})` / `runtime.getSecrets([...])` — Vault DON releases threshold-encrypted secrets **only into the attested enclave**, decrypted at call time. Max 5 fetches per execution; secrets map via `secrets.yaml` (`secretsNames: { API_TOKEN: [SECRET_API_TOKEN] }`) to `.env` in simulation, to the CRE secrets manager in production.
- `new cre.capabilities.HTTPClient().sendRequest(runtime, req)` — the `TeeRuntime` overload executes the HTTP call *from inside the enclave*; request and response bodies stay confidential. **Do not** use `ConfidentialHTTPClient` here (no TeeRuntime overload; it is the separate, production-GA "Confidential HTTP" single-request feature — which does *not* satisfy the prize's `handlerInTee` requirement).
- `runtime.usingTheDons()` returns a normal `Runtime`; anything passed to it is **no longer confidential** (consensus, `report(...)`, `evmClient.writeReport(donRuntime, {receiver, report, gasConfig})`). `runtime.reportFromDon(...)` is the shortcut. Cross over *only* the verdict/score/hash — never secrets or raw payloads.
- `TeeConstraint`: `{}` any TEE; `{ regions: ['us-west-2'] }`; `[{ tee: 'nitro', regions: ['us-west-2'] }]`. Yesterday's template commit moved to a `cre.AnyTee`-style helper — check your SDK version.
- Reads: templates do EVM reads/writes via the DON runtime, HTTP inside the enclave. Treat EVM reads as non-confidential unless the SDK version you install shows a TeeRuntime overload.

Skeleton (from the hello template, current as of Sep 3 2026):
```ts
import { cre, hexToBase64, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'

export const onTrigger = (runtime: TeeRuntime<Config>): string => {
  const apiToken = runtime.getSecret({ id: runtime.config.secretId }).result().value   // inside enclave
  const res = new cre.capabilities.HTTPClient().sendRequest(runtime, {
    url: runtime.config.url, method: 'POST',
    multiHeaders: { Authorization: { values: [`Bearer ${apiToken}`] } }, body: …,
  }).result()
  if (!ok(res)) throw new Error(`status ${res.statusCode}`)
  const verdict = decide(text(res), runtime.config /* private thresholds via getSecrets */)
  const donRuntime = runtime.usingTheDons()                                            // boundary
  const payload = encodeAbiParameters(parseAbiParameters('uint8 verdict, uint256 score'), [verdict, score])
  const report = donRuntime.report({ encodedPayload: hexToBase64(payload), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' }).result()
  // new EVMClient(selector).writeReport(donRuntime, { receiver, report, gasConfig:{gasLimit} }).result()
  return `${verdict}`
}
export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handlerInTee(cron.trigger({ schedule: config.schedule }), onTrigger, [{ tee: 'nitro', regions: ['us-west-2'] }])]
}
```

### 2.2 What is / isn't confidential
Confidential: Vault secrets, enclave memory, HTTP request/response payloads made via TeeRuntime, intermediate values. **Not** confidential: your source code and WASM binary (the DON hands them to the enclave), triggers, anything crossed via `usingTheDons()`, reports, on-chain writes, **and `runtime.log()` output** (docs: remove logs before production; enclaves may be shared between workflows; side-channel caveats). For a demo, log only booleans/verdicts, and narrate that.

### 2.3 Simulation & tooling
- Install: `curl -sSL https://app.chain.link/cre/install.sh | bash`; needs **Bun ≥1.2.21**; **`cre login` is required** (free account at app.chain.link) even for local simulation — create it on day 1.
- `cre init --template=hello-confidential-workflows-ts` (Go variant exists) → `bun install` → `cp .env.example .env` → `cre workflow simulate my-workflow --target staging-settings --non-interactive --trigger-index 0`. Output literally prints "Trigger requested TEE Execution… AWS Nitro in us-west-2 — The simulator is not a real TEE, and is meant to debug." Show that line in the video and say it honestly.
- `cre workflow simulate … --listen` runs a persistent simulator on `localhost:2000`; each `POST` fires an HTTP-trigger run (auth not enforced in simulation). **This lets an external agent invoke your confidential workflow live during the demo.**
- `--limits` flag enforces production quotas in simulation — run with it so the 5-HTTP/100KB limits don't surprise you.
- Deployment (`cre workflow register/deploy`) requires (a) deploy access (`cre account access` / app.chain.link/cre/request-access) and (b) Confidential Workflows beta enrollment (Google form linked from docs → "Requesting Confidential Workflows Access"). At Cannes 2026 Chainlink offered to deploy simulated workflows for hackers — ask in the ETHGlobal Chainlink channel; don't plan on it.
- Templates to crib from (`smartcontractkit/cre-templates/starter-templates/confidential-workflows`): `ai-audit-firewall` (two LLMs in TEE → `(uint8 verdict, uint8 riskMask, uint64 chainSelector)` report → `AuditFirewallConsumer.sol` extends `ReceiverTemplate`), `automated-liquidation-protection` (11 private policy params → compressed to fit secret limits, LLM plans actions, hard policy enforcement), `automated-portfolio-rebalancing`. All ship a mock server; all say Sepolia for staging.
- Chains (CRE): Sepolia, Base Sepolia, Arbitrum Sepolia, Arc testnet, Monad + 27 other testnets; 24 EVM mainnets; Solana write-only. TEE region is independent of chain.
- Quotas: 5 HTTP calls/exec, 100 KB response, 10 KB request, 5 secrets/exec (2 KB each), 15 EVM reads/exec, 5 KB report, 5 M gas, 5 min exec, cron ≥30 s, HTTP trigger 1/60 s, 3 workflows per private registry.
- TS vs Go: both first-class; TS SDK is `@chainlink/cre-sdk` on Bun; deterministic-build warnings for `Date.now()`/`Math.random()` (use `runtime.now()`). Go templates reference unreleased SDK commits — stay on TS.
- Time to first simulated confidential workflow: **30–60 min**. Custom workflow that calls The Graph from the enclave with the API key as a Vault secret and emits a signed report: **~1 day**. Adding a consumer contract on Sepolia and asserting the state change in simulation: **+½ day**.

### 2.4 What Chainlink judges reward (Convergence 2026 + Cannes)
Winners were: an autonomous vault-protection agent (SentinelCRE), dark-pool/OTC settlement with confidential HTTP (SSL, TACIT), privacy-preserving KYC that publishes only attestations (Aegis-Gate), confidential portfolio intelligence (InControl), AI-resolved prediction markets (VeritasX). Pattern: **off-chain confidential computation → attested on-chain settlement**, with a real financial/compliance reason for the secrecy. The prize text repeats: "a placeholder handler or isolated example… will not qualify" — the TEE part must be the product's core.

---

## 3. Idea seeds

Legend: **[SAFE]** clearly qualifies with bounded risk · **[REACH]** strong but with a hard part · **[HOLY]** if it works, it wins the room.

### Idea 1 — **Standards Atlas** — schema-conformance registry + MCP + SKILL for standardized subgraphs · [SAFE→REACH]
**Pitch.** Crawl all ~15K network subgraphs, introspect schemas, fingerprint them against the Messari schema families/versions (plus ERC-8004/Agent0, Uniswap-canonical, ERC-20/721 standards), and continuously score freshness (`_meta` block lag, indexing errors, 30-day query volume). Expose it as (a) an MCP server with tools like `find_deployments(schema:"lending", chain:"base", minFreshness:…)`, `fanout_query(schema, chains, graphql)` that runs *one* standardized query across every conforming deployment and returns provenance (deployment ID, block, lag) per row, and (b) a Claude Code plugin SKILL with the standardized-schema query cookbook. This is the exact "missing piece" The Graph named after Lisbon.
**Tracks.** Composable/Standardized (builds meaningfully on the Messari schema; composes Subgraph MCP + standardized subgraphs + optionally x402; shows "one query pattern spanning many protocols"). AI Tooling (reusable infra targeting the AI Suite; NL interface; live data). Could be submitted Continuity if you fork/extend `PaulieB14/subgraph-registry` — prefer Start Fresh.
**Wow moment.** In a fresh Claude Code: "Which lending markets on Base have utilization above 90% right now?" → the agent selects 4 conforming, *fresh* deployments (Aave v3, Compound v3, Moonwell, Seamless), runs one query, returns a ranked table with deployment IDs and block numbers, and flags the two stale ones it refused to use.
**Hardest risk.** Messari staleness may leave few healthy deployments per family; introspecting 15K schemas needs rate-limit-aware crawling (cache; nightly job; ship a snapshot JSON so judges can run it).
**Load-bearing combos.** Bazantic ("Best Recipe using sponsor APIs": wrap the fan-out API in an x402/MPP gateway + recipe; the A/B test is natural). Uniswap (compose with `uniswap-ai` skills: atlas finds pools, Uniswap skills act).

### Idea 2 — **graphpay-mcp** — an x402-paying Subgraph MCP for agents with no API keys · [SAFE]
**Pitch.** A TypeScript MCP server (stdio + streamable HTTP) exposing the same discovery/schema/query tools as the official Subgraph MCP, but every query is paid per-request in USDC over x402 (Base or Base Sepolia) from the agent's own wallet — with per-session budgets, spend receipts (tx hashes), retry/backoff on 402, and a `pay_for_query` tool the model can reason about ("this costs $0.01, budget left $0.43"). Ships as a Claude Code plugin with `/graph:*` slash commands and a SKILL.md on when to pay vs. when to use the key.
**Tracks.** AI Tooling ("x402 payment tooling" and "client configs" are named; live data via the x402 gateway; reusable). Composable if it also fans out standardized queries (borrow Idea 1's fan-out).
**Wow moment.** `claude plugin install graphpay`, fund with $1 USDC, ask 40 questions across Uniswap/Aave/ERC-8004 subgraphs; the final answer cites 40 Base tx hashes totalling $0.40 — no API key was ever created.
**Hardest risk.** `@graphprotocol/client-x402` edge cases (nonce handling under parallel tool calls; testnet gateway coverage). Mitigation: serialize payments; run on Base mainnet.
**Load-bearing combos.** **Ledger** ("agents that pay for APIs with Ledger-secured payment flows, including x402-style patterns" — hold the x402 signing key in `wallet-cli ring`, require device confirmation when a session exceeds a budget). **Hedera** (re-expose the same tools as an x402-gated *Hedera* service settled through Blocky402 — "metered data feed, price by query" is literally their example; you resell Graph queries to Hedera agents, paying The Graph in Base USDC underneath).

### Idea 3 — **Vouch** — a confidential ERC-8004 trust oracle in a TEE that gates agent payments · [HOLY]
**Pitch.** A CRE Confidential Workflow that, on HTTP trigger (agent A wants to hire agent B), pulls B's identity, feedback, validations and payment proofs from the Agent0 subgraphs on up to 9 chains (Graph API key held as a Vault secret, fetched inside the enclave), applies a **private trust policy** (thresholds, weightings, sybil heuristics like `feedback.clientAddress == agent.owner`, blacklists, minimum distinct payers) that never leaves the enclave, optionally has an LLM (called from inside the TEE) read feedback text for fraud signals, and crosses back only `(agentId, verdict ALLOW|DENY|REVIEW, score, evidenceHash)` as a DON-signed report written to a `TrustGate` consumer contract that escrow/payment contracts consult. Agents pay for a verdict via x402.
**Tracks.** Chainlink Confidential (handlerInTee; secrets + private policy + confidential API responses processed in-enclave; core to the product; simulated execution with logs). Graph AI Use Case (agent uses Graph as live data source; reasoning/decisions/automation). Graph Composable (Agent0 standardized schema across chains — one query, N chains; plus x402 = second product).
**Wow moment.** Two agents negotiate on camera. Agent B has 30 five-star reviews. Vouch returns DENY in the simulator and the on-chain `VerdictReceived` shows `score=12` — because 28 of the reviews came from wallets funded by B's owner. The policy that caught it is never printed; the console shows only "Enclave computation complete. verdict=DENY". Then a legit agent gets ALLOW and the USDC escrow releases.
**Hardest risk.** Quota math: 5 HTTP calls/exec and 100 KB responses means at most ~4 chains per verdict with tight GraphQL selection sets (do chain selection before the TEE, or precompute an aggregated feed with Idea 7). Also, the simulator isn't a real TEE — be explicit.
**Load-bearing combos.** **Hedera** (the paid verdict endpoint is an x402 service on Hedera via Blocky402; ERC-8004 identity is an explicit "extra point"; write verdict hash to HCS as audit trail). **Arc** (Circle Agent Stack wallets release USDC only after `TrustGate.allowed(agentId)` — "agents with decision logic tied to real signals"). **ENS** (ENSIP-25 check: resolve `agent-registration[registry][id]` on Sepolia ENSv2 as an extra trust input; agents as subnames). **Ledger** (verdict REVIEW → human confirms on device before funds move).

### Idea 4 — **Sentinel** — confidential liquidation/health guardian over standardized lending data · [HOLY]
**Pitch.** A CRE Confidential Workflow on a 30-second cron reads a wallet's positions from Messari **Lending 3.1.0** subgraphs across protocols on Base (Aave v3, Compound v3, Moonwell, Seamless) and Ethereum with *one* standardized GraphQL query, computes health with **private thresholds and a private defence strategy** loaded as Vault secrets (min HF, max repay %, venue preference, reserve floor — cf. the official liquidation template), and when breached emits a signed action report that a `GuardianExecutor` contract executes (repay from a pre-approved USDC reserve / add collateral / swap via Uniswap). The dashboard shows positions across protocols from one query and the moment the workflow fires; nothing about the strategy appears in logs or on-chain.
**Tracks.** Chainlink Confidential (private thresholds and strategy are the canonical use case in the prize text). Graph Composable ("one query pattern spanning many protocols" using the named Messari schema; composes Subgraph MCP for the dashboard + standardized subgraphs; optionally a Substreams price feed). Graph AI (automation/decisions on live data).
**Wow moment.** On a Sepolia/Base-Sepolia fork you crash the collateral price; within one cron tick the simulator prints only `verdict=DEFEND` and the executor tx lands, repaying exactly the private percentage; the judge is challenged to find the threshold anywhere in the repo, logs, or chain — and can't.
**Hardest risk.** Messari lending subgraphs must be live *and* carry `Position`-level data for the demo wallet on a testnet — they don't index testnets. Realistic path: read live mainnet positions for a real wallet (read-only, Base) and execute the defence on a local fork/testnet with a mocked price, narrating the split honestly; or run the standardized query for the dashboard and a small purpose-built subgraph for the testnet market.
**Load-bearing combos.** **Uniswap** (execution via Trading API/v4; `uniswap-ai` skills; FEEDBACK.md). **Arc/Circle** (USDC reserve top-up via Agent Stack; "conditional payments/automation"). **Ledger** (device approval above a repay size). **Privy** (policy-bound org wallet as the reserve; quorum approval for large actions).

### Idea 5 — **vaultflow** — ERC-4626 flows/share-price composable Substreams module + one-prompt hosted deploy + MCP · [REACH]
**Pitch.** Contribute the module the prize literally names: compose `pinax/erc4626` events with `erc20/transfers` into `erc4626-flows` (per-vault net flows, share price = assets/shares from events, TVL deltas, depositor counts, entry/exit-fee-aware), parameterizable by chain, published on substreams.dev. Deploy it via the Substreams SKILLs "from a single prompt" to a hosted ClickHouse sink on The Graph Market, then serve an MCP tool (`vault_flows(vault, window)`, `vault_anomalies()`) so agents can reason about vaults across Base + Ethereum. Record the one-prompt session as the featured-challenge evidence.
**Tracks.** Composable ("contributing a new composable Substreams module for an emerging standard such as ERC-4626… counts"; one pipeline reused across chains; composes Substreams + Market + MCP). AI Tooling incl. the featured Substreams one-prompt challenge.
**Wow moment.** Screen recording: one paragraph prompt → Claude Code (with `substreams-*` skills) writes the Rust module, runs the mandated `substreams run` quality gate, publishes the `.spkg`, deploys the hosted sink, and 10 minutes later an agent answers "which Base vaults lost >20% of assets in the last 24h and who withdrew?" from live ClickHouse rows.
**Hardest risk.** Rust/Substreams build time in a TS team; hosted sink needs a *public* ClickHouse (ClickHouse Cloud trial) and Market auth; the skill's quality-gate rule slows the "one prompt" story. Budget 2 full days before touching the MCP layer.
**Load-bearing combos.** **Privy** (Earn vaults are ERC-4626 — a "savings" flow that picks vaults using vaultflow data). **Arc** (USDC-denominated vaults on Arc — verify any exist). **Uniswap** (rebalancing between vaults through Trading API).

### Idea 6 — **Agent Ledger** — ERC-8004 Substreams package with payment-proof linkage · [REACH]
**Pitch.** No ERC-8004 Substreams package exists. Build a composable module family for the Identity/Reputation/Validation registries (same addresses on ETH/Base/Sepolia/Base Sepolia — one manifest, N chains), composed with `evm-transfers` (which already extracts x402 authorizations) to join feedback `proofOfPayment` claims against actual USDC transfers — i.e., verified "paid reviews." Sink to Postgres and expose a low-latency A2A/MCP directory of agents ranked by *verified-paid* reputation.
**Tracks.** Composable (new module for an emerging standard, reused across chains, composes Pinax primitives + Market). AI Tooling (A2A/MCP directory; agents use it to pick counterparties).
**Wow moment.** Side-by-side: the raw Agent0 subgraph shows agent X at 96/100; Agent Ledger shows 96/100 nominal but **0 verified paid interactions** and the same three payer wallets funded from X's owner — streamed within seconds of a new feedback event landing on Base Sepolia.
**Hardest risk.** Overlap with the Agent0 subgraph — you must sell *why* Substreams (streaming latency for guards, cross-chain join with transfers, verified payments) rather than duplicating. Rust again.
**Load-bearing combos.** **Hedera** (extra points for ERC-8004 + directory "that makes your service findable by other agents"). **ENS** (agents as ENSv2 subnames; ENSIP-25 badge from the directory). Feeds Idea 3 as its precomputed input.

### Idea 7 — **Dark Rebalancer** — private strategy execution over standardized DEX data · [REACH]
**Pitch.** Confidential CRE workflow holds proprietary target allocations, drift bands and sizing rules as secrets; reads pool state/volume/fees from Messari **DEX AMM Extended** (Uniswap v3 on ETH/Arb/Base/…) and prices via standardized `Token.lastPriceUSD`, decides trades in the enclave, emits only `(pool, direction, amountBucket)` in a signed report consumed by an executor that routes through Uniswap (Trading API or a v4 hook that only accepts CRE-signed reports). Front-running surface disappears because sizing logic never leaves the TEE.
**Tracks.** Chainlink Confidential ("confidential portfolio rebalancing using private target allocations and trade-sizing" is in the prize text). Graph Composable (one standardized query across DEXs/chains). Graph AI (automation).
**Wow moment.** Identical public inputs, two different secret strategies → two different on-chain trades; judges see inputs and outputs but cannot reconstruct the rule.
**Hardest risk.** Execution leg (Uniswap on a fork) plus report-verified hook is a lot; DEX-standardized subgraph freshness.
**Load-bearing combos.** **Uniswap** (v4 hook that verifies the CRE report → "Best Uniswap Stack Contribution"). **1inch** (Aqua/SwapVM app as the execution venue — bigger prize but heavy). **Ledger** (human approval above size).

### Idea 8 — **Continuity: ship a "standardized-subgraphs" skill + x402 support into The Graph's own AI Suite** · [SAFE, separate $5K pool]
**Pitch.** Register as a Continuity project and extend the official repos: add a `subgraph-standardized` skill to `PaulieB14/subgraphs-skills` (Messari schema cookbook, deployment-registry lookup, freshness gating, Agent0 query patterns) and/or an `x402` querying skill; open a PR to `graphops/subgraph-mcp` adding an optional x402 execution path/`X402_PRIVATE_KEY` mode; contribute a `substreams-skills/examples/` case study for the ERC-4626 module. Document before/after precisely.
**Tracks.** AI Tooling — Continuity pool only ("improving an existing MCP server or SKILL fits"). Cannot also enter Start Fresh; but nothing stops a *second* team member's separate Start Fresh project from consuming it — check ETHGlobal team rules before splitting.
**Wow moment.** Modest by design: same prompt in Claude Code before/after the skill, showing correct cross-protocol query + provenance only after.
**Hardest risk.** The Rust MCP PR; upstream maintainers may not respond (PR open is fine, not merged). Competing in a thinner pool is the point.
**Load-bearing combos.** Hedera Continuity/Harness and Ledger Continuity have the same "extend existing" shape if you want to register the whole entry as Continuity.

### Idea 9 — **Graph-native A2A agent registered in ERC-8004 with x402** · [REACH]
**Pitch.** Stand up an A2A + MCP data agent whose skills are "answer any on-chain question via The Graph" (Subgraph MCP under the hood, x402 for payment), register it in the ERC-8004 Identity Registry on Base Sepolia with `x402Support: true`, `mcpEndpoint`, `a2aEndpoint`, and an ENS name (ENSIP-25/26), and have client agents discover it *through the Agent0 subgraph*, pay it, and post feedback with `proofOfPayment` — closing the loop the Graph blog describes ("identity, environmental awareness, autonomous payment").
**Tracks.** Graph AI Tooling ("A2A integrations… agents using The Graph as live data source"; MCP/A2A infra is reusable). Graph Composable if the answers use standardized fan-out.
**Wow moment.** A stranger agent, given only "find me a data agent with x402 support and score > 80 on Base Sepolia," discovers yours via the Agent0 subgraph, pays $0.01, gets an answer, and its feedback appears in the subgraph seconds later — the whole agent economy loop in 60 seconds.
**Hardest risk.** Too many moving parts for one demo; A2A libs maturity. Cut ENS if late.
**Load-bearing combos.** **Hedera** (payment leg on Hedera via Blocky402; discovery directory extra points). **ENS** (ENSv2 subnames per agent with EAC-delegated record rights; ENSIP-25 verification). **World** (AgentKit: the paying agent is human-backed — Continuity only, skip unless already using it).

### Idea 10 — **Confidential compliance gate for stablecoin payouts** · [REACH]
**Pitch.** CRE Confidential Workflow receives a payout batch (HTTP trigger from a treasury app), queries Messari **Bridge** + Agent0 + DEX subgraphs for counterparties' on-chain history inside the enclave, applies private risk rules (and optionally an authenticated Web2 sanctions/KYC API whose key never leaves the TEE), and returns a signed allow-list the payout contract enforces. Only attestations go on-chain (the Aegis-Gate pattern that won Convergence).
**Tracks.** Chainlink Confidential ("privacy-preserving risk assessment and policy enforcement"; "privacy-preserving access to authenticated Web2 APIs"). Graph AI Use Case (decisions on live data; cross-protocol context).
**Wow moment.** Batch of 10 payouts → 9 released, 1 held with only a hash on-chain; the compliance analyst's API key and rule set never appear anywhere.
**Hardest risk.** Needs a believable Web2 API (use a public sanctions list mirror) and a treasury front-end; cross-chain history reads need compact queries.
**Load-bearing combos.** **Privy** (B2B treasury with policies/quorum — the payout app itself). **Arc/Circle** (USDC payouts on Arc; Arc is indexed by The Graph *and* supported by CRE, so the on-chain leg can be Arc testnet). **Hedera** ATS? (no — keep to Arc/Privy).

---

## 4. Recommended portfolio (if you must pick)

- **Primary (aim at both Graph tracks + Chainlink):** Idea 3 *Vouch* or Idea 4 *Sentinel*. Vouch has the better cross-sponsor story (Hedera + Arc + ENS + Ledger all name ERC-8004/agent payments) and depends on the *fresh* Agent0 subgraph rather than stale Messari data. Sentinel is closer to the Chainlink template and the Composable track's "one query, N protocols" wording, but inherits Messari staleness risk.
- **Insurance tooling deliverable (2–3 days, high hit-rate):** Idea 1 *Standards Atlas* or Idea 2 *graphpay-mcp* — reusable infra the Graph team explicitly asked for; Idea 2 also fits Ledger and Hedera. Build it first; Vouch/Sentinel consume it.
- **Featured challenge (optional 1.5 days):** Idea 5's one-prompt hosted-sink recording is worth attempting only if the Rust toolchain is up by day 3.

Partner-prize slots (max 3): The Graph (all three tracks count as one) + Chainlink + one of Hedera/Arc/Ledger depending on which leg you actually ship.

---

## 5. Traps and non-obvious things

1. **Live data only, and it must be a Graph provider.** Local graph-node, static JSON, or mocks disqualify both Graph tracks. Studio API key or the x402 gateway are the accepted paths; Substreams must stream from The Graph Market (StreamingFast) endpoints. Budget query/streaming quota; verify the free plan on day 1.
2. **Messari subgraphs may be dead.** Repo untouched since March 2025. Gate every deployment on `_meta.hasIndexingErrors` and block lag, and show that gating in the demo — Lisbon judges rewarded "unavailable" over stale.
3. **"Just querying one subgraph" is explicitly excluded from Composable**; and for the AI track "printing a raw query result" is excluded. Two Graph products (e.g., MCP + x402, Subgraph + Substreams, Substreams + Market hosted sink) or one standardized schema across many deployments is the floor.
4. **Continuity vs Start Fresh is a hard fork.** A project is registered in exactly one; the Graph Continuity pool is a separate $5K with the same tiers. If you extend any existing repo of yours or theirs as the core, you're Continuity; document pre-existing work with commit history. Max 3 partner prizes per project; Graph's 3 tracks count as 1 selection.
5. **Chainlink prize needs `handlerInTee` specifically.** Confidential HTTP (GA since Feb 25 2026) does not qualify on its own. Confidential Workflows is private beta: simulation is allowed and accepted ("Confidential Workflow simulation using the CRE CLI"), deployment is not something you can count on. `cre login` (free account) is required even to simulate. Only Nitro/us-west-2. Remove `runtime.log()` of anything sensitive. The `$500` "Chainlink-powered upgrade" is Continuity-only and requires an on-chain state change.
6. **CRE quotas inside the enclave (5 HTTP calls, 100 KB response, 10 KB request, 5 secrets/exec)** shape your GraphQL: small selection sets, `first:` limits, pre-aggregation outside the TEE where confidentiality isn't needed. Run `cre workflow simulate --limits`.
7. **SDK churn.** Confidential Workflows shipped Aug 6; templates changed Sep 1–3 (TEE constraint helper, secret count). Pin `@chainlink/cre-sdk` and CLI versions in the README; re-check the release notes the day before submission.
8. **Hedera is outside The Graph.** No Graph indexing of Hedera; ERC-8004 contracts not deployed on Hedera testnet. Any Hedera+Graph story must put identity/reputation on Base Sepolia/Sepolia and payments on Hedera, linked via the ERC-8004 feedback `proofOfPayment` fields or an HCS audit trail.
9. **x402 gateway testnet caveat.** `testnet.gateway.thegraph.com` pays in Base Sepolia USDC but likely only serves subgraphs published to the testnet protocol — assume mainnet Base with real cents ($0.01/query) for real data; keep the paying key hot-but-small (or in Ledger Key Ring).
10. **Amp is not for you.** Enterprise demo-only; mentioning it in the pitch without using it looks like padding.
11. **Video/repo rules will null a good build:** 2–4 min, ≥720p, human voice (no TTS), no phone recording; attribute AI-tool usage in the repo; keep a real commit history (no single-commit drop on Sept 13). Deadline in the rules page is **Sept 13 12:00 pm EDT** — not the 16th.

---

## Appendix — sources consulted (live, Sept 4 2026)
The Graph: `thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/*`, `…/tooling/x402-payments/` (+ raw MDX), `…/existing-subgraphs/standard-subgraphs/`, `…/existing-subgraphs/agent0/`, `…/ai-overview/`, `…/supported-networks/` + `networks-registry.thegraph.com`, blogs `querying-blockchain-data-natural-language-mcp-skills`, `onchain-agent-infrastructure`, `ethglobal-lisbon-2026-winners`, `hackathon-resources`; repos `graphops/subgraph-mcp`, `PaulieB14/subgraphs-skills`, `PaulieB14/subgraph-registry`, `streamingfast/substreams-skills` (master; README + `substreams-hosted-sink/SKILL.md`), `streamingfast/substreams-chain-modules`, `pinax-network/substreams-evm` (+ `erc4626/README.md`), `messari/subgraphs` (`deployment/deployment.json`, commit dates), `agent0lab/subgraph` (schema, deployments, network configs, README), `agent0lab/agent0-ts`, `erc-8004/erc-8004-contracts`, `pinax-network/pinax-mcp`, `thegraph.market`, `app.pinax.network/docs/api`, `substreams.dev`.
Chainlink: `docs.chain.link/cre/concepts/confidential-workflows`, `…/guides/workflow/using-confidential-workflows/making-workflow-confidential`, `…/reference/sdk/confidential-workflows-client(-ts)`, `…/account/confidential-workflows-access`, `…/cre-templates/hello-confidential-workflows`, `…/cre-templates/ai-audit-firewall`, `…/cre-templates/automated-liquidation-protection`, `…/cre/release-notes`, `…/cre/service-quotas`, `…/cre/supported-networks-ts`, `…/cre/key-terms`, `…/cre/getting-started/part-1-project-setup`, `…/http-trigger/testing-in-simulation`, `…/using-confidential-http-client`; repo `smartcontractkit/cre-templates` (tree + `hello-confidential-workflows-ts/my-workflow/workflow.ts`, `ai-audit-firewall-ts/main.ts`, `automated-liquidation-protection-ts/main.ts`, commit dates); `ethglobal.com/events/cannes2026/prizes/chainlink`; `chain.link/blog/convergence-hackathon-winners`.
ETHGlobal: `ethglobal.com/events/ethonline2026/info/details` (rules, deadline, partner-prize cap, AI attribution). Cross-sponsor: Ledger `developers.ledger.com/ethonline`, Blocky402 site, ENSIP-25/26 (ens.domains blog), `Uniswap/uniswap-ai`.
