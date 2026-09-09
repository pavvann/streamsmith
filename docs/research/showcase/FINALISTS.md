# Finalists (33)

### Yoga (yoga-up5v4) [buenosaires] [orig ? / prac ? / tech ?]
- badges: FINALIST, Octav
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist Octav - Best Octav Widget 2nd place
- tagline: An improved position manager that allows for arbitrary liquidity distribution
- Yoga the project implements a non-fungible position manager that allows liquidity providers to manage complex, multi-range positions within a single NFT. Unlike traditional position managers that represent one price range per NFT, Yoga can manage multiple sub-positions (different tick ranges) under a single ERC721 token, enabling sophisticated liquidity distribution strategies across price ranges. The contract exposes a simple ABI that allows LPs to simply specify the modification (liquidity delta) they wish to apply, and the contract figures out how to modify the underlying UniV4 position.

### Aqua0 (aqua0-u2krx) [buenosaires] [orig ? / prac ? / tech ?]
- badges: 1inch, FINALIST, LayerZero, World
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist World - World Pool Prize Prize Pool 1inch - Build an Aqua App 4th place LayerZero - Best Omnichain Implementation 2nd place
- tagline: Mini App for Cross-Chain shared liquidity via Aqua AMMs and LayerZero
- Aqua is a shared liquidity layer developed by 1inch that solves the inefficiency problems currently existing in AMMs. The problems are: 1) 90% of AMM liquidity is never used, generating immobilized liquidity. 2) This leads to fragmented liquidity, as AMMs end up having idle and unutilized liquidity across different LPs in different protocols and chains. Aqua0, our solution, evolves Aqua in a cross-chain manner. The problem Aqua currently has is that it's an accounting layer only usable on one chain at a time. That's why in Aqua0 we're going to create a cross-chain marketplace for AMMs, where we'll use Layer Zero composers across different chains, and Aqua's shared liquidity contracts, to all

### Halo (halo-hi8bv) [buenosaires] [orig ? / prac ? / tech ?]
- badges: FINALIST, Fluence, World
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist Fluence - Best use of Fluence CPU Cloud API World - Best Mini App 1st place
- tagline: Receipts become rewards for World ID verified humans with Fluence compute and Filecoin storage.
- Halo is a World Chain miniapp that turns real receipts into onchain rewards for verified humans. Users scan a receipt from any store, and Halo evaluates it through a lightweight processing pipeline before granting rewards to a World ID verified user. Personal identity remains private throughout the flow. Receipts contain valuable signals about real economic behavior, but this information is usually lost or locked inside closed systems. Halo captures it responsibly. Each receipt is processed to extract details such as merchant, timestamp, total, currency and category. Rewards can only be claimed by unique humans, creating a sybil resistant and privacy preserving way to connect offline actions

### Paybot (paybot-q7grd) [buenosaires] [orig ? / prac ? / tech ?]
- badges: FINALIST
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist
- tagline: x402 payment gateway for robot rentals. Gasless blockchain payments for physical devices.
- PayBot demonstrates the X402 Payment Required protocol for physical device access control through blockchain micropayments. Built for the Coinbase Developer Platform Hackathon, it showcases gasless transactions enabling pay-per-use robot control with QUSD stablecoin payments, without requiring users to hold ETH for gas fees. The system implements a complete payment facilitator architecture where users sign QUSD payment authorizations in their wallet, and a facilitator service submits the transaction on-chain while paying gas fees. This enables true micropayments for IoT and robotics applications where gas costs would otherwise be prohibitive. The payment flow: User clicks to unlock robot acc

### BMCP (bmcp-pfm11) [buenosaires] [orig ? / prac ? / tech ?]
- badges: Chainlink, Citrea, FINALIST
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist Citrea - All-In Bitcoin 1st place Chainlink - Connect the World with Chainlink Chainlink - Best workflow with Chainlink CRE
- tagline: From Taproot to Uniswap: Sign on Bitcoin, trade on Polygon. Hybrid relayer, zero trust bridges
- BMCP (Bitcoin Multichain Protocol) bridges Bitcoin and EVM chains with true cross-chain programmability. Users can trigger EVM transactions (DeFi swaps, token transfers, contract calls) by signing a Bitcoin transaction using native Schnorr signatures (Taproot/BIP340). The Cross-chain Relayer Engine (CRE) scans Bitcoin blocks and, on detection of valid, Schnorr-authenticated BMCP messages embedded in OP_RETURN, executes secure calls both offchain (risk management, validation) and onchain (contract invocation) across Polygon, Ethereum, and more—seamlessly leveraging Chainlink CCIP. BMCP ensures all flows remain trust-minimized, cryptographically anchored to Bitcoin finality, and composable acr

