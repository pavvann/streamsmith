# Privy facts for Vaultpilot

Compiled 2026-09-09 from `https://docs.privy.io/llms-full.txt` (4.3 MB snapshot saved under the
session scratchpad `.firecrawl/build/privy-llms-full.txt`) and from the installed SDK
`@privy-io/node@0.34.0` type declarations. No dashboard access and no API credentials were
available, so nothing below was exercised against the live API. Tags: **[docs]** quoted from the
docs page cited; **[sdk]** read from the package's `.d.ts`; **[unverified]** inferred, must be
checked on day 1 with real credentials. Zero firecrawl scrapes were needed.

Vault ids for Gauntlet USDC Prime and Steakhouse Prime are **app-specific** and only exist after
the human deploys the fee wrapper in the Dashboard (see §e and §"Human steps"). They cannot be
pinned in code ahead of time.

---

## (a) Node SDK: package, init, authorization key

- Package: **`@privy-io/node`** — "In a backend JS environment, you can use the `@privy-io/node`
  library to authorize requests and manage your application from your server."
  `pnpm install @privy-io/node@latest`. [docs] https://docs.privy.io/basics/nodeJS/installation
  Latest on npm at time of writing: 0.34.0 (`pnpm view @privy-io/node version`).
- Runtimes: "Node.js 20 LTS or later (non-EOL) versions. Deno v1.28.0 or higher. Bun 1.0 or later.
  Cloudflare Workers. Vercel Edge Runtime. Nitro v2.6 or greater." [docs]
  https://docs.privy.io/basics/nodeJS/setup
- Init [docs, same page]:
  ```ts
  import {PrivyClient} from '@privy-io/node';
  const privy = new PrivyClient({appId: 'insert-your-app-id', appSecret: 'insert-your-app-secret'});
  ```
  [sdk] `PrivyClientOptions { appId; appSecret; apiUrl?; authorizationKeyCacheMaxCapacity?;
  defaultRequestExpiryMs?; disableRequestExpiry?; requestExpiry?; jwtVerificationKey?;
  webhookSigningSecret?; ... }` (`public-api/PrivyClient.d.ts`). There is **no constructor-level
  default authorization key**; the authorization key is passed per call.
- Authorization key = P-256 keypair. "Authorization keys allow the party that controls the key to
  execute actions on wallets and policies by signing requests to the Privy API." Create in the
  Dashboard (**Wallets > Authorization keys > New key**; "Privy does not save this key and cannot
  help you recover it later") or with the SDK: [docs]
  https://docs.privy.io/controls/authorization-keys/keys/create/key
  ```ts
  import {generateP256KeyPair} from '@privy-io/node';
  const {privateKey, publicKey} = await generateP256KeyPair(); // base64 DER, no PEM headers
  ```
  [sdk] `P256KeyPair.publicKey` = "base64-encoded SPKI-formatted public key ... the format
  accepted by Privy when specifying a P-256 public key owner"; `.privateKey` = "base64-encoded
  PKCS8-formatted private key ... the format accepted by `AuthorizationContext.authorization_private_keys`".
  The Dashboard shows private keys as `wallet-auth:<base64>`; [sdk] `lib/cryptography.js` strips
  the `wallet-auth:` (and legacy `wallet-api:`) prefix, so either form works.
- Signing requests: "your application can pass the authorization context to the SDK method":
  `authorization_context: {authorization_private_keys: ['authorization-key']}` (also `user_jwts`,
  `sign_fns`, `signatures`). [docs]
  https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server
  REST equivalent: header `privy-authorization-signature` (comma-delimited for quorums).
  https://docs.privy.io/api-reference/authorization-signatures
- Errors [docs] https://docs.privy.io/basics/nodeJS/quickstart : "all errors thrown will be
  instances of `APIError` or `PrivyAPIError`" with `status`, `name`, `message`; [sdk] also
  `RateLimitError`, `BadRequestError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`.
- Idempotency: header `privy-idempotency-key` (SDK: `idempotency_key` on create/deposit/withdraw).
  "Privy processes a request with a given idempotency key only once within a 24-hour window."
  Replay table: "Wallet actions `/transfer`, `/swap`, `/earn`: 4xx Cached, 5xx Deleted (retry
  allowed)". [docs] https://docs.privy.io/api-reference/idempotency-keys

