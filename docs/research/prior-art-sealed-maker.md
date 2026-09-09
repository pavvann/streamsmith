# Prior-art check: "Sealed Maker" vs. the ETHGlobal showcase

Date: 2026-09-08. Scope: ethglobal.com/showcase (all events through Lisbon 2026; ETHOnline 2026 has no submissions yet), plus a short list of non-ETHGlobal neighbours.

**Concept under test.** An on-chain market maker / active LP strategy whose pricing logic runs inside a TEE (Chainlink CRE Confidential Workflow, AWS Nitro). The strategy is a 1inch SwapVM program on 1inch Aqua shared liquidity; a custom SwapVM opcode reads spread/range/skew parameters from an on-chain contract that only the enclave (via Chainlink DON-signed reports) can update. Anyone can trade against it and verify the attested code; nobody can read or copy the strategy. Depositors verify the manager instead of trusting it.

## Method

- 28 `firecrawl search` queries restricted to `site:ethglobal.com/showcase` (TEE market maker, confidential strategy vault, private AMM strategy, sealed strategy, Oasis ROFL, Phala, Marlin Oyster, iExec, Chainlink CRE confidential, FHE AMM, MPC market maker, copy-trading protection, verifiable trading agent, SwapVM, "1inch Aqua", swap-vm/opcode, sealed inference, Flare FCE/TEE, Inco/Fhenix/Zama/Arcium, dark pool 2026, Nitro, hidden strategy) plus ~12 WebSearch passes. Raw results saved under `scratchpad/.firecrawl/prior/search-*.md`.
- Scraped the showcase listing with the (undocumented but working) `?events=<slug>&partners=<slug>` filter to enumerate every project that tagged 1inch at Buenos Aires 2025, New York 2026, Lisbon 2026 and ETHOnline 2026 (empty), plus Chainlink Labs (BA, Cannes 2026, NY 2026), Oasis (BA), Flare (Cannes 2026), Canton and Unlink (NY 2026, Cannes 2026), and the full Trifecta-TEE and Open Agents listings. Prize badges on listing cards (`organizations/if0ri` = 1inch, `f8ku2` = Chainlink Labs, `1ijf8` = Oasis, `2ugg8` = Flare, `026zc` = Uniswap Foundation) were used to identify winners. Files: `listing-*.md`, `q-*.md`.
- Opened ~60 individual project pages (`proj-*.md`) for every EXACT/CLOSE candidate.
- Note: the showcase `?q=` search only matches project *names*, so keyword enumeration had to go through search engines + partner filters.

## Verdict

- **EXACT matches (full stack: Aqua/SwapVM + TEE-confidential strategy + DON/enclave-signed parameter updates): 0.**
- **EXACT-by-definition, partial (one half of the concept each): 3.** P.A.T (TEE-driven spread/skew params into an on-chain prop AMM, but Uniswap v4 hook not Aqua, and its 2025 Oasis ROFL build predates CRE confidential), CrossRevEngine (Chainlink CRE DON-signed reports compile and ship SwapVM programs to Aqua, but nothing is confidential), Baywatch (on-chain oracle signal read by custom SwapVM opcodes that re-price an Aqua pool, but the signal and logic are public).
- **CLOSE: 22** confidential/attested trading or LP-management projects (TEE/FHE/ZK) that execute on-chain. The two nearest in spirit are VeraFi (TEE-attested options market maker quoting via RFQ on Flare) and Aqua Prime (Aqua + custom SwapVM `SkewPricer` opcode whose knobs are tuned by an off-chain AI agent with an on-chain attestation hash).
- **ADJACENT: ~17** dark pools, TEE order books, private perps, privacy-pool traders.
- **Novelty conclusion:** the pieces have all been built separately at ETHGlobal (TEE-parameterised prop AMM; CRE-signed SwapVM programs; custom Aqua opcode reading tunable knobs; confidential CRE workflows that trade). No team has combined them, and no Aqua/SwapVM project has ever used a TEE or confidential compute to hide *live* strategy parameters. The "depositors verify the enclave instead of trusting the manager" framing on Aqua shared liquidity is unclaimed.

