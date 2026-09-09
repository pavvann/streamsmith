# ETHOnline 2026 — Prize Strategy (judge-brain)

Prepared 2026-09-04 for a 1–3 person, strong full-stack TypeScript + Solidity team. Sources: the ETHOnline 2026 prize sheet (`prizes-clean.md`), ETHGlobal rules/details pages, ETHGlobal showcase pages for Lisbon 2026, New York 2026, Cannes 2026, HackMoney 2026 and ETHOnline 2025 (485 project cards sampled, prize badges decoded), sponsor recap blogs (The Graph Lisbon 2026, Arc HackMoney 2026, Hedera x402 bounty Aug 2026), and sponsor docs (Blocky402, Circle Agent Stack/Nanopayments, Ledger wallet-cli/Key Ring, ENSv2, Chainlink CRE, Graph networks registry).

---

## 0. Rules that reshape everything (read before anything else)

| Rule | Source | Consequence |
|---|---|---|
| **You may apply to at most 3 Partner Prizes per submission.** A partner with multiple tracks counts as **one** partner and you are eligible for all of its tracks. | ethglobal.com/events/ethonline2026/info/details ("select up to 3 Partner Prizes"), overview page (`sponsor_sdks: up to three`) | A 4th/5th sponsor integration has **zero prize EV**. Stack *tracks within a partner*, not partners. The right unit is a **partner triad**. |
| **Submission deadline: Sunday Sept 13, 12:00 pm EDT.** Not Sept 16 (Sept 14–16 is judging). | details page, Ledger page ("Submissions close Sep 13") | **9 build days**, not 12. |
| **Video 2–4 min, hard-enforced on upload**; ≥720p; human narration (no TTS/AI voice); no speed-up; no phone recordings. | details page | Hedera's/Arc's "≤5 min" is moot; plan a 3:30 cut. |
| Classic ("From Scratch") vs **Continuity** (Extend Open Source / Ship a Feature). Continuity-only prizes are closed to net-new projects; whether Continuity projects can win classic partner tracks "may vary by event and partner". | details page, rules page | Net-new addressable pool is **$59,334**, see §1. |
| Version control throughout; "large single commits or missing histories may be disqualified". 1inch repeats it explicitly. | rules, 1inch track | Commit daily, from day 1, with real history. |
| **AI tool attribution is mandatory**; if you use spec-driven workflows you must commit all spec files/prompts/plans. Submissions "that rely entirely on AI without meaningful contributions" can be ineligible. | details page | Keep a `/specs` or `/plans` dir in the repo and an "AI usage" section in README. |
| Judging criteria: Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW. Async first round screens top ~20% to live finals; **partners judge asynchronously and "the majority of prizes are paid out to projects that do not advance"**. | details page | Optimize for the partner judge watching a 3-minute video and skimming a README, not for finals. |
| For each selected partner prize you fill a field explaining how you used their tools + **feedback**. | details page | Write the per-partner blurb + feedback while building, not at 11:50. |

---

## 1. Prize map

Legend: **F** = available to From-Scratch (net-new) projects; **C-only** = Continuity-only (closed to net-new). "Winners" = number of payouts. Amounts in USD.