### LensMint Camera (lensmint-camera-yzu6m) [buenosaires] [orig ? / prac ? / tech ?]
- badges: FINALIST, vlayer
- won: ETHGlobal - 🏆 ETHGlobal Buenos Aires 2025 Finalist vlayer - Best ZK Proving dApp
- tagline: Tamper-proof Web3 camera with ZK authenticity and instant NFT memories for everyone.
- LensMint is a full hardware-to-blockchain camera system designed to guarantee the authenticity and ownership of real-world photos. Built on a Raspberry Pi camera with hardware-derived cryptographic identity, every photo is signed at capture, hashed, and proven genuine using zero-knowledge proofs generated through vlayer and verified on-chain via RISC Zero. The system uploads all media to Filecoin for permanent decentralized storage and mints an ERC-1155 NFT representing the authenticated memory. A built-in QR system lets people in the photo instantly claim their NFT, enabling proof of attendance, verified memories, and automatic revenue sharing. LensMint provides a trustless way to prove a p

### maki (maki-564eg) [cannes2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST
- won: 
- tagline: Maki — AI agent for onchain DeFi. Keys locked in hardware, unreachable by the model.
- 

### Défi (defi-e9zii) [cannes2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST
- won: 
- tagline: Défi is a gamified 1v1 live DeFi trading competition platform.
- 

### ALMA (alma-07pzd) [cannes2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST, Uniswap
- won: Uniswap Foundation - Best Uniswap API Integration 3rd place ETHGlobal - 🏆 ETHGlobal Cannes 2026 Finalist
- tagline: Automated Liquidity Management Agent for your Uniswap positions
- ALMA (Autonomous Liquidity Management Agent) is a fully autonomous rebalancing system for concentrated liquidity positions on Uniswap V4. The problem: Over 40% of concentrated liquidity positions sit out of range at any given time, earning zero fees. Most LPs are passive, they don't monitor positions 24/7, and manually rebalancing means signing multiple transactions, timing swaps, and choosing new tick ranges. Studies show half of all Uniswap V3 LPs would have been better off just holding. How ALMA works: Users connect their wallet (delegated to Calibur via EIP-7702), sign once with an EIP-712 typed data signature, and ALMA takes it from there. That single signature registers the agent's key

### npmguard (npmguard-aeihd) [cannes2026] [orig 7 / prac 8 / tech 8]
- badges: ENS, FINALIST
- won: 
- tagline: NpmGuard: AI agents audit npm packages for malicious code, publish verifiable results on-chain.
- 

### VEIL VPN (veil-vpn-c643n) [cannes2026] [orig 8 / prac 7 / tech 8]
- badges: Arc, ENS, FINALIST, World
- won: 
- tagline: Verifiable Encrypted Internet Layer, is the pay as you go VPN protocol that proves no logs are kept.
- 

### ENShell (enshell-6t95y) [cannes2026] [orig 8 / prac 8 / tech 9]
- badges: Chainlink, FINALIST
- won: 
- tagline: ENShell Prevents AI agents from executing malicious transactions caused by prompt injection attacks.
- 

### Corpus (corpus-j7an5) [cannes2026] [orig 8 / prac 7 / tech 8]
- badges: FINALIST
- won: 
- tagline: Turn any product into an autonomous AI agent corp that runs GTM, trades, and earns for you.
- 

### DIVE (dive-5hxbp) [cannes2026] [orig 8 / prac 7 / tech 8]
- badges: 0G, FINALIST, Hedera, World
- won: 
- tagline: AI swarm engine verifying real-world truth for prediction markets and autonomous on-chain settlement
- 

### PaintGlobal (paintglobal-v4pwo) [cannes2026] [orig 8 / prac 7 / tech 7]
- badges: FINALIST
- won: 
- tagline: NFC wristbands power an on-chain art contest with voting, NFTs and auctions from the workshop.
- 

### ArcBook (arcbook-twp2a) [lisbon2026] [orig 8 / prac 8 / tech 9]
- badges: 1inch, FINALIST, Graph
- won: 1inch - Build an Aqua App 1st place The Graph - Best AI Tooling for The Graph 2nd place ETHGlobal - 🏆 ETHGlobal Lisbon 2026 Finalist
- tagline: An onchain order book where makers publish executable curves instead of fixed-price orders.
- Traditional order books force market makers to split liquidity across many independent price-and-size levels, while conventional AMMs place everyone inside a shared pool curve. ArcBook introduces a functional order book in which every maker position is itself a bounded, executable pricing curve. A maker independently configures buy and sell inventory, starting and ending prices, and an alpha parameter that continuously shapes how liquidity is distributed through the range. Equal endpoint prices reduce to an ordinary fixed-price limit order, so the classical order book is a special case. As one side executes, the assets received are automatically recycled into the opposite side while preservi