## (b) Create an EVM server wallet and read its address

- `POST /v1/wallets` — "Creates a new wallet on the requested chain and for the requested owner."
  [docs] https://docs.privy.io/api-reference/wallets/create
- "you can specify an **authorization key** as an `owner` on a wallet. The holder of the
  authorization key, typically your application backend, controls the wallet. You must use a
  server-side SDK to create wallets owned by an authorization key." [docs]
  https://docs.privy.io/wallets/wallets/create/create-a-wallet
  ```ts
  const wallet = await privy.wallets().create({chain_type: 'ethereum', owner: {public_key: publicKey}});
  // wallet.id, wallet.address, wallet.owner_id (auto-created key quorum), wallet.policy_ids, wallet.additional_signers
  ```
  [sdk] `WalletCreateParams { chain_type; additional_signers?; display_name?; entity?; external_id?;
  owner?: {public_key}|{user_id}|null; owner_id?; policy_ids?; 'privy-idempotency-key'? }`;
  `Wallet { id; address; chain_type; owner_id: string|null; policy_ids: string[];
  additional_signers: {signer_id; override_policy_ids?}[]; created_at; display_name?; entity? }`.
- Read: `privy.wallets().get(walletId)` [sdk]; REST `GET /v1/wallets/{wallet_id}`.
- Warning worth copying for the admin/fee wallet too: "Privy-generated admin wallets have no
  owner by default, and your app secret alone authorizes them. Assign an authorization key to
  require a second factor." [docs] https://docs.privy.io/wallets/actions/earn/setup

## (c) Additional signers: attach a second signer, revoke it

- Concept: "Each wallet can have multiple **additional signers** (authorization keys or key
  quorums). Each signer can have an **override policy** ... When a signer submits a transaction,
  Privy evaluates only that signer's override policy — not the policies of other signers." [docs]
  https://docs.privy.io/recipes/wallets/conditional-signer-policies
- A `signer_id` is a **key quorum id**. Register the agent's public key as a 1-of-1 quorum:
  `POST /v1/key_quorums` with `public_keys: string[]` (base64 DER P-256), `authorization_threshold`,
  `display_name`; "The returned `id` for the key quorum is used as the `owner_id` field ... or
  `signer_id` when specifying additional signers." [docs] https://docs.privy.io/controls/key-quorum/create
  and https://docs.privy.io/controls/authorization-keys/keys/create/key (REST tab).
  [sdk] `privy.keyQuorums().create({public_keys, authorization_threshold, display_name})`.
- Attach (Node/REST): "Make a request to update the wallet with the desired `additional_signers`
  you'd like to add. The wallet owner must sign the request." [docs]
  https://docs.privy.io/wallets/using-wallets/signers/add-signers
  ```ts
  await privy.wallets().update(walletId, {
    additional_signers: [{signer_id: '<agent-key-quorum-id>', override_policy_ids: ['<policy-id>']}],
    authorization_context: {authorization_private_keys: [ownerPrivateKey]},
  });
  ```
  REST: `PATCH /v1/wallets/{wallet_id}` body `{"additional_signers":[{"signer_id":"...","override_policy_ids":["..."]}]}`
  + `privy-authorization-signature` header. "Currently, only one policy is supported per wallet."
  / "each signer can only have one override policy." [docs]
  https://docs.privy.io/wallets/wallets/update-a-wallet
