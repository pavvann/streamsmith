/**
 * Privy Earn (EVM) wrappers. Endpoints (https://docs.privy.io/api-reference/wallets/earn/*):
 *   GET  /v1/wallets/{wallet_id}/earn/ethereum/vaults?vault_id=...   position
 *   GET  /v1/earn/ethereum/vaults/{vault_id}                           vault details
 *   POST /v1/wallets/{wallet_id}/earn/ethereum/deposit                 {vault_id, amount|raw_amount}
 *   POST /v1/wallets/{wallet_id}/earn/ethereum/withdraw                {vault_id, amount|raw_amount}
 *   GET  /v1/wallets/{wallet_id}/actions/{action_id}?include=steps    poll
 * Deposit/withdraw return a wallet action with status `pending`; terminal statuses are
 * `succeeded | rejected | failed`. "Rejected — the action failed before any transaction was
 * signed or broadcast (e.g. insufficient balance, policy violation)."
 * https://docs.privy.io/wallets/actions/earn/webhooks
 * Gas: "If your app has gas sponsorship configured, usage of the /earn/ethereum/deposit endpoint
 * will be gas-sponsored by default." https://docs.privy.io/wallets/actions/earn/deposit
 */
import {randomUUID} from 'node:crypto';
import type {AuthorizationContext, PrivyClient} from '@privy-io/node';
import {getPrivy} from './privy.js';

// Response types derived from the SDK methods so we do not depend on export names that differ
// between @privy-io/node entrypoints (the package blocks deep imports via its exports map).
type EarnEthereum = ReturnType<ReturnType<PrivyClient['wallets']>['earn']>['ethereum'] extends () => infer S ? S : never;
export type EarnDepositActionResponse = Awaited<ReturnType<EarnEthereum['deposit']>>;
export type EarnWithdrawActionResponse = Awaited<ReturnType<EarnEthereum['withdraw']>>;
export type EthereumEarnPositionResponse = Awaited<ReturnType<EarnEthereum['vaultPosition']>>;
export type EthereumEarnVaultDetailsResponse = Awaited<ReturnType<EarnEthereum['vaultDetails']>>;
export type WalletActionResponse = Awaited<ReturnType<ReturnType<PrivyClient['wallets']>['actions']['get']>>;

export interface EarnActionOptions {
  /** Which key signs. Omit only for wallets with no owner (not our case). */
  auth: AuthorizationContext;
  idempotencyKey?: string;
}

export async function position(walletId: string, vaultId: string): Promise<EthereumEarnPositionResponse> {
  return getPrivy().wallets().earn().ethereum().vaultPosition(walletId, {vault_id: vaultId});
}

export async function vaultDetails(vaultId: string): Promise<EthereumEarnVaultDetailsResponse> {
  return getPrivy().wallets().earn().ethereum().vaultDetails(vaultId);
}

/** `amount` is a human-readable decimal string of the vault asset, e.g. "1.5" USDC. */
export async function deposit(walletId: string, vaultId: string, amount: string, opts: EarnActionOptions): Promise<EarnDepositActionResponse> {
  return getPrivy().wallets().earn().ethereum().deposit(walletId, {
    vault_id: vaultId,
    amount,
    authorization_context: opts.auth,
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  });
}

export async function withdraw(walletId: string, vaultId: string, amount: string, opts: EarnActionOptions): Promise<EarnWithdrawActionResponse> {
  return getPrivy().wallets().earn().ethereum().withdraw(walletId, {
    vault_id: vaultId,
    amount,
    authorization_context: opts.auth,
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  });
}

export async function getAction(walletId: string, actionId: string): Promise<WalletActionResponse> {
  return getPrivy().wallets().actions.get(actionId, {wallet_id: walletId, include: 'steps'});
}

/** Poll until terminal status or timeout. */
export async function waitForAction(walletId: string, actionId: string, opts: {timeoutMs?: number; intervalMs?: number} = {}): Promise<WalletActionResponse> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const interval = opts.intervalMs ?? 3_000;
  let last = await getAction(walletId, actionId);
  while (last.status === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    last = await getAction(walletId, actionId);
  }
  return last;
}

/** Format base-unit strings for display (USDC: 6 decimals). */
export function formatUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}
