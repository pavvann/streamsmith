I’ll read the prize sheet end to end, then verify only the unstable technical premises that materially affect qualification or ranking. I’ll use the Firecrawl search skill for those web checks, as this request explicitly calls for current research.
The Firecrawl skill lives under `~/.agents/`, which you explicitly excluded, so I won’t inspect or use it. I’ll use the built-in web search only if the local prize sheet leaves a ranking-critical premise unclear.
The sheet leaves two implementation questions that affect feasibility: whether Aqua/SwapVM has a hackathon-ready execution surface, and whether Ledger’s Key Ring can support hosted agents without a USB device. I’m checking only those official sources, plus Circle’s Agent Stack boundary.
All qualification language below comes from `prizes-clean.md` (the scraped prize text, not committed). I exclude continuity-only tracks and omit repetitive repo/video requirements from each idea—they remain mandatory.

## 1. Read of the field

Of the advertised $79.5K, about **$59.3K is accessible to a net-new project**; roughly $20.2K is continuity-only.

The message: agents are graduating from chat interfaces into economic actors. Sponsors want the complete stack—live data, discoverable identity, scoped secrets, wallets, autonomous payments, programmable execution, confidential decision-making, and human intervention where appropriate. Parallel to that is institutional finance: compliant tokenized assets, treasury automation, shared liquidity, private risk policies, and real lifecycle operations.

Approximate, non-exclusive net-new concentration:

- **Agent services/payments/tooling:** ~$18.2K—Graph AI, Hedera x402, Arc Agent Stack, Ledger, Bazantic.
- **Tokenized finance/treasury/payment flows:** ~$16.2K—Hedera ATS, Arc finance/mainnet, Privy.
- **DeFi/data primitives:** ~$13K—Graph standards, 1inch Aqua, Uniswap.
- **Agent identity/security:** ~$8K—ENSv2 and Ledger.
- **Human verification:** $3.5K—World Selfie Check.
- **Confidential compute:** $2K—Chainlink CRE.

The dominant judging filter is not “uses AI.” It is **an autonomous system completing a real economic action from live inputs without mocks**.

## 2. Ten ideas, ranked

### 1. Blindside — Private Treasury Autopilot `[novel + buildable]`

A corporate treasury stores its allocation bands, API credentials, and trade-sizing logic inside a Chainlink TEE while Privy enforces organizational approval limits. When confidential policy and live market signals demand a rebalance, an Aqua/SwapVM strategy executes it without publishing the strategy itself.

**Qualifies**

- **1inch — Build an Aqua App:** uses official Aqua/SwapVM contracts; demonstrates “onchain execution of token transfers”; maintains “proper Git commit history.” The position is a confidentially controlled multi-band rebalance strategy. [Requirements](prizes-clean.md:447)
- **Chainlink — Best Confidential Workflow:** a CRE workflow registers `handlerInTee`, processes private allocation bands and an authenticated API response inside the enclave, and demonstrates a successful CRE simulation. [Requirements](prizes-clean.md:756)
- **Privy — Best B2B Financial Product:** Privy creates the treasury wallet; an organization performs a functional approval/treasury operation using policies, signers, or key quorum. [Requirements](prizes-clean.md:639)

**30-second wow:** A market shock arrives; the UI shows no strategy parameters, only a TEE attestation. A second Privy signer approves the generated action and an Aqua token transfer visibly executes.

**Hardest risk:** Safely binding the TEE output to the exact permitted SwapVM calldata and preventing replay/stale-price execution.

