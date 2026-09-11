# Vaultpilot

A business wallet on Privy, operated by a bounded agent.

The wallet is owned by a human treasurer's authorization key. The agent is an **additional signer**
with one override policy: it may call `earn_deposit` and `earn_withdraw` on exactly two pinned
Privy Earn vault ids, under a per-action cap. Everything else is denied by default, and the
treasurer can revoke the agent with a single call.

What the agent decides is read from the `erc4626-flows` Substreams pipeline through its ClickHouse
sink — the same SQL the generated MCP server exposes — and every number on screen carries the
deployment's provenance.

## The rule (docs/PROJECT.md §4.3)

Rotate the position into the other approved vault when **observed-window share-value growth**
differs by more than a configured minimum, subject to all of:

| Guard | Default | Where |
|---|---|---|
| Minimum observed window on **both** vaults | 24 h | `VAULTPILOT_MIN_OBSERVATION_HOURS` |
| Minimum growth differential (covers gas and friction) | 2 bps | `VAULTPILOT_MIN_DIFFERENTIAL_BPS` |
| Cooldown between rotations | 6 h | `VAULTPILOT_COOLDOWN_HOURS` |
| Destination 24 h net third-party outflow guardrail | 1000 bps | `VAULTPILOT_OUTFLOW_GUARDRAIL_BPS` |
| Staleness refusal (sink head vs chain head) | 300 blocks | `VAULTPILOT_MAX_LAG_BLOCKS` |
| `maxWithdraw` and destination liquidity check | — | Privy vault details + position |
| Idempotency key | `${fromVault}:${toVault}:${lastObservationBlock}` | ledger |

Everything that cannot be evaluated is a **refusal**, and every refusal means `hold`. The service is
fail-closed in the same way the MCP server is, and it accumulates every reason rather than stopping
at the first, so the screen shows all of them.

The differential is never lowered to manufacture a rotation. Initial funding goes to whichever
approved vault currently has the **lower** observed growth, so a real rotation stays possible.

### Self-flow exclusion

The outflow guardrail measures what *third parties* took out of the destination. Flows whose
`caller`, `owner` or `receiver` is the business wallet (`0xcdC8B69799bCb135C04A1052b918787125571fDC`)
or either Privy fee wrapper are excluded, because those are our own actions.

## Fee disclosure

A Privy Earn "vault" is a **fee wrapper**: a constrained Morpho Vault V2 that deposits into the
underlying Morpho vault. **Each wrapper takes a 10% fee on generated returns** (configured in the
Privy Dashboard).

| Privy vault | `vault_id` | fee wrapper (what our transactions touch) | underlying vault (what the pipeline observes) | fee |
|---|---|---|---|---|
| Gauntlet USDC Prime | `qwxu3riq3bvt5inw65jknkqf` | `0x3cb932ceaaaf42485d20ab4be6d7ec8cad291af2` | `0x050ce30b927da55177a4914ec73480238bad56f0` | 10% |
| Steakhouse Prime USDC | `d5d6zyaety43rqx513osyexr` | `0xfc956fb0ca009e0ab4f1e1964bdaa0c389f72028` | `0xbeef0e0834849acc03f0089f01f4f1eeb06873c9` | 10% |

The share-value growth shown anywhere in this app is measured by the pipeline on the **underlying**
vault, so it is *before* that fee. The UI says so on screen.

The rolling **daily cap** is enforced by this app, not by Privy: Privy's stateful policy
aggregations cover only `eth_signTransaction` and `eth_signUserOperation`, never
`earn_deposit`/`earn_withdraw`. It is computed from the local ledger and disclosed as app-side.

## Commands

Everything defaults to **DRY RUN**. Nothing is ever sent without an explicit `--execute`.

```bash
pnpm typecheck                       # tsc over src/ and test/
pnpm test                            # vitest, no network, no credentials needed

pnpm agent:once                      # one cycle: read -> decide -> print, sends nothing
pnpm agent:once --source cloud       # read ClickHouse Cloud instead of the local container
pnpm agent:once --source fixture --offline   # no database, no Privy call: the rehearsal path
pnpm agent:once --execute            # the same cycle, and execute the rotation if the rule fires
pnpm agent:watch --minutes 10        # a cycle every N minutes
pnpm agent:serve                     # read-only JSON service on :8787 for the UI

pnpm web:dev                         # the one screen (http://localhost:3000)
pnpm web:build && pnpm web:start

pnpm demo:denied  [--execute]        # the agent asks for a non-allowlisted vault -> Privy denies
pnpm demo:deposit --amount 25 [--execute]   # fund the LOWER-growth vault so a rotation is possible
pnpm demo:rotate  [--execute]        # one cycle with execution enabled
```

Flags: `--execute`, `--source local|cloud|fixture`, `--fixture <path>`, `--offline`, `--json`,
`--minutes <n>`, `--amount <n>`.

`--offline` makes no Privy call at all and takes positions and liquidity from the fixture: it is how
the whole rotate path is rehearsed while the business wallet is unfunded.

## The one screen (`web/`)

A Next.js 15 App Router page that reads `/api/state` — which returns the agent's live state service
when it is running and the `.vaultpilot-snapshot.json` every cycle writes otherwise. It shows the
position and vault names, both observed windows (hours, block range, observation count) with their
share-value growth and the differential, the decision and the rule that produced it, the policy
summary and the latest allow/deny outcomes, the pipeline provenance (`packageHash`,
`outputModuleHash`, head, lag, deployment mode) in the MCP's `pipeline_status` shape, Basescan links
for every transaction, and who controls the wallet plus the exact revocation command.

The UI holds no signing key and imports no agent code: the page bundle only reads JSON.

## Files

| File | What it is |
|---|---|
| `src/decision.ts` | the rule, as a pure function. No I/O, so tests and the UI run the same code |
| `src/data.ts` | `VaultflowsSource`: `ClickHouseHttpSource` (read-only HTTP, bound parameters) and `FixtureSource` |
| `src/executor.ts` | withdraw → poll → deposit → poll, with the partial-failure path and the caps |
| `src/ledger.ts` | the append-only JSON ledger: daily cap, cooldown and idempotency live here |
| `src/snapshot.ts` | one read of the whole world; the text summary, the service and the UI share it |
| `src/loop.ts` | `agent:once` / `agent:watch` and the one-screen text summary |
| `src/demo.ts` | the three demo beats |
| `src/policy.ts`, `src/signer.ts`, `src/wallet.ts`, `src/earn.ts` | the Privy surface |
| `fixtures/*.json` | rotate, hold-stale, hold-short-window, hold-guardrail |

## Failure semantics

Two sequential transactions. If the withdrawal succeeds and the deposit fails, the USDC stays
**idle in the business wallet**, an alert is written to the ledger, and **nothing is retried
automatically** — the treasurer decides. If the withdrawal is denied, no deposit is attempted and
the position is untouched. A rotation is never started when both legs would not fit inside the
remaining daily cap.

## Revoking the agent

```
detachAgentSigner(walletId, agentKeyQuorumId)   # src/signer.ts, signed by PRIVY_AUTH_KEY
```

The treasurer key owns the wallet and the policy; the agent key can only sign the two Earn methods
on the two approved vault ids. The app secret alone cannot change the policy or the signer list.

## Vocabulary

This app says "share value", "share-value growth", "observed window" and "execution rate". It never
says the words the contract bans — `test/vocabulary.test.ts` fails the build if one appears in
`src/`, `test/`, `fixtures/` or `web/`. Privy's own `user_apy` field is never read or displayed: the
only growth number anywhere here comes from the pipeline's own observations.
