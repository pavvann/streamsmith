/**
 * The two approved vaults, and the address set the outflow guardrail must ignore.
 *
 * A Privy Earn "vault" is a **fee wrapper**: a constrained Morpho Vault V2 that deposits into the
 * underlying vault (docs/build/vaults.md). Two different addresses matter:
 *   - the UNDERLYING vault, which the erc4626-flows pipeline observes and which the Deployment
 *     Receipt pins (`share_value_observations.vault`, `vault_flows.vault`);
 *   - the WRAPPER, returned by `GET /v1/earn/ethereum/vaults/{id}.vault_address`, which is what
 *     our deposits and withdrawals actually touch on chain.
 * The guardrail therefore excludes flows whose caller/owner/receiver is the business wallet or
 * either wrapper: those are our own actions, not third parties leaving the vault.
 *
 * Disclosure: each wrapper takes a **10% fee on generated returns** (Privy Dashboard "Fee 10%").
 * That is stated in the UI and the README, not hidden in a constant.
 */
import type {VaultRef} from './decision.js';
import {env, envOptional, loadEnv} from './env.js';

export const WRAPPER_FEE_PERCENT = 10;

export interface ApprovedVault {
  key: 'gauntlet' | 'steakhouse';
  label: string;
  /** on-chain name() of the underlying vault */
  onChainName: string;
  /** underlying ERC-4626 vault observed by the pipeline, lowercase */
  vaultAddress: string;
  /** Privy fee wrapper, lowercase; verified 2026-09-10 via GET /v1/earn/ethereum/vaults/{id} */
  wrapperAddress: string;
  /** Privy vault id recorded in docs/build/privy-spike.md; env wins when set */
  vaultIdFallback: string;
  envKey: 'PRIVY_VAULT_ID_GAUNTLET' | 'PRIVY_VAULT_ID_STEAKHOUSE';
}

export const APPROVED_VAULTS: readonly [ApprovedVault, ApprovedVault] = [
  {
    key: 'gauntlet',
    label: 'Gauntlet USDC Prime',
    onChainName: 'Gauntlet USDC Prime',
    vaultAddress: '0x050ce30b927da55177a4914ec73480238bad56f0',
    wrapperAddress: '0x3cb932ceaaaf42485d20ab4be6d7ec8cad291af2',
    vaultIdFallback: 'qwxu3riq3bvt5inw65jknkqf',
    envKey: 'PRIVY_VAULT_ID_GAUNTLET',
  },
  {
    key: 'steakhouse',
    label: 'Steakhouse Prime USDC',
    onChainName: 'Steakhouse Prime USDC',
    vaultAddress: '0xbeef0e0834849acc03f0089f01f4f1eeb06873c9',
    wrapperAddress: '0xfc956fb0ca009e0ab4f1e1964bdaa0c389f72028',
    vaultIdFallback: 'd5d6zyaety43rqx513osyexr',
    envKey: 'PRIVY_VAULT_ID_STEAKHOUSE',
  },
] as const;

/** Business wallet from docs/build/privy-spike.md, lowercase. */
export const BUSINESS_WALLET_ADDRESS = '0xcdc8b69799bcb135c04a1052b918787125571fdc';
export const BUSINESS_WALLET_ID = 'q4zcqb7leopoj7hocdtqhbfe';

/** VaultRefs for the decision service: env vault ids when present, recorded ids otherwise. */
export function vaultRefs(): [VaultRef, VaultRef] {
  loadEnv();
  const refs = APPROVED_VAULTS.map((v) => ({
    vaultId: envOptional(v.envKey) ?? v.vaultIdFallback,
    vaultAddress: v.vaultAddress,
    wrapperAddress: v.wrapperAddress,
    label: v.label,
  }));
  return [refs[0]!, refs[1]!];
}

/** Requires the env vault ids (used by anything that talks to Privy). */
export function requireVaultRefs(): [VaultRef, VaultRef] {
  const refs = APPROVED_VAULTS.map((v) => ({
    vaultId: env(v.envKey),
    vaultAddress: v.vaultAddress,
    wrapperAddress: v.wrapperAddress,
    label: v.label,
  }));
  return [refs[0]!, refs[1]!];
}

export function approvedVaultIds(): string[] {
  return vaultRefs().map((r) => r.vaultId);
}

export function labelOfVaultId(vaultId: string | null): string | null {
  if (!vaultId) return null;
  return vaultRefs().find((r) => r.vaultId === vaultId)?.label ?? vaultId;
}

/**
 * Addresses whose flows are OURS and must be excluded from the destination outflow guardrail:
 * the business wallet plus both fee wrappers (and any extra address a caller passes in).
 */
export function selfAddresses(extra: (string | null | undefined)[] = []): string[] {
  const all = [
    BUSINESS_WALLET_ADDRESS,
    ...APPROVED_VAULTS.map((v) => v.wrapperAddress),
    ...extra.filter((a): a is string => !!a),
  ];
  return [...new Set(all.map((a) => a.toLowerCase()))];
}