---

## Tier 1: EXACT (partial) — one half of Sealed Maker each

| Project | Event | What it did | Tech | Prizes | Match / gap |
|---|---|---|---|---|---|
| **P.A.T** — https://ethglobal.com/showcase/p-a-t-s0c42 | ETHGlobal Buenos Aires (Nov 2025) | "Proprietary AMM launchpad" on Uniswap v4 hooks. Orders are batched inside a TEE (Oasis ROFL) that runs proprietary strategies; per batch the strategy updates configurable parameters — **spread, skew, inventory targets** — that determine execution prices; reference strategy is an oracle-based constant-spread model on Pyth. Curators can plug in their own strategy contracts via an adapter interface. | Uniswap v4 hooks, Oasis ROFL (Intel TDX), Pyth pull feeds | Uniswap Foundation Volatile-Pairs Hooks **1st**, Oasis "Build with Oasis" **3rd**, Pyth Most Innovative **1st** | Closest conceptual precedent: TEE computes spread/skew off-chain, on-chain AMM settles. Gaps: Uniswap v4 hook + async batch model (not Aqua/SwapVM shared liquidity, not a continuous quote); Oasis ROFL not Chainlink CRE/DON-signed; no depositor-side attestation verification story; strategy "privacy" not the pitch (pitch was prop-AMM UX). |
| **CrossRevEngine** — https://ethglobal.com/showcase/crossrevengine-2mqi1 | ETHGlobal Buenos Aires | "Ghost AMMs": a Chainlink CRE workflow (AI inference + market data) **compiles trading logic into SwapVM bytecode, cryptographically signs a report**, LayerZero carries bytecode + capital cross-chain, the destination executor ships the strategy to Aqua, swaps, then docks. Deployed workflow to a DON. | Chainlink CRE (TS→WASM, DON-signed reports), 1inch Aqua + SwapVM (custom curves via opcodes), LayerZero V2 + Stargate | none | The exact plumbing Sealed Maker needs (CRE report → Aqua/SwapVM) exists. Gaps: no confidentiality (plain CRE in 2025, no TEE), strategy bytecode is fully public on-chain, ephemeral JIT liquidity not a standing market maker, no on-chain parameter contract / custom read opcode. |
| **Baywatch** — https://ethglobal.com/showcase/baywatch-x1az9 | ETHGlobal Lisbon 2026 | "Self-defending market maker": a cross-DEX toxicity index computed from The Graph is posted on-chain as an oracle; a 1inch Aqua pool **re-prices and tolls swaps through custom SwapVM opcodes that read that on-chain signal**; a Uniswap v4 hook applies the same defence. | 1inch Aqua + custom SwapVM opcodes, The Graph, Uniswap v4 hook | none | Same on-chain shape as Sealed Maker's "custom opcode reads parameters from an oracle-updated contract". Gaps: signal poster is a plain keeper (no TEE/attestation, anyone can read and copy the logic), parameters are toxicity surcharges not the maker's own spread/range/skew. |

Also oracle-anchored Aqua makers (letter-of-definition matches, but they only read a public price feed, not strategy parameters): **Ballast** (NY 2026, 1inch 4th; Chainlink ETH/USD anchor caps trades inside SwapVM), **ProaqctiveMM** (BA, 1inch 4th; Pyth-driven PMM on Aqua), **1Wave** (BA, 1inch 4th; Chainlink-feed rebalancing basket vault market-making on Aqua).

## Tier 2: CLOSE — confidential / attested strategies that trade or quote on-chain