- Revoke (Node/REST): "Make a request to update the wallet with the updated list of
  `additional_signers` you'd like on the wallet. The wallet owner must sign the request." [docs]
  https://docs.privy.io/wallets/using-wallets/signers/remove-signers
  PATCH replaces the list, so send the list **without** the agent's `signer_id` (or `[]`).
  Implemented as `detachAgentSigner` in `apps/vaultpilot/src/signer.ts`.
- Owners vs signers: owners "can update policies/signers/export; signers can only sign/transact
  within their policy" — restated from https://docs.privy.io/controls/authorization-keys/owners/overview
  (summary; not quoted verbatim). [unverified wording]

## (d) Policies

### Schema (all methods)
`POST /v1/policies` body: `version: '1.0'`, `name`, `chain_type: 'ethereum'`, `rules: Rule[]`,
optional `owner: {public_key}` or `owner_id`. "We highly recommend specifying owners for your
policies ... Without an owner, the policies can be updated by your app secret alone." [docs]
https://docs.privy.io/controls/policies/create-a-policy
Rule = `{name, method, action: 'ALLOW'|'DENY', conditions: Condition[]}`; Condition =
`{field_source, field, operator, value, abi?, typed_data?}`; operators
`eq | gt | gte | lt | lte | in | in_condition_set | contains | starts_with | ends_with` [sdk
`ConditionOperator`]. [sdk] `PolicyMethod = 'eth_sendTransaction' | 'eth_signTransaction' |
'eth_signUserOperation' | 'eth_signTypedData_v4' | 'personal_sign' | 'eth_sign7702Authorization' |
'wallet_sendCalls' | 'signTransaction' | 'signAndSendTransaction' | 'signMessage' |
'exportPrivateKey' | 'exportSeedPhrase' | 'signTransactionBytes' | 'signRawMessageBytes' |
'tron_sendTransaction' | 'tron_signTransaction' | 'xrpl_signTransaction' | 'earn_deposit' |
'earn_withdraw' | 'transfer' | '*'`.

Evaluation [docs] https://docs.privy.io/controls/policies/overview :
"`DENY` actions take precedence over `ALLOW` actions. If no rules resolve, the policy will default
to `DENY`." and "if the policy contains no entry with a `method` corresponding to `X`, the engine
will deny the request by default." "The enclave evaluates policy rules in a tamper-proof
environment ... Privy enforces some policies at the API level. For example, limiting transfer
sizes requires transaction simulation which runs outside the enclave today."

### The Earn method (this is what governs deposit/withdraw)
[docs] https://docs.privy.io/wallets/actions/earn/policies
- "Earn policies currently support these rule methods: **`earn_deposit`**, **`earn_withdraw`**."
  (There is no `earn` method.)
- "Method matching is exact. If a wallet policy only allows `eth_sendTransaction`, Earn requests
  will still be denied. Wallets that call the Earn endpoints need explicit `earn_deposit` and/or
  `earn_withdraw` rules."
- "Privy evaluates policies against the original request body sent to the `deposit` and
  `withdraw` endpoints before it prepares the underlying approval and vault transactions."
- Supported conditions (`field_source: "action_request_body"`):

  | field | operators | notes (quoted) |
  |---|---|---|
  | `vault_id` | `eq`, `in`, `in_condition_set` | "Matches the Privy vault ID from the Dashboard." |
  | `amount` | `eq`, `gt`, `gte`, `lt`, `lte` | "Value must be a positive decimal string, such as \"1.5\"." |
  | `raw_amount` | `eq`, `gt`, `gte`, `lt`, `lte` | "Value must be an integer string in base units, such as \"1500000\"." |
  plus `system.current_unix_timestamp`. "Earn policies use `chain_type: \"ethereum\"`. For Earn
  methods, the policy engine only accepts `action_request_body` and `system` conditions."
- "A single rule cannot condition on both `amount` and `raw_amount`... A rule using `amount` will
  not match a request that only sends `raw_amount`." Vaultpilot always sends `amount`.