| # | Sponsor | Track | $ pool | Winners / split | F / C | Hard qualification gates | "Extra points" signals |
|---|---|---|---|---|---|---|---|
| 1 | The Graph | Best Use of Composable or Standardized Graph Products | 5,000 | 3 (2,500 / 1,500 / 1,000) | F (open) | Compose ≥2 Graph products **or** build meaningfully on a standardized schema (Messari); **live data from a Graph provider** (Studio API key or Graph Market) — "mocked, local-only, or static datasets do not qualify"; single-subgraph query with no composition does not qualify; public repo; 2–4 min video | Show what became easier because of the shared schema; one query across many protocols; one pipeline across chains; contributing a standardized Substreams module (e.g. ERC-4626) |
| 2 | The Graph | Best AI Tooling or AI Use Case (From Scratch) | 5,000 | 3 (2,500 / 1,500 / 1,000) | F | Graph load-bearing (tooling targets Graph, or agent uses Subgraphs/MCP/Substreams as live data source); live data; "meaningful work with the data" (reasoning/decisions/automation/NL), not printing results; tooling must be reusable infra; README/SKILL.md runnable; select correct pool | Substreams one-prompt deployment challenge; x402 pay-per-query; A2A; MCP servers; SKILLs |
| 3 | The Graph | Best AI Tooling or AI Use Case (Continuity) | 5,000 | 3 (2,500 / 1,500 / 1,000) | **C-only** | Same as #2 plus documented pre-existing work | Extending Graph's own AI Suite counts |
| 4 | Hedera | AI & Agentic Payments on Hedera | 6,000 | up to 3 × 2,000 | F (open) | **Live x402-gated service on Hedera testnet/mainnet settled through the Blocky402 facilitator**; a platform/agent that consumes it with **≥1 real paid request end-to-end**; README with setup/architecture/payment flow; video shows the paid request | Pay-per-call inference/data/compute **metering** (not flat fee); multi-agent A2A/ACP negotiation; ERC-8004 or HCS-14 identity; UCP/directory discovery; HTS tokens or custom fee schedules in the settlement path; HCS audit trails; Scheduled Transactions for recurring/streamed payments |
| 5 | Hedera | Open Source — Improve the Hedera Harness | 2,000 | up to 2 × 1,000 | F (open) | Meaningful PR to hedera-dev/hedera-harness (open PR fine) **or** a new harness extending/inspired by it; repo/PR + README; video | New service coverage; fewer LOC to a working tx; tests/docs/examples; other language/framework; before/after DX evidence |
| 6 | Hedera | Tokenization of Anything | 6,000 | up to 3 × 2,000 | F (open) | Use **Asset Tokenization Studio** (SDK, contracts, web app or combo) to issue/manage a tokenised asset; deploy + demo on Hedera testnet; public repo; **contracts verified on HashScan where applicable**; video shows issuance, configuration and ≥1 lifecycle op (transfer / compliance check / distribution) | **Secondary market for ATS assets** (ATS lacks one); KYC grants/freezes/transfer restrictions/pauses; custom fees, coupons, dividends, royalties; oracle pricing/NAV; Scheduled Transactions for vesting/coupons/maturity; upstream contributions to ATS |
| 7 | Hedera | Continuity | 1,000 | 1 | **C-only** | Pre-existing Hedera project; substantive new work; README separating old/new with commit history | Real users; newly integrated Hedera services; roadmap |
| 8 | Arc | Best DeFi/Onchain Finance Application | 1,667 | 1 | F (open) | Working frontend **and** backend; **architecture diagram**; video + presentation; detailed docs; repo; state which bounty you target | Conditional payments, onchain automation, multi-step settlement; App Kits; treasury/FX/payments workflows |
| 9 | Arc | Best Agentic Economy Application with Circle Agent Stack | 1,667 | 1 | F (open) | Same as #8 | Agents with decision logic tied to real signals; autonomous USDC settlement; **Agent Stack** (Circle CLI, Agent Wallets); Nanopayments, Paymaster, App Kits |
| 10 | Arc | Best DeFi or Agentic Application (Continuity) | 1,666 | 1 | **C-only** | Same as #8 + registered Continuity project | — |
| 11 | Arc | Launch on Arc Testnet & Push to Mainnet | 3,500 | 2 (2,500 / 1,000) | F (open) | Same as #8 **plus "deployed or deployment-ready on Arc mainnet by September 30"** | USDC/EURC payment flows in a commerce/fintech/wallet product; Arc as core settlement layer; agentic payments; escrow |
| 12 | Arc | Launch on Arc Testnet & Push to Mainnet (Continuity) | 1,500 | 1 | **C-only** | Same as #11 for an existing product | — |
| 13 | World | AgentKit Continuity | 3,500 | unspecified | **C-only** | Meaningful AgentKit use; working app; AgentBook registration; **World ID Sandbox App** for remote testing; **feedback document** (AgentKit docs, Developer Portal, Sandbox states/proofs/test users/errors, what was confusing) | — |
| 14 | World | Selfie Check | 3,500 | unspecified (Lisbon precedent: 2 winners, 1st/2nd) | F | Uses Selfie Check (or Selfie-compatible World ID credential flow) **as a risk / eligibility / fairness / continuity / abuse-prevention signal**; **Sandbox App** used to test & demo; **feedback document** (same 4 headings); working app. Sandbox access is via a Google Form — apply day 1 | — |
| 15 | 1inch | Build an Aqua App | 5,000 | 3 (2,500 / 1,500 / 1,000) | F (open) | **Official Aqua/SwapVM contracts** (redeploying a modified SwapVM allowed); **on-chain token transfers shown in the demo** (local forks OK); **proper git history — "no single-commit entries on the final day"** | **SwapVM usage scored higher**; custom opcodes/instructions; sophisticated positions demonstrated via tests or UI |
| 16 | 1inch | Build an Aqua App — Continuity | 2,000 | 2 (1,500 / 500) | **C-only** | Same as #15 | — |
| 17 | ENS | Best Use of ENSv2 | 4,500 | 4 (1,500 / 1,500 / 1,000 / 500) | F (open) | **Built on ENSv2 on Sepolia**; ENSv2 features central, "not a cosmetic add-on"; functional demo, **no hard-coded values**; video and/or live demo; open source | Permissioned Registry / Resolver, Enhanced Access Control, record/namespace aliasing, expiring/revocable/non-transferable subnames; **AI agents as namespaces** |
| 18 | ENS | Best Integration of ENSv2 into an Existing Project | 500 | 1 | **C-only** | ENSv2 Sepolia against an existing project's testnet deployment | Agent identity |
| 19 | Uniswap Foundation | Best Uniswap Stack Contribution | 3,000 | up to 3 × 1,000 | F (open) | Public repo; **FEEDBACK.md**; **Uniswap Developer Feedback Form** submitted with the FEEDBACK.md link; README points to exact contracts/lines of integration ("submissions without it will be reviewed and audited") | Any part of the stack: API, v2/v3/v4, CCA, hooks, tooling |
| 20 | Uniswap Foundation | Best Uniswap Stack Contribution (Continuity) | 2,000 | 2 × 1,000 | **C-only** | Same as #19 | — |
| 21 | Ledger | AI Agents x Ledger | 3,500 | 3 (2,000 / 1,000 / 500) | F ("start something new") | Built on the **Ledger Agent Stack**, "in particular the Ledger Key Ring CLI (`wallet-cli ring`)" for the two headline asks; **documentation/DX feedback is mandatory** ("we judge the DX feedback as much as the code"); runnable without you (repo or recorded walkthrough). **Practical gate: wallet-cli is USB-based and `ring init` needs a physical Ledger.** | Agents using secrets they cannot leak (scoped capabilities); Key Ring on hosts with no USB (VPS/CI/hosted agent); x402-style Ledger-secured payments; human-in-the-loop device approval before irreversible actions |
| 22 | Ledger | Continuity | 1,500 | 2 (1,000 / 500) | **C-only** | Existing project + Ledger signer / Key Ring / device confirmation; before/after | — |
| 23 | Privy | Best B2B financial product | 2,500 | 1 | F (open) | Privy core; ≥1 Privy wallet; business/org use case; ≥1 functional B2B workflow (payment/approval/treasury/admin); **≥1 Privy control (policies, signers, key quorums, intents)**; working demo; explain how Privy enables it | Org wallets, team permissions, quorum approvals, automated/event-driven ops |
| 24 | Privy | Best financial flow | 2,500 | 1 | F (open) | Privy core; ≥1 wallet; ≥1 functional flow on a **GA** feature (transfer, bridge, stablecoin conversion, swap, Earn vault, onramp); Cards may be mocked but do not count | Hide onchain complexity |
| 25 | Bazantic | Help an Agent Use Your Hackathon Project | 1,000 | 2 × 500 | **C-only** | Bazantic account; x402/MPP Gateway; Recipe; A/B same prompt with/without Recipe; video; account handle | — |
| 26 | Bazantic | Best Recipe that uses ETHGlobal Sponsor APIs | 1,000 | 3 (500 / 300 / 200) | F (open) | Bazantic account; Gateway for your project; ≥1 other service (Bazantic or sponsor API); recipe using both; result depends on both; screen recording; account handle | — |
| 27 | Bazantic | Agentify a new API | 1,000 | 3 (500 / 300 / 200) | F (open) | Add an API **not** already on Bazantic and **not** a sponsor API; working Gateway; recipe using both in your project; screen recording; account handle | Reusable by other builders |
| 28 | Chainlink | Best Confidential Workflow | 2,000 | 2 × 1,000 | F (open) | CRE Workflow using **Confidential Workflows**; registers a TEE handler (`handlerInTee` TS / `cre.HandlerInTee` Go); processes ≥1 sensitive input/secret/API response inside the enclave; meaningfully integrated into core functionality (no placeholder); evidence of **simulation via CRE CLI or live deployment** (logs/video). Note: Confidential Workflows is a **private beta** — the local simulator works without approval; live deploy needs the access form | Audit firewalls, private risk thresholds, confidential rebalancing, private API access |
| 29 | Chainlink | Best Chainlink-Powered Upgrade | 500 | 1 | **C-only** | ≥1 Chainlink service inside contract logic/onchain workflow causing a **state change** (frontend display insufficient); use CRE not Functions/Automation | — |

### 1.1 Addressable totals

