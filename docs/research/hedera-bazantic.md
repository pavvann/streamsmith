# Cluster: Hedera ($15K) + Bazantic ($3K) — Research & Idea Seeds

Researched 2026-09-04 (ETHOnline 2026, Sept 4–16). Every claim below was verified against the live repo, npm registry, docs page, or live endpoint on this date unless marked *(unverified)*. Raw scrapes live in `../.firecrawl/`.

---

## 0. TL;DR — the facts that change what is buildable

1. **The Blocky402 hosted testnet facilitator is live right now** (`https://api.testnet.blocky402.com`, `/health` = ok, fee-payer `0.0.7162784`), open access, no API key, x402 **v2 only**, supports `hedera:testnet` with **HBAR and any HTS token** (asset = token id). Hosted mainnet also advertises `hedera:mainnet` (fee-payer `0.0.10571514`). Rate limit: **100 req/min/IP, burst 10**.
2. **Hedera's official x402 PoC defaults *testnet* to `x402.org/facilitator`, not Blocky402.** The prize *requires* Blocky402. Anyone who copies the PoC un-edited fails qualification. One env var fixes it.
3. **Hedera just paid out five $1K x402 bounties on Aug 31, 2026.** The judges have already seen: per-second metered sessions with HCS checkpoints (Pinout), an `upto` spending-cap scheme with an on-chain enforcement contract + MCP server (Tally), a single-tx atomic multi-seller split (Qisma), a subscription-quota marketplace (Xorv), and a per-minute VPN (Mystic). The extra-points bullets **nobody has claimed yet**: A2A/ACP negotiation, ERC-8004/HCS-14 identity, UCP discovery, HTS custom fee schedules in the settlement path, and Scheduled Transactions for recurring payments.
4. **"Hedera Harness" is not an SDK wrapper.** It is an AI code-generation harness (`npx hedera-harness run`) that drives Cursor/Claude Code to build features into scaffold-hbar projects from a PRD, then validates in 4 tiers (static → Playwright → adversarial LLM validator → on-chain via ephemeral funded testnet signer + mirror node). A "contribution" means improving *that* loop.
5. **ATS is huge and real** (v8.0.0 SDK/contracts, 100+ diamond facets: ERC-1400 + partial ERC-3643, Hold, Clearing, Lock, KYC, Compliance, Coupon, Dividend, Snapshot, Loan, LoansPortfolio, scheduled tasks) with a **pre-deployed factory + resolver on testnet**. But: (a) the SDK has **no headless private-key mode** (the `CLIENT` wallet is commented out — only MetaMask / Hedera WalletConnect / DFNS / Fireblocks / AWS KMS), (b) **coupons and dividends are records + snapshots only; no on-chain cash leg** ("Direct Transfer" or the separate Mass Payout NestJS+Postgres app), and (c) **there is no secondary market** — the prize text says so explicitly.
6. **ERC-8004 reference registries are deployed on Hedera testnet** at the vanity addresses `IdentityRegistry 0x8004A818BFB912233c491871b3d84c89A494BD9e`, `ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713` (also the same addresses on Arc testnet). HCS-14 (UAIDs) and HCS-10 (agent messaging) are HOL *drafts* with a working SDK (`@hol-org/standards-sdk` / `@hashgraphonline/standards-sdk` 0.1.186, plus `@hol-org/rb-client` registry broker).
7. **Bazantic signup is open** (Google / GitHub / email code at `bazantic.com/signup`; the "waitlist" on `/developers` is marketing). It is a hosted platform, not an SDK: you submit an OpenAPI spec, "Baz AI" generates a hosted MCP server + x402/MPP payment gateway + agent docs; a **Recipe** is a custom multi-step tool call (when/why/how to use a service). **One of the three Bazantic prizes is Continuity-only.** A fresh team can win at most $1K + $1K (ranked).
8. **No Hedera testnet reset is scheduled in the hackathon window** (status.hedera.com: none Sept 1–20; testnet upgraded to v0.76.3 on Sept 1). Circle's faucet gives 20 testnet USDC (`0.0.429274`) per address per 2h on Hedera.
9. **Hedera Scheduled Transactions**: max expiry **62 days**, `waitForExpiry` gives time-triggered execution; the Agent Kit's transfer tools already accept "schedule it and wait for expiry" in natural language; HIP-1215 lets Solidity contracts `scheduleCall()` themselves (HSS at `0x16b`) — **testnet/mainnet only, not on forks/Anvil**.

---

## 1. Technology research (per component)

### 1.1 Blocky402 facilitator (blocky402.com)

