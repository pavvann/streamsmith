# ETHGlobal Showcase Pass (Sept 9, 2026)

Source: 873 projects across Buenos Aires 2025, ETHOnline 2025, Lisbon 2026, Cannes 2026, New York 2026, filtered by our 11 sponsors. 267 sponsor winners (badge = won a prize from that sponsor, incl. pool prizes), 33 ETHGlobal finalists, 411 project pages read. Per-sponsor digests with ETHGlobal's own originality/practicality/technicality scores are in `showcase/`. Raw index: `showcase/all-projects.json`.

## Win rates by sponsor (participants → sponsor badges)

| Sponsor | Buenos Aires 25 | ETHOnline 25 | Lisbon 26 | Cannes 26 | New York 26 |
|---|---|---|---|---|---|
| 1inch | 24 → 10 | – | 23 → 5 | – | 6 → 4 |
| Uniswap | 29 → 10 | – | 37 → 8 | 53 → 4 | 22 → 6 |
| Chainlink | 27 → 5 | – | – | 46 → 5 | 63 → 9 |
| Hedera | 15 → 5 | **79 → 5** | 46 → 10 | 40 → 9 | 33 → 11 |
| Arc / Circle | 18 → 5 | – | – | 69 → 8 | 64 → 10 |
| Privy | 41 → 3 | – | – | – | 27 → 4 |
| Ledger | 10 → 5 | – | – | 27 → 8 | 19 → 5 |
| The Graph | 15 → 5 | – | 58 → 10 | – | – |
| ENS | 54 → 5 | – | 44 → 3 | 71 → 7 | 102 → 51 (pool) |
| World | 48 → 37 (pool) | – | 58 → 10 | 73 → 9 | 53 → 9 |

ETHOnline 2025 (async) Hedera: 6% hit rate. Async events are brutal; in-person pool prizes inflate the others.

## What wins, per sponsor

