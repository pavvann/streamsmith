# privy developer feedback

Friction log kept from the first minute. Format: what we tried, what happened, what we expected, how long it cost.


## 2026-09-09 — A3 research + Vaultpilot skeleton (docs only, no credentials yet)

1. **llms-full.txt is the fastest path.** `https://docs.privy.io/llms-full.txt` (4.3 MB, 115k
   lines) answered every question; zero scrapes needed. ~40 min of grep. Cost: none.
2. **Policy method naming drift.** Our research doc (and PROJECT.md §4.3) say method `earn`; the
   docs and SDK only have `earn_deposit` / `earn_withdraw`. A policy with method `earn` would be
   rejected or (worse) silently never match. Cost: 10 min to confirm across three pages.
3. **No rolling cap for Earn.** Aggregations "Only supported for Ethereum methods
   (`eth_signTransaction`, `eth_signUserOperation`)". The "rolling daily cap" in our plan cannot be
   a Privy policy. Expected: any method with a numeric field to be aggregatable. Cost: redesign —
   daily cap moves app-side and must be disclosed as such.
4. **Vault ids are per-app and dashboard-only.** No list endpoint; `vault_id` appears only after
   the human deploys a fee wrapper in the Dashboard. Expected a public catalog / list endpoint
   so code could pin vaults ahead of time. Blocks the spike until Pawan does dashboard work.
5. **Docs example inconsistency.** get-vault-details example shows "Gauntlet USDC Prime" on
   `eip155:1` at `0x0442...` while the setup page says USDC on Base at `0x050c...`. Confusing when
   trying to pin identifiers. Cost: 5 min.
6. **Endpoint path drift vs. our notes.** Position is `GET /v1/wallets/{id}/earn/ethereum/vaults?vault_id=`
   and deposit/withdraw take `vault_id` in the body — not `/vaults/{vault_id}/deposit`. Fine once
   read, but the `/earn/ethereum/` namespace for Base is a mild surprise (docs do call it out).
7. **SDK type exports are inconsistent across entrypoints.** `@privy-io/node` root exports
   `Policy`, `Wallet`, `KeyQuorum` but not `PolicyCreateParams`; `@privy-io/node/resources`
   exports `PolicyCreateParams` but renames earn types (`EthereumYieldPositionResponse` vs the
   internal `EthereumEarnPositionResponse`), and the package `exports` map blocks deep imports.
   Worked around with `Awaited<ReturnType<...>>`. Cost: 15 min.
8. **`require.resolve('@privy-io/node/package.json')` fails** (not in `exports`). Minor.
9. **pnpm 10 ignores esbuild's build script** ("Ignored build scripts: esbuild"). tsx still runs
   because the platform binary ships as an optional dependency. No action needed, but the
   warning is alarming on first install.
10. **Positive:** the public-API layer (`privy.wallets().update(id, {..., authorization_context})`)
    signs owner requests automatically; the `wallet-auth:` prefix is stripped by the SDK; the
    Earn policy page has an example that is exactly our use case (vault allowlist + amount cap +
    override policy on a signer). `generateP256KeyPair` output matches Node `crypto` SPKI
    derivation byte-for-byte, so we can derive the public key from an env private key.
11. **Gating found:** Manual approvals (Dashboard review UI) and production webhooks are
    Enterprise; key quorums say "advanced feature, reach out" but the API is public; no gating
    language on Organizations. Earn beyond the three self-serve vaults needs sales@privy.io.
12. **No Earn testnet** — denial tests are free (no funds moved) but the execution proof needs
    real USDC on Base. Gas sponsorship (App pays) should be on or the wallet needs ETH.
