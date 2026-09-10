/**
 * The live `EarnClient`: the executor's small interface, implemented on top of src/earn.ts with
 * the AGENT authorization key. The agent is an additional signer whose override policy allows
 * only `earn_deposit` / `earn_withdraw` on the two approved vault ids, under the per-action cap.
 * Reads (position, vault details) go out with the app secret, which cannot move funds.
 */
import type {EarnActionLike, EarnClient, EarnPositionLike} from './executor.js';
import {deposit, position, vaultDetails, waitForAction, withdraw} from './earn.js';
import {agentAuth} from './privy.js';

export function privyEarnClient(): EarnClient {
  return {
    async position(walletId, vaultId): Promise<EarnPositionLike> {
      const p = await position(walletId, vaultId);
      return {
        assets_in_vault: p.assets_in_vault,
        ...(p.shares_in_vault !== undefined ? {shares_in_vault: p.shares_in_vault} : {}),
        asset: {decimals: p.asset.decimals, symbol: p.asset.symbol},
      };
    },
    async withdraw(walletId, vaultId, amount, idempotencyKey): Promise<EarnActionLike> {
      const a = await withdraw(walletId, vaultId, amount, {auth: agentAuth(), idempotencyKey});
      return a as unknown as EarnActionLike;
    },
    async deposit(walletId, vaultId, amount, idempotencyKey): Promise<EarnActionLike> {
      const a = await deposit(walletId, vaultId, amount, {auth: agentAuth(), idempotencyKey});
      return a as unknown as EarnActionLike;
    },
    async waitForAction(walletId, actionId): Promise<EarnActionLike> {
      const a = await waitForAction(walletId, actionId);
      return a as unknown as EarnActionLike;
    },
  };
}

export interface VaultFacts {
  vaultId: string;
  name: string | null;
  /** the fee wrapper Privy deposits into (NOT the underlying Morpho vault), lowercase */
  wrapperAddress: string | null;
  caip2: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  /** `available_liquidity_usd` from vault details; used for the liquidity check only. */
  availableLiquidityUsd: string | null;
}

/**
 * Read the vault details we are allowed to show: name, chain, asset, fee-wrapper address and
 * available liquidity. The response also carries a rate field which this app never reads or
 * displays — the only growth number on screen comes from the pipeline's own observations.
 */
export async function readVaultFacts(vaultId: string): Promise<VaultFacts> {
  const d = (await vaultDetails(vaultId)) as unknown as Record<string, unknown>;
  const asset = (d.asset ?? {}) as {symbol?: string; decimals?: number};
  const liquidity = d.available_liquidity_usd;
  return {
    vaultId,
    name: typeof d.name === 'string' ? d.name : null,
    wrapperAddress: typeof d.vault_address === 'string' ? d.vault_address.toLowerCase() : null,
    caip2: typeof d.caip2 === 'string' ? d.caip2 : null,
    assetSymbol: asset.symbol ?? null,
    assetDecimals: asset.decimals ?? null,
    availableLiquidityUsd: liquidity === null || liquidity === undefined ? null : String(liquidity),
  };
}