| Project | Event | What it did | Tech | Prizes | Why close / why not exact |
|---|---|---|---|---|---|
| **VeraFi** — https://ethglobal.com/showcase/verafi-d62n9 | Cannes 2026 | TEE-powered **options market maker** for fXRP on Flare. Monte Carlo pricing runs inside an Intel TDX enclave (Flare Compute Extension), enclave key signs EIP-712 quotes bound to a hardware attestation registered on-chain; settlement gated by an on-chain Attestation Verifier. | Flare FCE (Intel TDX), FTSO, SecureRandom, Smart Accounts | none | Attested MM pricing in an enclave with on-chain verification. Not exact: RFQ options quotes, not AMM/LP liquidity; pricing model is public (integrity, not secrecy, is the pitch); no Aqua. |
| **Aqua Prime** — https://ethglobal.com/showcase/aqua-prime-p8wjj | Lisbon 2026 | Inventory-healing MM desk on 1inch Aqua + SwapVM. Forked swap-vm and appended custom opcode **SkewPricer**; `PrimeSelector` races candidate programs; **maker sets healing strength / skew penalty knobs, hard-capped in a gateway contract**; AI agent "Jarvis" proposes knob settings via 0G Compute and commits an attestation hash on-chain. Chainlink ETH/USD bounds fair mid. | 1inch Aqua/SwapVM (custom opcode), 0G Compute, ENS, Uniswap Trade API | none | Structurally the on-chain half of Sealed Maker (custom opcode + bounded tunable parameters + attestation). Gaps: agent runs in plain 0G Compute, knobs are public on-chain, no TEE/DON-signed update path, no depositor product. |
| **Meridian** — https://ethglobal.com/showcase/meridian-1x2ef | Cannes 2026 | Autonomous treasury FX agent. "Orchestration runs on Chainlink CRE inside confidential compute; **strategy logic, API credentials and trade parameters are encrypted even from node operators**." Executes Uniswap V3 swaps via a SwapExecutor contract; Unlink ZK pool hides treasury identity. | Chainlink CRE Confidential HTTP, Uniswap V3, Unlink | Chainlink **Best usage of Chainlink privacy standard** | First ETHGlobal project selling "strategy hidden inside CRE confidential compute, trades on-chain". Gaps: taker-side execution agent, no LP/AMM, nobody trades against it, no verification story for third parties. |
| **ZENITH** — https://ethglobal.com/showcase/zenith-iq02t | Cannes 2026 | Cross-chain yield optimiser. Blind per-chain agents (0G Compute) send encrypted proposals to a **Chainlink Confidential Compute TEE (Intel SGX)** that validates and reallocates via CCTP; "TEE attestations anchored on 0G Chain for verifiability **without revealing the underlying strategy**"; ERC-4626 vault on Arc. | Chainlink CRE/CC (SGX), 0G Compute/Storage, Circle CCTP, ERC-4626 | none | Confidential allocation strategy + attestation + depositor vault. Not a market maker; TEE simulated per write-up. |
| **Lunave** — https://ethglobal.com/showcase/lunave-5xkf2 | New York 2026 | AI-managed private USDC yield; **Chainlink Confidential AI attests the allocation decision, a CRE workflow binds it on-chain**, Ledger Secure Element signs Unlink private txs. | Chainlink Confidential AI + CRE, Unlink, Ledger BOLOS | Ledger AI Agents **1st**, Unlink Best Integration | Confidential/attested portfolio manager with hardware-bounded autonomy. No AMM/LP, no counterparties. |
| **Sluice** — https://ethglobal.com/showcase/sluice-mxbqy | Lisbon 2026 | NL → 1inch Aqua market-making strategies. LLM inference runs **inside a 0G TEE enclave "so no one can see a position before it ships and trade ahead of it"**, responses signed; deterministic compiler emits SwapVM bytecode; built the first Aqua subgraph. | 1inch Aqua/SwapVM, 0G TEE, The Graph | none | TEE privacy only at composition time; after shipping, the strategy is public bytecode. Not a live manager. |
| **Doca Finance** — https://ethglobal.com/showcase/doca-finance-rjm24 | Lisbon 2026 | Inventory-aware risk controller for Aqua: `InventorySkewProvider` behind SwapVM's dynamic-fee opcode prices budget depletion; off-chain "Harbormaster" keeper docks and re-ships underfunded strategies (signature-gated). | 1inch Aqua/SwapVM | none | Off-chain manager + custom fee provider on Aqua; fully public logic, no TEE. |
| **X-E-CUTE** — https://ethglobal.com/showcase/x-e-cute-somky | Cannes 2026 | Python framework for **verifiable automated trading strategies running inside Flare Confidential Compute (tee-node/tee-proxy container)**, FTSOv2 inputs, Uniswap API execution on Sepolia. | Flare FCC (TEE), Uniswap API | none | Strategy-in-TEE executing on-chain; taker bot, not a maker; no on-chain attestation consumer. |
| **Vela** — https://ethglobal.com/showcase/vela-4fwvn | Open Agents (2026) | "Verifiable AI fund manager": decisions generated in **Intel TDX via 0G Sealed Inference**, attestation stored on 0G DA, Uniswap v4 `beforeSwap` hook enforces Merkle-committed policy, ERC-4626 vault, Rust watchtower circuit breaker. | 0G Sealed Inference (TDX), Uniswap v4 hook, ERC-4626 | none | Attested strategy + depositor vault + EVM-enforced bounds. Trades as a taker; no market making. |
| **AetherSwarm** — https://ethglobal.com/showcase/aetherswarm-f57d7 | Open Agents | "Decentralized black-box hedge fund": AI trading logic in **0G TEE sealed inference** (with an SGX/TDX fallback simulator), libp2p agent mesh, output drives a Uniswap v4 `SwarmHook` that **adjusts pool fees**. | 0G TEE, Uniswap v4 hook, ERC-7857 | none | Explicit "strategy stays a cryptographic black-box" pitch; LP-side action limited to dynamic fees; heavy simulation. |
| **AgentFund** — https://ethglobal.com/showcase/agentfund-ad7ev | Open Agents | Marketplace where trading strategies are iNFTs; agent brain on **0G Compute sealed inference (TEE-attested)**, depositors fund ERC-4626 vaults, executes via KeeperHub with Uniswap routing. | 0G Compute/Storage, ERC-4626, KeeperHub | none | "Depositors back a sealed strategy" product shape; taker execution only. |
| **Kondor** — https://ethglobal.com/showcase/kondor-4bvt5 | Cannes 2026 | ENS-subdomain programmable wallet; **policies encrypted client-side (ECDH with the CRE's public key), only the CRE workflow can decrypt**, evaluates conditions, executes Uniswap batch swaps via DON-signed report to `KondorRegistry`. | Chainlink CRE, ENS, Uniswap EIP-5792, Railgun | ENS Most Creative **2nd** | Encrypted-policy-only-readable-by-CRE + signed-report execution is exactly Sealed Maker's control path; applied to personal payment routing, not market making. |
| **AIMM** — https://ethglobal.com/showcase/aimm-ajcan | Buenos Aires | AI agents market-making low-liquidity prediction markets; **CRE used as a "private environment for fair-price market pricing"**. | Chainlink CRE, Pyth, Base | Chainlink Best CRE workflow, Pyth **2nd** | Private pricing for a market maker via CRE; off-chain venue (Polymarket/Kalshi), not on-chain liquidity. |
| **Trade Royale** — https://ethglobal.com/showcase/trade-royale-esviu | New York 2026 | AI trading tournament; **vaults shielded with Unlink ZK so rivals "can't copy your strategy or front-run"**; Chainlink CRE snapshots NAV and settles via DON-signed report. | Unlink, Chainlink CRE, LI.FI, Claude Agent SDK | Privy Best AI agent | Copy-trading-proof vault framing + CRE settlement; strategy hidden by ZK balance privacy, not by hiding logic; no LP. |
| **Cleverly Using Money** — https://ethglobal.com/showcase/cleverly-using-money-pogqu | Buenos Aires | Noir-based **Private Vault (Tornado-style) whose anonymous LP funds are routed into Aqua strategies** chosen by curators. | Noir, 1inch Aqua | 1inch Build an Aqua App **2nd** | Depositor privacy on Aqua; strategy itself public. |
| **Private Deals** — https://ethglobal.com/showcase/private-deals-rqdm8 | Buenos Aires | (Incomplete) **Aqua-compatible privacy pool for institutional LPs** using Aztec PXE for private balances/intents and SwapVM `extruction`/maker callbacks. | 1inch Aqua/SwapVM, Aztec | Aztec Privacy Across Chains | Institutional-LP privacy on Aqua; not strategy privacy. |
| **Siphon.Money** — https://ethglobal.com/showcase/siphon-money-krzg3 | Lisbon 2026 | Private DeFi execution: ZK vault + **FHE-encrypted strategy trigger prices/amounts**, executor checks conditions via FHE engine; **optional Phala TEE** for autonomous triggering; Uniswap V3 settlement. | tfhe-rs, Groth16, Phala, Pyth | none | Encrypted strategy conditions executing on-chain; taker limit orders, not market making. |
| **Shayd** — https://ethglobal.com/showcase/shayd-4w0ry | Buenos Aires | f(x)-protocol fork: **Oasis ROFL TEE keeper bundles many users' leveraged positions into one so liquidation prices stay private**. | Oasis ROFL | none | TEE hides positions from hunters; not an LP strategy. |
| **Alloy** — https://ethglobal.com/showcase/alloy-8bje7 | Buenos Aires | Autonomous AI agents whose brain and keys live in **Oasis ROFL**; execute across 60+ chains via MCP. | Oasis ROFL, MCP | none | TEE trading agent infra; no market making. |
| **4g3n7** — https://ethglobal.com/showcase/4g3n7-33h7q | Trifecta TEE (2025) | "Verifiable auto trader": attestation service in **Marlin CVM**, PCR chain of trust, audit trail; trading engine on a normal server. | Marlin Oyster CVM | none | Attested trading agent; only attestation in TEE. |
| **Rebalancer** — https://ethglobal.com/showcase/rebalancer-vaz83 | Open Agents | iNFT-owned Uniswap V3 LP rebalancer; policy on 0G Storage, 0G Compute recommendations, decision registry. | 0G, KeeperHub | none | Agent LP manager; no confidentiality. |
| **Scipio: Agent Vaults** — https://ethglobal.com/showcase/scipio-agent-vaults-zfr47 | Lisbon 2026 | ERC-4626 vault curated by an autonomous LLM; **mandate hash committed at genesis so depositors verify the mandate**; guardian pause, redeem-in-kind. | ERC-4626, The Graph MCP | none | "Depositors verify the manager" framing without TEE; allocation not market making. |

