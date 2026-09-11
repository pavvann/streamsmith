/**
 * The three demo beats. All of them are DRY RUN unless `--execute` is passed, and the two that
 * would move money refuse to run when the business wallet's USDC balance cannot cover the amount.
 *
 *   pnpm demo:denied                    the agent asks for an unapproved vault id -> Privy denies.
 *                                       Moves nothing, needs no funds; safe to run any time.
 *   pnpm demo:deposit --amount 25 --execute
 *                                       deposits into whichever approved vault has the LOWER
 *                                       observed share-value growth, so a real rotation stays
 *                                       possible later. Prints Basescan links and the new position.
 *   pnpm demo:rotate --execute          one agent cycle with execution enabled.
 *
 * The threshold is never lowered to manufacture a rotation: `demo:deposit` picks the vault the
 * data says is behind and then waits for the rule to fire on its own.
 */
import {APIError} from '@privy-io/node';
import {buildSnapshot, writeSnapshot} from './snapshot.js';
import {createSource} from './data.js';
import {parseArgs, renderSummary, runCycle, type CliOptions} from './loop.js';
import {appendLedger} from './ledger.js';
import {basescanTxUrl, extractTxHashes} from './executor.js';
import {privyEarnClient} from './earnclient.js';
import {deposit, formatUnits, position, waitForAction} from './earn.js';
import {agentAuth} from './privy.js';
import {envNumber, envOptional, missingEnv} from './env.js';
import {BUSINESS_WALLET_ADDRESS, vaultRefs} from './vaults.js';
import {fromBaseUnits, parseDecimal} from './decimal.js';

/** Base mainnet USDC (docs/build/vaults.md: the asset() of both vaults). */
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

function describeError(e: unknown): string {
  if (e instanceof APIError) return `HTTP ${e.status} ${e.name}: ${JSON.stringify(e.error)}`;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function requireCredentials(): void {
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error(`this demo needs Privy credentials; unset: ${missing.join(', ')}`);
    process.exit(2);
  }
}

/** USDC balance of the business wallet, as a decimal string; null when it cannot be read. */
async function usdcBalance(): Promise<string | null> {
  const rpc = envOptional('BASE_RPC_URL');
  if (!rpc) return null;
  const data = `0x70a08231${'0'.repeat(24)}${BUSINESS_WALLET_ADDRESS.replace(/^0x/, '')}`;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: USDC, data}, 'latest']}),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as {result?: string; error?: {message?: string}};
    if (!json.result) throw new Error(json.error?.message ?? 'no result');
    return fromBaseUnits(BigInt(json.result).toString(), 6);
  } catch (e) {
    console.warn(`could not read the wallet USDC balance: ${(e as Error).message}`);
    return null;
  }
}

async function demoDenied(execute: boolean): Promise<void> {
  requireCredentials();
  const snapshot = await buildSnapshot({dryRun: true});
  const wallet = snapshot.wallet.walletId!;
  const unapproved = envOptional('PRIVY_VAULT_ID_UNAPPROVED') ?? 'vaultpilot-unapproved-vault-id';
  console.log(`DEMO 1 — the agent asks for a vault that is not on the allowlist.`);
  console.log(`  wallet     ${wallet} (${snapshot.wallet.address})`);
  console.log(`  allowed    ${snapshot.policy.allowedVaultIds.join(', ')}`);
  console.log(`  requested  ${unapproved}  amount 1 USDC`);
  if (!execute) {
    console.log('  DRY RUN: pass --execute to send the request. It moves no funds either way — Privy denies it.');
    return;
  }
  try {
    const action = await deposit(wallet, unapproved, '1', {auth: agentAuth()});
    const final = action.status === 'pending' ? await waitForAction(wallet, action.id) : action;
    const denied = final.status === 'rejected';
    console.log(`  outcome    ${denied ? 'DENIED (async rejected)' : final.status.toUpperCase()}  action ${final.id}`);
    appendLedger({
      kind: 'denial', dryRun: false, idempotencyKey: null, vaultId: unapproved, vaultLabel: 'not on the allowlist',
      amountUsd: 1, amountNormalized: '1', actionId: final.id, status: final.status, txHashes: extractTxHashes(final),
      note: `demo: earn_deposit into the unapproved vault id ${unapproved} -> ${final.status}`,
    });
  } catch (e) {
    const msg = describeError(e);
    const denied = e instanceof APIError && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
    console.log(`  outcome    ${denied ? 'DENIED (synchronous 4xx)' : 'ERROR'}  ${msg}`);
    appendLedger({
      kind: 'denial', dryRun: false, idempotencyKey: null, vaultId: unapproved, vaultLabel: 'not on the allowlist',
      amountUsd: 1, amountNormalized: '1', actionId: null, status: 'denied', txHashes: [],
      note: `demo: earn_deposit into the unapproved vault id ${unapproved} -> denied`, error: msg,
    });
  }
  console.log('  Above-policy actions are denied and returned to the treasurer; nothing was signed.');
}

