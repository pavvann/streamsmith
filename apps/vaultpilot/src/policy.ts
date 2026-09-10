/**
 * Earn policy for the agent signer.
 *
 * Facts (https://docs.privy.io/wallets/actions/earn/policies):
 * - "Earn policies currently support these rule methods: `earn_deposit`, `earn_withdraw`."
 * - "Method matching is exact. If a wallet policy only allows `eth_sendTransaction`, Earn requests
 *   will still be denied."
 * - Supported conditions are `action_request_body` fields `vault_id` (eq, in, in_condition_set),
 *   `amount` (eq, gt, gte, lt, lte; "positive decimal string, such as \"1.5\""), `raw_amount`
 *   (integer string in base units), plus `system.current_unix_timestamp`.
 * - "A rule using `amount` will not match a request that only sends `raw_amount`" -> our earn.ts
 *   always sends `amount`, so the policy conditions on `amount`.
 * - Policy engine (https://docs.privy.io/controls/policies/overview): "`DENY` actions take
 *   precedence over `ALLOW` actions. If no rules resolve, the policy will default to `DENY`."
 *   So a policy with only these two ALLOW rules denies eth_sendTransaction, transfer, export, etc.
 *
 * Rolling daily cap: stateful policies (aggregations) are "Only supported for Ethereum methods
 * (`eth_signTransaction`, `eth_signUserOperation`)" -- NOT for `earn_deposit`/`earn_withdraw`.
 * https://docs.privy.io/controls/policies/stateful-policies  Therefore `dailyCapUsd` cannot be
 * encoded in this policy; it is returned separately as an app-side limit that Vaultpilot must
 * enforce itself (and disclose in the UI).
 */
import {randomUUID} from 'node:crypto';
import type {Policy, PrivyClient} from '@privy-io/node';
import {getPrivy, ownerPublicKey} from './privy.js';

/** Exact body accepted by `privy.policies().create()` (== POST /v1/policies), minus idempotency key. */
export type PolicyCreateParams = Omit<Parameters<ReturnType<PrivyClient['policies']>['create']>[0], 'idempotency_key'>;

export interface EarnPolicySpec {
  /** Privy vault ids (app-specific, from the Dashboard). The agent may only touch these. */
  allowedVaultIds: string[];
  /** Max per deposit/withdraw, in USD. For USDC vaults 1 USD == 1 USDC == `amount` "1". */
  perActionCapUsd: number;
  /** Desired rolling 24h cap in USD. NOT enforceable by Privy for Earn methods (see above). */
  dailyCapUsd?: number;
  /** Apply the per-action cap to withdrawals too (default true). */
  capWithdrawals?: boolean;
  name?: string;
}

export interface BuiltEarnPolicy {
  /** Exact request body for POST /v1/policies (minus owner, added by createPolicy). */
  policy: PolicyCreateParams;
  /** Limits that Privy cannot enforce for Earn today and that the app must enforce. */
  appSideLimits: {dailyCapUsd?: number; reason: string};
}

function decimalString(n: number): string {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`cap must be a positive number, got ${n}`);
  // Privy: "Value must be a positive decimal string". USDC has 6 decimals.
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

export function buildEarnPolicy(spec: EarnPolicySpec): BuiltEarnPolicy {
  if (spec.allowedVaultIds.length === 0) throw new Error('allowedVaultIds must not be empty');
  const cap = decimalString(spec.perActionCapUsd);
  const vaultCondition = {
    field_source: 'action_request_body' as const,
    field: 'vault_id',
    operator: 'in' as const,
    value: [...spec.allowedVaultIds],
  };
  const amountCondition = {
    field_source: 'action_request_body' as const,
    field: 'amount',
    operator: 'lte' as const,
    value: cap,
  };
  const policy: PolicyCreateParams = {
    version: '1.0',
    name: spec.name ?? 'Vaultpilot agent: Earn on approved vaults only',
    chain_type: 'ethereum',
    rules: [
      {
        name: `earn_deposit approved vaults <= ${cap}`,
        method: 'earn_deposit',
        action: 'ALLOW',
        conditions: [vaultCondition, amountCondition],
      },
      {
        name: spec.capWithdrawals === false
          ? 'earn_withdraw approved vaults'
          : `earn_withdraw approved vaults <= ${cap}`,
        method: 'earn_withdraw',
        action: 'ALLOW',
        conditions: spec.capWithdrawals === false ? [vaultCondition] : [vaultCondition, amountCondition],
      },
    ],
  };
  return {
    policy,
    appSideLimits: {
      ...(spec.dailyCapUsd !== undefined ? {dailyCapUsd: spec.dailyCapUsd} : {}),
      reason:
        'Privy aggregations (rolling windows) are only supported for eth_signTransaction / eth_signUserOperation, not earn_deposit / earn_withdraw (docs.privy.io/controls/policies/stateful-policies). Enforce the daily cap in Vaultpilot and disclose it.',
    },
  };
}

/**
 * Create the policy, owned by the treasurer key so that neither the agent nor the bare app
 * secret can edit it. Docs: "Without an owner, the policies can be updated by your app secret
 * alone." https://docs.privy.io/controls/policies/create-a-policy
 */
export async function createPolicy(policy: PolicyCreateParams, opts: {ownedByTreasurer?: boolean; idempotencyKey?: string} = {}): Promise<Policy> {
  const privy = getPrivy();
  const owned = opts.ownedByTreasurer ?? true;
  return privy.policies().create({
    ...policy,
    ...(owned ? {owner: {public_key: ownerPublicKey()}} : {}),
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  });
}