## Tier 3: ADJACENT (order/size privacy, TEE venues, private OTC)

- **SoloPatty** (Trifecta TEE; Marlin TEE order matching; Marlin Best use **+** Trifecta finalist) — https://ethglobal.com/showcase/solopatty-5ua9t
- **BlackBook** (Trifecta TEE; SGX in-memory order book; t1 2nd) — https://ethglobal.com/showcase/blackbook-36mz7
- **Corex** (Cannes 2026; dark-pool spot exchange inside Flare Compute Extension TEE; Flare bonus track) — https://ethglobal.com/showcase/corex-ddu93
- **Dark Pools** (NY 2026; Canton dark pool, selective disclosure; Canton prize) — https://ethglobal.com/showcase/dark-pools-pgah9
- **Nyx** (NY 2026; private perp DEX on Canton, Chainlink Data Streams; Canton 1st + Chainlink) — https://ethglobal.com/showcase/nyx-prk3o
- **DarkMargin** (NY 2026; private perps on Canton) — https://ethglobal.com/showcase/darkmargin-etnqz
- **Murmur** (Open Agents; agent dark pool over Gensyn AXL, atomic settle) — https://ethglobal.com/showcase/murmur-tokxi
- **Fugazi** (Fhenix FHE AMM-based dark pool) — https://ethglobal.com/showcase/fugazi-nxpt2 ; **QuantumPools** (FHE dark pool) — https://ethglobal.com/showcase/quantumpools-n2s8h
- **Shade** (NY 2026; Unlink hides an agent's x402 data purchases so its strategy can't be reconstructed) — https://ethglobal.com/showcase/shade-rkfzc
- **FlexProver** (Cannes 2026; Flare TEE attests CEX PnL without revealing keys; Flare 2nd) — https://ethglobal.com/showcase/flexprover-7xuf8
- **Overlap** (Lisbon 2026; sealed two-party negotiation judged by 0G TEE model) — https://ethglobal.com/showcase/overlap-7ninc
- **Aphotic** (Lisbon 2026; Seal-encrypted sealed-order batch auction on Sui) — https://ethglobal.com/showcase/aphotic-a9tce
- **Confidential Hook** (HackMoney 2026; Noir ZK Uniswap v4 hook, "keep LP position sizes and strategies private") — https://ethglobal.com/showcase/confidential-hook-7v9t1
- **Private FHE Intents** (BA; Zama FHE encrypted intents + delta-neutral rebalancing hook; Uniswap 2nd, Pyth 5th) — https://ethglobal.com/showcase/private-fhe-intents-4hrso
- **Shadow Nox** (ETHOnline 2025; dark-pool-like DeFi on Arcology) — https://ethglobal.com/showcase/shadow-nox-xybiv
- **Ascenda** (Unite DeFi; FHEVM confidential derivatives strategies) — https://ethglobal.com/showcase/ascenda-w24z5

