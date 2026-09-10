# Pinned vaults (Base, chain id 8453)

Resolved 2026-09-09. Every value cites its source. **UNVERIFIED** marks items not confirmed against a primary source.

## Identity

| | Vault A | Vault B |
|---|---|---|
| Name in brief / PROJECT.md | "Gauntlet USDC Prime" | "Steakhouse Prime" |
| Name in Privy setup doc | "Gauntlet USDC Prime (USDC on Base)" | **"Steakhouse Prime Instant (USDC on Base)"** |
| On-chain `name()` | `Gauntlet USDC Prime` | **`Steakhouse Prime USDC`** |
| On-chain `symbol()` | `gtusdcp` | `steakUSDC` |
| Address (Base) | `0x050cE30b927Da55177A4914EC73480238BAD56f0` | `0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9` |
| Lowercase (for params / store keys) | `0x050ce30b927da55177a4914ec73480238bad56f0` | `0xbeef0e0834849acc03f0089f01f4f1eeb06873c9` |
| Contract type | Morpho **Vault V2** (`type: MorphoVault`, `listed: true`) | Morpho **Vault V2** (`type: MorphoVault`, `listed: true`) |
| Curator (Morpho API) | Gauntlet | Steakhouse Financial |
| Share `decimals()` | 18 (`0x12`) | 18 (`0x12`) |
| `asset()` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (Base USDC) | same |
| Asset decimals | 6 (Morpho API `asset.decimals: 6`) | 6 |
| Creation block | 37,179,342 (2025-10-22T15:47:11Z) | 37,404,640 (2025-10-27T20:57:07Z) |
| `convertToAssets(1e18)` at head 2026-09-09 ~17:13Z | `0xfe166` = 1,040,742 (≈1.040742 USDC per share) | `0xfde28` = 1,039,912 (≈1.039912 USDC per share) |

**Name discrepancy to resolve with the human:** the brief says "Steakhouse Prime"; Privy's dashboard list says "Steakhouse Prime Instant"; the contract says "Steakhouse Prime USDC". All three point at `0xbeef…73C9` per the Privy link. Vaultpilot copy should use the on-chain name or the Privy dashboard name consistently.

### Sources
- Addresses + Privy naming: https://docs.privy.io/wallets/actions/earn/setup.md — "* [Gauntlet USDC Prime (USDC on Base)](https://app.morpho.org/base/vault/0x050cE30b927Da55177A4914EC73480238BAD56f0/gauntlet-usdc-prime)" and "* [Steakhouse Prime Instant (USDC on Base)](https://app.morpho.org/base/vault/0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9/steakhouse-prime-instant)".
- On-chain `name()`/`symbol()`/`decimals()`/`asset()`/`convertToAssets()`: `eth_call` via public RPCs `https://mainnet.base.org` and `https://base-rpc.publicnode.com` (selectors `06fdde03`, `95d89b41`, `313ce567`, `38d52e0f`, `07a2d13a`), 2026-09-09. Raw returns saved in the session scratchpad; e.g. Gauntlet `name()` → `…000000134761756e746c65742055534443205072696d65…` ("Gauntlet USDC Prime"), Steakhouse `symbol()` → `…0000000009737465616b55534443…` ("steakUSDC").
- Morpho API: `POST https://api.morpho.org/graphql` `vaultV2ByAddress(address, chainId: 8453)` → names/symbols/asset/`creationBlockNumber`/`creationTimestamp`/`type`/`listed`/`curators`. (`vaultByAddress` returns `NOT_FOUND` for both — they are V2 vaults, not MetaMorpho V1.)
- Creation blocks independently confirmed by binary search on `eth_getCode` (first block with code) via `https://base-mainnet.public.blastapi.io`: 37,179,342 and 37,404,640 — identical to the Morpho API values.
- Base USDC address expectation from the brief matches `asset()` and Privy's deposit example (`"asset_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"`, https://docs.privy.io/wallets/actions/earn/deposit.md).