| Pool | $ | Notes |
|---|---|---|
| Total sponsor prizes | **79,500** | 11 sponsors, 29 prize lines |
| **Addressable by a net-new (From Scratch) project** | **59,334** | Rows marked F. Includes Hedera 14,000; Graph 10,000; Arc 6,834; Privy 5,000; 1inch 5,000; ENS 4,500; World 3,500; Ledger 3,500; Uniswap 3,000; Bazantic 2,000; Chainlink 2,000 |
| **Continuity-only** | **20,166** | Graph 5,000; World 3,500; Arc 3,166; 1inch 2,000; Uniswap 2,000; Ledger 1,500; Hedera 1,000; Bazantic 1,000; ENS 500; Chainlink 500 |
| Addressable by a Continuity project | 20,166 floor, up to 79,500 ceiling | Only Graph (#2 "THIS TRACK IS THE FROM SCRATCH TRACK") and Ledger (#21 "start something new") explicitly exclude Continuity teams from their classic tracks; the other classic tracks are silent, and ETHGlobal says eligibility "may vary by event and partner". Ask each partner in Discord before relying on it. |

### 1.2 What one submission can realistically win (the number that matters)

Because of the 3-partner cap, and because "up to N teams receive $X" tracks pay a fixed amount per team, the **per-team ceiling per partner** (first place in every track of that partner) is:

| Partner | Ceiling per team (net-new) | Tracks stacked |
|---|---|---|
| Arc | 5,834 | 1,667 + 1,667 + 2,500 |
| Hedera | 5,000 | 2,000 + 1,000 + 2,000 |
| The Graph | 5,000 | 2,500 + 2,500 |
| Privy | 5,000 | 2,500 + 2,500 |
| World | 3,500 (likely split 2,000 / 1,500) | 1 |
| 1inch | 2,500 | 1 |
| Ledger | 2,000 | 1 |
| ENS | 1,500 | 1 |
| Bazantic | 1,000 | 500 + 500 |
| Uniswap | 1,000 | 1 |
| Chainlink | 1,000 | 1 |

**Best-case triad ceiling: Arc + Hedera + (Graph or Privy) = $15,834.** Realistic expected values are an order of magnitude lower (§3), which is why picking tracks with *thin competition* matters more than picking tracks with big pools.

---

## 2. What recent winners looked like (2025–2026)

### 2.1 Hard numbers from the showcase (485 cards sampled across 5 events)

Prize badges on ETHGlobal showcase cards were decoded by sponsor logo ID. Sample is the first 2–5 pages per event, so treat as indicative.

| Event | Cards sampled | Won ≥1 sponsor prize | Won ≥2 sponsors | Won ≥3 sponsors | Finalists |
|---|---|---|---|---|---|
| ETHGlobal Lisbon 2026 (Jul, in person) | 129 | 40 (31%) | 3 (2%) | 0 | 7 |
| ETHGlobal New York 2026 (Jun, in person) | 129 | 52 (40%) | 13 (10%) | 4 (3%) | 3 |
| ETHGlobal Cannes 2026 (Apr, in person) | 65 | 13 (20%) | 1 | 0 | 3 |
| HackMoney 2026 (async) | 33 | 6 (18%) | 0 | 0 | 1 |
| **ETHOnline 2025 (async — the comparable format)** | 97 | **8 (8%)** | 0 | 0 | 0 |
| All | 485 | 126 (26%) | 19 (15% of winners) | 4 (3% of winners) | 16 |

Take-aways:
- **Async events pay out far less often per project** (ETHOnline 2025 ≈ 8% in this sample vs 30–40% in person) because there are 3–5× more submissions. Assume a strong submission has maybe a 40–60% chance of winning *anything*, and the modal outcome is one track from one sponsor.
- **Multi-sponsor stacking is rare among winners: ~15% won two sponsors, ~3% won three.** NY 2026 inflated the multi-sponsor count because ENS ran a $6K "Integrate ENS" pool that paid many small prizes. Don't plan on three payouts; plan on making one partner's judges love you and two more plausible.
- The Simon Brown analysis of 8,200 showcase projects (Medium, Jun 2026) found: AI-agent projects over-performed only where a specialist sponsor earmarked money; at general events in late 2025 agents *under*-performed (0.54× at ETHOnline 2025) because the category was crowded; "differentiation beats the size of the bounty"; cloneable themes flooded by their own bounty (217 Fusion+ clones at Unite DeFi) did worst. Implication for us: the "agent payments" category is now the default, so win it with a *specific technical thing nobody else ships* (a new x402 scheme, metering, a rail nobody has combined), not with "an agent marketplace".

### 2.2 The cautionary set: broad stacks that won nothing (Lisbon 2026)

These are the most instructive data points for a "4+ sponsor" strategy. Each of these had 3–4 sponsors wired in and **no prize badge**:
- **PlanBound** (ethglobal.com/showcase/planbound-wqxy5): Hedera (KeyList accounts + ScheduleCreate) + World ID 4.0 + The Graph (subgraph + Substreams) + x402 v2 + MCP, 163 tests, deployed. Zero prizes.
- **Namesake** (namesake-kq1ez): ENSv2 subnames + ERC-8004 + ENSIP-25/26 + World ID gating + 0G TEE compute, 18-step provisioning orchestrator. Zero prizes — while **atlas** (ENSv2 + three Graph products + 0G) won ENS *and* Graph 2nd, and **ENSignv2** (ENS only, guardians-as-subnames + zkEmail recovery) won ENS.
- **Covenant** (covenant-6j7sn): Hedera HTS KYC/freeze + HCS + World ID 4.0 + ENSv2 text records. Zero prizes — while **Mint & Chill** (HTS + World ID + a Graph subgraph, agent-operated RWA marketplace) won Hedera Tokenization.
- **Kinora** (kinora-5dtqg): A2A agents negotiating music licences, x402 via Blocky402, HCS-14, HTS NFTs — exactly Hedera's brief — zero prizes, while **Glassbox402** (x402ify CLI that wraps any API into x402 on Hedera/Base/Solana + revenue dashboard + MCP + World Selfie Check for human-vs-agent pricing + a monetized Graph subgraph) won Hedera **and** was a Lisbon finalist.
- **HumanMandate** (humanmandate-wbx5i): World AgentBook humanId + Selfie step-up + spending caps on World Chain mainnet. Zero prizes.

Pattern: the winners had a *sharper product thesis and a reusable artifact* (a CLI, an MCP server, a formal-verification harness, an order book primitive). The losers had *more integrations*. Judges reward depth-with-a-hook, not breadth.

### 2.3 What each sponsor's judges have actually rewarded

**The Graph** (source: thegraph.com/blog/ethglobal-lisbon-2026-winners/, showcase). Lisbon winners: **Pista** ($2,500; Substreams → ClickHouse via hosted sink, behavioural anomaly scoring), **ArcBook** ($1,500; on-chain order book with a native Subgraph as discovery layer + an "Executable Liquidity" MCP; also 1inch Aqua 1st + finalist), **deeptrace** ($1,000; four read-only MCP tools running *one shared query template* over Aave v3/Seamless/Moonwell via Messari standardized subgraphs, with deployment-ID pinning), **ColdProof** (Substreams + custom firehose-core provider for Hedera Consensus Service), **BookerBob** (MCP returning risk bands), **Am I cooked** ($2,000 composable; "one query, N protocols" over Aave/Compound/Spark), **atlas** ($1,000 composable; Subgraph + Substreams + MCP + Skills + x402, 86 pinned deployment IDs). The Graph team wrote that all winners converged on: (1) standardized schemas as a multiplier, (2) **provenance** (deployment-ID pinning, freshness, honest staleness), (3) real-time streaming with cursor resumption/reorg handling. They publish winner write-ups, so they read code. Live data is non-negotiable.

**Hedera** (sources: hedera.com/blog/x402-bounty-on-hedera-winners-announced/ Aug 2026; showcase). Their own $5K x402 bounty rewarded **Pinout** (single x402 payment → metered session, per-second burn checkpoints on a plain HCS topic + HIP-991 fee topic as settlement anchor, no contract), **Tally** (first non-EVM `upto` scheme: sign a ceiling, pay only metered usage, Permit2-equivalent on HTS allowance, receipts hashed to HCS, npm packages + MCP server, scheme submitted upstream), **Xorv** (rent idle AI subscription quota, USDC via HTS), **Qisma** (`exact-multi` scheme: one CryptoTransfer settles a 4-party supply chain atomically), **Mystic** (pay-per-minute VPN). ETHGlobal Hedera winners: Glassbox402 (x402 tooling), Mint & Chill (agent-operated RWA), Kickoff Aivy Studio (agents negotiating prices, HBAR/HTS settlement, World ID + Ledger; NY), AgentRanker (trust-gated agent payments; NY), cashmeifyoucan (agents bidding on invoices; NY), Wafer (KYC-gated tokenized pool, live NAV; NY), AudiThor (audits paid by real-time micropayments; Cannes), AgentRouter (inference exchange), Pastel, Ognef, Vouch, Nook, Alba (Lisbon). What Hedera judges like: **native services without Solidity** (HTS/HCS/Scheduled Tx/mirror node), **novel x402 schemes and metering**, receipts anyone can recompute from the mirror node, packaged tooling (npm/MCP), upstream contributions. Hedera awards 8–14 prizes per event, so the field is winnable.

**Arc / Circle** (source: arc.io blog "HackMoney 2026 Arc track winners"; showcase). Winners: **arctan(x)** (FX DEX, unified balances, Gateway/StableFX), **Text-to-Chain** (SMS wallet, dev-controlled wallets + CCTP), **ArcFlow** (self-paying treasury, idle payroll into yield then cross-chain salaries, multisig + roles), **Versus** (agents earn micropayments and trade creator tokens). Later: **Clawback** (agent payment escrow on Arc with x402 v2 + custom "clawback" scheme + Chainlink Confidential AI Attester adjudication + ENS/ERC-8004 reputation; NY, won ENS), **Sidekick** (perps built for agents; NY, Arc), **Vouch DeFi** (zero-collateral credit; Arc + World + Chainlink), **Thurman Protocol** (secondary loan sales; Arc + Chainlink), **AnyAsset Checkout**, **OpenCompliance** (CRE + TEE compliance layer on Arc; Cannes, Chainlink), **Nominal** (ENS payroll subnames + Circle dev-controlled wallets + LI.FI; HackMoney, ENS), **C.E.S.T.A**, **Onda** (Cannes, Arc). Circle's own lessons: 97% of submissions used agents; teams built **familiar workflows** (escrow, freelancer pay, BNPL, payroll) "not new financial primitives"; gas-abstracted email onboarding via Circle Wallets; cross-chain assumed. Arc is **crowded** (155 teams at HackMoney) and the diagram + working backend gate is enforced.

**ENS** (showcase). ENSv2/agent winners: **atlas**, **ENSignv2**, **VouchMe** (Lisbon); **AgentIndex**, **AgentRankr** (ERC-8004 explorer with live Universal Resolver + ENSIP-25/26), **allowance.eth** (portable AI spending policies as ENS records), **ENS-bound agent auth**, **StableSettle**, **Clawback**, **Realm**, **UNSU** (NY). ENS pays many prizes but the agent-identity niche is now very crowded; ENSv2-specific mechanics (EAC roles, permissioned resolver, expiring/revocable subnames) are the differentiator the prize text asks for.

**Ledger** (showcase, developers.ledger.com/ethonline). **maki** (Cannes finalist: LLM never touches keys; deterministic code builds calldata; simulate → policy → human approval → Secure Enclave/Ledger signer; Uniswap Trading API; World AgentKit), **Veryclear** (scriptable ERC-7730 clear-signing descriptions; Cannes), **Agent Pay** (Cannes), **Lunave** (AI-managed private USDC yield custodied by Ledger; NY), **QuickLedgerBooks** (bookkeeping agent with Ledger approval; NY, ENS). Ledger's stated bar: real user value, **clear boundaries between autonomous and approved**, concrete primitives "not just wallet branding", runnable without you, and DX feedback judged as much as code.

**World** (showcase). Selfie/human-backed-agent winners: **Glassbox402** (Selfie Check to price humans vs agents differently), **Turing Swap** (humans trade cheaper than bots), **Novi Corpus**, **HORS**, **Commitment Issues** (human signs agent-written commits), **Human Bond**, **Hands Unchained** (finalist), **Proof-of-Human**, **AgentRank**. Selfie Check as a *tiering/abuse signal inside a real product* wins; "verify a human, show a badge" doesn't.

**Privy** (showcase): **vouch** (autonomous copy-trading agent gated by World ID, Base Sepolia; NY), **Aragorn** (private compliant ledgers; World + Privy + ENS). Privy fields are small; policies/quorum are the differentiator this year.

**Chainlink** (showcase, chain.link Convergence winners): **OpenCompliance**, **Meridian** (treasury agent converting stablecoins with corporate privacy; Cannes), **Nyx**, **Lineage**, **Immunity**, **Canary**, **Thurman**, **Vouch DeFi**. Convergence hackathon winners: InControl, CRE Risk Router, Ghost Finance, SentinelCRE. Judges reward CRE workflows where the TEE protects something that matters (credentials, thresholds, strategy).

**Uniswap Foundation** (showcase): **Umbra** (autonomous circuit breaker), **Sentinel** (portfolio stop-loss), **Peregrine** (signal → risk-controlled trade), **r00t.fund** (v4 hook), **RWA Outlet** (Aqua + v4 + ERC-7540), **KOLlateral** (finalist), **Smile**, **Better Wallet**, **Lotus**, **Pampalo**, **Chatter**. Broad track; automation/risk tooling and real hooks win; FEEDBACK.md gate is enforced.

**1inch Aqua** (showcase): **ArcBook** (1st, order book of executable curves), **KSwap-VM** (formal semantics + verification of swap-vm), **Agora Markets**, **Votive** (Lisbon); **Ballast** (leveraged oracle-anchored liquidity), **Lotus** (NY); **Aqua0** (Buenos Aires). Small, technical field; SwapVM-native positions and tooling win.

### 2.4 Patterns judges reward (synthesis)

1. **One reusable artifact** at the centre: a CLI (`x402ify`), an npm package + MCP server (Tally), a scheme submitted upstream, a formal-verification harness, an order-book primitive. It signals "this outlives the weekend".
2. **Deep use of the sponsor's *distinctive* primitives** (HCS running hashes, HTS allowances, ENSv2 EAC roles, SwapVM opcodes, Key Ring, TEE handlers) rather than the generic surface (an RPC call, a name lookup).
3. **Verifiability in the video**: a paid request executing, a HashScan/Arcscan link, a mirror-node receipt recomputed live, a Studio query with a real API key.
4. **Provenance and honesty**: pinned deployment IDs, staleness shown, simulation labelled as simulation.
5. **A product thesis a non-crypto person understands in one sentence** (Circle's "milestone payments without lawyers"), then the crypto mechanism.
6. **Polish where the judge looks**: README that runs, architecture diagram, 3-minute video with narration, per-partner feedback.
7. **Breadth does not substitute for 1–6.** Several 4-sponsor Lisbon projects won nothing.

---

## 3. Chain/tooling topology and the conflicts you must resolve

| Sponsor tech | Where it lives | Interop facts (verified) |
|---|---|---|
| Hedera x402 via Blocky402 | Hedera testnet/mainnet (hosted facilitator also serves Polygon Amoy + Solana devnet; Base/Arb/OP/Sepolia only when self-hosting) | `@x402/hedera` ExactHederaScheme; pays HBAR or **HTS tokens** (asset = token ID, e.g. testnet USDC); facilitator pays network fees; no API key on testnet |
| Circle Agent Stack / Nanopayments | Arc Testnet (`5042002`, USDC at `0x3600…0000`, 6 decimals), Base, Base Sepolia, others | Nanopayments = gasless USDC x402 scheme via Gateway; buyer stack is `@circle-fin/x402-batching` on `@x402/core` + `@x402/evm`; Agent Wallets support Arc **testnet only**; Agent Marketplace Discovery API (keyless) lists x402 services; ERC-8004 registries and an ERC-8183 job/escrow reference are deployed on Arc testnet |
| The Graph | Subgraphs on **Arc testnet + Arc mainnet**, Sepolia, Base Sepolia, Unichain Sepolia, Polygon Amoy, World Chain Sepolia (verified in networks registry). **Hedera is not supported.** Messari standardized subgraphs and Agent0 ERC-8004 subgraphs are mainnet/Base/Sepolia/Base Sepolia. Graph x402 pay-per-query = USDC on Base / Base Sepolia | Graph can index your Arc/Sepolia contracts; it cannot index Hedera (ColdProof needed a custom firehose-core provider — do not attempt in 9 days) |
| ENSv2 | **Sepolia only** | Universal Resolver walks hierarchical registries; two-hop subname resolution; permissioned registry/resolver contracts "not final" |
| 1inch Aqua / SwapVM | Ethereum mainnet + Sepolia configs; local fork allowed; redeploying modified SwapVM allowed | Not on Hedera/Arc |
| Uniswap v4 / API | Mainnet, Unichain (+Sepolia), Base, etc. | Not on Hedera/Arc |
| Ledger wallet-cli / Key Ring | Host with USB Ledger for `ring init` and any signing; encrypt/decrypt afterwards is device-less and headless; DMK supports Speculos simulator for dev | EVM signer works for any chain ID (Hedera EVM relay, Arc) |
| Privy | EVM (any chain via custom chain config), Solana, etc. Policies/quorum in TEE | Hedera native (HTS/ED25519) not supported; Hedera **EVM** via JSON-RPC relay is plausible (test day 1) |
| World Selfie Check | Chain-agnostic (IDKit; on-chain verifier on World Chain) | Sandbox App via TestFlight/Play; access by form |
| Chainlink CRE Confidential Workflows | TS SDK (`handlerInTee`), writes to EVM chains incl. Arc testnet (OpenCompliance did) | Private beta; **local simulator works without approval** and simulation is accepted evidence |
| Hedera ATS | Hedera testnet (Solidity, ERC-1400/3643, factory + SDK + React app) | Heavy monorepo; HashScan verification of any custom contracts |

### Conflicts and resolutions

1. **Hedera and Arc both want to be the agent settlement chain.** Resolve with a **multi-rail x402 buyer**: one `x402Client` registers `hedera:*` (ExactHederaScheme → Blocky402) *and* `eip155:5042002` (Circle Gateway nanopayments scheme). The *seller* declares its rail in the 402; the agent pays on whichever rail the seller accepts and the receipt ledger unifies both. This is not a hack — the x402 v2 client is designed for multiple scheme registrations, and Glassbox402 already sold on Hedera/Base/Solana. It also produces a genuinely new demo ("same agent, same budget, two rails") that neither sponsor has seen.
2. **Blocky402 is not on Arc; Nanopayments is not on Hedera.** Same resolution; do not try to self-host Blocky402 for Arc — Hedera's gate says "settled through the Blocky402 facilitator", so the Hedera leg must use the hosted facilitator.
3. **ENSv2 is Sepolia-only while settlement is on Hedera/Arc.** Treat Sepolia as the **identity/control plane** (ENSv2 subnames, EAC roles, ERC-8004 Agent0 subgraph, Aqua, Uniswap v4 also live there) and Hedera/Arc as **settlement planes**. Records on the Sepolia name (ENSIP-25/26 `agent-endpoint`, `agent-context`) point at Hedera/Arc accounts (ERC-7930 chain-address encoding). Resolution is a read-only RPC, so it costs nothing at runtime.
4. **The Graph cannot see Hedera.** Put the Graph on what it *can* see: your Arc contracts (subgraph on `arc-testnet`), your Sepolia registry, and the **standardized** Messari/Agent0 subgraphs for market/trust data. For the Hedera leg, use the free mirror node for receipts and expose both through one MCP with one schema — the "one query pattern across rails" framing satisfies the Composable track if you also consume a standardized subgraph.
5. **Uniswap and Aqua are not on Hedera/Arc.** If DeFi execution is part of the product, run it on Sepolia/Unichain Sepolia and settle fees/payments on Hedera/Arc; or drop DeFi sponsors from concepts that are payments-centric (the 3-partner cap makes this free).
6. **Ledger needs a physical device.** If nobody on the team has one, do not submit to Ledger; swap the slot for The Graph or Privy. Ledger's headline ask ("Key Ring on a host with no USB port") is exactly *enroll once on a laptop with the device, then run headless on a VPS*, so one device for one day suffices.
7. **World Sandbox and Chainlink Confidential access are form-gated.** Apply on day 1; build against the CRE local simulator and IDKit sandbox docs meanwhile; if access does not arrive by day 5, drop the sponsor.
8. **Video length.** Three sponsors × "show the thing executing" in ≤4:00 means ~50 s per sponsor after a 20 s intro and 20 s close. Storyboard accordingly (§4).

---

## 4. Five product concepts (each with 4+ load-bearing sponsor integrations)

Design rule applied to every concept: exactly **three partners are submitted** (the "triad"); the 4th/5th sponsor is either (a) required for the product to work and cheap, (b) a **flex slot** that displaces a triad member if a gate fails (no Ledger device, no World sandbox), or (c) a non-sponsor open standard (x402, ERC-8004, A2A, MCP) that makes the product coherent. Expected values use per-track placing probabilities calibrated to the win-rate data above for a *strong, polished* entry from this team; they are deliberately conservative.

### Concept 1 — **Tollbooth**: multi-rail metered x402 for agents, with hardware-rooted budgets

**Pitch.** `npx tollbooth wrap <url>` turns any HTTP API or model endpoint into a *metered* x402 seller (per-token / per-second / per-row, with an `upto`-style ceiling so the buyer signs once and pays only what was used) that settles on **Hedera** (HBAR or HTS-USDC via Blocky402) *or* **Arc** (USDC via Circle Nanopayments). `tollbooth-agent` is a buyer SDK where one agent wallet pays on whichever rail the seller accepts, inside a budget envelope whose *signing key and API secrets live in a Ledger Key Ring on a headless VPS*; raising the envelope requires a device tap. A receipt ledger (Graph subgraph on Arc + HCS mirror) shows every micro-settlement on both rails in one schema, and an MCP server lets agents discover sellers and compare price-per-unit and trust.

**Why judges should care.** Every "agent marketplace" pays a flat fee per request on one chain. Tollbooth is the first buyer that is rail-agnostic and the first metering layer that spans Hedera and Arc; the hardware-rooted budget answers Ledger's exact ask; it ships as reusable tooling (CLI + SDK + MCP), which is what Glassbox402, Tally and Pinout had in common.

**Sponsor stack (load-bearing roles).**
| Sponsor | Role in product | Remove it and… |
|---|---|---|
| Hedera (track #4) | Rail A: x402 exact + metered settlement through Blocky402; HTS-USDC; HCS topic as tamper-evident metering checkpoints; HCS-14 seller identity; Scheduled Tx for streamed top-ups (extra points) | …there is no Hedera rail and no verifiable meter |
| Arc / Circle (tracks #9, #11, optionally #8) | Rail B: Circle Agent Wallet + Nanopayments (gasless USDC); seller listed on Agent Marketplace discovery; ERC-8004 identity registry on Arc for sellers; testnet now, mainnet-ready config by Sept 30 | …no USDC rail, no gasless agents, no discovery |
| Ledger (track #21) | `wallet-cli ring` holds the agent's x402 signing key + upstream API keys encrypted under the Ledger seed; enrolled once on a laptop, decrypts headlessly on the VPS; DMK signer requires a device confirmation to raise the budget ceiling or add a rail | …the agent holds raw keys and can leak them; no human gate |
| The Graph (flex slot; tracks #1, #2) | Subgraph on `arc-testnet` indexing Tollbooth receipts/escrows + the Agent0 ERC-8004 standardized subgraph for seller trust; Subgraph MCP so buyer agents rank sellers by price and reputation | …no discovery/reconciliation layer (fallback: mirror node + Arcscan only) |
| World Selfie Check (optional 5th, not submitted) | Human-vs-agent price tiers (Glassbox402 pattern) | product still works |

**Submit to:** Hedera + Arc + Ledger. If no Ledger device by day 2: Hedera + Arc + Graph.

**Expected value.**
| Track | P(place) | E[$ \| place] | EV |
|---|---|---|---|
| Hedera AI & Agentic Payments (2,000 × 3) | 0.30 | 2,000 | 600 |
| Arc Agentic Economy (1,667) | 0.12 | 1,667 | 200 |
| Arc Launch → Mainnet (2,500 / 1,000) | 0.15 | 1,750 | 263 |
| Ledger AI Agents (2,000 / 1,000 / 500) | 0.30 | 1,167 | 350 |
| **Total** | **P(any prize) ≈ 0.63** | | **≈ $1,400** (first-everywhere ceiling $8,167) |
Graph variant: replace Ledger with Graph AI (0.25 × 1,667 = 417) + Composable (0.20 × 1,667 = 333) → EV ≈ $1,800, P(any) ≈ 0.68.

**Qualification traps.** Blocky402 hosted facilitator must be in the Hedera path (do not self-host); the video must show a *paid* request executing on each rail with the settlement tx; Arc needs a working frontend + backend + **architecture diagram** in the repo and a "mainnet-ready" statement (Circle Agent Wallets are Arc-testnet-only today, so document the mainnet config path); Ledger needs a **DX feedback document** and a runnable repo; if Graph is submitted, the subgraph must be deployed to Studio and queried with a real API key on camera, and you must consume a standardized subgraph for the Composable track.

**Demo storyboard (3:40).**
0:00 Hook: "Agents can pay per request. They can't yet pay *per unit of work*, on whichever chain the seller wants, without holding a leakable key." 0:20 Terminal: `tollbooth wrap https://…/inference --meter tokens --rails hedera,arc`; seller comes up; show its 402 response. 0:50 Agent on a VPS: `ring decrypt` (no device), agent budget shows ceiling; agent calls seller; picks Hedera rail; HashScan tx + HCS checkpoint appear; meter ticks by tokens; final settle = actual usage. 1:50 Same agent, second seller that only accepts USDC on Arc; Nanopayment fires; Arcscan link; Agent Marketplace listing. 2:30 Agent tries to exceed ceiling → blocked; Ledger device lights up; tap to approve raise; retry succeeds. 3:00 Dashboard (Graph subgraph + mirror node): both rails, one schema; MCP query "cheapest inference per 1k tokens with rep > 80". 3:25 Architecture diagram; what's reusable; close.

### Concept 2 — **Quorum**: an AI ops agent inside a policy-bound business treasury

**Pitch.** A B2B treasury where the company's funds sit in **Privy** org wallets governed by policies (recipient allowlists, per-day caps, chain allowlists) and a **key quorum** for anything above threshold. An ops agent pays vendors' x402 invoices (Hedera via Blocky402 for HTS-USDC, Arc via Nanopayments for USDC), runs payroll on **Arc** as a multi-step conditional settlement (fund → attest hours → release), and schedules recurring payouts with **Hedera Scheduled Transactions**. Every autonomous action is inside policy; every exception routes to a human approval that the quorum signs.

**Sponsor stack.**
| Sponsor | Role | Remove it and… |
|---|---|---|
| Privy (tracks #23, #24) | Org wallets, policy engine (TEE-enforced), key quorum approvals, server-side agent signer with a scoped policy; a GA financial flow (USDC transfer + bridge via Privy funding tools) | …no governance, no B2B story |
| Arc / Circle (tracks #8, #11) | Payroll vault contract with multi-step settlement in native USDC; Nanopayments for vendor micro-invoices; mainnet-ready | …no stablecoin treasury rail |
| Hedera (track #4) | Vendor x402 rail through Blocky402; **Scheduled Transactions** for recurring payouts; HCS as the audit log the auditor exports | …no recurring automation and no second rail |
| ENSv2 (4th; not submitted unless Privy fails) | Payee identity: employees/vendors as subnames under `acme.eth` on Sepolia; payroll resolves names, never raw addresses | …UX regresses to addresses |
| Bazantic (optional) | Gateway + Recipe so an external agent can invoke "submit invoice" against Quorum | — |

**Submit to:** Privy + Arc + Hedera.

**Expected value.** Privy B2B 0.15 × 2,500 = 375; Privy financial flow 0.12 × 2,500 = 300; Arc DeFi 0.10 × 1,667 = 167; Arc Launch 0.15 × 1,750 = 263; Hedera Agentic 0.25 × 2,000 = 500. **EV ≈ $1,600; P(any) ≈ 0.57**; ceiling $9,334.

**Traps.** Privy: must use ≥1 *control* (policy/quorum) and the flow must be on a GA feature (Cards can only be mocked). Hedera: the x402 Hedera scheme expects a Hedera account + ECDSA key; Privy raw-sign can produce the signature but wiring `@x402/hedera` to an external signer is custom work — prototype on day 1, or fund a policy-bound Hedera operations account from the Privy treasury and be explicit about it. Arc: diagram + backend + mainnet-ready. This concept looks like ArcFlow + Nominal; differentiate with the agent + policy + quorum loop, not the payroll UI.

**Storyboard (3:30).** Hook: "Give an agent a company card, not the company." → Privy dashboard: policy JSON, quorum of 2 → agent receives vendor 402, pays within policy on Hedera (HashScan) → second vendor on Arc (Arcscan) → agent proposes payroll run > cap → quorum approvals on two devices → Arc payroll vault settles in USDC, Scheduled Tx created on Hedera for next month → audit export from HCS → diagram.

### Concept 3 — **Coupon**: receivables and bond tokenization on Hedera ATS with human-verified investors

**Pitch.** An SME issues invoice/receivable tokens (ERC-3643 via **Hedera ATS**) at a discount; **Selfie-Check-verified** investors (one human, one allocation; step-up for bigger tickets) buy them; the issuer's treasury lives in a **Privy** org wallet with quorum approval for issuance and coupon runs; coupons/maturity settle automatically via **Hedera Scheduled Transactions**; a minimal **compliance-enforced secondary market** (the thing ATS "does not have today") lets investors exit early. An agent prices the discount from live lending rates read from **Messari standardized subgraphs** via The Graph.

**Sponsor stack.**
| Sponsor | Role | Remove it and… |
|---|---|---|
| Hedera (tracks #6, and #4 if an agent buys receivables via x402) | ATS issuance, KYC grants/freeze, coupon distribution, Scheduled Tx for maturity, secondary order book with transfer-restriction enforcement, HashScan-verified contracts | …no product |
| World Selfie Check (track #14) | Eligibility + abuse-prevention gate for investors (one human per allocation; liveness step-up above a size threshold) mapped to ATS KYC grants | …sybil investors, no compliance story |
| Privy (track #23) | Issuer org wallet + key quorum approving issuance and coupon runs; policies restricting the ops signer to ATS contracts on Hedera EVM (chain 296 via JSON-RPC relay) | …no B2B governance |
| The Graph (flex; track #2) | Pricing agent reads Aave/Compound/Spark standardized subgraphs to set the discount; Subgraph MCP for the analyst view | …pricing is hard-coded (fallback: drop Graph, keep triad) |
| Chainlink CRE Confidential (optional 5th) | Private credit-score/NAV computed in the TEE; simulated | — |

**Submit to:** Hedera + World + Privy (Graph is the flex if World sandbox access doesn't arrive by day 5).

**Expected value.** Hedera Tokenization 0.30 × 2,000 = 600; Hedera Agentic (secondary x402 buyer agent) 0.15 × 2,000 = 300; World Selfie 0.70 (access) × 0.25 × 1,750 = 306; Privy B2B 0.15 × 2,500 = 375. **EV ≈ $1,580; P(any) ≈ 0.58**; ceiling $10,000. Note the Tokenization field is thin: Lisbon's Tokenization winner (Mint & Chill) didn't even use ATS.

**Traps.** ATS monorepo is heavy (npm workspaces, factory deployments, React app) — budget 2 days and use the SDK + deployed factory rather than forking the web app; verify any custom contracts on HashScan; World: apply for Sandbox on day 1, use the Sandbox App in the recorded demo, and write the four-heading feedback doc; Privy on Hedera EVM must be smoke-tested day 1; the video must show issuance → config → a lifecycle op (transfer with compliance check, coupon distribution).

**Storyboard (3:40).** Hook: "A €40k invoice due in 60 days should be cash today." → issuer (Privy quorum) mints receivable token in ATS, KYC required, 8% discount set by the agent from live Graph lending rates → investor opens app, Selfie Check in Sandbox App, KYC grant lands on HashScan → buys; transfer to an unverified wallet reverts live → Scheduled Tx for maturity payout shown → secondary order book: investor exits early to another verified investor → coupon run approved by quorum → diagram.

### Concept 4 — **Mandate**: ENSv2 agent namespaces as revocable capabilities, enforced by hardware

**Pitch.** Every agent an org runs is an **ENSv2 subname** in the org's own Permissioned Registry on Sepolia. **Enhanced Access Control** gives each agent the right to edit only its own `agent-*` text records (ENSIP-25/26: endpoint, policy hash, ERC-8004 registration); subnames are **expiring and revocable**, so the name *is* the credential. A **Ledger Key Ring** broker on the org's VPS hands agents scoped capabilities (never the raw API key) only while their name resolves and is unexpired; escalations require a device tap. A **Graph** subgraph indexes the registry and composes with the Agent0 ERC-8004 standardized subgraph, exposed via MCP as the org's agent directory + audit. The agents' actual job is DeFi execution via the **Uniswap** API/v4 within mandate.

**Sponsor stack.** ENSv2 (#17) — the registry/EAC/expiry model is the product; Ledger (#21) — capability broker + device approvals; The Graph (#1, #2) — composed directory (own subgraph + standardized Agent0 subgraph + MCP); Uniswap (#19; 4th, not submitted unless Ledger drops) — the work the agents do; Arc (optional) — USDC settlement of agent fees.

**Submit to:** ENS + Ledger + Graph (swap Ledger → Uniswap if no device).

**Expected value.** ENS 0.20 × 1,125 = 225; Ledger 0.30 × 1,167 = 350; Graph Composable 0.25 × 1,667 = 417; Graph AI 0.20 × 1,667 = 333. **EV ≈ $1,325; P(any) ≈ 0.66**; ceiling $8,500.

**Traps.** ENS-agent-identity is the most crowded niche in the set (NY 2026 alone: AgentRank, AgentRankr, allowance.eth, ENS-bound agent auth, StableSettle, Namesake…) — ENSv2 EAC/expiry/permissioned resolver must be visibly central and nothing may be hard-coded; ENSv2 contracts are "not final" (pin versions); Graph needs live Studio data and a composed/standardized story; Ledger needs device + DX feedback.

**Storyboard (3:30).** Hook: "Revoke an agent by deleting its name." → create `trader-01.acme.eth` with EAC role limited to its own records, 24h expiry → agent boots on VPS, Key Ring broker checks resolution, decrypts scoped Uniswap API key → agent executes a mandate-compliant swap on Unichain Sepolia → agent attempts an out-of-mandate action → Ledger tap denied → admin revokes name → next call fails, key unreachable → Graph MCP: "which agents are live, expiring, and their ERC-8004 reputation" → diagram.

### Concept 5 — **Curveform**: agent-managed SwapVM positions fed by standardized market data

**Pitch.** A 1inch **Aqua/SwapVM** app with a custom opcode implementing a time-decaying limit ("Dutch curve") position; a **Graph**-powered agent re-prices curves from Messari standardized DEX subgraphs and Substreams block triggers; a **Uniswap** v4 pool/Trading API is the external reference and the agent arbitrages/rebalances between Aqua curves and Uniswap; a **Ledger** device approves mandate changes. Positions demonstrated on a Sepolia fork with real transfers.

**Sponsor stack.** 1inch (#15) — SwapVM opcode + positions (scored higher); The Graph (#1, #2) — standardized subgraphs + Substreams + our positions subgraph + MCP; Uniswap (#19) — reference/route + FEEDBACK.md; Ledger (4th) — approvals; Chainlink CRE Confidential (optional) — private strategy parameters in TEE.

**Submit to:** 1inch + Graph + Uniswap.

**Expected value.** 1inch 0.25 × 1,667 = 417; Graph Composable 0.25 × 1,667 = 417; Graph AI 0.15 × 1,667 = 250; Uniswap 0.15 × 1,000 = 150. **EV ≈ $1,230; P(any) ≈ 0.59**; ceiling $6,000.

**Traps.** Deep Solidity (SwapVM opcodes) — the most engineering-risky concept for 9 days; 1inch requires official contracts, on-chain transfers in the demo and real commit history; Uniswap requires FEEDBACK.md + the feedback form; Graph needs live Studio data. It is off-theme for the agent-payments narrative but has the thinnest, most technical field.

### Concept comparison

| Concept | Triad | EV | P(any) | Ceiling | Solidity load | Gate risk | Distinctiveness |
|---|---|---|---|---|---|---|---|
| 1 Tollbooth | Hedera + Arc + Ledger/Graph | 1,400–1,800 | 0.63–0.68 | 8,167–9,334 | Low | Ledger device; Arc diagram | High (multi-rail metering) |
| 2 Quorum | Privy + Arc + Hedera | 1,600 | 0.57 | 9,334 | Low–Med | Privy↔Hedera signer | Medium (ArcFlow/Nominal exist) |
| 3 Coupon | Hedera + World + Privy | 1,580 | 0.58 | 10,000 | Medium (ATS) | World sandbox; ATS learning curve | High in a thin field |
| 4 Mandate | ENS + Ledger + Graph | 1,325 | 0.66 | 8,500 | Medium | Ledger device; crowded niche | Medium |
| 5 Curveform | 1inch + Graph + Uniswap | 1,230 | 0.59 | 6,000 | High | Time | High, technical |

---

## 5. Anti-patterns and the submission checklist

### What gets you disqualified or ignored
- **Mocked or static data where live data is required** — The Graph says it verbatim; Hedera wants a *real paid request* through Blocky402; ENS wants "not just hard-coded values"; 1inch wants on-chain transfers in the demo.
- **Single-commit dumps / no history** — ETHGlobal default-disqualifies; 1inch repeats it. Also forgetting to commit spec/prompt files when using spec-driven AI workflows.
- **Missing artifacts that are explicit gates**: Arc architecture diagram + working backend; World feedback document + Sandbox App usage; Uniswap FEEDBACK.md + form submission; Ledger DX feedback doc; Hedera ATS HashScan verification; Bazantic account handle; Chainlink simulation logs.
- **Wrong facilitator/contracts**: Hedera x402 not through Blocky402; 1inch positions not on official Aqua/SwapVM.
- **Video violations**: > 4:00 or < 2:00 (upload fails), < 720p, TTS voice, sped-up, phone-recorded, music-with-text instead of narration.
- **Applying to more than 3 partners / the wrong pool** (Continuity vs Start Fresh), or forgetting to pick the partner at all ("it is the only way for partners to assess your project").
- **Cosmetic integrations**: an ENS lookup, a single subgraph query, a Privy login with no control, "wallet branding" for Ledger, a placeholder TEE handler. Every sponsor text now says some version of "not a cosmetic add-on".
- **Breadth as a substitute for a thesis** (see §2.2).
- **No README anyone can run**; no per-partner "how we used it" + feedback text in the form.

### Submission checklist (do these as you build)
- [ ] Day 1: create repo, first commit, `.harness/`/`specs/` dir committed; `AI-USAGE.md` started.
- [ ] Day 1: request World Sandbox access (form), Chainlink Confidential access (form), Privy app, Circle Developer Console key + Arc testnet USDC (faucet.circle.com), Hedera testnet account + Blocky402 `/supported` check, Subgraph Studio API key, Uniswap dev dashboard; locate a Ledger device.
- [ ] Architecture diagram (Arc requires it; everyone benefits) — Mermaid in README + PNG.
- [ ] Per-partner section in README: exact files/lines of integration (Uniswap requires this; do it for all three).
- [ ] Feedback docs: `FEEDBACK.md` (Uniswap), `feedback/world.md` (four headings), `feedback/ledger.md`, plus the free-text fields in the submission form.
- [ ] Verified contracts (HashScan for Hedera, Arcscan/Etherscan for Arc/Sepolia) linked in README.
- [ ] Live-data proof in the video: Studio query with API key, Blocky402 settlement tx, Nanopayment tx, Sandbox App proof.
- [ ] Video: 3:30 target, human narration, 1080p, no speed-up; script with timestamps; export and test-upload by Sept 12.
- [ ] Select exactly 3 partners; tick every applicable track within each; select **Start Fresh** pool where asked.
- [ ] Submit by **Sept 13, 12:00 EDT**; final commit before that; do not force-push history afterwards.

---

## 6. Recommendation

**Build Concept 1 — Tollbooth — as the primary submission (Hedera + Arc + Ledger, with Graph as the drop-in if no Ledger device appears by day 2).**

Why: (a) it targets the two largest net-new pools that reward exactly this shape (Hedera "AI & Agentic Payments" $6K wants a *real* x402 service with metering, HTS/HCS, and a directory; Arc wants Agent Stack/Nanopayments and mainnet-ready code) plus Ledger, whose brief literally lists "Key Ring on hosts with no USB port" and "agents that pay for APIs with x402-style patterns"; (b) it is ~90% TypeScript with no Solidity beyond an optional escrow, which is this team's fast lane; (c) the reusable artifact (CLI + buyer SDK + MCP) is the pattern that won for Glassbox402, Tally and Pinout; (d) multi-rail metering is a real technical novelty in a category that is otherwise saturated, which is the only way to win an agent-themed track in 2026 per both the showcase data and the 8,200-project analysis; (e) the demo is inherently visual and verifiable (two explorers, a device tap, a meter ticking).

**Second choice — Concept 3, Coupon (Hedera Tokenization + World Selfie + Privy B2B).** Pick it instead of Tollbooth if you have no Ledger device *and* want to avoid the agent-payments crowd; pick it *in addition* only if the team is three people and splits into two ETHGlobal teams (one hacker cannot be on two projects). Its logic is contrarian in the right way: Hedera Tokenization has the same $6K as Agentic Payments but a much thinner field (ATS deters weekend hackers; Lisbon's winner didn't even use ATS), World Selfie Check is sandbox-gated (thin field, $3.5K), and Privy's B2B track maps naturally onto an issuer treasury with quorum approvals. It also has the highest ceiling ($10K) of the five.

Not recommended for this event: Concept 5 (Solidity-heavy, off-theme, smallest ceiling) and Concept 4 as a primary (most crowded niche). Concept 2 is a reasonable alternative to Tollbooth if the team prefers a B2B fintech narrative, but it will be judged against ArcFlow/Nominal-style payroll apps that already won.

### Nine-day plan for Tollbooth
- **D1 (Sep 4)**: repo + specs; Hedera testnet + Blocky402 hello-402 with `@x402/hedera`; Circle console + Arc testnet USDC + first Nanopayment with the sample buyer; Ledger `ring init` on laptop, `ring decrypt` on a VPS; decide Ledger vs Graph slot by end of day.
- **D2–D3**: `tollbooth wrap` (Hono middleware: metering, `upto` ceiling, HTS-USDC or USDC pricing, HCS checkpoints); buyer SDK with multi-scheme `x402Client`; receipts schema.
- **D4–D5**: Arc side: ERC-8004 seller registration, Agent Marketplace listing, mainnet-config path; Ledger budget-raise flow via DMK signer; Graph subgraph on `arc-testnet` + MCP (even if Graph isn't submitted, it is the dashboard).
- **D6**: frontend dashboard; architecture diagram; README runbook; feedback docs.
- **D7**: hardening, tests, edge cases (ceiling exceeded, rail unavailable, reorg/staleness labels), second seller (inference) for the demo.
- **D8 (Sep 11)**: record video (two takes), cut to 3:30, test upload; write partner form text.
- **D9 (Sep 12)**: buffer; submit the evening of Sep 12, not at noon Sep 13.

---

### Source index
- Prize sheet: `scratchpad/prizes-clean.md` (ethglobal.com/events/ethonline2026/prizes)
- Rules/details: https://ethglobal.com/events/ethonline2026/info/details ; https://ethglobal.com/rules ; https://ethglobal.com/events/ethonline2026
- Continuity track: https://ethdaily.io/ethglobal-introduces-continuity-track
- Showcase (event filters used): https://ethglobal.com/showcase?events=lisbon2026 ; ?events=newyork2026 ; ?events=cannes2026 ; ?events=hackmoney2026 ; ?events=ethonline2025 (pages 1–5)
- The Graph Lisbon 2026 winners: https://thegraph.com/blog/ethglobal-lisbon-2026-winners/ ; networks registry: https://networks-registry.thegraph.com/TheGraphNetworksRegistry.json ; Agent0 subgraphs: https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/ ; x402: https://thegraph.com/docs/en/subgraphs/tooling/x402-payments/
- Hedera x402 bounty winners: https://hedera.com/blog/x402-bounty-on-hedera-winners-announced/ ; Blocky402: https://blocky402.com/docs/networks/
- Arc HackMoney 2026 winners: https://www.arc.io/blog/meet-the-arc-track-winners-from-the-hackmoney-2026-hackathon-and-what-we-learned ; Circle Agent Stack/Nanopayments docs: https://developers.circle.com/agent-stack ; release notes: https://developers.circle.com/release-notes/agent-stack-2026
- Ledger track: https://developers.ledger.com/ethonline ; wallet-cli/Key Ring: https://developers.ledger.com/docs/ai-tools/ledger-cli
- Chainlink Confidential access: https://docs.chain.link/cre/account/confidential-workflows-access
- World Selfie Check sandbox: https://docs.world.org/world-id/sandbox/testing-selfie-check
- Hackathon meta-analysis: https://simbro.medium.com/what-8-200-hackathon-projects-reveal-about-what-actually-wins-f105346ec97c
- Project pages cited: ethglobal.com/showcase/{arcbook-twp2a, glassbox402-qyepd, deeptrace-7fqoz, atlas-pmtqo, ensignv2-34544, mint-and-chill-cwo8n, clawback-vpmw2, maki-564eg, kickoff-aivy-studio-f6o10, nominal-tsiqq, opencompliance-b89x9, agentrankr-xe2vj, planbound-wqxy5, namesake-kq1ez, covenant-6j7sn, kinora-5dtqg, humanmandate-wbx5i}