| | |
|---|---|
| **What** | Independent x402 facilitator by BlockyDevs (the team that also maintains Ledger's Hedera app). NestJS + Postgres. Registers one `exact` scheme per family via official `@x402/evm`, `@x402/svm`, `@x402/hedera`. |
| **Endpoints** | `GET /supported`, `POST /verify`, `POST /settle`, `GET /health`. Body: `{x402Version:2, paymentPayload, paymentRequirements}`; also accepts `X-PAYMENT` header form and legacy `paymentHeader`. |
| **Hosted testnet** | `https://api.testnet.blocky402.com` — Polygon Amoy (USDC/USDT), Solana Devnet, **Hedera testnet (HBAR + HTS tokens)**. Live-verified 2026-09-03 19:20 UTC. |
| **Hosted mainnet** | `https://api.blocky402.com` — **only** `hedera:mainnet` advertised (fee-payer `0.0.10571514`). Docs say mainnet needs `X-Api-Key: b402_<64hex>`; the `/supported` call worked without one. |
| **Hedera specifics** | Client must put `extra.feePayer` = `signers["hedera:*"][0]` into requirements or the SDK throws before signing. Client builds a `TransferTransaction` with `transactionId.accountId = feePayer`, signs it partially; facilitator co-signs and submits. `settle.transaction` returns `0.0.<feePayer>@<secs>.<nanos>`. Error surface: `errorMessage: "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"` if the *receiver* hasn't associated the HTS token. |
| **Maturity** | "Testnet MVP Ready". Version 1.0.0. Works. The **GitHub link (`github.com/blockydevs/blocky402`) is a 404** — the "Open Source (MIT), self-hostable" claim is not currently verifiable; the org has no such public repo. Self-hosting is possible via `@x402/hedera/exact/facilitator` (as scaffold-hbar's `x402-pay-per-use` template does), but **the prize requires settlement through Blocky402**. |
| **Time to first tx** | ~30 min if you have two ECDSA testnet accounts: `npm i @x402/hedera @x402/fetch @x402/core @x402/express` (all 2.24.0), copy the PoC's `x402.ts`, set `X402_TESTNET_FACILITATOR_URL=https://api.testnet.blocky402.com`. |
| **Gotchas** | Rate limit 100/min/IP (burst 10) — a "settle every 3 seconds" streaming demo with 3 agents will 429. No `upto` scheme advertised on Hedera (only `exact`), though the settle response schema mentions `amount` for partial-settlement schemes. |

### 1.2 x402 on Hedera (`@x402/hedera`, exact scheme, hedera-dev PoC)

- **Spec**: `specs/schemes/exact/scheme_exact_hedera.md` in x402-foundation/x402. Payload = base64 partially-signed `TransferTransaction`. Facilitator checks: direct transfer only, net-zero for all other assets, fee-payer not a net sender, signature valid vs on-chain key, exact amount reaches `payTo`, payer balance sufficient. Replay protection = facilitator idempotency (tx IDs are unique by design). Token association is a known failure mode, not pre-checked.
- **Packages** (npm, 2026-09-03): `@x402/core|express|fetch|hono|next|mcp|hedera` all **2.24.0**. `@x402/hedera` exports `./exact/client`, `./exact/server`, `./exact/facilitator`. `@x402/mcp` exists (paywalled MCP tools).
- **hedera-dev/x402-inference-pay-per-request-poc** (pushed 2026-07-15): Express service with 4 routes (testnet/mainnet × USDC/HBAR) proxying LM Studio; agent server using `@hashgraph/hedera-agent-kit-ai-sdk` `wrapLanguageModel`; SSE payment status; flat $0.001/request. Its own "Limitations" section is a to-do list of the extra-points bullets: *no per-token metering, no streaming, single wallet*. Testnet USDC `0.0.429274`, mainnet USDC `0.0.456858`. HBAR asset id `0.0.0`, amounts in tinybars (1 HBAR = 1e8).
- **Scaffold-hbar `templates/x402-pay-per-use`**: pay-per-download file marketplace, MinIO + self-hosted facilitator + `FileRegistry` contract, HashPack signs via WalletConnect `hedera_signTransaction` (sign-only). Good reference for browser-wallet x402; not Blocky402.
- **hedera-skills `x402-payments` skill** (native-services-js): documents self-hosted facilitator wiring. **Open PR/issue #28** documents five *silent* failure modes (see Traps). Note the skill is listed under `unmerged-skills` in the harness's `skills-index.json`, so the harness generator does not discover it.
- **hiero-cli 1.2.0** has `hcli x402 sign --challenge "<PAYMENT-REQUIRED>"` (KMS-held key, returns `PAYMENT-SIGNATURE` header; agent does the HTTP) and a `schedule` plugin (`--scheduled <name>` wraps any command in a `ScheduleCreateTransaction`; max 62 days).
- **What the judges want** (from the bullets + the winners): not "another 402 that returns JSON". They want *metering* (per token/second/row), *multi-party* (A2A/ACP negotiation), *identity* (ERC-8004/HCS-14), *discovery* (UCP or directory), *HTS tokens & fee schedules in the settlement path*, *HCS audit trail*, *Scheduled/streamed payments*. The five winners covered metering, caps, atomic splits, marketplace, per-minute. The rest is open.

### 1.3 Hedera Agent Kit v4 (`@hashgraph/hedera-agent-kit` 4.1.0)

- Monorepo: core + adapters for LangChain, Vercel AI SDK, ElizaOS, **MCP** (`@hashgraph/hedera-agent-kit-mcp` 1.1.0, `HederaMCPToolkit extends McpServer`), Google ADK, `create-hedera-agent` scaffold. Apache-2.0. Active (pushed 2026-09-03), **148 open issues**.
- Core tools are thin: transfer HBAR (supports **scheduled** via NL: "schedule it … wait for its expiration"), create account/topic/FT/NFT, airdrop, submit topic message, allowances, `SIGN_SCHEDULE_TRANSACTION_TOOL`, `SCHEDULE_DELETE_TOOL`, queries (balances, token info, topic messages, exchange rate, tx records).
- Execution modes: `AUTONOMOUS`, `RETURN_BYTES` (non-custodial MCP), `CUSTOM_EXECUTE_TX` / `CUSTOM_RETURN_BYTES` (pluggable `TransactionStrategy`: TEE, MPC, KMS, human-in-the-loop).
- **Hooks & Policies**: `HcsAuditTrailHook(tools[], topicId)` writes every tool execution to an HCS topic (warns about HIP-991 paid topics); `HolAuditTrailHook`; `MaxRecipientsPolicy`, `RejectToolPolicy`. Custom `AbstractPolicy` can block execution — this is how you build agent spend limits.
- **No x402 plugin in core**; third-party plugin list lives in Hedera docs. Plugin authoring guide + `examples/plugin` + hedera-skills `agent-kit-plugin` skill make a custom x402/ERC-8004 plugin a half-day job.
- Gotcha: EVM/ERC tools require an **ECDSA** operator key. `PrivateKey.fromString()` is deprecated — use typed constructors; mismatch = `INVALID_SIGNATURE`.

### 1.4 Hedera Harness (`hedera-harness` 1.2.2 on npm; 2.0.0-rc.4 on `next`) + Hedera Skills

- **What it is**: TypeScript CLI. `init` clones scaffold-hbar (or adopts an existing repo) and provisions `.harness/{spec.yaml, prd.md, validators/}`. `run` executes attempts of GENERATE (Cursor `agent` or Claude Code `claude`) → ASSERT (files, static needles, secret scan, `yarn build`) → SMOKE (dev server + Playwright routes) → EVALUATE (adversarial validator agent with Playwright MCP grades numbered assertions in an acceptance contract) → optional **Tier 3.5 chain validation** (provisions an ephemeral funded ECDSA testnet account, injects it as scaffold's burner wallet, verifies effects via mirror node, sweeps HBAR back). Repairs with cheaper model, escalates when an attempt "fixed nothing". Everything on `harness/run-*` git branches with checkpoint commits. **A run costs 40 min – 2 h.**
- **Repo**: pushed 2026-09-03, 1 star, 5 open issues/PRs: #37 release rc.4 (ships Playwright as dep), **#16 doctor should verify the chain operator on-chain**, **#15 ephemeral signer has zero auto token associations → any HTS/USDC-receiving template fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`** (PR proposes `setMaxAutomaticTokenAssociations(-1)` + sweep fallback), #8 HOL Guard plugin-scanner validator. `docs/prds/` ships three PRDs incl. **`x402-metered-api.md`** (a Blocky402-settled x402 template spec with HashPack + burner dual signer and HCS receipts).
- **Hedera Skills** (`hedera-dev/hedera-skills`, 26 stars, marketplace for Claude Code / `npx skills add`): plugins `agent-kit-plugin`, `system-contracts` (HTS `0x167`, HSS `0x16b` incl. HIP-1215), `oracles` (Chainlink/Pyth/Supra on Hedera), `cross-chain` (Axelar/LayerZero/CCIP), `native-services-js` (HTS/HCS/**x402**), `hiero-cli`, `hackathon-helper` (PRD + submission validator against Hedera's 7 judging criteria), `hedera-harness` (spec authoring), `dev-intelligence`. Open issues: **#17 asks for an HCS-14 agent identity/registration/discovery skill** (literally citing this ETHGlobal track), #16 mirror-node skill, #28 x402 silent failures.
- **What "improve the harness" can mean** (from the bullets): new service coverage (validators that assert HTS/HCS/x402 effects), a **local-development mode removing testnet round trips** (Tier 3.5 currently needs testnet; scaffold-hbar has `yarn hardhat:chain` fork but HSS isn't on forks), a port to another language/runtime, fixing rough edges (#15, #16), before/after DX evidence.
- **Language coverage**: TS only; validators assume Yarn/npm + Next.js; Tier 3.5 uses `@hiero-ledger/sdk` JS. There is no Python/Go/Rust/Java target although Hedera has SDKs for all of them.

### 1.5 Agent identity: ERC-8004, HCS-14, HCS-10

- **ERC-8004** (Trustless Agents): `IdentityRegistry` is ERC-721; token URI → `/.well-known/agent-card.json`-style registration file; `ReputationRegistry` for feedback. **Deployed on Hedera testnet** (`erc-8004/erc-8004-contracts` README): Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. Same vanity addresses on **Arc testnet**. Registering = one `ContractExecute` via ethers on `https://testnet.hashio.io/api` (chain 296). The Graph lists "Agent0/ERC-8004 subgraphs" but has **no hosted Hedera indexing**.
- **HCS-14** (Universal Agent ID, HOL, *Draft*): `uaid:aid:<base58 sha384>;uid=…;registry=hol;nativeId=hedera:testnet:0.0.x` or self-sovereign `uaid:did:…;proto=hcs-10;nativeId=…`. Skills enum. For EVM agents `nativeId` is CAIP-10 (`eip155:296:0x…`) so ERC-8004 agents get UAIDs deterministically. DNS TXT proof (`_uaid.<domain>`) supported by the registry broker.
- **HCS-10** (OpenConvAI, *Draft*): registry topic (HCS-2) for discovery, per-agent inbound/outbound topics, private connection topics with threshold keys, **optional HIP-991 fee-gating of connection requests**. This is Hedera-native A2A transport.
- **Tooling**: `@hol-org/standards-sdk` (legacy `@hashgraphonline/standards-sdk` 0.1.186) — HCS-10 client, HCS-11 profiles, `RegistryBrokerClient` (`https://hol.org/registry/api/v1`) with `registerAgent()`, `updateAgent({additionalRegistries: ['erc-8004:…']})`, `search()`, x402 credit top-ups. `standards-agent-kit` (Hedera Agent Kit plugin for HCS-10) exists but last pushed 2025-10. Registry broker registration uses credits; "402 Payment Required" when depleted.
- **Time to first identity**: ERC-8004 mint on Hedera testnet ≈ 1 hour (ethers + ABI). HCS-14 UAID generation is pure hashing (30 min). HCS-10 registry + topics ≈ half a day with the SDK.

### 1.6 Scheduled Transactions (HAPI + HSS)

- **HAPI**: `ScheduleCreateTransaction().setScheduledTransaction(tx).setExpirationTime(t).setWaitForExpiry(true).setAdminKey(k).setPayerAccountId(p)`. Executes when signatures collected or, with `waitForExpiry`, **at** expiry. **Max 62 days (5,356,800 s)**. No `freezeWith` needed. Omitting admin key = undeletable. Identical inner tx → `IDENTICAL_SCHEDULE_ALREADY_CREATED` (vary memo/nonce). Creator, payer, admin must sign. Verify via mirror node `/api/v1/schedules/{id}`.
- **HSS system contract `0x16b`** (HIP-755/756/**1215**): `scheduleCall(target, expirySecond, gasLimit, value, data)`, `scheduleCallWithPayer`, `executeCallOnPayerSignature`, `hasScheduleCapacity(expiry, gas)` (throttled per second → `SCHEDULE_EXPIRY_IS_BUSY`), `authorizeSchedule`, `signSchedule`, `deleteSchedule`. **Non-reverting** — check return codes. Recurring = the scheduled call re-schedules itself. **Not available on local forks/Anvil**; scaffold-hbar `templates/payments-scheduler` (Foundry `ScheduledVault` + `IExecutionStrategy`) is the reference.
- Implication: "recurring payments" can be done two ways — pre-sign N future `TransferTransaction`s (HAPI, ≤62 days) or a self-rescheduling contract (HIP-1215).

### 1.7 HTS custom fees + HIP-991 fee topics

- HTS: `CustomFixedFee` (sender pays, HBAR or HTS, collector account), `CustomFractionalFee` (receiver pays unless `net_of_transfers`; min/max), `CustomRoyaltyFee` (NFT only, fallback fee). **Max 10 fees/token**, nest ≤2 levels, treasury exempt, `setAllCollectorsAreExempt`. Royalties are "strictly a convenience".
- **Key insight for x402**: a fractional fee on an HTS settlement token means **every x402 payment automatically pays a protocol/marketplace take-rate with no smart contract** — the facilitator-submitted `TransferTransaction` triggers it. The exact-scheme verifier requires "exact amount reaches payTo"; with a fractional fee the receiver gets amount − fee unless `net_of_transfers=true` (then sender pays extra). Test this early: it's the single most elegant hit on the "HTS tokens or custom fee schedules in the settlement path" bullet.
- **HIP-991**: topics with a fixed submit fee (HBAR or FT) paid to the topic operator; submit-key holders exempt; payers set max fee. Live since testnet v0.59. Pinout used it as a costly-to-forge settlement anchor. Agent Kit's `HcsAuditTrailHook` warns about it.

### 1.8 Asset Tokenization Studio (`hashgraph/asset-tokenization-studio`)

- **Structure**: `packages/ats/contracts` (Solidity, Hardhat, diamond; `@hashgraph/asset-tokenization-contracts` 8.0.0 on npm), `packages/ats/sdk` (`@hashgraph/asset-tokenization-sdk` 8.0.0; DDD/CQRS; tsyringe), `apps/ats/web` (React 18), `packages/mass-payout/*` + `apps/mass-payout/{backend NestJS+Postgres, frontend}`, Docusaurus docs. Audited (PDF in repo). Apache-2.0.
- **Standards**: ERC-1400 (partitions) + **partial ERC-3643/T-REX** (`enableERC3643`, `setCompliance`, `setIdentityRegistry`, `addAgent`, `setOnchainID`, `forcedTransfer`, `freezePartialTokens`, `setAddressFrozen`, `recovery`). Also ERC-20 Permit/Votes facets.
- **Asset types via Factory**: Equity (rights flags, dividends, voting, splits), Bond (coupons, maturity, `fixedRate`, `kpiLinkedRate`, `interestRate`, `amortization`, `principal`), plus scripts for **Loan, LoansPortfolio, Deposit** tokens (layer_2). Reg S / Reg D 506(b)/(c) regulation metadata, country allow/deny lists.
- **Lifecycle primitives**: `Hold` (escrow-controlled lock; escrow executes/releases; anyone reclaims after expiry; held balance still earns coupons), `Clearing` (validator-approved transfers, one-way activation), `Lock`, `transferAndLock`, `Pause`, `ControlList`, external KYC/pause/control lists, KYC grant with VC data (`@terminal3/verify_vc`), SSI management, `Snapshot`, `ScheduledCrossOrderedTasks` (internal queue triggered lazily by `triggerPendingScheduledCrossOrderedTasks()`), `ProceedRecipients` (who receives issuance proceeds), `kpi` facets (KPI-linked coupon rates — oracle hook!).
- **Coupons/dividends**: `setCoupon(rate, recordTimestamp, executionTimestamp)` records + snapshot at record date; `getCouponAmountFor(couponId, holder)` view. **No on-chain payout function** — docs: "Direct Transfer (<100 holders) / Mass Payout (>100)". `PAYMENT_PROCESSOR_ROLE` exists. So the "coupon payment" leg is *yours to build* — an obvious place for Scheduled Transactions.
- **Testnet deployment**: docs `deployed-addresses.md` (v4.0.0, 2026-01-22): BLR proxy `0.0.7707874`, Factory proxy `0.0.7708432`. **But** `apps/ats/web/.env.example` points to a newer June-2026 deployment: Resolver `0.0.9212226`, Factory `0.0.9213391`, Equity configId `…01`, Bond configId `…02`; `deployments/hedera-testnet/newBlr-2026-06-12*.json` has the full facet map. Use the newer pair (matches SDK 8.x) and pin config versions.
- **SDK usage**: `Network.init(InitializationRequest{network, mirrorNode, rpcNode, configuration:{resolverAddress, factoryAddress}})` → `Network.connect(ConnectRequest{wallet: SupportedWallets.HWALLETCONNECT | METAMASK | DFNS | FIREBLOCKS | AWSKMS})` → `Equity.create(CreateEquityRequest)`, `Bond.create`, `Security.transfer`, `Kyc.grantKyc`, hold/clearing ops. **There is no plain-private-key `Client` adapter** (commented out in `Wallet.ts`). For a Node agent/backend either (a) use ethers + the diamond ABIs from `@hashgraph/asset-tokenization-contracts` against `https://testnet.hashio.io/api` (this is exactly what the MetaMask path does under the hood via `RPCTransactionAdapter`), or (b) the AWS KMS adapter. The prize allows "SDK, contracts, web application, or a combination" — direct contract calls qualify.
- **Web app**: React, needs WalletConnect project ID; connect HashPack/MetaMask; create bond/equity, KYC, corporate actions, holds, clearing. Good for the *issuer* half of a demo video.
- **Time to first token**: If you drive the web app with MetaMask on testnet: ~1–2 h (factory deploy of a bond is a heavy multi-facet diamond → budget tens of HBAR). Headless via ethers: ~half a day to get `deployBondToken`-equivalent call encoded correctly (study `scripts/domain/factory/deployBondToken.ts`).
- **Gotchas**: Hedera JSON-RPC `eth_getLogs` limited to a **7-day window** — index via mirror node or view functions; balance adjustments change `balanceOf` without emitting events until next op; `enableERC3643` requires compliance module + identity registry addresses (you can point at ERC-8004? no — T-REX `IIdentityRegistry` interface; you'd deploy a minimal one or reuse ATS's). Node ≥ 20.19.4; monorepo is npm-workspaces (fine to `npm i` the two packages in a pnpm project).

### 1.9 Bazantic (bazantic.com)

- **What it is**: hosted "agent gateway" for API providers. You submit an OpenAPI spec (or docs + test key); **Baz AI** generates and hosts: an **MCP server** (atomic tools, skills file, `llm.txt`), an **x402 / MPP payment gateway** (per-call payments; OFAC screening; "you receive a wallet you control"), scoped agent credentials, generated OpenAPI/RPC specs, custom domains. **Recipes** = custom tool calls that encode *when, why, how* to use a service, possibly chaining several services ("Uniswap GET /swap → 1inch trace"). Dashboard shows inbound/outbound calls, spend, P95 latency, live feed (so developers are also *consumers* paying providers through it).
- **MPP** = Stripe/Tempo **Machine Payments Protocol** (launched Mar 18 2026): HTTP 402 + session layer (pre-authorized spending limit, "open a tab"), rails: stablecoin on Tempo, cards via Visa, Lightning. Bazantic abstracts both x402 and MPP.
- **Access**: `/signup` works (Google, GitHub, email code). Robots.txt disallows all; no public docs site (`/docs` → login). The provider page says "we review every application personally … 2 business days" — **that's the marketing funnel; the hackathon path is the self-serve signup**, but expect the gateway generation to be semi-automated. **Sign up on day 1** and create a throwaway gateway to learn the shape before committing.
- **Eligible prizes for a fresh team**: "Best Recipe that uses Sponsor APIs" ($500/$300/$200) and "Agentify a new API" ($500/$300/$200). "Help an Agent Use Your Hackathon Project" ($500×2) is **Continuity-only**. All require: account, an x402/MPP Gateway *for your project*, a Recipe, a screen recording, and your Bazantic username in the submission. "Agentify" additionally requires the API to be **not already on Bazantic and not a sponsor API**.
- **Judge signal**: reusable recipes ("not a one-off connection created only for the demo"); the result must "depend meaningfully on both services"; for the (Continuity) A/B prize they want a controlled experiment with the Recipe as the only variable — even though we can't enter that one, doing the A/B and showing it costs nothing and reads as rigor.
- **Time to first gateway**: unknown until logged in; budget half a day and a fallback (if Baz AI generation stalls, the MCP server can be self-hosted with `@x402/mcp` and the *Recipe* still authored on Bazantic).

### 1.10 Cross-sponsor facts that matter for combos

- **Chainlink**: Data Feeds exist on Hedera testnet (chain 296) per hedera-skills `oracles`; CRE Confidential Workflows (TEE handler) is the Chainlink prize — must cause an on-chain state change.
- **Ledger**: `@ledgerhq/wallet-cli` "ring" = secrets encrypted under Ledger-derived keys; signing covers BTC/EVM/Solana only — **no Hedera signing**. A Hedera ECDSA key can be *stored* in the ring and decrypted headlessly (`WALLET_PASS`), which fits "agents that use secrets they cannot leak" but not "device signs the payment".
- **Arc**: ERC-8004 registries at the same addresses on Arc testnet; Circle Agent Stack / Nanopayments for USDC. ARC prize wants a diagram + frontend + backend and (for the $3.5K one) mainnet-ready by Sept 30.
- **ENS v2 (Sepolia)**: ENSIP-25 (agent registry name verification) and ENSIP-26 (agent text records) — an ENS name can point at an ERC-8004 id / UAID / x402 endpoint.
- **World**: Selfie Check ($3.5K, open) = low-assurance human credential; AgentKit prize is Continuity-only.
- **Privy**: server wallets with policies/quorums; EVM-native. Hedera x402 needs a secp256k1 signature over the Hedera tx body — Privy `rawSign` *might* work; treat as risky.
- **The Graph**: no hosted Hedera indexing. Graph is load-bearing only as *data being sold* (Subgraph MCP / Substreams behind your x402 endpoint), not as Hedera indexer.
- **1inch Aqua/SwapVM, Uniswap**: no Hedera presence; combos would be bolted-on. Skip.

---

## 2. Reading the judges

| Track | Qualification floor | What earns the $2K (flat, up to 3 teams) |
|---|---|---|
| **AI & Agentic Payments ($6K)** | Live x402 service on Hedera testnet **settled via Blocky402**; an agent that completes ≥1 real paid request; README with payment-flow architecture; ≤5-min video showing the paid request | Metering not flat pricing; A2A/ACP negotiation; ERC-8004/HCS-14 identity; UCP/directory discovery; HTS tokens or **custom fee schedules in settlement**; HCS audit; **Scheduled/streamed payments**. Five winners already did metering/caps/splits/marketplace/per-minute — differentiate on identity + negotiation + fees + schedules. |
| **Improve the Harness ($2K)** | Open PR (unmerged OK) or a new harness "extending or inspired by it"; README/PR description; ≤5-min video of the improvement working | New service coverage, fewer LOC to first tx, tests/docs/examples, **another language/framework**, **before/after DX evidence**. Judges are the harness authors — fix what they already filed (#15, #16), promote the x402 skill, add a local mode. |
| **Tokenization of Anything ($6K)** | Use ATS (SDK/contracts/web/any combo) to issue or manage an asset on testnet; verified contracts on HashScan; ≤5-min video with issuance + config + ≥1 lifecycle op | **Secondary market (explicitly missing)**; KYC/freeze/pause/transfer restrictions in use; fees/coupons/dividends/royalties; **oracle for pricing/NAV**; **Scheduled Transactions for vesting/coupons/maturity**; **upstream contributions**. "Real asset classes and real lifecycle" > "a token with a name". First idea bullet is literally *tokenized collateral for repo*. |
| **Continuity ($1K)** | Pre-existing Hedera project | Skip unless the team has one. |
| **Bazantic ($2K reachable)** | Account + Gateway for your project + Recipe + recording + username | Multi-service recipes other builders can reuse; a genuinely new API agentified; the result depends on both services. |

---

## 3. Idea seeds

Legend: 🟢 safe/clearly qualifies · 🟡 mid · 🔴 "holy shit if it works". "Hits" lists qualification + extra-points bullets touched. Amounts assume flat $2K per Hedera track qualification.

---

### 🟢 S1 — **Coupon Clock**: an ATS bond whose coupons and redemption pay themselves

**Pitch.** Issue a real fixed-rate bond through ATS on testnet (Reg D 506(c), KYC-gated, country allow-list), grant KYC to three investor accounts, mint, then let *Coupon Clock* do the part ATS leaves to spreadsheets: it reads each coupon's record-date snapshot (`getCouponAmountFor` per holder), computes the USDC owed, and **pre-schedules the payments as Hedera Scheduled Transactions** (`waitForExpiry` at `executionTimestamp`) from an issuer treasury account — and schedules the principal redemption at maturity the same way. A Chainlink Data Feed on Hedera testnet prices the bond's NAV in the dashboard and drives an optional KPI-linked coupon rate (ATS has `kpiLinkedRate` facets). Investors watch coupons land on HashScan at the exact tick with nobody clicking anything.

**Hits.** Tokenization ✅ (ATS issuance + compliance + lifecycle). Extra: compliance controls (KYC grants, a freeze demo, a failed transfer to a non-KYC account), coupon distributions, **oracle for pricing/NAV**, **Scheduled Transactions for coupon payments and maturity settlement**. Upstream: a PR adding a `CouponPayoutScheduler` example/doc to ATS (`docs/ats/developer-guides/`) — the docs literally say payout is "Direct Transfer" with no code.

**Wow moment.** Split screen: HashScan schedule entity flips to *executed* at T+0; three investor USDC balances tick up; the bond's `getCouponFor` shows paid; a frozen investor's coupon is held back (freeze + `PAYMENT_PROCESSOR_ROLE` logic). Zero human actions on camera.

**Hardest risk.** Getting the ATS bond deployed headlessly (no private-key SDK adapter) — mitigate by issuing through the ATS web app + MetaMask in the video and doing the *payment* leg from Node via `@hiero-ledger/sdk`. Second risk: 62-day schedule max means a "3-year bond" demo must use compressed timelines (coupons every 10 minutes).

**Load-bearing combos.** Chainlink (Data Feed for NAV; or a CRE Confidential Workflow that computes a *private* KPI-linked rate in a TEE and writes it on-chain → qualifies the $2K Chainlink track too). World Selfie Check as the human-presence gate before `grantKyc` (eligibility signal).

**Build estimate.** 4–6 days for 1–2 people.

---

### 🟢 S2 — **Meterwise**: pay-per-token inference metered, not flat, with a provable bill

**Pitch.** The Hedera PoC charges $0.001 flat and says so in its limitations. Meterwise is an x402-gated inference proxy (any OpenAI-compatible backend) where the **402 price is computed per call** from prompt tokens + `max_tokens` × per-token rate, settled through **Blocky402 in HTS USDC**, and any unused `max_tokens` is refunded as a signed HCS credit note the buyer can redeem against the next call (so the buyer's effective cost is per *actual* token). Every settlement writes a compact receipt to an **HIP-991 fee-charging HCS topic** (costs the seller real HBAR to write → can't be spam-forged). The service registers itself in the **ERC-8004 IdentityRegistry on Hedera testnet** and publishes an HCS-14 UAID + A2A agent card; the consumer is a Hedera Agent Kit (MCP) agent with a `MaxSpendPolicy` that budgets across two Meterwise providers by advertised rate. `npx meterwise audit --topic 0.0.x` recomputes any bill from the mirror node.

**Hits.** Agentic Payments ✅ (live Blocky402-settled service + consuming agent). Extra: **per-call metering**, **HTS token in settlement**, **HCS audit trail**, **ERC-8004/HCS-14 identity**, directory (ERC-8004 + UAID). Bazantic "Agentify a new API": expose the same endpoint through a Bazantic Gateway + Recipe ("cheapest inference for this prompt across providers").

**Wow moment.** Agent asks for a 2,000-token answer, pays for 2,000, model returns 640; the credit note appears on HCS and the next request's 402 is visibly discounted; the audit CLI reproduces the bill to the tinybar.

**Hardest risk.** Fitting metering into `exact` (pay-before-compute) without inventing a new scheme — the credit-note pattern keeps Blocky402 as the settler. Rate limit (100/min/IP) constrains the "budgeting across providers" demo — keep it to a few dozen calls.

**Combos.** The Graph (sell Subgraph-MCP-backed data endpoints through the same meter → Graph "agent pays per query with x402" track); Ledger Key Ring holding the agent's ECDSA key ("secrets it cannot leak").

**Build estimate.** 3–4 days.

---

### 🟢 S3 — **Feedwire**: the smallest thing that qualifies, done twice (Blocky402-native + Bazantic)

**Pitch.** Wrap one useful, not-yet-agentified dataset as an x402 metered feed (priced per row/per query) on Hedera settled via Blocky402, then expose the *same* API through a **Bazantic x402/MPP Gateway + hosted MCP server**, and write a **Recipe** that chains it with a sponsor API (e.g., Chainlink price → Feedwire's HCS agent-spend feed → "USD value of everything this agent paid today"). Candidate dataset: a Hedera mirror-node-derived "x402 receipts index" (all HIP-991/HCS x402 receipt topics across the ecosystem, normalized) — genuinely new, useful to every other team, and *about* Hedera. Show the same agent buying via both rails.

**Hits.** Agentic Payments ✅ (minimal but real: metered data feed, HTS, HCS). Bazantic **Agentify a new API** ✅ and **Best Recipe with sponsor APIs** ✅. This is the insurance policy: it qualifies for three prizes in ~2 days and any bigger idea can sit on top of it.

**Wow moment.** One curl → 402 → paid → data, then the identical tool called from Claude Desktop via the Bazantic-hosted MCP server, with the Bazantic dashboard's spend meter ticking.

**Hardest risk.** Bazantic being a semi-manual black box (gateway generation reviewed by humans). Mitigation: sign up day 1; keep the native Blocky402 path as the qualifying artifact.

**Combos.** Chainlink Data Feed (in the recipe), The Graph (as an alternate data source).

**Build estimate.** 2 days.

---

### 🟡 M1 — **Harness: `chainValidation.network: local` + an `x402` validator + the two open bugs**

**Pitch.** The harness's Tier 3.5 is the only stage that needs testnet, and it is also where two filed bugs live. Contribution PR set: (1) **local mode** — `network: local` boots `hiero-local-node` (Docker) or reuses scaffold's `yarn hardhat:chain`, provisions the ephemeral signer there, verifies via the local mirror node, no faucet, no round trips (the "testing or local-development mode" bullet); (2) a new deterministic **`validators/x402.json`** stage that hits the app's paid route, asserts a well-formed v2 `PAYMENT-REQUIRED` (asset/amount/feePayer sanity — catching skills-issue-#28's silent redenomination), pays with the ephemeral signer through a configurable facilitator (self-hosted locally, Blocky402 on testnet), and verifies settlement on the mirror node; (3) land **#15** (`setMaxAutomaticTokenAssociations(-1)` + sweep fallback) and **#16** (`doctor` checks operator balance/key type on-chain) if still open; (4) promote `x402-payments` from `unmerged-skills` to `skills` in `skills-index.json` so the generator can find it; (5) run the shipped `x402-metered-api.md` PRD end-to-end before/after and publish the timing + attempt diff as DX evidence.

**Hits.** Harness ✅ (meaningful PR). Extra: **new service coverage (x402, HTS)**, **tests + docs**, **before/after evidence**, fewer round trips. Synergy: whatever x402 service you build for S2/S3 becomes the harness's fixture.

**Wow moment.** `npx hedera-harness run` on the x402 PRD with `network: local` completes a paid 402 → 200 in the validator log with zero testnet calls; then the same recipe on testnet settles via Blocky402 and the validator prints the HashScan link.

**Hardest risk.** Harness runs take 40 min–2 h and need Cursor/Claude CLI; local Hedera node is heavy (Docker, several GB). Keep the PR surgical and test the validator in isolation (`validate` subcommand) rather than full runs.

**Combos.** None needed; this is a contribution track.

**Build estimate.** 3–4 days for one person comfortable in TS + Docker.

---

### 🟡 M2 — **`hedera-harness` Python runtime target**

**Pitch.** The harness only knows Yarn/Next.js/`@hiero-ledger/sdk`. Add a **runtime profile** so a recipe can say `runtime: python` and the harness provisions a `uv`/pytest skeleton, swaps ASSERT validators (ruff, mypy, pytest), skips Playwright, and runs Tier 3.5 with `hiero-sdk-python` (or keeps the TS chain signer but exposes creds as env). Ship one PRD (an HCS audit-trail CLI or an x402 client in Python) and a `docs/runtimes.md`. It is a legitimate "port to another language/runtime" without rewriting the orchestrator.

**Hits.** Harness ✅. Extra: **a language the current one does not cover**, tests/docs/examples, before/after evidence (Hedera advertises Python/Java/Go/Rust/Swift SDKs; the harness serves none).

**Wow moment.** The same PRD text produces a passing TS app and a passing Python app from two recipes.

**Hardest risk.** The generator prompts (`prompts/generator.md`) are Next.js-shaped; making them runtime-aware without regressing the TS path. Python SDK parity gaps (scheduled tx, HTS custom fees) could bite the PRD.

**Build estimate.** 4–5 days.

---

### 🔴 H1 — **Repo Desk**: two agents negotiate a tokenized-treasury repo and it unwinds itself

**Pitch.** The prize's first bullet, built literally. A *Borrower* agent holds an ATS-issued tokenized treasury bond (KYC'd, Reg D). A *Lender* agent holds USDC. They talk over **A2A** (agent cards + `@a2a-js/sdk`), run an **ACP-style Request → Negotiate → Transact → Evaluate** loop over rate, term and haircut, and sign a Proof-of-Agreement that is anchored to an HCS topic. Settlement: the borrower creates an **ATS Hold** on the collateral with the Repo Desk contract as escrow; the lender's USDC moves to the borrower; the **repurchase leg is pre-scheduled** as a Hedera Scheduled Transaction (or HIP-1215 `scheduleCall` on the repo contract) at maturity: USDC + interest returns, escrow releases the hold. A Chainlink Data Feed prices the collateral; if it falls below the haircut, the escrow **executes the hold** to the lender (margin call). Both agents carry **ERC-8004 identities on Hedera testnet** and HCS-14 UAIDs; the lender writes reputation to the ReputationRegistry after settlement; the agents discover each other via an HCS-10 registry topic. The lender's due-diligence data (bond terms, holder snapshot, price) is sold by Repo Desk as an **x402 endpoint settled via Blocky402** in USDC — so the same build is a live x402 service with a consuming agent.

**Hits.** Tokenization ✅ (ATS issue + KYC + hold + lifecycle; collateral for repo; **oracle**; **Scheduled Transactions for maturity settlement**; compliance controls). Agentic Payments ✅ (Blocky402-settled x402 data service consumed by the lender agent). Extra: **A2A/ACP negotiation and settlement**, **ERC-8004 + HCS-14 identity**, **HCS audit trail**, **HTS in settlement**, **Scheduled Transactions**, discovery via HCS-10 registry. That is two $2K tracks with one codebase plus most of the open extra-points bullets.

**Wow moment.** In the video the two agents haggle in plain English (rate 5.2% → 4.9%, haircut 8%), the ATS hold appears on HashScan, the lender's USDC lands, a countdown shows the scheduled repurchase, and at T+90s the schedule executes and the hold releases — then re-run with a price shock and watch the margin call fire instead.

**Hardest risk.** ATS hold semantics with a *contract* as escrow: `executeHoldByPartition` must be callable by the repo contract and honor ATS compliance (`canTransfer`) on the destination. Verify on testnet in the first 48 hours; fallback is an EOA "escrow agent" key controlled by the Repo Desk service. Second risk: scope — cut ACP to a 3-message negotiation and hard-code A2A discovery if HCS-10 fights you.

**Load-bearing combos.** **Chainlink** (Data Feed for haircut; CRE Confidential Workflow that evaluates a *private* margin threshold in a TEE and triggers the on-chain hold execution → Chainlink $2K track, "automated liquidation protection" is their own template). **World Selfie Check** as the human gate for investor KYC grants. **ENS v2** (Sepolia): `borrower.repodesk.eth` with ENSIP-26 agent text records pointing at the UAID/ERC-8004 id/x402 endpoint — agents-as-namespaces is ENS's bonus bullet.

**Build estimate.** 9–11 days for 2–3 people; do S3 first as insurance.

---

### 🔴 H2 — **Bourse**: the secondary market ATS doesn't have, with agents as market makers

**Pitch.** An order book / batch auction for ATS securities where **compliance is enforced at fill time by the token itself**. Sell orders lock inventory with an **ATS Hold** (escrow = Bourse contract); buy orders lock USDC (HTS allowance or hold in a USDC escrow); the matcher executes the hold to the buyer — which runs ATS's KYC/control-list/partition checks — and a non-compliant fill **reverts and releases** rather than settling. Market data (depth, prints, last) is an **x402 endpoint settled via Blocky402**; two Agent Kit market-maker agents quote on a tokenized bond using that feed and a Chainlink price; a fractional **HTS custom fee** on the USDC-denominated settlement token routes the exchange fee with no fee logic in the contract. Clearing-mode tokens use ATS `Clearing` ops so a compliance validator (an agent with `CLEARING_VALIDATOR_ROLE`) approves fills. Ship a `Marketplace` facet proposal or doc PR upstream.

**Hits.** Tokenization ✅ + the explicit "**secondary market, which the Studio does not have today**" bullet, compliance controls in use, custom fee schedules, oracle pricing, upstream contribution. Agentic Payments ✅ (x402 market data consumed by MM agents; HTS fee in settlement path; HCS trade prints).

**Wow moment.** A KYC'd agent's bid fills; the next bid from a non-KYC'd account reverts live with ATS's compliance error; the exchange fee shows up in the treasury account from the HTS fractional fee — no contract code did that.

**Hardest risk.** Matching engine + two-sided escrow on ATS partitions is the most contract-heavy idea here; the ATS diamond's `canTransferByPartition`/hold-execute interplay must be validated early. Mitigate with a batch auction (one clearing price per round) instead of continuous matching.

**Combos.** Chainlink (reference price), World Selfie Check (investor onboarding gate), Privy (B2B org wallet for the exchange treasury — risky raw-sign path; can be mocked).

**Build estimate.** 8–10 days for 2–3 people.

---

### 🔴 H3 — **Standing Orders**: x402 subscriptions without subscriptions, via Scheduled Transactions + HTS fee schedules

**Pitch.** x402 is per-request; agents need recurring access. Standing Orders is an x402 *extension* where the 402 offers two `accepts`: `exact` (pay now via Blocky402) **or** `scheduled` — the client pre-signs N future `TransferTransaction`s as Hedera **Scheduled Transactions** (`waitForExpiry`, every T seconds for up to 62 days), and the resource server grants access for each period after verifying on the mirror node that the schedule exists, is signed, and cannot be deleted (no admin key). Missed/deleted schedules revoke access at the next boundary. The settlement token carries an **HTS fractional fee** to a protocol treasury, so every scheduled tick pays the protocol automatically. Receipts and access-grant events go to a HIP-991 topic. Includes a middleware (`@standing-orders/express`) and an Agent Kit policy (`RecurringBudgetPolicy`). First `exact` payment still goes through Blocky402 (qualification), then the schedule takes over.

**Hits.** Agentic Payments ✅ (first paid request via Blocky402). Extra: **recurring/streamed payments using Scheduled Transactions** (the one bullet no winner touched), **custom fee schedules in the settlement path**, HCS audit, HTS tokens. Reusable infra rather than a demo.

**Wow moment.** Agent subscribes once; the video fast-forwards through three scheduled ticks executing on HashScan while the agent keeps calling the API with no payment headers; delete one schedule and access lapses on the next tick.

**Hardest risk.** Protocol fit — Blocky402 does not settle the scheduled leg (Hedera does, natively), so make the README crystal clear that the *first* request is facilitator-settled and the recurring leg is Hedera-native by design; a purist judge may still call it "not x402". Mitigate by also offering the pure `exact` path per call.

**Combos.** Ledger Key Ring holding the pre-signing key; Privy policies as the human-side spend guardrail.

**Build estimate.** 5–6 days.

---

### 🔴 H4 — **Souk**: an agent bazaar where identity, discovery, negotiation, payment and reputation are all on Hedera

**Pitch.** Services (any x402 endpoint) register once: an **ERC-8004** identity on Hedera testnet whose agent-card doubles as the **A2A** card and a **UCP `/.well-known/ucp` manifest**; an **HCS-14 UAID**; an entry in an **HCS-10 registry topic** (HIP-991 fee-gated to deter spam). Buyer agents (Agent Kit + MCP) discover by skill, run a short **ACP-style negotiation** over A2A (price, SLA), pay via **x402/Blocky402 in an HTS marketplace token** whose **fractional custom fee is the marketplace's take-rate** — no marketplace contract at all — and post feedback to the **ERC-8004 ReputationRegistry**; all messages and receipts sit on HCS. Souk's own directory search is itself a paid x402 endpoint (bootstrapping). Ships as three packages: `souk-register` (one command to make any x402 service discoverable), `souk-discover` (Agent Kit plugin / MCP tools), `souk-audit`.

**Hits.** Agentic Payments ✅ + literally every extra bullet: metering (per-search), **A2A/ACP negotiation**, **ERC-8004 + HCS-14**, **UCP + directory discovery**, **HTS tokens + custom fee schedules**, **HCS audit**. Also hedera-skills issue #17 (HCS-14 skill) becomes a natural PR → Harness track ("new service coverage… examples").

**Wow moment.** A fresh agent with nothing but a UAID types "I need OCR under $0.01/page"; Souk returns two providers with on-chain reputation; the agent negotiates, pays, rates; the marketplace's fee account balance rises from an HTS fee with zero contract code; the whole trace is one HCS topic.

**Hardest risk.** Breadth. UCP's spec is large (use only the discovery manifest), HCS-10 is a draft, and A2A negotiation UX must fit a 5-minute video. Ruthlessly stub: one buyer, two sellers, three A2A messages.

**Combos.** **ENS v2** (agent names → UAID/ERC-8004 via ENSIP-26; agents as namespaces with delegated permissions — strong for ENS $4.5K). **Arc** (same ERC-8004 addresses on Arc testnet; register agents on both chains and settle USDC on Arc for buyers who prefer it → Arc Agentic Economy track). **The Graph** (a seller that resells Subgraph MCP queries).

**Build estimate.** 8–10 days for 2–3 people.

---

### 🟡 M3 — **Proof-of-Payment MCP** (small, sharp, reusable; pairs with anything)

**Pitch.** An MCP server (`@x402/mcp` + `@hashgraph/hedera-agent-kit-mcp`) whose tools are x402-paywalled and settled via Blocky402, but with one twist: every tool result carries a **verifiable receipt** — the settlement tx id, an HCS consensus timestamp, and a mirror-node proof — and a companion `verify_receipt` tool that any *other* agent can call for free. Adds `HcsAuditTrailHook` to the client side so the *buyer's* actions are also on HCS. Publish as an Agent Kit third-party plugin (gets listed in Hedera docs) and as a Bazantic-hosted MCP with a recipe ("call tool → verify receipt → only then act").

**Hits.** Agentic Payments ✅ (paid MCP tool = paid request), HCS audit, HTS. Bazantic Agentify/Recipe. Cheap to add to S2/H1/H4 as the consumer surface.

**Risk.** `@x402/mcp` maturity on Hedera is unverified — test on day 1; fall back to wrapping tools in `@x402/fetch`.

**Build estimate.** 2 days.

---

## 4. Recommended portfolio for a 1–3 person team

1. **Days 1–2**: S3 (Feedwire) — secures Agentic Payments qualification + both eligible Bazantic prizes; validates Blocky402, USDC association, HTS fee behavior, Bazantic's real workflow.
2. **Days 3–11**: **H1 Repo Desk** (highest prize density: Tokenization + Agentic + Chainlink CRE, all load-bearing) — or **H4 Souk** if the team prefers pure agent infra over RWA. Reuse S3's x402 core as the paid data endpoint.
3. **Days 8–11, one person**: M1 (harness local mode + x402 validator + #15/#16) using the S3 service as fixture — the cheapest $2K on the board because the judges wrote the issues.
4. **Day 12**: three videos, HashScan links, READMEs with architecture + payment-flow diagrams, Bazantic username in submission, FEEDBACK docs where sponsors ask.

Why not S1 as the headline? It is the safest Tokenization entry but reads like "bond + cron". H1 contains S1's coupon-scheduling idea *and* the repo collateral story the prize text leads with.

---

## 5. Traps and non-obvious things

1. **Facilitator mismatch.** The official Hedera PoC (and `x402.org/facilitator`, which *does* advertise `hedera:testnet`, fee-payer `0.0.9185802`) is not Blocky402. Qualification requires Blocky402. Set `X402_TESTNET_FACILITATOR_URL=https://api.testnet.blocky402.com` and show the `0.0.7162784` fee-payer in the HashScan tx in your video. Blocky402's GitHub link is a 404, so you cannot fork their facilitator; self-hosting uses `@x402/hedera/exact/facilitator` — fine for local dev, not for qualification.
2. **Bazantic: two-thirds reachable.** "Help an Agent Use Your Hackathon Project" is Continuity-only. Fresh teams compete for "Agentify a new API" and "Best Recipe with sponsor APIs" only (ranked, $500 top). The platform is human-in-the-loop ("Baz AI builds… you sign off") — sign up on day 1, and the "new API" must be neither on Bazantic nor a sponsor's.
3. **ATS SDK is wallet-only.** `SupportedWallets` = MetaMask, Hedera WalletConnect, DFNS, Fireblocks, AWS KMS; the plain `Client` adapter is commented out. Agents/backends must call the diamond via ethers with `@hashgraph/asset-tokenization-contracts` ABIs on `testnet.hashio.io` (chain 296), or use the web app for issuance. Two live testnet factory/resolver pairs exist (docs: `0.0.7708432/0.0.7707874` v4.0.0; web `.env.example`: `0.0.9213391/0.0.9212226` June 2026) — use the newer one with SDK 8.x and pin config versions. ATS coupons/dividends have **no on-chain cash leg**; Mass Payout is a separate NestJS+Postgres product — do not plan to run it in a hackathon.
4. **x402-on-Hedera silent failures** (hedera-skills #28, built against `@x402/hedera` 2.24.0 + Blocky402): a `$`-denominated `price` is redenominated to USDC via `DEFAULT_ASSETS` (your 402 silently quotes the wrong asset — always decode `PAYMENT-REQUIRED` and check `asset`); `PrivateKey.fromStringECDSA` happily parses an ED25519 raw key; payer == payee nets to zero and fails verification (use two accounts from minute one); mirror node lags consensus (poll, don't assert immediately); a second 402 after a *valid-but-unsettled* payment is byte-identical to an unpaid 402. Also: the **receiving** account must associate USDC (`0.0.429274`) before the first USDC settlement or Blocky402 returns `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; everything must be **ECDSA**.
5. **Harness ≠ SDK; runs are slow.** Each `hedera-harness run` is 40 min–2 h and requires Cursor or Claude Code CLI installed and authenticated; Tier 3.5 needs testnet HBAR; the ephemeral signer has **zero auto token associations** (#15) so USDC-receiving templates fail; the x402 skill is invisible to the generator (`unmerged-skills`). Test validators with `validate`/`validate-semantic` subcommands rather than full runs.
6. **Scheduling limits.** HAPI schedules max **62 days**; no admin key = undeletable; identical inner tx = `IDENTICAL_SCHEDULE_ALREADY_CREATED` (vary memo); HSS/HIP-1215 is **not available on local forks/Anvil** and is throttled per second (`hasScheduleCapacity`); scheduled calls do not revert on failure — check return codes.
7. **Rate limits and RPC quirks.** Blocky402 testnet: 100 req/min/IP, burst 10 — design demos with ≤1 settlement/sec. Hedera JSON-RPC `eth_getLogs` is capped to a 7-day window — read via mirror node or view functions. `AccountBalanceQuery` is deprecated in v0.77 (Oct 6–7) — use the mirror node.
8. **HTS fractional fee vs `exact` verification.** The Hedera exact scheme verifies "exact amount reaches `payTo`". A fractional fee (receiver pays) makes the receiver net less; use `net_of_transfers=true` (sender pays the fee on top) or a fixed fee, and test against Blocky402's verifier on day 1 before promising "fee schedules in the settlement path".
9. **Identity standards are drafts.** HCS-14 and HCS-10 are HOL *Draft* status; the registry broker costs credits (x402-purchasable). ERC-8004 on Hedera testnet is real and address-stable — lean on ERC-8004 for the on-chain claim, use HCS-14 UAIDs as the cross-protocol handle, and treat HCS-10 as optional transport.
10. **Continuity-gated prizes**: Hedera Continuity ($1K), Bazantic A/B ($1K), World AgentKit ($3.5K), Ledger Continuity, Arc/ENS/Uniswap/Chainlink continuity variants — all require a pre-existing project. Don't count them.
11. **Good news to bank**: no testnet reset in the window (last upgrade v0.76.3 on Sept 1; October 6–7 maintenance is after judging); Circle faucet gives 20 USDC/2h/address on Hedera testnet; portal faucet gives HBAR; Blocky402 and x402.org both healthy as of 2026-09-03 19:20 UTC.

---

## Appendix — key coordinates

- Blocky402 testnet: `https://api.testnet.blocky402.com` (fee-payer `0.0.7162784`); mainnet `https://api.blocky402.com` (fee-payer `0.0.10571514`)
- x402.org facilitator (not qualifying): `hedera:testnet` fee-payer `0.0.9185802`
- USDC: testnet `0.0.429274`, mainnet `0.0.456858`; HBAR asset `0.0.0`; 1 HBAR = 1e8 tinybar
- ERC-8004 Hedera testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- ATS testnet (newest): Resolver `0.0.9212226`, Factory `0.0.9213391`, Equity config `0x…01`, Bond config `0x…02`; docs v4.0.0 pair `0.0.7707874` / `0.0.7708432`
- Hedera testnet RPC `https://testnet.hashio.io/api` (chain 296); mirror `https://testnet.mirrornode.hedera.com/api/v1/`
- HSS system contract `0x16b`; HTS `0x167`
- npm: `@x402/*` 2.24.0; `@hashgraph/hedera-agent-kit` 4.1.0; `@hashgraph/hedera-agent-kit-mcp` 1.1.0; `@hiero-ledger/sdk` 2.87.0; `@hiero-ledger/hiero-cli` 1.2.0; `hedera-harness` 1.2.2 (`next` = 2.0.0-rc.4); `@hashgraph/asset-tokenization-sdk` / `-contracts` 8.0.0; `@hashgraphonline/standards-sdk` 0.1.186 (`@hol-org/standards-sdk`, `@hol-org/rb-client`); `@a2a-js/sdk` 1.1.0; `@modelcontextprotocol/sdk` 1.30.0
- Repos: hedera-dev/{hedera-harness, hedera-skills, x402-inference-pay-per-request-poc, scaffold-hbar (branches `templates/x402-pay-per-use`, `templates/payments-scheduler`, `templates/tokenise-subscriptions`)}, hashgraph/{hedera-agent-kit-js, asset-tokenization-studio}, erc-8004/erc-8004-contracts, hashgraph-online/standards-sdk
- Prior art to differentiate from (Aug 31 winners): Pinout, Tally, Xorv, Qisma, Mystic
