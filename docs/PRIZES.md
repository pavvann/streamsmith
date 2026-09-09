# ETHOnline 2026 — Prize Map

Source: https://ethglobal.com/events/ethonline2026/prizes/ (scraped 2026-09-04)

## Key dates & rules

- **Hackathon:** Sept 4 – 16, 2026 (async)
- **Submission deadline:** Sunday **Sept 13, 2026, 12:00 pm EDT** (hard cutoff)
- **Demo video:** 2–4 min, ≥720p, real voice (no TTS/AI voiceover, no music-only, no phone recording, no speed-up)
- **Partner prizes:** pick **up to 3 sponsors** at submission. Multiple tracks from one sponsor count as 1 pick.
- **From Scratch (Classic):** all project-specific code must start after Sept 4. Starter kits / OSS libs OK, be transparent.
- **Continuity track (new 2026):** extend a pre-existing project. Some prizes are Continuity-only; net-new projects cannot win those.
- **Version control:** meaningful commit history required. Single-commit dumps can be disqualified.
- **AI tools:** allowed, must be attributed in submission (which files/parts). Spec-driven workflows must include spec files/prompts in repo.
- **Judging criteria:** Technicality, Originality, Practicality, Usability, WOW factor. Top ~20% advance to live finalist judging (7 min: 4 demo + 3 Q&A). Most partner prize money goes to projects that do NOT advance to finals.
- Total advertised: $100K (sponsor sum below ≈ $79.5K; remainder is ETHGlobal finalist pool).

## Sponsors at a glance

| Sponsor | Total | Tracks (net-new eligible unless marked) |
|---|---|---|
| The Graph | $15,000 | Composable/Standardized products $5K (3 places) · AI tooling/use case From Scratch $5K (3 places) · AI Continuity $5K **[Continuity-only]** |
| Hedera | $15,000 | AI & Agentic Payments (x402) $6K (3×$2K) · Tokenization of Anything (ATS) $6K (3×$2K) · Improve Hedera Harness $2K (2×$1K) · Continuity $1K **[Continuity-only]** |
| Arc (Circle) | $10,000 | Best DeFi/Onchain Finance $1,667 · Best Agentic Economy w/ Agent Stack $1,667 · Launch on Arc Testnet → Mainnet $3.5K ($2.5K/$1K) · DeFi/Agentic Continuity $1,666 **[C-only]** · Launch Continuity $1.5K **[C-only]** |
| World | $7,000 | Selfie Check $3.5K · AgentKit Continuity $3.5K **[Continuity-only]** |
| 1inch | $7,000 | Build an Aqua App $5K ($2.5K/$1.5K/$1K) · Aqua Continuity $2K **[Continuity-only]** |
| ENS | $5,000 | Best Use of ENSv2 $4.5K ($1.5K/$1.5K/$1K/$500) · ENSv2 into existing project $500 **[Continuity-only]** |
| Uniswap Foundation | $5,000 | Best Uniswap Stack Contribution $3K (3×$1K) · second pool $2K (2×$1K) **[Continuity-only]** |
| Ledger | $5,000 | AI Agents x Ledger $3.5K ($2K/$1K/$500) · Continuity $1.5K **[Continuity-only]** |
| Privy | $5,000 | Best B2B financial product $2.5K · Best financial flow $2.5K |
| Bazantic | $3,000 | Help an Agent Use Your Project $1K (2×$500) **[Continuity-only]** · Best Recipe w/ sponsor APIs $1K · Agentify a new API $1K |
| Chainlink | $2,500 | Best Confidential Workflow (CRE) $2K (2×$1K) · Chainlink-Powered Upgrade $500 **[Continuity-only]** |

**Net-new addressable ≈ $59.3K.** Continuity-only (≈ $20.2K, verified from the page banners): Graph AI $5K · Hedera $1K · Arc $1,666 + $1,500 · World AgentKit $3.5K · 1inch Aqua $2K · ENS integration $500 · Uniswap 2nd pool $2K · Ledger $1.5K · Bazantic Help-an-Agent $1K · Chainlink Upgrade $500.

---

## The Graph — $15,000

**About:** Subgraphs, Firehose, Substreams, Amp. 50+ networks. Subgraph MCP lets AI query 15K+ subgraphs in natural language; x402 pay-per-query for agents.

### 🧩 Best Use of Composable or Standardized Graph Products — $5,000 (1st $2.5K / 2nd $1.5K / 3rd $1K)
Use **Standardized Subgraphs** (Messari: one schema across every protocol of a type → one query across many protocols), compose reusable **Substreams packages**, or layer **Subgraph MCP** for cross-protocol analysis. Contributing a composable Substreams module for an emerging standard (e.g. **ERC-4626 vault flows**) counts.
- Must compose 2+ Graph products OR build meaningfully on a standardized schema
- **Live data only** (Subgraph Studio / The Graph Market). Mocked/local/static = DQ
- Querying one subgraph with no composition doesn't qualify
- Show what became easier because of the shared schema
- Public repo + 2–4 min video
- Links: Messari standard subgraphs, Agent0/ERC-8004 subgraphs, streamingfast/substreams-chain-modules, pinax-network/substreams-evm