- "For signer-specific Earn permissions, attach the policy as an override policy on a signer instead."

Vaultpilot's drafted policy (`buildEarnPolicy` in `apps/vaultpilot/src/policy.ts`, cap 60):
```json
{
  "version": "1.0",
  "name": "Vaultpilot agent: Earn on approved vaults only",
  "chain_type": "ethereum",
  "rules": [
    { "name": "Allow earn_deposit into approved vaults, amount <= 60.0", "method": "earn_deposit", "action": "ALLOW",
      "conditions": [
        { "field_source": "action_request_body", "field": "vault_id", "operator": "in", "value": ["<GAUNTLET_VAULT_ID>", "<STEAKHOUSE_VAULT_ID>"] },
        { "field_source": "action_request_body", "field": "amount", "operator": "lte", "value": "60.0" } ] },
    { "name": "Allow earn_withdraw from approved vaults, amount <= 60.0", "method": "earn_withdraw", "action": "ALLOW",
      "conditions": [
        { "field_source": "action_request_body", "field": "vault_id", "operator": "in", "value": ["<GAUNTLET_VAULT_ID>", "<STEAKHOUSE_VAULT_ID>"] },
        { "field_source": "action_request_body", "field": "amount", "operator": "lte", "value": "60.0" } ] }
  ]
}
```
Because the default is DENY, this policy also denies `eth_sendTransaction`, `transfer`, `swap`,
key export, etc. for the agent signer. Both vaults are USDC so 1 USD == 1 USDC == `amount` "1".