## Privy vault ids — NOT publicly resolvable (UNVERIFIED / pending A3)

Privy's `vault_id` is issued per app after the app deploys a fee wrapper in the Dashboard; it is not a public constant of the Morpho vault.

- https://docs.privy.io/wallets/actions/earn/setup.md: "## Copy the vault ID — After setup, Privy provides a unique `vault_id` for the vault. Copy this value — all deposit and withdraw API calls require it." and "Open the **Wallet infrastructure > Earn** page in the Privy Dashboard and configure a fee wrapper. During setup, your app selects: 1. A Morpho vault to allocate assets into 2. The percentage of generated yield your app receives 3. An admin wallet".
- https://docs.privy.io/wallets/actions/earn/providers/morpho.md: "Morpho vaults are self-serve: deploy a fee wrapper and configure a vault under **Wallet infrastructure > Earn** in the Privy Dashboard."
- Policies match on it: https://docs.privy.io/wallets/actions/earn/policies.md — `action_request_body.vault_id` with operators `eq`, `in`, `in_condition_set`; methods `earn_deposit`, `earn_withdraw`; "Earn policies use `chain_type: "ethereum"`".
- Read-back endpoint once issued: `GET https://api.privy.io/api/v1/earn/ethereum/vaults/{vault_id}` → `{ id, name, provider: "morpho", vault_address, asset{address,symbol,decimals}, caip2: "eip155:8453", … }` (https://docs.privy.io/wallets/actions/earn/get-vault-details.md).

**Action for A3/human:** deploy both fee wrappers in the Privy Dashboard, then record `vault_id` and the returned `vault_address` for each here.

### Design-changing consequence: the fee wrapper is a separate contract

Per Morpho (https://docs.morpho.org/developers/earn/concepts/fee-wrapper): "A **Fee Wrapper** is a Vault V2 configured in a specific, constrained mode … 2. **Fee Wrapper**: A lightweight **Vault V2** that deposits into the main Morpho Vault V2 … Fee Wrappers are not listed on app.morpho.org." and "**ERC-4626 Mostly Compliant** … Immutably Bound to a single Morpho Vault V2".

Therefore Privy-executed deposits/withdrawals target the **wrapper address** (Privy's `get-vault-details.vault_address`), not `0x050c…`/`0xbeef…` directly. Expected on-chain footprint (**UNVERIFIED — inferred from the architecture; confirm with the first real Privy deposit**): a `Deposit` on the wrapper with `sender`/`owner` = the Privy wallet, plus a `Deposit` on the underlying vault with `sender`/`owner` = the wrapper (or its adapter). Consequences: (1) `streamsmith.yaml.vaults` should gain the two wrapper addresses once A3 has them, so Vaultpilot can exclude its own flows from the outflow guardrail by matching `owner`/`receiver`; (2) the observation module should still sample the **underlying** vaults (the growth signal), while position accounting uses wrapper shares. Privy's doc example `vault_address` `0x5224d0c05698eD4a97C771B62095929F293f1D60` has **no code on Base** (`eth_getCode` → `0x`), so it is a placeholder, not a real wrapper. Morpho's doc shows a real Base fee wrapper example `0x2861ABE7AB28484Fb8375def4A7eb56C8F53fE8F` (ownership unknown, UNVERIFIED) that could be used to observe wrapper event shape before ours exists.

## Recent block range with Deposit/Withdraw activity (gate range)

Scanned with `eth_getLogs` on `https://1rpc.io/base` (50-block windows; topics `Deposit` `0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7`, `Withdraw` `0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db`), 2026-09-09 ~17:17Z.

- Events found in **51,092,263 – 51,092,449** (187 blocks): **42** logs on the two vaults; Gauntlet: 33 Deposit + 7 Withdraw; Steakhouse: 1 Withdraw (block 51,092,316, tx `0xf3188ffdb3d650e0f0a876391700726684bbb25ff54f802aea1dd87af514973b`, logIndex 163, assets 2,210,001, shares 2,125,180,826,770,979,130) + 1 Deposit (block 51,092,402, tx `0x640557be0ab1dae20ea52973bdee493f7851919e2bdd745412bd8160876fd751`, logIndex 521, assets 10,000,000, shares 9,616,196,376,594,418,305).
- First event: block 51,092,263, Gauntlet Deposit, tx `0x0fe8b63d99cbe6eac9baab1967e9011d7de8a52fa6d5d210b15b4aa4c80a12b4`, logIndex 406, assets 197,373,726 (197.373726 USDC), shares 189,647,169,910,852,085,674 → deposit-implied execution rate ≈ 1.0407 USDC/share (matches `convertToAssets(1e18)` = 1,040,742).
- Last event: block 51,092,449, Gauntlet Withdraw, tx `0x4388fe4a9820e592dc85a9e140722c6c23ad28826f50a81399ed07c9a22d06c0`, logIndex 836.
- **Padded to exactly 200 blocks: `51,092,254` … `51,092,453` inclusive** (`substreams run -s 51092254 -t +200`).
  - Block 51,092,254 hash `0xe05b627f4d4c392cb2cc577ac21421b6c3d09b4f3c0b397532e292177e7bd089`, ts 1788973855 (2026-09-09T17:10:55Z).
  - Block 51,092,453 hash `0xa3310a6eafb01072b70e09cf316c25ba23d04cd0ade3105b0bdfd80d6b90f675`, ts 1788974253 (2026-09-09T17:17:33Z).
  - Block time check: (1788974253 − 1788973855) / 199 = **2.000 s/block** (`eth_getBlockByNumber` via `https://base-rpc.publicnode.com`).
- No block in that range satisfies `block % 1800 == 0` (nearest: 51,091,200 and 51,093,000), so `gate.yaml` adds a second, short observation range around **51,093,000** (see gate.yaml; block hash/timestamp recorded there when fetched).
- Full log dump: session scratchpad `recent-logs.json`.

## Head and startBlock computation

- Head at 2026-09-09T17:11:47Z: `eth_blockNumber` = `0x30b9b38` = **51,092,280** (`https://mainnet.base.org`); block 51,092,280 timestamp 1788973907 = 17:11:47Z (consistent).
- 6 weeks = 42 × 86,400 s = 3,628,800 s; at 2.000 s/block = 1,814,400 blocks → 51,092,280 − 1,814,400 = 49,277,880 (≈ 2026-07-29T17:11Z).
- Rounded **down** to the nearest multiple of `sampleIntervalBlocks` (1800) so the first observation lands on the first block: **49,276,800** (= 27,376 × 1800; ≈ 2026-07-29T16:35Z). Both vault creation blocks (37.18M / 37.40M) precede it.

## Privy fee wrappers — resolved (Sept 10, 20:50 IST, via `GET /v1/earn/ethereum/vaults/{id}`)
| Privy vault | `vault_id` | fee wrapper `vault_address` (Base) | underlying Morpho vault | fee |
|---|---|---|---|---|
| Gauntlet USDC Prime | `qwxu3riq3bvt5inw65jknkqf` | `0x3cb932ceaaaf42485d20ab4be6d7ec8cad291af2` | `0x050ce30b927da55177a4914ec73480238bad56f0` | 10% of generated returns to the app (dashboard) |
| Steakhouse Prime USDC | `d5d6zyaety43rqx513osyexr` | `0xfc956fb0ca009e0ab4f1e1964bdaa0c389f72028` | `0xbeef0e0834849acc03f0089f01f4f1eeb06873c9` | 10% |
Both created 2026-09-10 18:44 IST by the dashboard. Consequence (unchanged contract): the module keeps sampling and filtering the two **underlying** vaults; Vaultpilot fetches the wrapper addresses at runtime and excludes flows whose `owner`/`receiver` is the business wallet or a wrapper from the outflow guardrail. Disclose the 10% fee in the UI and README.