---

## Complete enumeration of 1inch Aqua / SwapVM projects at ETHGlobal

Source: `showcase?events=<event>&partners=1inch` listings (projects that tagged 1inch), cross-checked against search hits. Bold = won a 1inch prize (badge `if0ri`). "Param source" = what sets/steers the strategy at run time.

### ETHGlobal Buenos Aires (Nov 2025) — first Aqua event, $17k "Build an Aqua App"
| Project | Param source / off-chain actor | Notes |
|---|---|---|
| **Aqua Outcome Market** (1st) — https://ethglobal.com/showcase/aqua-outcome-market-0va0j | none (pm-AMM invariant in SwapVM; Euler EVC JIT hook) | custom instructions |
| **Cleverly Using Money** (2nd) — https://ethglobal.com/showcase/cleverly-using-money-pogqu | curator-chosen strategies; zk Private Vault | LP privacy |
| **ProaqctiveMM** (4th) — https://ethglobal.com/showcase/proaqctivemm-f0y6v | **Pyth oracle** price | PMM on Aqua |
| **1Wave** (4th) — https://ethglobal.com/showcase/1wave-9ypfs | **Chainlink feeds** + TWAP | basket vault MM via Factor SDK |
| **Aqua0** (4th) — https://ethglobal.com/showcase/aqua0-u2krx | none | LayerZero cross-chain Aqua |
| **aqua-flash-loans** — https://ethglobal.com/showcase/aqua-flash-loans-egocw | none | flash loans on Aqua |
| **Omni402** — https://ethglobal.com/showcase/omni402-dvpjd | none | x402 payments via SwapVM |
| **Coco** — https://ethglobal.com/showcase/coco-dvaxo | none | savings via Aqua |
| **RageQuit Kit** — https://ethglobal.com/showcase/ragequit-kit-jb53p | none | exit tool |
| **MEGA Quant** (1inch API prize) — https://ethglobal.com/showcase/mega-quant-6bvz2 | off-chain desktop quant strategies | not Aqua |
| CrossRevEngine — https://ethglobal.com/showcase/crossrevengine-2mqi1 | **Chainlink CRE DON-signed reports compile+ship SwapVM bytecode** | see Tier 1 |
| Private Deals — https://ethglobal.com/showcase/private-deals-rqdm8 | Aztec private intents | incomplete; Aztec prize |
| Pagga — https://ethglobal.com/showcase/pagga-b0szs | RFQ/auction, Aqua mock | agent credit |
| Poorps — https://ethglobal.com/showcase/poorps-jg27k | Chainlink/Pyth vAMM version | memecoin perps |
| Agentrade, parcelito, BridJet, ORYR, blockhead.vision, Unimagnifier, Yield Lab, Heira, TurtleCare, AgentFi | — | 1inch-tagged, not Aqua-centric |