### `eth_sendTransaction` caps and rolling aggregations
- `ethereum_transaction` fields: "`to`, `value`, `chain_id`" ("The verbatim Ethereum transaction
  object in an `eth_signTransaction`, `eth_sendTransaction`, `eth_signUserOperation`, or
  `wallet_sendCalls` request."); `ethereum_calldata` fields `function_name`,
  `function_name.param` with required `abi`; "The policy engine evaluates numerical data exactly
  as passed in the request body—no conversion is applied. For example, ETH values will be
  evaluated in wei". [docs] https://docs.privy.io/controls/policies/overview
  Example ERC-20 cap: `{field_source:'ethereum_calldata', field:'transfer.amount', abi: erc20Abi,
  operator:'lte', value: parseUnits('1000', 6).toString()}`. [docs]
  https://docs.privy.io/recipes/wallets/conditional-signer-policies
- Aggregations (stateful policies) [docs] https://docs.privy.io/controls/policies/stateful-policies :
  `POST /v1/aggregations` `{method, metric:{field, field_source:'ethereum_transaction'|'ethereum_calldata',
  function:'sum', abi?}, window:{type:'rolling', seconds: 3600..259200}, conditions?, group_by?}`;
  reference in a policy condition as `{field_source:'reference', field:'aggregation.<id>',
  operator:'lte', value:'0x...'}`. "Each app can have a maximum of **10 aggregations**."
  "Supported RPC methods: `eth_signTransaction`, `eth_signUserOperation`." "Aggregation values are
  updated **after** a request is successfully signed ... Stateful policies are designed for
  **disaster prevention** ... rather than strict real-time enforcement."
  **Consequence for Vaultpilot: a rolling daily cap cannot be expressed for `earn_deposit` /
  `earn_withdraw`.** Whether Earn's internally prepared transactions are additionally evaluated
  against `eth_signTransaction` rules/aggregations is not documented. [unverified] The daily cap
  therefore lives app-side (`appSideLimits` returned by `buildEarnPolicy`) and must be disclosed.

## (e) Earn API

All EVM Earn endpoints live under `/earn/ethereum/...` for every EVM chain: "Privy namespaces EVM
endpoints under `/earn/ethereum/...`, which applies to vaults on any supported EVM chain — not
just Ethereum mainnet. Privy routes each request to the vault's configured chain." [docs]
https://docs.privy.io/wallets/actions/earn/setup

| purpose | endpoint | SDK (`privy.wallets().earn().ethereum()`) | body / query |
|---|---|---|---|
| vault details (APY, TVL, liquidity) | `GET /v1/earn/ethereum/vaults/{vault_id}` | `.vaultDetails(vaultId)` | — |
| position | `GET /v1/wallets/{wallet_id}/earn/ethereum/vaults?vault_id={vault_id}` | `.vaultPosition(walletId, {vault_id})` | query `vault_id` |
| deposit | `POST /v1/wallets/{wallet_id}/earn/ethereum/deposit` | `.deposit(walletId, {vault_id, amount, authorization_context})` | `{vault_id, amount \| raw_amount}` |
| withdraw | `POST /v1/wallets/{wallet_id}/earn/ethereum/withdraw` | `.withdraw(walletId, {vault_id, amount, authorization_context})` | `{vault_id, amount \| raw_amount}` |
| claim incentives | `POST /v1/wallets/{wallet_id}/earn/ethereum/incentive/claim` | `.incentive().claim(...)` | — |
| poll action | `GET /v1/wallets/{wallet_id}/actions/{action_id}?include=steps` | `privy.wallets().actions.get(actionId, {wallet_id, include:'steps'})` | — |

Sources: https://docs.privy.io/api-reference/wallets/earn/deposit ,
https://docs.privy.io/api-reference/wallets/earn/withdraw ,
https://docs.privy.io/api-reference/wallets/earn/get-position ,
https://docs.privy.io/api-reference/wallets/earn/get-vault-details ,
https://docs.privy.io/wallets/actions/status . **There is no "list vaults" endpoint** in the docs;
vault ids are read from the Dashboard.

- Body details [docs] https://docs.privy.io/wallets/actions/earn/deposit : `vault_id` "Copy this
  from the Privy Dashboard after deploying a fee wrapper." `amount` "Human-readable decimal amount
  to deposit (e.g. \"1.5\" for 1.5 USDC). Exactly one of `amount` or `raw_amount` must be provided."
  "Wallets with `owner_id` present must provide an authorization signature as a request header for
  deposit operations." Response: `{id, wallet_id, type:'earn_deposit', status:'pending'|'succeeded'|
  'rejected'|'failed', caip2 (e.g. "eip155:8453"), vault_id, vault_address, asset_address,
  raw_amount, amount?, asset?, decimals?, share_amount: string|null, created_at, steps?}`.
  "Privy handles the ERC-20 approval and deposit in a single call." "The wallet must hold enough
  of the deposit token to cover the full amount."
- Position response [docs] https://docs.privy.io/wallets/actions/earn/get-vault-position :
  `{asset:{address,symbol,decimals}, total_deposited, total_withdrawn, assets_in_vault, shares_in_vault}`
  all "in the token's smallest unit"; `earned_yield = assets_in_vault - (total_deposited - total_withdrawn)`.
- Withdraw [docs] https://docs.privy.io/wallets/actions/earn/withdraw : "withdraw any amount up to
  the wallet's current `assets_in_vault` ... pass the full `assets_in_vault` value as the
  `raw_amount`" for a full exit; "check the vault's `available_liquidity_usd` ... before
  initiating large withdrawals."
- Status semantics [docs] https://docs.privy.io/wallets/actions/earn/webhooks : "**Rejected** — the
  action failed **before** any transaction was signed or broadcast (e.g. insufficient balance,
  policy violation). Safe to retry. **Failed** — a transaction was broadcast but reverted onchain."
  A policy denial may therefore surface either as a synchronous 4xx or as an async `rejected`
  action; the spike handles both. [unverified which one Earn returns]
- Chain: both self-serve USDC vaults are on **Base mainnet, `eip155:8453`**. Vault identifiers
  [docs] https://docs.privy.io/wallets/actions/earn/setup :
  - "Gauntlet USDC Prime (USDC on Base)" → Morpho vault `0x050cE30b927Da55177A4914EC73480238BAD56f0`
    (https://app.morpho.org/base/vault/0x050cE30b927Da55177A4914EC73480238BAD56f0/gauntlet-usdc-prime)
  - "Steakhouse Prime Instant (USDC on Base)" → Morpho vault `0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9`
    (https://app.morpho.org/base/vault/0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9/steakhouse-prime-instant)
  - (also listed: "Sentora PathUSD (PathUSD on Tempo)")
  The Privy **`vault_id`** is generated per app after fee-wrapper deployment: "After setup, Privy
  provides a unique `vault_id` for the vault. Copy this value — all deposit and withdraw API
  calls require it." The deposit response's `vault_address` is the fee-wrapper (ERC-4626) address,
  which differs from the underlying Morpho vault address (deposit example shows
  `0x5224d0c05698eD4a97C771B62095929F293f1D60`). [unverified: that the returned `vault_address`
  is the wrapper rather than the Morpho vault] Note a docs inconsistency: the get-vault-details
  example labels "Gauntlet USDC Prime" with `caip2: "eip155:1"` and address
  `0x04422053aDDbc9bB2759b248B574e3FCA76Bc145` (mainnet), contradicting the setup page (Base).
- Gas: "if your app has gas sponsorship enabled, Privy automatically sponsors gas for earn
  deposit, withdraw, and incentive claim actions" [docs] https://docs.privy.io/financial-flows/earn ;
  "If your app has gas sponsorship configured, usage of the `/earn/ethereum/deposit` endpoint will
  be gas-sponsored by default. There is no need to specify additional parameters." Gas sponsorship
  is enabled in Dashboard > Gas sponsorship > **App pays**, per chain; "Apps **must** use TEE
  execution". [docs] https://docs.privy.io/wallets/gas-and-asset-management/gas/setup
  If sponsorship is off, the wallet needs ETH on Base for approve+deposit. [unverified]
- Self-serve vs sales: "A select set of yield sources are available in the Privy Dashboard for
  self-serve setup. Contact Privy sales to enable additional Veda, Aave, Morpho, and Kamino
  vaults" ; "Morpho vaults are self-serve: deploy a fee wrapper and configure a vault under
  **Wallet infrastructure > Earn**". [docs] https://docs.privy.io/wallets/actions/earn/providers/morpho
  Fee share: "capture up to 50% of accrued yield as vault shares in your admin wallet" — set it to
  0% for Vaultpilot unless we want the fee-share story. Admin wallet: "Privy cannot reassign the
  admin wallet after creation."
- No testnet Earn: all three self-serve vaults are mainnet; nothing in the docs mentions Earn on
  Base Sepolia.

## (f) Organizations and key quorums: endpoints and gating language

- Key quorums: `POST /v1/key_quorums` `{public_keys?, user_ids?, key_quorum_ids?,
  authorization_threshold?, display_name?}`; also `GET/PATCH/DELETE /v1/key_quorums/{id}`;
  Dashboard: Authorization keys > New key > "Register key quorum instead" ("Key quorums containing
  both user IDs and authorization keys must be created via the REST API"). [docs]
  https://docs.privy.io/controls/key-quorum/create , https://docs.privy.io/api-reference/key-quorums/create
  Gating language: "Key quorums are an advanced feature. Reach out to discuss whether this setup
  is right for your integration." (https://docs.privy.io/controls/key-quorum/overview) and "Key
  quorums are an advanced integration. To determine if key quorums are right for your use case,
  please reach out." (https://docs.privy.io/controls/authorization-keys/keys/create/key-quorum).
  No plan/Enterprise gate is stated; the API is public. [unverified: creation works on a free app]
- Organizations: `POST /v1/organizations` `{display_name, default_key_quorum_id}`; `GET/PATCH/DELETE
  /v1/organizations/{organization_id}`; `GET /v1/organizations`. [docs]
  https://docs.privy.io/api-reference/organizations/create ,
  https://docs.privy.io/organizations/setup/organizations . SDK: `privy.organizations().create({...})`.
  Org wallets: `privy.wallets().create({chain_type:'ethereum', entity:{id: orgId, type:'organization'}})`
  — "Privy automatically sets the organization's `default_key_quorum_id` as the wallet owner";
  "You can assign up to 150 wallets to an organization"; "A wallet's entity cannot be changed
  after it is set." [docs] https://docs.privy.io/recipes/wallets/organization-wallets
  **No "contact sales" or plan-gating language was found on any Organizations page.**
- What *is* gated: "Manual approvals is an Enterprise feature. Reach out to Privy sales to
  request access for your app." (Dashboard human-review of intents/transactions) [docs]
  https://docs.privy.io/controls/dashboard/overview . Webhooks in production: "Webhooks can be
  tested at no cost in development environments. To enable webhooks in production, upgrade to the
  Enterprise plan in the Privy Dashboard." [docs] https://docs.privy.io/api-reference/webhooks/overview
  Intents themselves (asynchronous quorum approval via API) carry no gating language on
  https://docs.privy.io/organizations/actions/overview .

## (g) Webhooks (for later)

Configure at Dashboard **Configuration > Webhooks** (URL must be `https://`). Event types [docs]
https://docs.privy.io/api-reference/webhooks/overview :
- User: `user.created`, `user.authenticated`, `user.linked_account`, `user.unlinked_account`,
  `user.updated_account`, `user.transferred_account`, `user.wallet_created`, `mfa.enabled`, `mfa.disabled`
- Wallet: `wallet.archived`, `wallet.restored`, `wallet.funds_deposited`, `wallet.funds_withdrawn`,
  `wallet.private_key_export`, `wallet.seed_phrase_export`, `wallet.recovery_setup`, `wallet.recovered`
- Transaction: `transaction.broadcasted`, `transaction.confirmed`, `transaction.failed`,
  `transaction.execution_reverted`, `transaction.replaced`, `transaction.still_pending`, `transaction.provider_error`
- Wallet actions: `wallet_action.swap.*`, `wallet_action.transfer.*`, `wallet_action.earn_deposit.*`,
  `wallet_action.earn_withdraw.*`, `wallet_action.earn_incentive_claim.*` (each `.created`,
  `.succeeded`, `.rejected`, `.failed`); plus `wallet_action.earn_fee_collect.*` per
  https://docs.privy.io/wallets/actions/earn/webhooks
- Usage (postpaid only): `usage.gas_sponsorship.recorded`, `usage.cross_chain_fee.recorded`
- Intents: `intent.created`, `intent.authorized`, `intent.rejected`, `intent.executed`, `intent.failed`
- `user_operation.completed`
Earn webhook payloads include `wallet_id` and `vault_id`. Verify signatures per the overview page.

## (h) Rate limits, sandbox / test mode

- "Privy rate limits REST API endpoints that you may call from your server." [docs]
  https://docs.privy.io/basics/nodeJS/setup ; "When you exceed a rate limit, Privy's API returns a
  `429 Too Many Requests` status code. Rate limits are applied per endpoint" — implement
  exponential backoff. [docs] https://docs.privy.io/recipes/dashboard/optimizing
  The only published numbers are for user creation ("240 users per minute"). No wallet/earn
  endpoint numbers are published. [unverified numbers]
- No Privy-wide sandbox or test mode exists. Environments are separate apps: "We recommend
  creating a new app for each environment (e.g. development, staging, production)". [docs]
  https://docs.privy.io/basics/get-started/dashboard/create-new-app . "sandbox" in the docs refers
  only to third parties (Bridge, Cards) and is "not a testnet: wallets and assets used in sandbox
  flows are still mainnet". Policies and wallets can be exercised on Base Sepolia via raw RPC, but
  **Earn has no testnet**, so the denial test is safe (no funds needed) while the execution proof
  needs real USDC on Base.

## Contradictions with docs/research/arc-privy-ledger.md §1.3

1. §1.3 lists a policy method **`earn`**. The docs define **`earn_deposit`** and **`earn_withdraw`**
   only; `earn` does not exist in the SDK `PolicyMethod` union. PROJECT.md §4.3 ("`earn` allowed
   only for...") inherits the same error.
2. §1.3 gives Earn paths as `/earn/ethereum/vaults/{vault_id}/deposit|withdraw|position`. Actual:
   `POST /v1/wallets/{wallet_id}/earn/ethereum/deposit` and `/withdraw` with `vault_id` in the
   body; position is `GET /v1/wallets/{wallet_id}/earn/ethereum/vaults?vault_id=`.
3. §1.3 / PROJECT.md assume a "rolling daily cap" enforced by Privy for Earn. Aggregations only
   support `eth_signTransaction` / `eth_signUserOperation`, so the daily cap is app-side only.
4. §1.3 says self-serve vaults are "Gauntlet USDC Prime and Steakhouse Prime Instant" — correct,
   but the identifiers are per-app `vault_id`s issued after fee-wrapper deployment, not global ids.
5. §1.3 says key quorums/orgs have "'reach out' language but no hard gate" — confirmed; the only
   explicit Enterprise gates found are Manual approvals (Dashboard review UI) and production webhooks.

## Human steps in the Privy Dashboard (in order)

1. https://dashboard.privy.io → create an app (one for dev is enough) → **Configuration > App
   settings > Basics**: copy **App ID** and **App secret** → `PRIVY_APP_ID`, `PRIVY_APP_SECRET`.
2. **Wallets > Authorization keys > New key** → name "Vaultpilot treasurer", copy the private key
   (`wallet-auth:...`) → `PRIVY_AUTH_KEY`. Privy never shows it again.
3. Same page → **New key** → name "Vaultpilot agent", copy → `PRIVY_AGENT_AUTH_KEY`. (Alternatively
   `openssl` per `.env.example`.) The spike registers this key's public key as a key quorum itself.
4. **Wallet infrastructure > Earn** → deploy a fee wrapper for **Gauntlet USDC Prime (USDC on
   Base)**: pick 0% (or a small) app yield share, let Privy create the admin wallet → copy the
   `vault_id` → `PRIVY_VAULT_ID_GAUNTLET`. Repeat for **Steakhouse Prime Instant** →
   `PRIVY_VAULT_ID_STEAKHOUSE`. Optionally assign the treasurer key as owner of the admin wallet.
5. **Gas sponsorship** → **App pays** → enable **Base** (mainnet). Otherwise the business wallet
   needs ETH on Base.
6. Copy `apps/vaultpilot/.env.example` to `apps/vaultpilot/.env`, fill it, run
   `pnpm --filter @ethonline26/vaultpilot spike`. The spike creates the wallet, policy, signer,
   reads positions, and runs two denial tests (unapproved vault id; over-cap amount). It never
   deposits real funds.
7. After the spike prints the wallet address, send ~50 USDC on Base to it for the execution proof.
8. Later: **Configuration > Webhooks** → add an `https://` endpoint, subscribe to
   `wallet_action.earn_deposit.*` / `earn_withdraw.*` (dev only; production webhooks are Enterprise).

## Open items to verify on day 1
- Exact error shape for an Earn policy denial (sync 4xx vs async `rejected`) and its message.
- Whether a Dashboard-created authorization key already has a key-quorum id (would let us skip
  `key_quorums.create`), and whether registering the same public key twice is allowed.
- Whether Earn's internal approve/deposit transactions are also evaluated against
  `eth_signTransaction` rules (would let an aggregation-based daily cap apply after all).
- Actual per-endpoint rate limits for `/earn` and `/wallets`.
- Whether the deposit response `vault_address` is the fee wrapper or the Morpho vault.