### 🤖 Best AI Tooling or AI Use Case with The Graph (From Scratch) — $5,000 (1st $2.5K / 2nd $1.5K / 3rd $1K)
Two ways in: (a) **tooling** that makes The Graph usable from Claude/Cursor/ChatGPT — new/extended MCP servers, agent SKILLs, x402 payment tooling, A2A integrations, framework plugins, client configs; (b) **agents/apps** using The Graph as live data source — research assistants, trading/execution agents, portfolio copilots, risk monitors.
- Featured challenge: **Substreams SKILLs → one prompt → deployed Substreams pipeline**
- Graph must be load-bearing; live data via Studio API key or Graph Market
- "Meaningful work with the data: reasoning, decisions, automation, or NL interface, not just printing a raw query result"
- Tooling submissions must be reusable infra, not a single end-user app
- Open source with README/SKILL.md; public repo + 2–4 min video
- Links: Subgraph MCP docs, graphprotocol/subgraphs-skills, streamingfast/substreams-skills

### 🤖 Same track, Continuity pool — $5,000 **[Continuity-only]**
Extend an existing OSS repo or ship a feature on an existing product (incl. improving The Graph's own MCP servers / SKILLs). Document pre-existing work.

---

## Hedera — $15,000

**About:** EVM-compatible, hashgraph consensus, 10K+ TPS, 3s finality, USD-priced fees, HTS native tokens, HCS consensus topics, Scheduled Transactions. SDKs: JS, Java, Python, Rust, Go, Swift.

### 🤖 AI & Agentic Payments on Hedera — $6,000 (up to 3 × $2,000)
"x402 on Hedera is still short of one thing: actual services you can pay for." Stand up a **real x402-gated service on Hedera** and build the platform/agent that consumes it.
- **Must:** live x402-gated service on Hedera testnet/mainnet settled through the **Blocky402 facilitator**; an agent/platform that completes ≥1 real paid request end to end; repo w/ setup + architecture + payment flow; video ≤5 min showing the paid request
- Ideas from sponsor: pay-per-call inference; metered data feed; agent marketplace (services register, agents discover & pay in HBAR/HTS); micropayment streaming
- **Extra points:** pay-per-call inference/data/compute metering (not flat fee) · multi-agent negotiation via **A2A or ACP** · on-chain agent identity via **ERC-8004 or HCS-14** · discovery via **UCP** or an agent-findable directory · **HTS tokens / custom fee schedules** in settlement · **HCS** verifiable payment audit trails · recurring/streamed payments via **Scheduled Transactions**
- Links: blocky402.com, hedera-dev/x402-inference-pay-per-request-poc, hashgraph/hedera-agent-kit-js, hedera-dev/scaffold-hbar, x402-foundation/x402

### 🛠️ Open Source — Improve the Hedera Harness — $2,000 (up to 2 × $1,000)
Contribute to **hedera-dev/hedera-harness** (open PR fine) or build a new harness inspired by it. Extend service coverage, port to another language/runtime, fix first-hour rough edges, add local/test mode without testnet round trips.
- Extra: new coverage, fewer LOC to first tx, tests/docs, new language target, before/after DX evidence
- Links: hedera-dev/hedera-harness, hedera-dev/hedera-skills

### 🪙 Tokenization of Anything — $6,000 (up to 3 × $2,000)
Enterprise finance app on Hedera using **Asset Tokenization Studio (ATS)** — supports ERC-3643 + ERC-1400, compliance controls, corporate actions, coupons. Real asset classes & lifecycle > "a token with a name".
- Ideas: tokenized collateral for repo · bonds w/ issuance/coupons/redemption · **secondary market for ATS assets (Studio doesn't have one today)** · KYC-gated tokenized equities w/ corporate actions · cashflow tokenization (invoices/receivables/royalties)
- **Must:** use ATS (SDK/contracts/web app); Hedera testnet; repo w/ contracts **verified on HashScan**; video ≤5 min showing issuance, config, ≥1 lifecycle op
- Extra: secondary market · compliance controls in use (KYC grants, freezes, restrictions, pauses) · custom fees/coupons/dividends/royalties · oracle for pricing/NAV · Scheduled Transactions for vesting/coupons/maturity · upstream contributions to ATS
- Links: hashgraph/asset-tokenization-studio, @hashgraph/asset-tokenization-sdk

### ♻️ Continuity — $1,000 **[Continuity-only]**

---

## Arc (Circle) — $10,000

**About:** Circle's EVM L1, "Economic OS", stablecoin-native. Products: Arc, USDC, App Kits, Circle Wallets, Circle Contracts, CCTP, Gateway, StableFX, Agent Stack, Nanopayments, Paymaster.

**All Arc tracks require:** working frontend + backend + **architecture diagram**; video + presentation on use of Circle tools; detailed docs; repo link; state which bounty you're submitting for.

### 🏆 Best DeFi/Onchain Finance Application — $1,667
Lending, borrowing, swaps, liquidity, FX, yield, payments, treasury or fintech infra using Arc + USDC. Wants: advanced programmable money flows (conditional payments, onchain automation, multi-step settlement); App Kits where relevant.

### 🏆 Best Agentic Economy Application with Circle Agent Stack — $1,667
Agents that hold wallets, pay, manage risk, settle jobs, transact agent-to-agent in USDC. Wants: decision logic tied to real signals; autonomous spending/settlement; **Agent Stack** to connect agents to wallets; **Nanopayments / Paymaster / App Kits** for agent-to-agent or service payments.

### 🏆 Launch on Arc Testnet & Push to Mainnet — $3,500 (1st $2.5K / 2nd $1K)
Add a working Arc integration that's ready to ship. Wants: USDC/EURC payment flows in commerce/fintech/wallet; crosschain transfers / unified balance w/ Arc as settlement; agentic payments in an AI agent or API monetization tool; stablecoin escrow/settlement in DeFi/marketplace; Arc treasury/FX in a multi-chain product.
- **Must be deployed or deployment-ready on Arc mainnet by Sept 30.**

### 🏆 Continuity variants — $1,666 + $1,500 **[Continuity-only]**

Links: docs.arc.io, docs.arc.io/app-kit, developers.circle.com, circlefin/agent-stack-starter-kits

---

## World — $7,000

**About:** World ID (unique human), **AgentKit** (agents backed by real humans), **Selfie Check** (low-friction liveness credential, no Orb).

### 🤳 Selfie Check — $3,500
Realistic Selfie Check flow where a low-assurance biometric credential is useful for **risk, eligibility, fairness, continuity, or abuse prevention**.
- Must: use Selfie Check (or compatible World ID credential flow) meaningfully; treat it as a signal, not a login; **use the World ID Sandbox App** to test/demo remotely; working app; **feedback document** covering docs/integration flow, Developer Portal, Sandbox App states/proof flows/errors/edge cases, what was confusing/missing/broken

### 🤖 AgentKit Continuity — $3,500 **[Continuity-only]**
Extend an existing project with AgentKit; register/resolve agents through **AgentBook**; Sandbox App; feedback doc.

---

## 1inch — $7,000

### 💧 Build an Aqua App — $5,000 (1st $2.5K / 2nd $1.5K / 3rd $1K)
Custom **Aqua** app implementing a sophisticated DeFi position. If using **SwapVM**, may modify opcodes and define own instructions. **SwapVM use scored higher.**
- Must: official Aqua/SwapVM contracts (redeploying modified SwapVM allowed); onchain token transfers shown in demo (local forks OK); **proper git history, no single-commit final-day dumps**

### 💦 Aqua Continuity — $2,000 **[Continuity-only]**

---

## ENS — $5,000

### 🧬 Best Use of ENSv2 — $4,500 (1st $1.5K / 2nd $1.5K / 3rd $1K / runner-up $500)
**ENSv2 beta live on Sepolia.** Hierarchical registry; resolve subnames off parent's resolver w/ wildcard; deploy own subname registry to tokenize/manage subnames; **Enhanced Access Control** (role-based permissions, e.g. account can edit only certain text records); **Permissioned Resolver** per subname; record aliasing / namespace aliasing; expiring, revocable, non-transferable vs transferable, "forever names" with no parent control. **Bonus: AI agents as namespaces, each with own identity and permissions.**
- Must: built on ENSv2 Sepolia; ENSv2 central not cosmetic; functional demo (no hardcoded values); video and/or live demo; open source

### 🔗 Best Integration of ENSv2 into an Existing Project — $500 **[Continuity-only]**
Integrate ENSv2 (Sepolia) against an existing project's testnet deployment. Pairs with agent identity.

---

## Uniswap Foundation — $5,000

### 🦄 Best Uniswap Stack Contribution — $3,000 (3 × $1,000) · second pool $2,000 (2 × $1,000) **[Continuity-only]**
Build on/integrate any part of the stack: Uniswap API, AMM v2/v3/v4, **CCA**, new **v4 hooks**, extensions/improvements to official repos, ecosystem tooling.
- **Must:** public open-source repo + a `FEEDBACK.md` file + completed Uniswap Developer Feedback Form (https://developers.uniswap.org/hackathon-feedback) linking to your FEEDBACK.md. Submissions without it are reviewed/audited before winners are finalized.
- README must point to the exact contracts and lines of code for verification

---

## Ledger — $5,000

### 🤖 AI Agents x Ledger — $3,500 (1st $2K / 2nd $1K / 3rd $500)
Device-backed security central to the product: agents that hold secrets they can't leak; agents that pay for what they use; human approval before anything irreversible.
- Most wanted: (1) **agents that use secrets they cannot leak** — a broker hands out scoped capabilities, never the API key; (2) **bring the Key Ring to hosts with no USB port** — enroll a VPS, CI runner, or hosted agent. Both must be built on the **Ledger Agent Stack**, specifically the **Ledger Key Ring CLI (`wallet-cli ring`)**.
- Also: agents paying for APIs/tools with Ledger-secured flows incl. **x402-style**; human-in-the-loop where Ledger approves high-risk actions before funds move / permissions escalate

### 🛣️ Continuity — $1,500 **[Continuity-only]**
Add Ledger signer via DMK skills; make `wallet-cli ring` the key backend for .env/sops/age; device confirmation in front of an existing action; land a fix on a Ledger repo.

---

## Privy — $5,000

### 🏢 Best B2B financial product — $2,500
Treasury platforms, business accounts, payroll, spend management, payment ops, shared org wallets. Wants: **org wallets, policies, team permissions, quorum approvals, intents, automated/event-driven transactions**.
- Must: Privy core; ≥1 Privy wallet; business use case; ≥1 functional B2B workflow (payment, approval, treasury op, wallet admin); **≥1 Privy control (policies, signers, key quorums, or intents)**; working demo + source; explain how Privy enables it

### 💸 Best financial flow — $2,500
Funding, moving, trading, growing, spending. Payments, remittances, cross-chain, stablecoin conversion, swaps, savings, payouts, card-like spending.
- Must: Privy core; ≥1 wallet; ≥1 functional flow using a **generally available** feature (transfers, bridging, stablecoin conversion, swaps, self-service Earn vaults, onramps); features needing commercial onboarding may be mocked but don't count. **Privy Cards require guided onboarding → mocked card OK but need another live flow.**

---

## Bazantic — $3,000

**About:** one integration turns an API into something agents can understand, use, and pay for: deploy an **x402/MPP Gateway**, deploy an **MCP server**, custom domains, and **Recipes** (custom tool calls explaining when/why/how to use a service).

### 🤖 Help an Agent Use Your Hackathon Project — $1,000 (2 × $500) **[Continuity-only]**
Put your project's internal API behind a Bazantic gateway + MCP server + Recipe. **A/B test:** same task, same model/prompt/settings, once with raw API info and once with the Recipe; show repeatable improvement; video walkthrough; provide Bazantic username.

### 🍳 Best Recipe that uses ETHGlobal Sponsor APIs — $1,000 ($500/$300/$200)
Recipe chaining ≥2 services (yours + another Bazantic service or a sponsor API) into one workflow neither could solve alone. E.g. Uniswap API GET /swap → 1inch Trace API for tx logs.

### 👨‍🍳 Agentify a new API — $1,000 ($500/$300/$200)
Add an API not already on Bazantic and not from a sponsor; working Gateway; Recipe using it plus your project in one flow; reusable by other builders.

---

## Chainlink — $2,500

### 🔗 Best Confidential Workflow — $2,000 (2 × $1,000)
**CRE Confidential Workflows:** designate parts of a CRE workflow to run in a hardware-isolated **TEE**. Secrets fetched inside enclave; sensitive inputs/API responses/intermediate computation protected; dev controls what leaves for DON consensus, delivery, or onchain settlement.
- Example uses: AI audit firewalls protecting API creds; liquidation protection w/ private thresholds; confidential rebalancing; proprietary strategy trading; private risk/policy enforcement; secure LLM/agent workflows with private inputs; payment orchestration w/ protected account details; privacy-preserving authenticated Web2 API access
- Must: CRE workflow using a **confidential TEE handler** (`handlerInTee` TS / `cre.HandlerInTee` Go); processes ≥1 sensitive input/secret/API response inside enclave; meaningfully integrated (no placeholder); show successful execution via **CRE CLI simulation** or live deployment (logs/video)

### 🏆 Best Chainlink-Powered Upgrade — $500 **[Continuity-only]**
Upgrade an existing project with CRE (incl. Confidential), Price Feeds, Data Streams, PoR, or VRF. Must cause an onchain state change, not just display data. **Don't use Functions/Automation (deprecated) — use CRE.**
