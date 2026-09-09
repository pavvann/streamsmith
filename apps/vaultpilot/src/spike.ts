/**
 * Vaultpilot kill-risk spike.
 * Sequence: create business wallet -> create Earn policy -> register agent key + attach as
 * additional signer -> read both vault positions -> attempt a deposit to a NON-allowed vault id
 * with the agent key (expect denial) -> attempt an over-cap deposit to an allowed vault (expect
 * denial) -> print results.  Nothing is faked: every step is a live Privy call.
 *
 * Re-runs reuse ids saved in .vaultpilot-state.json so we do not create a wallet per run.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {APIError} from '@privy-io/node';
import {ENV_FILE, envOptional, env, missingEnv} from './env.js';
import {agentAuth} from './privy.js';
import {createBusinessWallet, describeWallet, getWallet} from './wallet.js';
import {buildEarnPolicy, createPolicy} from './policy.js';
import {attachAgentSigner, createAgentAuthorizationKey} from './signer.js';
import {deposit, formatUnits, position, vaultDetails, waitForAction} from './earn.js';

const STATE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.vaultpilot-state.json');

interface State {
  walletId?: string;
  policyId?: string;
  agentKeyQuorumId?: string;
}

function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State) : {};
}
function saveState(s: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

function step(title: string): void {
  console.log(`\n== ${title}`);
}

function describeError(e: unknown): string {
  if (e instanceof APIError) {
    return `HTTP ${e.status} ${e.name}: ${JSON.stringify(e.error)}`;
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function main(): Promise<void> {
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error('Vaultpilot spike cannot run: the following env vars are unset.');
    for (const k of missing) console.error(`  - ${k}`);
    console.error(`\nCopy .env.example to ${ENV_FILE} and fill them in (see the comments there).`);
    console.error('Nothing was called; no state was written.');
    process.exit(2);
  }
  if (!envOptional('BASE_RPC_URL')) {
    console.warn('note: BASE_RPC_URL is unset (not needed by this spike; needed later for maxWithdraw/liquidity checks).');
  }

  const gauntlet = env('PRIVY_VAULT_ID_GAUNTLET');
  const steakhouse = env('PRIVY_VAULT_ID_STEAKHOUSE');
  const perActionCapUsd = Number(envOptional('VAULTPILOT_PER_ACTION_CAP_USD') ?? '60');
  const dailyCapUsd = Number(envOptional('VAULTPILOT_DAILY_CAP_USD') ?? '120');
  const unapprovedVaultId = envOptional('PRIVY_VAULT_ID_UNAPPROVED') ?? 'vaultpilot-unapproved-vault-id';

  const state = loadState();
  const results: Record<string, unknown> = {};

  step('0. Vault details (sanity: both vault ids resolve, both on Base = eip155:8453)');
  for (const [label, id] of [['gauntlet', gauntlet], ['steakhouse', steakhouse]] as const) {
    try {
      const d = await vaultDetails(id);
      console.log(label, {id: d.id, name: d.name, provider: d.provider, caip2: d.caip2, vault_address: d.vault_address, asset: d.asset, user_apy_bps: d.user_apy, available_liquidity_usd: d.available_liquidity_usd});
      results[`vault_${label}`] = {id: d.id, name: d.name, caip2: d.caip2};
    } catch (e) {
      console.log(label, 'FAILED', describeError(e));
      results[`vault_${label}`] = {error: describeError(e)};
    }
  }

  step('1. Business wallet (owner = treasurer authorization key)');
  if (!state.walletId) {
    const w = await createBusinessWallet({displayName: 'Vaultpilot business wallet (spike)'});
    state.walletId = w.id;
    saveState(state);
    console.log('created', describeWallet(w));
  } else {
    console.log('reusing wallet from state file', state.walletId);
  }
  const wallet = await getWallet(state.walletId);
  console.log(describeWallet(wallet));
  results.wallet = describeWallet(wallet);

  step('2. Earn policy (earn_deposit / earn_withdraw, vault_id in allowlist, amount <= cap)');
  const built = buildEarnPolicy({allowedVaultIds: [gauntlet, steakhouse], perActionCapUsd, dailyCapUsd});
  console.log(JSON.stringify(built.policy, null, 2));
  console.log('app-side limits (not enforceable by Privy for Earn):', built.appSideLimits);
  if (!state.policyId) {
    const p = await createPolicy(built.policy);
    state.policyId = p.id;
    saveState(state);
    console.log('created policy', p.id, 'owner_id', p.owner_id);
  } else {
    console.log('reusing policy from state file', state.policyId);
  }
  results.policyId = state.policyId;

  step('3. Agent key -> key quorum -> additional signer with override policy');
  if (!state.agentKeyQuorumId) {
    const k = await createAgentAuthorizationKey();
    state.agentKeyQuorumId = k.keyQuorumId;
    saveState(state);
    console.log('registered agent key quorum', k.keyQuorumId, 'public key', k.publicKey.slice(0, 24) + '...');
  } else {
    console.log('reusing agent key quorum from state file', state.agentKeyQuorumId);
  }
  const updated = await attachAgentSigner(state.walletId, state.agentKeyQuorumId, state.policyId);
  console.log('wallet after attach', describeWallet(updated));
  results.additional_signers = updated.additional_signers;

  step('4. Positions in both vaults (read with app secret)');
  for (const [label, id] of [['gauntlet', gauntlet], ['steakhouse', steakhouse]] as const) {
    try {
      const p = await position(state.walletId, id);
      console.log(label, {
        assets_in_vault: `${formatUnits(p.assets_in_vault, p.asset.decimals)} ${p.asset.symbol}`,
        shares_in_vault: p.shares_in_vault,
        total_deposited: formatUnits(p.total_deposited, p.asset.decimals),
        total_withdrawn: formatUnits(p.total_withdrawn, p.asset.decimals),
      });
      results[`position_${label}`] = p;
    } catch (e) {
      console.log(label, 'FAILED', describeError(e));
      results[`position_${label}`] = {error: describeError(e)};
    }
  }

  step(`5. DENIAL TEST A: agent deposits 1 USDC into NON-allowed vault id "${unapprovedVaultId}"`);
  results.denial_unapproved_vault = await attemptDeposit(state.walletId, unapprovedVaultId, '1');

  step(`6. DENIAL TEST B: agent deposits ${perActionCapUsd + 1} USDC (over the ${perActionCapUsd} cap) into the allowed Gauntlet vault`);
  results.denial_over_cap = await attemptDeposit(state.walletId, gauntlet, String(perActionCapUsd + 1));

  step('RESULTS');
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nState saved at ${STATE_FILE}. Revoke the agent at any time with detachAgentSigner(walletId, agentKeyQuorumId) signed by PRIVY_AUTH_KEY.`);
}

async function attemptDeposit(walletId: string, vaultId: string, amount: string): Promise<Record<string, unknown>> {
  try {
    const action = await deposit(walletId, vaultId, amount, {auth: agentAuth()});
    console.log('accepted synchronously (status', action.status + '), action id', action.id, '- polling for terminal status');
    const final = await waitForAction(walletId, action.id);
    const outcome = {
      outcome: final.status === 'rejected' ? 'DENIED (async rejected)' : final.status === 'succeeded' ? 'EXECUTED - POLICY DID NOT BLOCK' : final.status,
      action: final,
    };
    console.log(outcome.outcome, JSON.stringify(final, null, 2));
    return outcome;
  } catch (e) {
    const msg = describeError(e);
    const denied = e instanceof APIError && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
    console.log(denied ? 'DENIED (synchronous 4xx)' : 'ERROR', msg);
    return {outcome: denied ? 'DENIED (synchronous 4xx)' : 'ERROR', error: msg};
  }
}

main().catch((e) => {
  console.error('spike failed:', describeError(e));
  process.exit(1);
});