### KOLlateral (kollateral-ho1d1) [lisbon2026] [orig 7 / prac 8 / tech 8]
- badges: 0G, FINALIST, Uniswap
- won: 0G - Best AI Product on 0G 3rd place Uniswap Foundation - Best Uniswap API Integration 1st place ETHGlobal - 🏆 ETHGlobal Lisbon 2026 Finalist
- tagline: The accountability layer for crypto influencers: build a verifiable record, back the real traders.
- Crypto influencers operate with almost no accountability. They post hundreds of "calls" a week, delete the ones that lose, and there is no shared record of whether following them ever made money. KOLlateral fixes both sides of that with one thing: a public, verifiable track record. For a caller who is actually good, that record is an asset they own. Every explicit call they make in public becomes a structured signal (asset, direction, target, confidence) and gets priced against real DEX history, so their edge shows up as numbers they can point to: what following them returned versus just holding ETH. Losing calls are archived and flagged in red instead of disappearing. Each call is checked a

### Glassbox402 (glassbox402-qyepd) [lisbon2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST, Hedera
- won: 
- tagline: Google Analytics for x402 - Convert any API into an x402. Track every payment in one dashboard.
- 

### Carte Bleue (carte-bleue-ftuuc) [lisbon2026] [orig ? / prac ? / tech ?]
- badges: FINALIST
- won: 
- tagline: Recover any smart wallet using real credit cards and a standard cheap card reader.
- 

### Lortnoc Tahc (lortnoc-tahc-y1d3j) [lisbon2026] [orig ? / prac ? / tech ?]
- badges: 0G, FINALIST
- won: 
- tagline: Hide real messages inside ordinary Telegram chats. Everyone else sees small talk.
- 

### Hands Unchained (hands-unchained-6kdf3) [lisbon2026] [orig 8 / prac 8 / tech 9]
- badges: 0G, FINALIST, World
- won: 
- tagline: Book a robot arm, execute tasks. Book on chain, drive from your browser, get paid if you did well.
- 

### explorador.pt (explorador-pt-35okq) [lisbon2026] [orig 8 / prac 7 / tech 9]
- badges: FINALIST
- won: 
- tagline: Collateralize the home you're selling to draw stablecoin liquidity for the new one.
- 

### Happy Hour (happy-hour-v3o03) [lisbon2026] [orig ? / prac ? / tech ?]
- badges: 0G, FINALIST
- won: 
- tagline: Find local happy hours and earn punch-card rewards at your favorite venues.
- 

### Immunity (immunity-eg56a) [newyork2026] [orig 8 / prac 7 / tech 9]
- badges: Chainlink, ENS, FINALIST
- won: 
- tagline: On-chain immune system for AI agents : earn by minting antibody
- 

### LYNX (lynx-ta08o) [newyork2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST
- won: 
- tagline: The terminal that turns prediction markets into baskets you can buy beside real assets.
- 

### UNSU (unsu-o1e71) [newyork2026] [orig 8 / prac 8 / tech 8]
- badges: ENS, FINALIST
- won: 
- tagline: unsu is a crypto wallet that works in any browser. No apps, no extensions, no accounts.
- 

### Proof of Scan (proof-of-scan-trx38) [newyork2026] [orig ? / prac ? / tech ?]
- badges: ENS, FINALIST, Sui
- won: 
- tagline: Crowdsourced website scanner for security researchers to bypass cloaked phishing sites
- 

### The Wallet Shift (the-wallet-shift-pqdxy) [newyork2026] [orig ? / prac ? / tech ?]
- badges: FINALIST, GCloud
- won: 
- tagline: DeFiLlama for the on-chain AI agent economy: a live, agent-callable ERC-8004 directory.
- 

### Distro (distro-h393v) [newyork2026] [orig 7 / prac 8 / tech 8]
- badges: FINALIST, World
- won: 
- tagline: Distro fixes clipping marketplaces to give brands and builders more reach with crypto infra.
- 

### Accrue (accrue-racfy) [newyork2026] [orig 8 / prac 8 / tech 8]
- badges: FINALIST, Hedera
- won: 
- tagline: Get paid to wait. The most-watched line on Earth is now a bot-proof on-chain ad market.
- 

### Void Tactics (void-tactics-ag25f) [newyork2026] [orig ? / prac ? / tech ?]
- badges: Dynamic, FINALIST, World
- won: 
- tagline: Tactical onchain fleet combat: Dynamic Flow purchases, World ID sybil resistance, Walrus game replay
- 

### Canary (canary-kh3h7) [newyork2026] [orig 8 / prac 8 / tech 9]
- badges: Chainlink, FINALIST
- won: 
- tagline: Parametric insurance instrument underwritten and priced by prediction markets
- 

### Cumulant (cumulant-xfzya) [newyork2026] [orig 8 / prac 7 / tech 8]
- badges: Arc, FINALIST
- won: 
- tagline: Structured products on prediction markets - baskets, tranches, PPNs, & continuous markets
- 