async function demoDeposit(opts: CliOptions, amount: string): Promise<void> {
  const {execute, selection, fixture} = opts;
  requireCredentials();
  const source = createSource({
    ...(selection ? {selection} : {}),
    ...(fixture ? {fixturePath: fixture, selection: 'fixture' as const} : {}),
  });
  const snapshot = await buildSnapshot({source, dryRun: !execute, ...(opts.offline ? {offline: true} : {})});
  writeSnapshot(snapshot);
  const withGrowth = snapshot.vaults
    .map((v) => ({vaultId: v.vaultId, label: v.label, growth: v.growth?.growth ?? null}))
    .filter((v) => v.growth !== null)
    .sort((a, b) => (a.growth as number) - (b.growth as number));
  const refs = vaultRefs();
  const target = withGrowth[0] ?? {vaultId: refs[0].vaultId, label: refs[0].label, growth: null};
  const perActionCap = envNumber('VAULTPILOT_PER_ACTION_CAP_USD', 60);

  console.log('DEMO 2 — fund the vault with the LOWER observed share-value growth, so a rotation can happen later.');
  for (const v of snapshot.vaults) {
    const g = v.growth;
    console.log(`  ${v.label.padEnd(24)} growth ${g?.growth === null || g === null ? 'n/a' : `${(g.growth! * 10000).toFixed(4)} bps`} over ${g?.observedHours ?? 'n/a'} h  vault ${v.vaultId}`);
  }
  if (withGrowth.length < 2) {
    console.log('  note: fewer than two vaults have observed growth yet; the target is the lower of what is known.');
  }
  console.log(`  target     ${target.label} (${target.vaultId})`);
  console.log(`  amount     ${amount} USDC   per-action cap ${perActionCap}`);

  if (Number(amount) > perActionCap) {
    console.error(`  refused: ${amount} is above the ${perActionCap} per-action cap the policy allows.`);
    process.exit(1);
  }
  const balance = await usdcBalance();
  console.log(`  balance    ${balance ?? 'unknown'} USDC in ${BUSINESS_WALLET_ADDRESS}`);
  if (!execute) {
    console.log('  DRY RUN: pass --execute to send the deposit.');
    return;
  }
  if (balance === null || parseDecimal(balance) < parseDecimal(amount)) {
    console.error(`  refused: the business wallet holds ${balance ?? 'an unknown amount of'} USDC, which does not cover ${amount}. Fund it first.`);
    process.exit(1);
  }

  const client = privyEarnClient();
  const action = await client.deposit(snapshot.wallet.walletId!, target.vaultId, amount, `demo-deposit:${target.vaultId}:${amount}:${Date.now()}`);
  const final = action.status === 'pending' ? await client.waitForAction(snapshot.wallet.walletId!, action.id) : action;
  const hashes = extractTxHashes(final);
  console.log(`  outcome    ${final.status.toUpperCase()}  action ${final.id}`);
  for (const h of hashes) console.log(`  tx         ${basescanTxUrl(h)}`);
  appendLedger({
    kind: 'deposit', dryRun: false, idempotencyKey: null, vaultId: target.vaultId, vaultLabel: target.label,
    amountUsd: Number(amount), amountNormalized: amount, actionId: final.id, status: final.status,
    txHashes: hashes, note: `demo deposit ${amount} USDC into the lower-growth vault (${target.label})`,
  });
  const p = await position(snapshot.wallet.walletId!, target.vaultId);
  console.log(`  position   ${formatUnits(p.assets_in_vault, p.asset.decimals)} ${p.asset.symbol} in ${target.label} (shares ${p.shares_in_vault})`);
}

async function demoRotate(opts: CliOptions): Promise<void> {
  if (opts.execute) requireCredentials();
  console.log(`DEMO 3 — one agent cycle${opts.execute ? ' WITH EXECUTION' : ' (DRY RUN)'}${opts.offline ? ', offline (fixture positions, no Privy call)' : ''}.`);
  const {snapshot, execution} = await runCycle(opts);
  console.log(renderSummary(snapshot, execution));
  if (execution?.executed) {
    console.log('Rotation transactions:');
    for (const step of [execution.withdraw, execution.deposit]) {
      for (const h of step?.txHashes ?? []) console.log(`  ${step!.step}: ${basescanTxUrl(h)}`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const what = argv[0] ?? 'help';
  const opts = parseArgs(argv);
  const amountAt = argv.indexOf('--amount');
  const amount = amountAt >= 0 ? (argv[amountAt + 1] ?? '25') : '25';
  switch (what) {
    case 'denied':
      await demoDenied(opts.execute);
      return;
    case 'deposit':
      await demoDeposit(opts, amount);
      return;
    case 'rotate':
      await demoRotate(opts);
      return;
    default:
      console.log('usage: tsx src/demo.ts <denied|deposit|rotate> [--execute] [--amount 25] [--source local|cloud|fixture] [--fixture path] [--offline]');
      console.log('  every demo is a dry run without --execute; deposit and rotate also check the wallet balance first.');
      console.log('  --offline makes no Privy call at all (fixture positions): the rotate rehearsal without funds.');
  }
}

main().catch((e) => {
  console.error(`demo failed: ${describeError(e)}`);
  process.exit(1);
});