### ETHGlobal New York 2026 (Jun 2026) — $7k
| Project | Param source | Notes |
|---|---|---|
| **RiverSwap** (1st) — https://ethglobal.com/showcase/riverswap-bat5v | on-chain fee-right auction (am-AMM) | concentrated liquidity on SwapVM |
| **Lotus** (2nd; also Uniswap API 1st) — https://ethglobal.com/showcase/lotus-9vnou | none ("no keeper, no oracle") | 3 custom opcodes `ONEWAY_FILL*` |
| **TenorFi** (1inch badge) — https://ethglobal.com/showcase/tenorfi-06wnb | — | fixed funding rate on Hyperliquid |
| **Ballast** (4th) — https://ethglobal.com/showcase/ballast-7jpyp | **Chainlink ETH/USD anchor read inside the swap** | leveraged oracle-anchored Aqua liquidity |
| Smile, T+0 Settlement | — | tagged 1inch, no Aqua prize |

### ETHGlobal Lisbon 2026 (Jul 2026) — $7k incl. continuity track
| Project | Param source | Notes |
|---|---|---|
| **ArcBook** (1st; Graph 2nd; Finalist) — https://ethglobal.com/showcase/arcbook-twp2a | maker-set curve params (start/end price, alpha) | functional order book compiled to SwapVM |
| **KSwap-VM** (3rd) — https://ethglobal.com/showcase/kswap-vm-aix5n | — | K/Kontrol formal verification of swap-vm |
| **Agora Markets**, **Votive**, **Pool Party** (1inch badges) | — | prediction-governance / wish funding / neobank |
| Aqua Prime — https://ethglobal.com/showcase/aqua-prime-p8wjj | **AI agent (0G) sets bounded knobs; attestation hash on-chain** | custom `SkewPricer` opcode; see Tier 2 |
| Baywatch — https://ethglobal.com/showcase/baywatch-x1az9 | **on-chain oracle signal read by custom opcodes** | see Tier 1 |
| Doca Finance — https://ethglobal.com/showcase/doca-finance-rjm24 | off-chain keeper re-ships; dynamic-fee opcode | see Tier 2 |
| Sluice — https://ethglobal.com/showcase/sluice-mxbqy | **0G TEE inference at composition** | see Tier 2 |
| Vortex — https://ethglobal.com/showcase/vortex-aowex | off-chain proposes (EIP-712 sessions), on-chain disposes | prop-style MM on Aqua vs Uniswap |
| QilinSwap — https://ethglobal.com/showcase/qilinswap-pzccy | maker-drawn CFG; 2 custom opcodes (`InventorySkew`, `IfInventoryAbove`) | visual builder |
| Aquapilot — https://ethglobal.com/showcase/aquapilot-03izt | LLM fills typed params → template | composer/validator |
| wave — https://ethglobal.com/showcase/wave-i97sc | Chainlink deviation circuit breaker | compiler + social feed |
| ScubaSwap — https://ethglobal.com/showcase/scubaswap-4k2jm | World ID ZK proof in-swap (2 custom instructions) | human-tiered pricing |
| SeaLevel — https://ethglobal.com/showcase/sealevel-qg699 | none | stablecoin AMM in "Plank" |
| signalflo — https://ethglobal.com/showcase/signalflo-k8jiw | fund-manager calls → members ship Aqua positions | social alpha |
| Scipio, Omega, bebecita, intentional.so, Superpose, Turing Swap, Alba | — | 1inch-tagged, Aqua peripheral |

