/**
 * Business wallet: an EVM server wallet owned by the treasurer's authorization key.
 *
 * - `privy.wallets().create({chain_type:'ethereum', owner:{public_key}})` creates a wallet whose
 *   owner is a key quorum auto-created around that public key; the response carries `owner_id`.
 *   https://docs.privy.io/wallets/wallets/create/create-a-wallet
 *   https://docs.privy.io/controls/authorization-keys/keys/create/key
 * - `privy.wallets().get(walletId)` returns id, address, owner_id, policy_ids, additional_signers.
 *   https://docs.privy.io/api-reference/wallets/get
 */
import {randomUUID} from 'node:crypto';
import type {Wallet} from '@privy-io/node';
import {getPrivy, ownerPublicKey} from './privy.js';

export interface CreateBusinessWalletOptions {
  displayName?: string;
  /** Base policy ids for the wallet itself (applies to the OWNER's own actions). Optional. */
  policyIds?: string[];
  idempotencyKey?: string;
}

/**
 * Create the business wallet. The treasurer's key (PRIVY_AUTH_KEY) becomes the owner, so every
 * later change (policies, signers, export) must be signed by that key; the app secret alone is
 * not enough.
 */
export async function createBusinessWallet(opts: CreateBusinessWalletOptions = {}): Promise<Wallet> {
  const privy = getPrivy();
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    owner: {public_key: ownerPublicKey()},
    display_name: opts.displayName ?? 'Vaultpilot business wallet',
    ...(opts.policyIds ? {policy_ids: opts.policyIds} : {}),
    idempotency_key: opts.idempotencyKey ?? randomUUID(),
  });
  return wallet;
}

export async function getWallet(walletId: string): Promise<Wallet> {
  return getPrivy().wallets().get(walletId);
}

/** Human-readable summary used by the spike and (later) the UI "who controls this wallet" panel. */
export function describeWallet(w: Wallet): Record<string, unknown> {
  return {
    id: w.id,
    address: w.address,
    chain_type: w.chain_type,
    owner_id: w.owner_id,
    policy_ids: w.policy_ids,
    additional_signers: w.additional_signers,
    display_name: w.display_name ?? null,
  };
}
