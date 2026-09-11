/**
 * The agent loop.
 *
 *   pnpm agent:once             one cycle: read -> decide -> print. DRY RUN: sends nothing.
 *   pnpm agent:once --execute   the same cycle, and if the decision is `rotate`, execute it.
 *   pnpm agent:watch            one cycle every VAULTPILOT_WATCH_MINUTES (default 10) minutes.
 *
 * Flags: --execute, --source local|cloud|fixture, --fixture <path>, --json, --minutes <n>,
 * --offline (make no Privy call at all: positions and liquidity come from the fixture, which is
 * how the rotate path can be rehearsed end to end while the business wallet is still unfunded).
 * Every cycle writes .vaultpilot-snapshot.json so the UI has something to show even when the
 * agent is not running, and appends to .vaultpilot-ledger.json.
 */
import {buildSnapshot, writeSnapshot, type Snapshot} from './snapshot.js';
import type {EarnClient} from './executor.js';
import {createSource, type SourceSelection} from './data.js';
import {envNumber} from './env.js';
import {executeRotation, basescanTxUrl, type ExecutionResult} from './executor.js';
import {privyEarnClient} from './earnclient.js';

export interface CliOptions {
  execute: boolean;
  json: boolean;
  selection: SourceSelection | undefined;
  fixture: string | undefined;
  minutes: number | undefined;
  /** never call Privy; take positions and liquidity from the fixture. Implies dry run. */
  offline: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const minutes = at('--minutes');
  return {
    execute: argv.includes('--execute') && !argv.includes('--offline'),
    json: argv.includes('--json'),
    offline: argv.includes('--offline'),
    selection: at('--source') as SourceSelection | undefined,
    fixture: at('--fixture'),
    minutes: minutes === undefined ? undefined : Number(minutes),
  };
}

