# Uniswap winners across events (28)


## buenosaires (10)

### ALA (ala-nxpw2) [orig ? / prac ? / tech ?]
- badges: Graph, Uniswap
- won: Uniswap Foundation - Uniswap v4 Volatile-Pairs Hooks 3rd place The Graph - Best Use of Amp Datasets 3rd place
- tagline: Crowdsourced Market Maker built by global data scientists to optimize on-chain liquidity.
- ALA is a Crowdsourced Market Maker built on Uniswap v4 that transforms liquidity management into a collaborative intelligence network. The platform allows data scientists to submit models that determine how a pool adjusts fees, manages output deltas, and reallocates liquidity through rehypothecation. ALA provides a unified on chain dataset with historical swaps, pool transitions, and LP positions, all prepared for model development. It also includes a testing environment where contributors can measure how their models would have performed against default Uniswap behavior. Validated model decisions are combined and executed inside ALA Pools which are Uniswap v4 pools equipped with advanced ho

### Private FHE Intents (private-fhe-intents-4hrso) [orig ? / prac ? / tech ?]
- badges: Pyth, Uniswap
- won: Uniswap Foundation - Uniswap v4 Volatile-Pairs Hooks 2nd place Pyth Network - Most Innovative use of Pyth pull price Feeds 5th place
- tagline: We Solved The $700M MEV Problem Using Math That Breaks Wall Street's Playbook
- PrivacyPoolHook implements a privacy-preserving Uniswap V4 hook enabling encrypted swaps through FHE (Fully Homomorphic Encryption) and intent-based matching. Users deposit ERC20 tokens to receive ERC7984 encrypted pool tokens with hidden balances, then submit encrypted intents where both amounts (euint64) and directions (euint8) are completely hidden on-chain. An authorized relayer matches opposite intents off-chain using FHE permissions and settles them in batches: matched pairs execute as internal encrypted transfers with zero slippage and no AMM fees, while unmatched volume routes through a single net Uniswap V4 swap. The hook integrates Pyth Network oracles for delta-neutral strategies 

### Redfish (redfish-v4g9r) [orig ? / prac ? / tech ?]
- badges: Uniswap, vlayer
- won: Uniswap Foundation - Uniswap v4 Volatile-Pairs Hooks 3rd place vlayer - Best Server-Side Proving dApp 2nd place
- tagline: Using zero knowledge machine learning and zktls to create trustless anomaly detection
- The Core Problem The "Impossible Trinity" of DeFi security states that you can only achieve two out of three critical properties: Sophisticated Detection (complex ML models that catch attacks), Decentralization (trustless, no oracles), and Low Cost (affordable gas fees). Traditional solutions always sacrificed one—centralized oracles are sophisticated and cheap but require trust; on-chain ML would be sophisticated and trustless but would cost $15,000+ per transaction in gas fees; simple allowlists are cheap and trustless but can't detect novel attack patterns. This trilemma forced DeFi protocols to accept either security theater (simple rules), centralization (trust oracles), or massive loss

### P.A.T (p-a-t-s0c42) [orig ? / prac ? / tech ?]
- badges: Oasis, Pyth, Uniswap
- won: Uniswap Foundation - Uniswap v4 Volatile-Pairs Hooks 1st place Oasis Protocol - Build with Oasis 3rd place Pyth Network - Most Innovative use of Pyth pull price Feeds 1st place
- tagline: Proprietary Automated Market Maker launchpad built on top of Uniswap V4 using TEEs.
- This project builds on Uniswap v4 hooks to create a proprietary (prop) AMM launchpad on Ethereum. On Solana, prop AMMs are a major venue for swaps and are especially popular with market makers, but they haven’t really existed on Ethereum because of EVM limitations around gas pricing mechanisms. We address this by combining Trusted Execution Environments (TEEs) with an oracle-driven pricing mechanism, enabling complex, off-chain price computation with on-chain settlement guarantees. The result is a launchpad that lets teams deploy prop AMMs on Ethereum with market-maker-friendly features, while preserving transparency, security, and composability with the broader DeFi ecosystem.

