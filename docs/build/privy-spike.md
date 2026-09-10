# Privy spike (Sept 10, 2026, 20:30 IST) — `pnpm --filter @ethonline26/vaultpilot spike`

Result: **pass** (wallet, policy, signer, positions, denials). No funds moved.

| item | value |
|---|---|
| Business wallet | `q4zcqb7leopoj7hocdtqhbfe` → `0xcdC8B69799bCb135C04A1052b918787125571fDC` (ethereum), owner = treasurer authorization key `y10nwtofchornn7evweg20vg` |
| Policy | `gghm9iorl3flfaybrqmlvisf`: rules `earn_deposit` / `earn_withdraw` ALLOW iff `action_request_body.vault_id in [qwxu3riq3bvt5inw65jknkqf, d5d6zyaety43rqx513osyexr]` and `amount <= 60.0`; default deny |
| Agent signer | key quorum `yfd2jb9phfeufhh2aibpjw3s` (1-of-1 over the agent authorization key `sasau9mvtgbs4hzrrypms7ry`) attached as `additional_signers[0]` with `override_policy_ids = [gghm9iorl3flfaybrqmlvisf]` |
| Vaults (Privy) | Gauntlet USDC Prime `qwxu3riq3bvt5inw65jknkqf`; Steakhouse Prime USDC `d5d6zyaety43rqx513osyexr`; both `eip155:8453`, asset USDC `0x8335…2913` (6 dp). Privy `vault_address` is the **fee wrapper** (e.g. `0xfc956fb0ca009e0ab4f1e1964bdaa0c389f72028`), not the Morpho vault — confirms docs/build/vaults.md |
| Positions | both `assets_in_vault = 0`, `shares_in_vault = 0` |
| Denial: unapproved vault | HTTP 404 `Vault not found` (synchronous) |
| Denial: over cap | HTTP 409 `Vault is not available for deposits or withdrawals` (`invalid_state`) — **not a policy denial**; unverified whether the fee wrapper is still deploying or sponsorship is off. Re-test once the dashboard shows both vaults active and App-pays sponsorship is on |
| App-side limit | daily cap 120 USD enforced in Vaultpilot (Privy aggregations don't cover Earn) |

Privy input rule learned: policy rule names must be < 50 characters (fixed in `src/policy.ts`).
Revocation: `detachAgentSigner(walletId, agentKeyQuorumId)` signed by the treasurer key.