- **1inch.** Every 1st place is a *paper → SwapVM program* market-microstructure primitive on shared Aqua liquidity: Aqua Outcome Market (pm-AMM invariant), ArcBook (functional order book, also finalist), RiverSwap (am-AMM auction-managed). 2nd/3rd: flash loans, one-way directional liquidity (Lotus), fixed funding-rate swaps (TenorFi), leveraged oracle-anchored liquidity (Ballast), formal semantics (KSwap-VM), private vault → Aqua. **Not apps, not AI.** At Lisbon, four teams built "natural language → SwapVM bytecode" (Aquapilot, Sluice, QilinSwap, wave) and zero won. "AI tunes the knobs" (Aqua Prime, ALA) won nothing from 1inch.
- **Uniswap.** 2025: novel curves as v4 hooks (Orbital spherical AMM 1st, pm-AMM hook, TEE prop-AMM P.A.T 1st). 2026: API integrations that are real products: portfolio stop-loss agent (Sentinel 1st), influencer accountability (KOLlateral 1st + finalist), self-arbitraging delta-neutral MM (αβγ' 1st), Lotus 1st. Flat $1K, broad, crowded.
- **Chainlink.** CRE workflows with a real-world reason: AI market making for illiquid prediction markets (AIMM), Bitcoin→EVM relayer (BMCP, finalist), CRE-triggered broker paying per intel call via Arc nanopayments (Flow Broker), parametric insurance priced by prediction markets (Canary, finalist), rent escrow released when an NYC HPD violation resolves (Plumb, no prize but great shape). **Agent-safety firewalls made finals twice** (ENShell at Cannes, Immunity at NY).
- **Hedera.** Native services win: Alba (revolving credit as SwapVM programs, each maturity a Hedera Scheduled Transaction, won Cross-Chain Automation Hub), HyperAgent (ERC-8004 protocol, 1st), Incendia (zk auction, 1st), Price Feed plugin for Agent Kit. Finalists: Glassbox402 (x402 analytics), DIVE, Accrue (bot-proof ad market). Tokenization entries exist (Mint & Chill, Wafer, Covenant, Finvoice, equitas) but none did repo/collateral lifecycle.
- **Arc / Circle.** Payments with a twist: 1 cent per play (Onda), pay-per-page browsing via nanopayments (NanoCrawl), pay-as-you-go VPN that proves no logs (VEIL, finalist), gasless cross-chain USDC (ArcBeam), Global IDs for DeFi instruments (OneTx 1st). Agent-native finance: perps for agents with per-block funding and no liquidations (Sidekick), private agentic payroll (Manila), structured products on prediction markets (Cumulant, finalist).
- **Privy.** Thin field, simple winners: gas sponsorship, x402 utils, a World-gated copy-trading agent. Nobody has used key quorums or intents as the product.
- **Ledger.** ERC-7730 clear-signing tooling, DMK interop, hardware threshold wallets; 2026: Ledger as root of trust for agents (Lunave 1st, Stream Vaults 4th, Signel, Flowguard, Aegis).
- **The Graph.** MCP/tooling over standardized data (deeptrace, atlas, ArcBook AI tooling 2nd), Amp IDE (Amplify 1st), NL → LP agent (RangeSeeker). Provenance and standardized schemas rewarded. Substreams one-prompt challenge has no prior entrant.
- **ENS.** 2025: creative infra (Filify "Vercel for the decentralized web" 1st, iWitness proof-of-IRL 2nd). NY 2026 was a 51-badge pool: agent auth on ENS, agent reputation on ENS, agent spending policies on ENS, subname managers, agent banks.
- **World.** Mostly mini-app pool prizes. Notable: Turing Swap (humans trade cheaper than bots via a `_humanGate` SwapVM instruction reading AgentBook, AgentKit 3rd), BookerBob (bots prepay, humans pay later), AgentGate (pay-per-call API gateway with x402 + Agent Kit).

## Finalist shapes (33)

Novel DeFi primitive (Yoga multi-range positions, ArcBook, Cumulant, Canary, LYNX), agent safety (ENShell, Immunity, maki), hardware/physical (LensMint camera, Paybot robots, Hands Unchained robot arm, PaintGlobal NFC, Carte Bleue card recovery, Clanker500), privacy (VEIL VPN), consumer with a twist (Halo receipts → rewards, Accrue "get paid to wait"), infra (Glassbox402, BMCP, UNSU wallet, The Wallet Shift ERC-8004 directory, npmguard). Roughly half of 2026 finalists are agent-related. Every finalist has a one-sentence thesis and something visibly moving in the video.

## Prior art against our Sept 4 shortlist

| Our concept | Showcase precedent | Verdict |
|---|---|---|
| **VaultMind** (agent firewall, private policy, hardware gate) | ENShell (Cannes **finalist**, "prevents agents executing malicious txs from prompt injection"), Immunity (NY **finalist**), maki (Cannes **finalist**, "keys locked in hardware, unreachable by the model"), Tollgate, Flowguard, Signel, Bound, Preflight, Don't Get Drained, StableSettle, intentOS, Aegis, MultiSub, allowance.eth | **Saturated.** 14+ entries, 3 finalists. The poisoned-prompt demo has been done. |
| **Sealed Maker** (TEE strategy → SwapVM) | P.A.T (BA, 3 prizes), Aqua Prime, Meridian, Daemon Hall, Shade | Saturated-ish (see prior-art-sealed-maker.md) |
| **AgentNS** (ENSv2 agent credentials) | ENS-bound agent auth, allowance.eth, ENS Subname Manager, Bank of Agent (all NY) | **Done three times.** ENSv2-specific mechanics are new, the concept isn't. |
| **Vouch** (agent trust oracle) | AgentRank, AgentRankr, Argos, AgentIndex, AgentRanker, Pfand, Credence, Assay | **Very saturated.** |
| **Turing Toll** (humans free, bots pay) | Turing Swap, BookerBob, HumanPay, AgentGate, GlobalPhone | **Done.** |
| **Ronin** (agent that pays its own rent, dies) | Ghost in the Machine (Cannes, twice) | Done. |
| **Agent Court** | Clawback ("chargebacks for the machine economy", NY) | Done. |
| **Metered Mind** (per-token streaming) | NanoCrawl, Onda, AudiThor, Pinout, AgentRouter | Metering done in five forms. |
| **Aqua Options Desk** | Smile (options via Uniswap API, NY 3rd), Superpose (covered call as one leg of shared collateral) | Open as a first-class Aqua program, but 1inch's field is the hardest on the sheet. |
| **Repo Desk** (tokenized treasuries as programmable repo collateral, agents negotiate) | Alba (revolving credit + Scheduled Transactions, won Hedera), Folio, Seikine; invoice factoring done 3× (Finvoice, cashmeifyoucan, intentional.so) | **Open.** No repo/collateral-lifecycle entry. Institutional shape is rare. |
| **Substreams one-prompt + ERC-4626 flows module** | none | **Open.** Featured challenge is new; module is the prize's own example. |

## Whitespace worth building (fits the current prize sheet)

1. **Substreams from a sentence** (Graph both tracks): prompt → Rust module → quality gate → publish → hosted sink → auto-generated MCP over the ClickHouse tables. Worked example: ERC-4626 flows/share-price module (Pinax only has raw events). Inspired by deeptrace/atlas (MCP over standardized data won) and RangeSeeker (NL → action). Third sponsors: Privy Earn (Morpho vaults are ERC-4626; a savings flow that rotates vaults on live flow data) or Chainlink (confidential workflow acting on vault anomalies). Bazantic gateway is a cheap add.
2. **Repo Desk** (Hedera ATS + x402 + Chainlink): Alba's shape (credit instrument whose maturities are Scheduled Transactions) applied to ATS tokenized treasuries with an ATS Hold as escrow and a private margin threshold in CRE. Nobody has done it.
3. **Structured notes as SwapVM programs on one Aqua balance** (1inch + Chainlink feeds + Graph): principal-protected note = zero-coupon leg + call leg backed by one balance, inspired by Cumulant (finalist, tranches/PPNs on prediction markets) and Superpose. Novel for 1inch judges who reward "paper → program", but 1inch is the toughest room.
4. **Agent-native finance on Arc** in Sidekick's vein (perps for agents won Arc): e.g. working-capital lines for agents priced off ERC-8004 payment history. Arc rewards finance built for machines, not humans.
5. **Real-world-triggered escrow via CRE** in Plumb's vein: escrow that releases on a verified public-records event. Chainlink judges reward a real reason for the oracle.

## Taste notes from winners

One-sentence thesis in the tagline. A named academic or industry anchor (pm-AMM, am-AMM, ROSCA, repo). Live on-chain proof in the video, not slides. Something visibly moving: a counter, a device, a robot, a price. Reusable artifact (a module, an MCP, a hook) over an app. "Not X, Y": "makers publish executable curves instead of fixed-price orders."