### OneTx (onetx-gtqrx) [orig ? / prac ? / tech ?]
- badges: Circle, Uniswap
- won: Uniswap Foundation - Uniswap v4 Stable-Asset Hooks 2nd place Circle - Best Smart Contracts on Arc with Advanced Stablecoin Logic 1st place
- tagline: Universal DeFi router: one-click access to any DeFi instrument across chains via Global IDs
- This project introduces the first universal DeFI ID and routing system for DeFi financial instruments. Every DeFi product—whether AAVE lending pools, Compound vaults, or liquidity positions—receives a standardized Global ID, similar to stock tickers or bond ISINs. Users simply purchase the instrument by its ID (e.g., #aave-usdc-arbitrum) in a single transaction, regardless of what token they hold or which chain they're on. The routing layer automatically handles all intermediate steps—swaps, bridges, deposits—atomically. This creates machine-readable standardization that makes DeFi accessible to AI agents, institutional systems, and traditional APIs. For the first time, DeFi instruments have

### Orbswap Prediction (orbswap-prediction-hyxb2) [orig ? / prac ? / tech ?]
- badges: Uniswap
- won: Uniswap Foundation - Uniswap v4 Volatile-Pairs Hooks 2nd place
- tagline: Uniswap v4 pm-AMM hook for an asymmetric LP payoff to simulate prediction markets.
- Most prediction markets are adopted as orderbooks, but AMMs have not taken off as prediction market infrastructure. Our belief for it is that custom curves such as CPMM and LMSR do not allow for the concentration of the probability by the LP, instead the LP is forced to accept a 50/50 outcome, waiting until the event occurs, resulting in IL as seen in desmos figure below and simluation link here: [href=https://www.desmos.com/calculator/sk8d2g49hj]. For example, consider the prediction for tomorrow's weather, will it rain or shine? It rarely is a 50/50 coinflip, instead it's a rather specific probability, and an LP should have the freedom, just like in Uniswap v3, to concentrate around such a

### Orbital Hook (orbital-hook-no27o) [orig ? / prac ? / tech ?]
- badges: Uniswap
- won: Uniswap Foundation - Uniswap v4 Stable-Asset Hooks 1st place
- tagline: A Uniswap V4 Hook implementing a custom spherical AMM curve for efficient stable asset swaps.
- Orbital leverages Uniswap V4 Hooks to introduce a new primitive for stablecoin liquidity: the Spherical AMM. Unlike standard pools that rely on hyperbolic curves x.y=k or fragmented ticks, Orbital implements a custom pricing invariant based on high-dimensional spherical geometry. This design creates a naturally "flatter" price curve, ideal for pegged assets, reducing slippage without requiring active tick management. By mathematically defining liquidity as a "radius" rather than a tick range, we unlock higher capital efficiency and lay the groundwork for future multi-asset pools where USDC, DAI, and USDT can share a single liquidity surface. This project demonstrates how V4 Hooks can be used

### SAGE Protocol (sage-protocol-tv19y) [orig ? / prac ? / tech ?]
- badges: Uniswap
- won: Uniswap Foundation - Uniswap v4 Stable-Asset Hooks 3rd place
- tagline: Dynamic fee hook integrating S&P SSA ratings - safer stablecoin pairs earn lower fees on Uniswap v4
- This project bridges traditional financial risk assessment with decentralized finance by creating a sophisticated Uniswap v4 hook that dynamically adjusts trading fees based on real-time stablecoin stability data from S&P Global's Stablecoin Stability Assessment (SSA). Traditional Uniswap pools charge fixed trading fees regardless of the underlying assets' risk profiles. This hook transforms that model by integrating institutional-grade risk data directly into the fee structure, creating a transparent, incentive-aligned system that rewards users for trading the safest stablecoin pairs. The hook offers up to 30% fee discounts exclusively for pools pairing stablecoins with the highest SSA rati

### Anti-Toxicity Hook (anti-toxicity-hook-fxv68) [orig ? / prac ? / tech ?]
- badges: Uniswap
- won: Uniswap Foundation - Uniswap v4 Stable-Asset Hooks 3rd place
- tagline: This UniswapV4 hook reduces impermanent loss by rewarding trades that goes against the market
- This UniswapV4 hook protects liquidity providers from impermanent loss by incentivizing balanced trading activity. When traders execute large one-directional trades that move prices significantly, liquidity providers typically lose value compared to simply holding their assets. This hook addresses that problem by encouraging traders to swap in the opposite direction of recent price movements, helping liquidity providers rebalance their positions back to equilibrium. Additionally, LPs can opt into automated position management, allowing the hook to rebalance their positions on their behalf.

### antidote (antidote-i18um) [orig ? / prac ? / tech ?]
- badges: Pyth, Uniswap
- won: Uniswap Foundation - Uniswap v4 Stable-Asset Hooks 2nd place Pyth Network - Most Innovative use of Pyth pull price Feeds 3rd place
- tagline: Permissioned  Institutional Margin Call Protection Protocol
- Antidote is the first fully permissioned, atomic-margin risk insurance protocol embedded directly into Uniswap v4 AMMs. By combining institutional-grade KYC via Coinbase x402 payments, real-time Pyth price data with pull architecture and privacy-preserving automated claims, Antidote empowers institutions to hedge margin call liquidations dynamically and compliantly. Antidote transforms systemic liquidation risk into a manageable, tokenized asset class, bridging Web2 regulatory trust with Web3 composability to redefine institutional decentralized finance risk management.


## lisbon2026 (8)

### WallCard (wallcard-knavu) [orig 8 / prac 8 / tech 8]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap Stack Contribution 2nd place
- tagline: First Ever Self Custodial Wallet In a Card Form. No extensions - just card, CVV, PIN & OTP
- WallCard is a non-custodial crypto wallet but in a card form, not a browser extension. You link a virtual card (number, CVV, and PIN) to EVM, Solana, and Sui accounts behind the scenes. When a site or app needs a signature or transaction, you approve with the same habits you already trust: card details, PIN, and a one-time code (or a push approval on the mobile app), instead of MetaMask popups or seed phrases on every action. For developers, WallCard exposes a familiar wallet interface (Session Connect for dApps, SDK examples, WalletConnect-style flows) so users can sign messages, send transactions, and use advanced features like sending USDC while paying from USDT via integrated swap and se

### RWA Outlet (rwa-outlet-wogh8) [orig 8 / prac 8 / tech 9]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place
- tagline: Instant RWA liquidity through 1inch Aqua, Uniswap v4, and ERC-7540 queues
- RWA Outlets is an instant-liquidity market for tokenized real-world assets. Tokenized T-bills and private credit (~$33B) redeem on issuer timelines — T+2 up to 180 days — so holders needing cash either wait or dump at unpredictable discounts. With RWA Outlets, holders exit to USDC in one transaction through three risk-tiered pools built as 1inch Aqua strategies with SwapVM programs: Express (NAV minus 5–25 bps), Patient (onchain Dutch-decay auction that discovers the fair discount), and Market (two-sided AMM, so buyers can enter too). Pricing plugs into the unmodified official 1inch router via a custom NavExtruction instruction; KYC is a soulbound NFT checked by stock opcodes. Patient holder

### r00t.fund (r00t-fund-p536c) [orig 8 / prac 7 / tech 9]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap Stack Contribution 3rd place
- tagline: ReFi launchpad: a Uniswap v4 hook arbs a token's shielded + public pools to regenerate real land.
- Every day, pump.fun-style launchpads extract millions into casino tokens — sniped, farmed by MEV bots, and leaving nothing but a dead chart. R00T.fund takes that exact machinery — token launches, price discovery, relentless arbitrage — and points it at regenerating real-world land. A community steward tokenizes a parcel of land and opens a Continuous Clearing Auction; backers bid $R00T. One transaction clears the auction, sends the raise to the parcel's regeneration treasury, and seeds two paired markets at the same price: a ZK-shielded pool where backer flow stays private, and a public Uniswap v4 pool for open price discovery. Here's the twist that makes it self-funding. Those two pools con

### KOLlateral (kollateral-ho1d1) [orig 7 / prac 8 / tech 8] FINALIST
- badges: 0G, FINALIST, Uniswap
- won: 0G - Best AI Product on 0G 3rd place Uniswap Foundation - Best Uniswap API Integration 1st place ETHGlobal - 🏆 ETHGlobal Lisbon 2026 Finalist
- tagline: The accountability layer for crypto influencers: build a verifiable record, back the real traders.
- Crypto influencers operate with almost no accountability. They post hundreds of "calls" a week, delete the ones that lose, and there is no shared record of whether following them ever made money. KOLlateral fixes both sides of that with one thing: a public, verifiable track record. For a caller who is actually good, that record is an asset they own. Every explicit call they make in public becomes a structured signal (asset, direction, target, confidence) and gets priced against real DEX history, so their edge shows up as numbers they can point to: what following them returned versus just holding ETH. Losing calls are archived and flagged in red instead of disappearing. Each call is checked a

### Umbra (umbra-044g4) [orig 7 / prac 7 / tech 8]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place
- tagline: Autonomous DeFi circuit breaker that auto-evacuates funds before pools collapse
- Umbra: The shadow that guards your funds. Umbra is an autonomous financial circuit breaker designed to protect DeFi liquidity providers and traders from systemic market crashes and depegs around the clock. Because crypto markets never sleep, but users do, Umbra continuously monitors live pool data via The Graph to track sudden liquidity drains, volume spikes, and pricing anomalies. When a crisis begins, our quantitative risk model (the CBRI index, hosted and verified via 0G infrastructure) computes a real-time threat score using a robust multi-signal aggregation. Once the critical threshold is crossed, the system autonomously executes an emergency evacuation, leveraging 1inch to instantly ro

### Peregrine (peregrine-z7pr3) [orig 7 / prac 8 / tech 8]
- badges: Uniswap
- won: 
- tagline: Build custom flows that turn any signal into an automated, risk-controlled trade
- 

### Pool Party (pool-party-s7i6a) [orig 7 / prac 8 / tech 8]
- badges: 1inch, Uniswap
- won: 
- tagline: An institutional-grade crypto neobank abstracting DeFi complexity for non-crypto natives via USDC.
- 

### Sentinel (sentinel-yaqmj) [orig 6 / prac 8 / tech 8]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 1st place
- tagline: Stop-loss for your entire portfolio. Sentinel auto-exits to stables when risk hits.
- Sentinel is a DeFi stop-loss agent for your whole portfolio and Uniswap LP positions. It watches pool health, token prices, depegs, and exploit intel (The Graph, Blockaid/X), scores risk with 0G Compute, then auto-exits: withdraw LP → swap to USDC/USDT/DAI → transfer to a safe wallet in case of protocol hacks or compromises. Policy thresholds live in a dashboard; a bot runs the always-on scanner and panic worker against shared Redis. Public demo at sentinel-lisbon.vercel.app runs dry-run triggers so anyone can fire an incident and see the live agent feed without shipping private keys.


## cannes2026 (4)

### Flow Broker (flow-broker-ez5rr) [orig 8 / prac 7 / tech 8]
- badges: Chainlink, Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place Chainlink - Best workflow with Chainlink CRE
- tagline: Autonomous AI brokers that pay per intelligence call via Arc, trades via Uniswap, run by CRE.
- FlowBroker gives anyone an autonomous AI broker that manages their crypto investments — no charts, no jargon, no manual trades. Users answer 5 questions, get matched to a broker agent (Conservative, Balanced, or Alpha), fund their wallet with USDC, and let the agent run. Every 60 seconds, Chainlink CRE triggers a new cycle. The broker agent purchases exactly the intelligence it needs — market data from CoinGecko and Kaiko, on-chain signals from Dune, Nansen and Glassnode, sentiment from X and Reddit — paying per call in USDC via Arc x402 nanopayments. Sub-cent. Gas-free. No subscriptions. An LLM analysis costs $0.015. Market data costs $0.000002. The agent pays only for what it uses, only wh

### ALMA (alma-07pzd) [orig 7 / prac 8 / tech 8] FINALIST
- badges: FINALIST, Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place ETHGlobal - 🏆 ETHGlobal Cannes 2026 Finalist
- tagline: Automated Liquidity Management Agent for your Uniswap positions
- ALMA (Autonomous Liquidity Management Agent) is a fully autonomous rebalancing system for concentrated liquidity positions on Uniswap V4. The problem: Over 40% of concentrated liquidity positions sit out of range at any given time, earning zero fees. Most LPs are passive, they don't monitor positions 24/7, and manually rebalancing means signing multiple transactions, timing swaps, and choosing new tick ranges. Studies show half of all Uniswap V3 LPs would have been better off just holding. How ALMA works: Users connect their wallet (delegated to Calibur via EIP-7702), sign once with an EIP-712 typed data signature, and ALMA takes it from there. That single signature registers the agent's key

### αβγ' (avg-1x2z2) [orig 7 / prac 7 / tech 7]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 1st place
- tagline: Onchain market making system that solves Impermanent loss and toxic orderflow problems
- Uniswap V3 is already on-chain market making, but LPs keep losing money. Two reasons: arbitrageurs trade against your stale prices (toxic flow), and price movements eat your capital (impermanent loss). We built Aetherius to fix both. The idea is simple: we provide concentrated liquidity to Uni V3 in tight ranges (like placing maker orders on-chain), but then we do something no one else does — we arbitrage our own liquidity. If the market moves and our LP is offering a bad price, we take it ourselves before external arbs can. On top of that, every block we check how much directional exposure we're accumulating from retail swaps, and hedge it on Hyperliquid perps. That's how we stay delta-neut

### Casper (casper-km2di) [orig 7 / prac 8 / tech 7]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 2nd place
- tagline: Browser extension that automatically finds you better DeFi rates
- Casper is a browser extension that automatically finds you better swap and bridge rates. (Like Honey, but for DeFi) Most DeFi users overpay on every trade and don't even know it. Comparing rates across dapps manually is painful, and even aggregators miss the best price sometimes. Casper runs quietly in your browser. When you're about to swap or bridge on any dapp, it detects the trade, checks Uniswap and Li.Fi for a better rate, and pops up if it finds one. You then simply execute the better trade in a couple clicks. That's it. It works with your existing wallet — no setup, no new wallets. When there's nothing to save, you won't even know it's there. We're starting with swaps and bridges, bu


## newyork2026 (6)

### Smile (smile-fictr) [orig 8 / prac 7 / tech 8]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place
- tagline: Standard options market potentially as popular as Robinhood, decentralized as Polymarket.
- While prediction markets — binary options on event outcomes — have been widely successful in DeFi (Polymarket, Augur), standard options have not.  In contrast, standard options are popular with retail investors, but gate kept, e.g. 2021 Gamestop trading was halted by brokers.  Prediction markets do not offer many strategies retail traders have been increasingly investing in: selling covered calls to generate yield on held ETH, selling cash-secured puts to acquire ETH at a discount, buying butterflies to express a range-bound view on volatility, etc. The building blocks for this popular market requires a functioning options market with real liquidity across strikes and expiries for standard o

### Pampalo Private Swap (pampalo-private-swap-2g5bs) [orig 8 / prac 8 / tech 9]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap Stack Contribution
- tagline: Private money on Pampalo - shield tokens, then send + swap privately on public Uniswap liquidity
- Pampalo is private money on Base. You shield your normal tokens (USDC, ETH) into private notes, and from there you can send them to people or swap them, USDC ↔ ETH, without anyone on-chain seeing who owns what. The whole project is client side first: your encryption keys are derived from your passkey (WebAuthn PRF), and the backend only ever stores ciphertext and public material - even a full database leak reveals nothing about you or your notes, your mnemonic, or who you paid. Compliance is baked in too (monthly USD caps plus a wait-and-contest window on deposits), so it's not a complete free-for-all. Basically a wallet where privacy is the default instead of a bolt-on.

### Lotus (lotus-9vnou) [orig 8 / prac 8 / tech 9]
- badges: 1inch, Uniswap
- won: 1inch - Build an Aqua App 2nd place Uniswap Foundation - Best Uniswap API Integration 1st place
- tagline: A directional liquidity for big holders, sell on the way up, never re-buy.
- Lotus is one-way directional liquidity, a maker primitive where inventory only moves one way and never trades back. A normal range order is reversible: if price falls back through it, it re-buys the asset you just sold, so you round-trip your inventory. Big holders therefore avoid on-chain depth. Lotus makes liquidity a directional intent: a maker deposits BASE across ascending price bins, takers buy cheapest-first, and once a bin fills the proceeds become claimable and can never re-enter the market, a monotonic invariant, no keeper, no oracle. Full cycle: entry via a single LI.FI Composer Flow (swap → createLadder from any token/chain); fills from the same ladder exposed on two venues, a 1i

### Stream Vaults (stream-vaults-m9qz5) [orig 8 / prac 8 / tech 9]
- badges: Ledger, Uniswap
- won: Ledger - AI Agents x Ledger 4th place Uniswap Foundation - Best Uniswap API Integration 2nd place
- tagline: Stream USDC to a Ledger-signed DCA agent that buys ETH/BTC, bounded to hours of flow, not TVL.
- StreamBot was built for the purpose of making automated DeFi strategies safer to use. For on-chain strategies — DCA, yield, hedging — to be adopted widely, users shouldn't have to lock all their capital upfront and stay 100% exposed from day one. StreamBot was built with the same goal: it replaces deposit-and-pray with capital-on-demand. You stream your capital to an autonomous bot while you use it, so your exposure is measured in hours of flow, not your full balance. Not only does it bound risk, but it also lets developers build any streaming vault — yield routing, rebalancing, hedging — on top of the same StreamVaults primitive. StreamBot is divided into three different parts: Stream => Le

### Better Wallet (better-wallet-yvjdh) [orig 7 / prac 8 / tech 8]
- badges: Uniswap
- won: Uniswap Foundation - Best Uniswap Stack Contribution
- tagline: Open-source airgapped hardware wallet with clear signing for safer self-custody
- Better Wallet is an open-source, DIY hardware wallet project focused on safer self-custody through clear signing and offline-first architecture. Instead of asking users to approve opaque payloads, it shows human-readable transaction on device so users understand exactly what they are signing. The prototype combines Raspberry Pi hardware, NFC-based interaction, and a custom mobile app to create smoother, more secure signing flows across Solana and EVM-style workflows. The goal is to make auditable, developer-friendly hardware wallet security accessible to more people. The new hardware , firmware and app has been developed from scratch at ethglobal NYC

### Chatter (chatter-hczx1) [orig 7 / prac 7 / tech 8]
- badges: ENS, Uniswap
- won: Uniswap Foundation - Best Uniswap Stack Contribution ENS - Integrate ENS Prize Pool
- tagline: Pay $1, Research trends from keywords, Review, Swap and Own the data on ENS.
- Brief Overview: Chatter is a Go-To-Market mindshare tool I extended from an open source desktop research app into a web product. Allows projects, startups, businesses and investors to see what's trending across multiple mediums without high subscription fees or the need to build complicated trending analytics tools. User Flow: Users sign in with email (Dynamic creates embedded wallet), pay $1 via Fireblocks Flow on Base Sepolia and unlock a research run across 5–20 keywords. Triggers a social scrape across sources (Reddit, HN, GitHub, Polymarket, etc.) via last30days-skill, summarizes data with Gemini into trend briefs and pairs each topic with tradable assets showing social mindshare vs onc