**Feasibility:** **4/5.** Actually differentiated. Keep to deployed Aqua opcodes; the current SDK warns that deployed routers support only the Aqua subset, while broader/custom opcodes require your own deployment. [Official SwapVM SDK](https://github.com/1inch/sdks/blob/master/typescript/swap-vm/README.md)

---

### 2. Covenant Zero — Confidential Tokenized Repo Desk `[novel + commercially legible]`

A company posts ATS-issued tokenized treasuries as repo collateral while private covenants, counterparty limits, and margin thresholds run in Chainlink CRE. Privy organization wallets and quorum approvals control issuance, drawdown, margin calls, and collateral release.

**Qualifies**

- **Hedera — Tokenization of Anything:** uses ATS to issue/manage the asset on testnet and demonstrates issuance, compliance configuration, and a lifecycle operation such as freeze, restricted transfer, or distribution. [Requirements](prizes-clean.md:195)
- **Chainlink — Confidential Workflow:** `handlerInTee` processes private exposure limits, covenant parameters, and pricing responses; successful simulation/deployment evidence is shown.
- **Privy — B2B Financial Product:** organization wallet plus quorum/policy controls executes a real treasury approval.

**30-second wow:** Issue a compliant treasury token, move the simulated market price, then watch the confidential engine produce a margin call and ATS freeze/release collateral without revealing the lender’s threshold.

**Hardest risk:** Reliably relaying the CRE result into a Hedera ATS lifecycle transaction without making the TEE look ornamental.

**Feasibility:** **3/5.** Strong institutional story; ATS integration is the schedule risk.

---

### 3. IntentForge — Natural-Language SwapVM Compiler `[strange]`

A user describes a position—“sell gradually above $4,000, stop below $3,500, cap daily volume”—and an agent compiles it into auditable SwapVM bytecode using live standardized market data. Ledger protects provider credentials and requires device approval before the compiled strategy can move funds.

**Qualifies**

- **1inch — Aqua App:** official Aqua/SwapVM, sophisticated programmable position, tests/UI, and real token transfers.
- **The Graph — Composable/Standardized Products:** “build meaningfully on a standardized schema,” consume live provider data, and show the standards leverage through one query pattern spanning multiple protocols. [Requirements](prizes-clean.md:19)
- **Ledger — AI Agents x Ledger:** built on Ledger Agent Stack and `wallet-cli ring`; secrets cannot leak and high-risk fund movement receives human device confirmation. [Track](prizes-clean.md:587)

**30-second wow:** Speak one strategy, see generated bytecode and a plotted execution curve, approve on Ledger, then execute the first live/forked transfer.

**Hardest risk:** Proving compiler correctness; an LLM must produce an intermediate policy AST that a deterministic compiler validates, never raw bytecode directly.

**Feasibility:** **3/5.** Memorable and technical; reduce the language to four or five composable primitives.

---

### 4. Machine Bazaar — Named, Permissioned Agent Commerce `[differentiated agent payments]`

Agents receive expiring ENSv2 subnames containing service endpoints, capabilities, budgets, and delegated record permissions, then discover and purchase Hedera x402 services. Ledger Key Ring releases only the credential needed for that specific service, with device approval above a spend threshold.

**Qualifies**

- **ENS — Best Use of ENSv2:** ENSv2 Sepolia is central; deploys a subname registry using wildcard resolution and Enhanced Access Control for expiring/revocable agent identities. [Requirements](prizes-clean.md:511)
- **Hedera — AI & Agentic Payments:** hosts a live Blocky402-gated service and completes a real paid request end to end on Hedera. [Requirements](prizes-clean.md:121)
- **Ledger — AI Agents x Ledger:** `wallet-cli ring` is the scoped secret broker and Ledger gates irreversible actions.

**30-second wow:** Resolve `researcher.acme.eth`, discover its paid capability, execute an HBAR x402 request, then revoke its ENS permission and show the next request denied.

**Hardest risk:** Making cross-network ENS authorization and Hedera settlement feel like one coherent security model.

**Feasibility:** **3/5.** Ledger enrollment requires a device once, but subsequent Key Ring decryptions can run without the device—useful for VPS agents. [Ledger Wallet CLI](https://developers.ledger.com/docs/ai-tools/ledger-cli)

---

### 5. Ghost Liquidity — Confidential Shared-Liquidity Optimizer `[strange/hard tech]`

One maker balance backs several Aqua strategies while a confidential optimizer reallocates virtual liquidity using live cross-protocol Graph data. Competitors can see fills and reserves but cannot see target bands, venue preferences, or the next rebalance.

**Qualifies**

- **1inch — Aqua App:** official Aqua/SwapVM, sophisticated shared-liquidity position, onchain transfers.
- **The Graph — Composable/Standardized Products:** live standardized queries across multiple protocols; optionally compose a Subgraph with Substreams.
- **Chainlink — Confidential Workflow:** target allocation, routing preferences, and intermediate calculation remain in `handlerInTee`.

**30-second wow:** Two strategies quote against the same wallet inventory; a live liquidity shock arrives and the enclave reallocates exposure before a swap executes.

**Hardest risk:** Maintaining solvency and avoiding unsafe virtual over-allocation across simultaneous strategies.

**Feasibility:** **3/5.** Technically excellent, but invariants and explanations will consume time.

---

### 6. Human Bounty Router `[qualification-safe]`

An autonomous Arc agent posts and settles small USDC research or labeling bounties, while World Selfie Check limits participation to one live person per bounty cohort. Privy creates participant wallets and hides the payment mechanics; Selfie Check is only an anti-abuse eligibility signal, not proof of work quality.

**Qualifies**

- **World — Selfie Check:** uses a compatible credential flow meaningfully for “fairness” and “abuse prevention,” demonstrates through the Sandbox App, and supplies the required feedback document. [Requirements](prizes-clean.md:392)
- **Arc — Agentic Economy:** Agent Stack drives autonomous USDC settlement from clear decision logic, with a frontend, backend, diagram, and working MVP. [Requirements](prizes-clean.md:281)
- **Privy — Best Financial Flow:** creates a wallet and completes a functional transfer/funding flow using generally available features. [Requirements](prizes-clean.md:650)

**30-second wow:** One sandbox human claims and receives an Arc USDC bounty; a second claim from the same verified person is rejected.

**Hardest risk:** Getting remote Selfie Sandbox access early enough.

**Feasibility:** **5/5.** Near-certain qualification, but bounty/escrow apps are familiar.

---

### 7. API Jury — Pay-per-Answer Consensus `[qualification-safe, mildly generic]`

An agent buys independent live risk answers from several services and releases a result only when their signed outputs agree within tolerance. The data comes from The Graph, services are paid through Hedera x402, and a Bazantic Recipe defines the reproducible multi-service workflow.

**Qualifies**

- **Hedera — AI & Agentic Payments:** live Blocky402 service plus one real paid request; add HCS audit trails and service discovery for extra points.
- **The Graph — AI Use Case, Start Fresh:** Graph is the live, load-bearing data source and the agent performs reasoning/decisions rather than printing query results. [Requirements](prizes-clean.md:53)
- **Bazantic — Best Sponsor API Recipe:** create an x402/MPP Gateway, combine it with another sponsor service in one working Recipe, and make the final result depend meaningfully on both. [Requirements](prizes-clean.md:706)

**30-second wow:** The agent receives HTTP 402s, pays three services, displays live Graph-derived answers, rejects one outlier, and commits the consensus trail.

**Hardest risk:** External Bazantic and Blocky402 setup/account reliability.

**Feasibility:** **5/5.** It is still “an agent paying for APIs”; the paid consensus protocol is the only differentiator.

---

### 8. BondOS — A Bond That Refinances Itself `[strange/high risk]`

An ATS-issued bond monitors comparable onchain yields through standardized Graph data and proposes a tender/refinancing operation when savings exceed its covenant threshold. Coupon and settlement flows use Arc USDC, making the asset behave like an autonomous financial program rather than a static token.

**Qualifies**

- **Hedera — Tokenization of Anything:** ATS issuance, compliance controls, coupon/redemption lifecycle operation.
- **The Graph — Composable/Standardized Products:** live standardized vault/lending data across protocols.
- **Arc — DeFi/Onchain Finance:** meaningful Arc/USDC usage and “advanced programmable money flows” with conditional, multi-step settlement. [Requirements](prizes-clean.md:267)

**30-second wow:** Change the market rate; the bond discovers cheaper financing, launches a tender, and distributes a coupon to current holders.

**Hardest risk:** Cross-chain accounting between Hedera ownership and Arc cash settlement.

**Feasibility:** **2/5.** Talk-worthy, but too many lifecycle and interoperability surfaces for nine days.

---

### 9. Namewall — An Agent Capability Firewall

Each agent has an ENSv2 subname whose delegated roles determine which secrets and actions it may request. The firewall combines those permissions with live Graph-indexed agent behavior, while Ledger Key Ring releases a scoped capability only if both checks pass.

**Qualifies**

- **ENS — ENSv2:** permissioned subname registry, Enhanced Access Control, resolver records, revocation and delegation are core.
- **The Graph — AI Use Case:** live Agent0/ERC-8004 or project Subgraph data drives an authorization decision.
- **Ledger — AI Agents x Ledger:** Key Ring serves secrets the agent cannot directly extract; device confirmation gates escalation.

**30-second wow:** A suspicious event lowers an agent’s live reputation; its next credential request fails, while a sibling subname with the correct role succeeds.

**Hardest risk:** Producing a reputation signal that looks substantive rather than arbitrary.

**Feasibility:** **4/5.** Strong infrastructure entry; less visually exciting than money moving.

---

### 10. Payroll Mesh `[qualification-safe, generic]`

A company funds payroll in USDC on Arc, while employees choose destination chain or token and Privy hides wallet, bridge, and swap complexity. Uniswap supplies executable swap routes and the system batches approvals and settlement into an auditable business workflow.

**Qualifies**

- **Arc — DeFi/Onchain Finance:** meaningful Arc/USDC use and multi-step payment/treasury settlement.
- **Privy — B2B Financial Product or Financial Flow:** organization wallet, approval policy, and a functional transfer/bridge/swap.
- **Uniswap — Stack Contribution:** integrates the Uniswap API/AMM, publishes open source, includes `FEEDBACK.md`, submits the feedback form, and points the README to relevant integration code. [Requirements](prizes-clean.md:554)

**30-second wow:** Approve one payroll batch, then watch employees receive different assets/chains from one Arc USDC treasury balance.

**Hardest risk:** Finding live routes where Arc, bridging, and Uniswap all work reliably during the event.

**Feasibility:** **4/5.** Very practical and easy to understand; also very generic.

## 3. Contrarian take

### Likely over-subscribed

- **Hedera x402:** explicit examples, starter PoC, and three $2K awards. Expect dozens of “agent pays inference API” variants.
- **Graph AI:** portfolio copilots, trading agents, and natural-language Subgraph querying are obvious.
- **Arc Agent Stack:** starter kits plus a fashionable agent-payment story; the individual prize is only $1,667.
- **ENS agent identity:** “give an agent a name” is practically written into the prompt. ENSv2 sophistication will separate winners.
- **Privy financial flow:** many submissions will be embedded-wallet frontends with a transfer.
- **Uniswap:** qualification is broad and prize size is only $1K per winner, so integration volume should be high.

### Likely under-subscribed

- **1inch Aqua/SwapVM:** unfamiliar architecture, onchain position mechanics, bytecode/opcode work, and required commit hygiene.
- **Hedera ATS:** substantial SDK and lifecycle work; fewer teams understand repo, compliance, coupons, and restricted transfers.
- **Chainlink Confidential Workflows:** new CRE/TEE tooling, difficult local reasoning, and only $1K per winner discourage shallow entrants.
- **Graph composability/standardization:** materially harder than querying one Subgraph.
- **Ledger Key Ring on hosted agents:** requires real device provisioning and a credible secret-boundary design.

For one coherent submission, the EV-maximizing trio is **1inch + Chainlink + Privy**:

- 1inch provides the hard-technicality moat and a $5K/three-place pool.
- Chainlink provides a low-competition confidential-compute distinction and two winner slots.
- Privy supplies the polished, credible B2B workflow that prevents the project from looking like a protocol demo.
- Blindside can win all three without any integration being decorative.

If maximizing probability rather than upside, substitute **Hedera ATS** for 1inch and build Covenant Zero. Three equal $2K Hedera winners may be easier to hit than first place in Aqua.

## 4. What I would actually build

**Blindside.** It has one clean thesis—companies need autonomous treasury execution without publishing their strategy—and every sponsor is load-bearing: Privy owns authorization, CRE owns confidentiality, Aqua owns execution. It is technical enough for the overall prize, visually demonstrable, and avoids the saturated “agent buys an API” category.

### Nine-day skeleton

- **Sept 4 — Kill-risk spikes:** Complete one Aqua token transfer on a fork/test deployment, one `handlerInTee` CRE simulation, and one Privy controlled-wallet transaction. Drop any sponsor whose primitive is not working by end of day.
- **Sept 5 — Contracts and invariants:** Treasury executor, replay protection, policy-output schema, spending caps, emergency pause; start meaningful commit history.
- **Sept 6 — Aqua position:** Implement one robust strategy—three allocation bands or TWAP plus stop—and exhaustive Foundry tests.
- **Sept 7 — Confidential workflow:** Fetch live authenticated price/volatility data inside the TEE, evaluate private targets, and emit tightly constrained action data.
- **Sept 8 — Privy control plane:** Organization wallet, proposer/approver roles, quorum approval, policy limits, and rejected-action paths.
- **Sept 9 — End-to-end orchestrator:** Signal → confidential decision → Privy proposal → approval → Aqua execution → indexed receipt.
- **Sept 10 — Frontend:** Private policy entry, attestation view, approval queue, before/after allocation, and transaction explorer links.
- **Sept 11 — Adversarial testing:** Stale signals, replay, excessive slippage, rejected quorum, unavailable API, malformed TEE output, and emergency pause.
- **Sept 12 — Freeze features:** Deploy, rehearse from clean accounts, finish architecture diagram, README, tests, Privy explanation, and evidence logs.
- **Sept 13 — Submission buffer:** Record the two-to-four-minute canonical demo, prepare a 30-second backup clip, verify public repo and links, submit well before **9:30pm IST / noon EDT**.

tokens used: 213392
