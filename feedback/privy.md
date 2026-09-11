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

## 2026-09-11 — A10b, decision service + executor + one-screen UI

13. **`available_liquidity_usd` is the only liquidity number Earn exposes, and it is a USD figure.**
    The rule needs a `maxWithdraw` and a destination-liquidity check. For the source side we can use
    `assets_in_vault` ("withdraw any amount up to the wallet's current assets_in_vault"), but for the
    destination there is no `maxDeposit`/cap field at all, and `available_liquidity_usd` mixes the
    asset with a price. For USDC vaults 1 USD == 1 USDC so it works out, but a non-stable vault would
    leave the check unimplementable. Expected: asset-denominated `max_deposit` / `max_withdraw` on
    `GET /v1/earn/ethereum/vaults/{id}`. Cost: 20 min plus a documented assumption.
14. **`user_apy` is the only growth number in the Earn API, and it is a projection.** We deliberately
    do not display it: the app shows growth it observed itself, over an explicit window, from
    on-chain `convertToAssets` samples. A point-in-time *observed* growth field (with the window it
    was measured over) would be far more usable for an agent that has to justify an action.
15. **Nothing in the Earn API tells you where the money actually goes.** `vault_address` is the fee
    wrapper, not the Morpho vault it is immutably bound to, and there is no `underlying_vault` field.
    We had to resolve the pair by hand (docs/build/vaults.md) so the pipeline could observe the right
    contract while the executor targets the right one. Expected: `underlying_vault_address` and the
    fee percent in the same response. Cost: the whole self-flow exclusion design depends on it.
16. **The fee on generated returns is Dashboard-only.** `GET /v1/earn/ethereum/vaults/{id}` does not
    return the wrapper's fee percentage, so an app that wants to disclose it (we do, 10%) has to
    hardcode a number a human read off a screen. Expected: `fee_bps` in the vault details response.
17. **No way to ask "would this be allowed?"** There is no policy dry-run / simulate endpoint, so the
    only way to learn whether an action passes the policy is to send it. Everything risky in this app
    is therefore gated app-side behind an explicit `--execute` flag, and the per-action cap is
    re-checked locally before the request is built. Expected: `POST /v1/policies/{id}/evaluate`.
18. **Denials do not look like denials.** The spike recorded an unapproved vault id as HTTP 404
    "Vault not found" and an over-cap request as HTTP 409 `invalid_state` ("Vault is not available for
    deposits or withdrawals") — neither says "policy". A real policy denial arrives asynchronously as
    action status `rejected`. The executor therefore treats "4xx" and "status rejected" as the same
    outcome class, which is a guess. Expected: a stable `policy_denied` error code with the rule name.
19. **Positive:** `idempotency_key` on deposit/withdraw is exactly what a two-legged rotation needs,
    and the action-polling shape (`pending` → `succeeded|rejected|failed`, `include=steps` for the
    transaction hashes) made the partial-failure path straightforward to implement and to test.

### Not Privy — ClickHouse, recorded here because it changed this app's code

20. **A read-only ClickHouse user cannot ask for `readonly=1`.** ClickHouse Cloud's `ro` user has a
    readonly *profile*, so any per-query setting (including `readonly=1` itself and
    `max_execution_time`) is refused with `Code: 164 ... Cannot modify ... setting in readonly mode`.
    The source now sends the settings, and on that specific error retries once without them and
    remembers the mode — a stronger guarantee than the one we asked for. Cost: 25 min.
21. **`max(block_number) AS block_number` next to `argMax(x, block_number)` is an error, not a
    shadow.** ClickHouse resolves the inner reference to the SELECT alias and fails with
    `Code: 184 ILLEGAL_AGGREGATION`. Renaming the alias fixed it. Worth knowing when writing the
    view bodies by hand.