### ETHOnline 2026 (in progress) — 0 submissions visible yet. ETHOnline 2025, HackMoney 2026, Cannes 2026, Open Agents did not have a 1inch/Aqua track.

**Takeaway for the enumeration:** across ~50 Aqua-tagged projects, the only run-time parameter sources ever used are public price oracles (Pyth/Chainlink), a public on-chain signal (Baywatch), an unattested off-chain keeper/agent (Doca, Vortex, Aqua Prime), or CRE-signed *public* bytecode (CrossRevEngine). No Aqua/SwapVM project has hidden its live strategy parameters behind a TEE or confidential workflow, and none used AWS Nitro.

## Chainlink CRE events checked for confidential trading

- **Cannes 2026** (Chainlink Labs sponsor, first event with the Privacy Standard): Meridian (privacy prize), ZENITH, Kondor, AIMM-style CRE uses (Flow Broker, TWAP CHOP, SENTINEL, PayMate, Folio). Meridian is the only one hiding *trade strategy* in confidential compute.
- **New York 2026**: Lunave (Confidential AI + CRE), Trade Royale (CRE settlement), Nyx (Data Streams), BankOS. No confidential market maker.
- **Buenos Aires 2025**: AIMM (CRE prize), CrossRevEngine, Ketchup risk oracle. Pre-confidential CRE.
- **ETHOnline 2025**: Chainlink was not a sponsor (prize index has no Chainlink page); Shadow Nox was the only dark-pool entry.