function bar(): string {
  return '-'.repeat(78);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function ts(unix: number | null | undefined): string {
  return unix ? new Date(unix * 1000).toISOString().replace('.000Z', 'Z') : 'n/a';
}

/** The one-screen text summary. Same facts as the UI, same words. */
export function renderSummary(s: Snapshot, execution: ExecutionResult | null = null): string {
  const out: string[] = [];
  const d = s.decision;
  out.push(bar());
  out.push(`VAULTPILOT  ${s.generatedAt}   ${s.mode.dryRun ? 'DRY RUN (nothing is sent)' : 'EXECUTE'}   data: ${s.mode.source.kind} (${s.mode.source.origin})`);
  out.push(bar());

  out.push('POSITION');
  for (const v of s.vaults) {
    const p = v.position;
    const held = p ? `${p.assetsNormalized} ${p.assetSymbol}` : 'unknown';
    out.push(`  ${pad(v.label, 24)} ${pad(held, 18)} vault ${v.vaultId}`);
    out.push(`  ${pad('', 24)} observed ${v.vaultAddress}  via wrapper ${v.wrapperAddress ?? 'unknown'} (fee ${v.wrapperFeePercent}% on generated returns)`);
  }

  out.push('OBSERVED WINDOW AND SHARE-VALUE GROWTH');
  if (s.decision.evidence.observedWindow.vaults.length === 0) out.push('  no call_ok observations in the sink yet');
  for (const w of d.evidence.observedWindow.vaults) {
    const g = [d.evidence.growthA, d.evidence.growthB].find((x) => x && x.vaultId === w.vaultId);
    out.push(
      `  ${pad(w.label, 24)} ${pad(`${w.hours} h`, 9)} blocks ${w.firstBlockNumber}-${w.lastBlockNumber}  ` +
      `${w.observationCount} obs  growth ${g?.growthBps ?? 'n/a'} bps  ${w.meetsMinimum ? '' : `(under the ${d.evidence.observedWindow.minHoursRequired} h minimum)`}`,
    );
    if (g) out.push(`  ${pad('', 24)} share value ${g.firstAssetsPerShareNormalized} -> ${g.lastAssetsPerShareNormalized}  (${ts(w.firstBlockTimestamp)} .. ${ts(w.lastBlockTimestamp)})`);
  }
  out.push(`  differential: ${d.evidence.differentialBps ?? 'n/a'} bps   minimum to act: ${s.config.minDifferentialBps} bps`);

  out.push('GUARDRAIL (24 h net third-party outflow, our own flows excluded)');
  for (const g of d.evidence.guardrail.evaluated) {
    out.push(
      `  ${pad(g.label, 24)} out ${pad(g.assetsOutNormalized, 14)} ours ${pad(g.selfExcludedOutNormalized, 12)} ` +
      `net ${pad(g.netOutflowExcludingSelfNormalized, 14)} = ${g.outflowBps ?? 'n/a'} bps (limit ${d.evidence.guardrail.limitBps})${g.exceedsLimit ? '  EXCEEDS' : ''}`,
    );
  }

  out.push('PIPELINE');
  out.push(`  ${s.pipelineHealth.refused ? `REFUSED (${s.pipelineHealth.reason}): ${s.pipelineHealth.detail}` : 'verified'}`);
  out.push(`  head ${s.pipelineHealth.headBlock ?? 'n/a'}  chain ${s.pipelineHealth.chainHead ?? 'n/a'}  lag ${s.pipelineHealth.lagBlocks ?? 'n/a'} (limit ${s.config.maxLagBlocks})  chain id ${s.pipelineHealth.chainId ?? 'n/a'}`);
  out.push(`  package ${s.provenance.packageName ?? '?'} ${s.provenance.packageVersion ?? ''}  packageHash ${(s.provenance.packageHash ?? '').slice(0, 16)}  outputModuleHash ${(s.provenance.outputModuleHash ?? '').slice(0, 16)}  mode ${s.provenance.deploymentMode ?? '?'}`);

  out.push('POLICY');
  out.push(`  earn_deposit / earn_withdraw on ${s.policy.allowedVaultIds.join(', ')} only, amount <= ${s.policy.perActionCapUsd}; everything else is denied by default`);
  out.push(`  app-side daily cap ${s.policy.dailyCapUsd} USD: ${s.policy.dailySpentUsd} used, ${s.policy.dailyRemainingUsd} left (trailing 24 h, from the ledger)`);
  out.push(`  cooldown ${s.config.cooldownHours} h; last rotation ${d.evidence.cooldown.lastRotationAt ?? 'never'}`);

  out.push(`DECISION: ${d.action.toUpperCase()}`);
  out.push(`  ${d.reason}`);
  if (d.refusals.length > 0) {
    for (const r of d.refusals) out.push(`  refusal [${r.code}] ${r.message}`);
  }
  out.push(`  idempotency key ${d.idempotencyKey ?? 'n/a'}   amount ${d.amountNormalized ?? 'n/a'}`);

  if (execution) {
    out.push('EXECUTION');
    if (execution.skipped) out.push(`  skipped [${execution.skipped}] ${execution.skippedMessage}`);
    for (const step of [execution.withdraw, execution.deposit]) {
      if (!step) continue;
      out.push(`  ${pad(step.step, 9)} ${pad(step.vaultLabel ?? step.vaultId, 24)} ${step.amountNormalized}  status ${step.status}  action ${step.actionId ?? 'n/a'}${step.error ? `  error ${step.error}` : ''}`);
      for (const h of step.txHashes) out.push(`            ${basescanTxUrl(h)}`);
    }
    if (execution.alert) out.push(`  ALERT [${execution.alert.code}] ${execution.alert.message}`);
  }

  if (s.ledger.alerts.length > 0) {
    out.push('OPEN ALERTS');
    for (const a of s.ledger.alerts.slice(-3)) out.push(`  ${a.at} ${a.note}`);
  }
  out.push('CONTROL');
  out.push(`  wallet ${s.wallet.walletId} ${s.wallet.address}  treasurer key ${s.wallet.treasurerKeyId ?? 'unknown'}  agent signer ${s.wallet.agentKeyQuorumId ?? 'unknown'}`);
  out.push(`  revoke: ${s.wallet.revocationCommand}`);
  if (s.errors.length > 0) {
    out.push('NOTES');
    for (const e of s.errors) out.push(`  ${e}`);
  }
  out.push(bar());
  return out.join('\n');
}

export interface CycleResult {
  snapshot: Snapshot;
  execution: ExecutionResult | null;
}

export async function runCycle(opts: CliOptions): Promise<CycleResult> {
  const source = createSource({
    ...(opts.selection ? {selection: opts.selection} : {}),
    ...(opts.fixture ? {fixturePath: opts.fixture, selection: 'fixture' as const} : {}),
  });
  const snapshot = await buildSnapshot({
    source,
    dryRun: !opts.execute,
    ...(opts.offline ? {offline: true} : {}),
  });
  let execution: ExecutionResult | null = null;
  if (snapshot.decision.action === 'rotate') {
    execution = await executeRotation({
      decision: snapshot.decision,
      walletId: snapshot.wallet.walletId ?? '',
      // The only place a signing client is ever constructed is behind `--execute`.
      client: opts.execute ? privyEarnClient() : dryRunClient(snapshot),
      dryRun: !opts.execute,
      perActionCapUsd: snapshot.policy.perActionCapUsd,
      dailyCapUsd: snapshot.policy.dailyCapUsd,
    });
  }
  writeSnapshot(snapshot);
  return {snapshot, execution};
}

/**
 * Dry-run client. It reports the position the snapshot already read (live from Privy, or from the
 * fixture when offline) and refuses to sign anything: this object has no authorization key and no
 * path to one, so a dry run cannot move money even if the guards above it were wrong.
 */
export function dryRunClient(snapshot: Snapshot): EarnClient {
  return {
    async position(_walletId: string, vaultId: string) {
      const p = snapshot.vaults.find((v) => v.vaultId === vaultId)?.position;
      if (!p) return {assets_in_vault: '0', asset: {decimals: 6, symbol: 'USDC'}};
      return {assets_in_vault: p.assetsInVaultRaw, asset: {decimals: p.assetDecimals, symbol: p.assetSymbol}};
    },
    async withdraw(): Promise<never> {
      throw new Error('dry run: no withdrawal is ever sent without --execute');
    },
    async deposit(): Promise<never> {
      throw new Error('dry run: no deposit is ever sent without --execute');
    },
    async waitForAction(): Promise<never> {
      throw new Error('dry run: nothing to poll');
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv[0] === 'watch' ? 'watch' : 'once';
  const opts = parseArgs(argv);
  if (mode === 'once') {
    const {snapshot, execution} = await runCycle(opts);
    console.log(opts.json ? JSON.stringify({snapshot, execution}, null, 2) : renderSummary(snapshot, execution));
    return;
  }
  const minutes = opts.minutes ?? envNumber('VAULTPILOT_WATCH_MINUTES', 10);
  console.log(`vaultpilot watch: one cycle every ${minutes} min, ${opts.execute ? 'EXECUTING rotations' : 'DRY RUN'}. Ctrl-C to stop.`);
  const tick = async (): Promise<void> => {
    try {
      const {snapshot, execution} = await runCycle(opts);
      console.log(renderSummary(snapshot, execution));
    } catch (e) {
      console.error(`cycle failed: ${(e as Error).message}`);
    }
  };
  await tick();
  setInterval(() => void tick(), Math.max(1, minutes) * 60_000);
}

const invokedDirectly = process.argv[1] !== undefined && /loop\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`vaultpilot failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