## Non-ETHGlobal near-neighbours (one line each)

- **Oasis WT3** — autonomous trading agent in Oasis ROFL (Intel TDX) that keeps its strategy private and posts verifiable decisions on Sapphire; taker bot, no LP (https://github.com/oasisprotocol/wt3).
- **Anafi** (ana.fi) — "confidential execution substrate" running user strategies + signing keys in a Phala dstack TDX CVM, with actions interpreted on-chain "1inch swapVM style"; the closest live product to Sealed Maker's architecture, but a personal-strategy engine rather than a shared-liquidity market maker.
- **Carrot x Oasis** — ROFL-verified on-chain prop trading (oasis.net blog).
- **Chainlink Convergence hackathon (2026)** — privacy winners SSL (dark pool for tokenized RWAs on CRE) and TACIT (private OTC settlement); "autonomous trading risk gates" in CRE & AI track; no confidential AMM.
- **Renegade** — MPC/ZK on-chain dark pool (order privacy, not strategy privacy).
- **Uniswap/Unichain TEE block building** and the Chainscore "TEE-based AMM" glossary entry describe the primitive abstractly; no shipped TEE-parameterised AMM found.

## Implications for novelty at ETHOnline 2026

1. **No exact precedent.** Nobody has shipped an Aqua/SwapVM maker whose live pricing parameters are written only by an attested enclave via DON-signed reports. The three partial precedents (P.A.T, CrossRevEngine, Baywatch) each prove one leg works and none was pitched as "sealed strategy".
2. **Judges will have seen the ingredients.** 1inch judges saw Aqua Prime's `SkewPricer` + AI-tuned knobs and Baywatch's oracle-read opcodes (Lisbon); Chainlink judges saw Meridian/Kondor/Lunave (encrypted logic only CRE can read, executed by signed report). Sealed Maker's differentiator must be stated crisply: *the strategy is a standing market maker that anyone can trade against, its code is attested and its parameters are unreadable/uncopyable, and depositors verify the enclave measurement instead of trusting a manager.*
3. **Watch-outs to pre-empt in the pitch:** (a) P.A.T already won Uniswap 1st + Oasis 3rd + Pyth 1st with "TEE sets spread/skew for a prop AMM" — explicitly contrast Aqua shared liquidity, continuous quoting, Nitro/CRE attestation-on-chain and depositor verification; (b) the 1inch prize text says SwapVM opcode modifications score higher — Sealed Maker's parameter-read opcode aligns, but Aqua Prime, Lotus, QilinSwap, ScubaSwap, Baywatch have all added custom opcodes, so the opcode itself is not novel; the *access control on the parameter contract (only DON-signed reports from an attested workflow)* is; (c) be honest about what the TEE hides: parameters and logic, not fills (fills are public on Aqua) — Trade Royale/Shade-style "copy-trading-proof" claims are already common, so lean on "verify the manager" rather than only "hide the strategy".
4. **Unclaimed combinations worth owning:** Chainlink CRE Confidential Workflow → Aqua/SwapVM (only CrossRevEngine touched CRE→SwapVM, unconfidentially); AWS Nitro attestation verified on-chain for an AMM (no ETHGlobal project used Nitro for trading at all); depositor-side attestation verification for a market maker (only Scipio's mandate-hash and Vela's watchtower approach the idea, neither for LP).
