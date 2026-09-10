/**
 * Rotation executor: two sequential Privy Earn actions signed by the AGENT key, inside the
 * policy the treasurer owns (`earn_deposit` / `earn_withdraw`, vault allowlist, per-action cap).
 *
 * Order and failure semantics (docs/PROJECT.md section 4.3):
 *   withdraw everything from the source vault -> poll to a terminal status -> deposit into the
 *   destination -> poll. "Two sequential transactions: if withdraw succeeds and deposit fails,
 *   USDC stays idle and the treasurer is alerted." Nothing is retried automatically.
 *
 * Guards that run BEFORE any money moves, in this order: the decision must say `rotate`; the
 * idempotency key must be unclaimed in the ledger; the source must actually hold a position; the
 * amount must be within the per-action cap the policy enforces; and BOTH legs together must fit
 * inside the app-side rolling daily cap — a withdrawal is never sent when its matching deposit
 * would be over the cap.
 *
 * Amounts are always sent as `amount` (human-readable decimal), never `raw_amount`: Privy states
 * "A rule using `amount` will not match a request that only sends `raw_amount`", so a raw_amount
 * withdrawal would fall through the ALLOW rule into the policy's default DENY. USDC has 6
 * decimals, so converting `assets_in_vault` base units to a decimal string is exact.
 */
import {randomUUID} from 'node:crypto';
import type {Decision} from './decision.js';
import {fromBaseUnits, parseDecimal} from './decimal.js';
import {
  appendLedger,
  dailyCapRemainingUsd,
  executedKeys,
  readLedger,
  type LedgerEntry,
  LEDGER_PATH,
} from './ledger.js';
import {labelOfVaultId} from './vaults.js';

export interface EarnPositionLike {
  assets_in_vault: string;
  shares_in_vault?: string;
  asset: {decimals: number; symbol: string};
}

export interface EarnActionLike {
  id: string;
  status: string;
  [key: string]: unknown;
}

/** The slice of Privy Earn the executor needs; `privyEarnClient()` is the real one, tests mock it. */
export interface EarnClient {
  position(walletId: string, vaultId: string): Promise<EarnPositionLike>;
  withdraw(walletId: string, vaultId: string, amount: string, idempotencyKey: string): Promise<EarnActionLike>;
  deposit(walletId: string, vaultId: string, amount: string, idempotencyKey: string): Promise<EarnActionLike>;
  waitForAction(walletId: string, actionId: string): Promise<EarnActionLike>;
}

export interface ExecuteRotationOptions {
  decision: Decision;
  walletId: string;
  client: EarnClient;
  /** true (the default everywhere) means: decide and log, send nothing. */
  dryRun: boolean;
  perActionCapUsd: number;
  dailyCapUsd: number;
  ledgerPath?: string;
  now?: () => number;
}

export interface StepOutcome {
  step: 'withdraw' | 'deposit';
  vaultId: string;
  vaultLabel: string | null;
  amountNormalized: string;
  actionId: string | null;
  status: string;
  txHashes: string[];
  error?: string;
}

export interface ExecutionAlert {
  code: 'idle_usdc' | 'withdraw_failed' | 'withdraw_denied';
  message: string;
  amountNormalized: string | null;
  vaultId: string | null;
}

export interface ExecutionResult {
  attempted: boolean;
  executed: boolean;
  dryRun: boolean;
  /** set when nothing was sent; one of the guard codes below. */
  skipped: string | null;
  skippedMessage: string | null;
  amountNormalized: string | null;
  amountUsd: number | null;
  idempotencyKey: string | null;
  withdraw: StepOutcome | null;
  deposit: StepOutcome | null;
  alert: ExecutionAlert | null;
  dailyCap: {capUsd: number; remainingUsdBefore: number; requiredUsd: number | null};
  entries: LedgerEntry[];
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Collect every 32-byte hash-looking string in a Privy action response (steps included). */
export function extractTxHashes(value: unknown, seen = new Set<string>(), depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [...seen];
  if (typeof value === 'string') {
    if (TX_HASH.test(value)) seen.add(value.toLowerCase());
    return [...seen];
  }
  if (Array.isArray(value)) {
    for (const v of value) extractTxHashes(v, seen, depth + 1);
    return [...seen];
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // block hashes are not transaction hashes; everything else that looks like a hash counts
      if (/block_hash|blockHash/.test(k)) continue;
      extractTxHashes(v, seen, depth + 1);
    }
  }
  return [...seen];
}

export function basescanTxUrl(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}

function describeError(e: unknown): string {
  const err = e as {status?: number; name?: string; message?: string; error?: unknown};
  if (err && typeof err.status === 'number') {
    return `HTTP ${err.status} ${err.name ?? 'APIError'}: ${typeof err.error === 'object' ? JSON.stringify(err.error) : err.message ?? ''}`;
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function isDenial(e: unknown): boolean {
  const status = (e as {status?: number}).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Execute (or dry-run) the rotation the decision describes. Never throws: every failure comes
 * back as a step outcome plus a ledger entry, so the caller can print it and the UI can show it.
 */
export async function executeRotation(opts: ExecuteRotationOptions): Promise<ExecutionResult> {
  const ledgerPath = opts.ledgerPath ?? LEDGER_PATH;
  const nowMs = (opts.now ?? Date.now)();
  const d = opts.decision;
  const entries: LedgerEntry[] = [];
  const record = (e: Parameters<typeof appendLedger>[0]): LedgerEntry => {
    const written = appendLedger(e, ledgerPath);
    entries.push(written);
    return written;
  };
  const ledgerBefore = readLedger(ledgerPath);
  const remainingBefore = dailyCapRemainingUsd(ledgerBefore, opts.dailyCapUsd, nowMs);
  const base: ExecutionResult = {
    attempted: false,
    executed: false,
    dryRun: opts.dryRun,
    skipped: null,
    skippedMessage: null,
    amountNormalized: null,
    amountUsd: null,
    idempotencyKey: d.idempotencyKey,
    withdraw: null,
    deposit: null,
    alert: null,
    dailyCap: {capUsd: opts.dailyCapUsd, remainingUsdBefore: remainingBefore, requiredUsd: null},
    entries,
  };
  const skip = (code: string, message: string): ExecutionResult => ({...base, skipped: code, skippedMessage: message, entries});

  if (d.action !== 'rotate') return skip('not_a_rotation', `decision is ${d.action}: ${d.reason}`);
  if (!d.from || !d.to || !d.idempotencyKey) return skip('incomplete_decision', 'decision has no source, destination or idempotency key');
  if (executedKeys(ledgerBefore).includes(d.idempotencyKey)) {
    return skip('already_executed', `idempotency key ${d.idempotencyKey} is already in the ledger`);
  }

  // --- source position -------------------------------------------------------------------------
  let position: EarnPositionLike;
  try {
    position = await opts.client.position(opts.walletId, d.from);
  } catch (e) {
    const message = `could not read the position in ${labelOfVaultId(d.from)}: ${describeError(e)}`;
    record({
      kind: 'alert', dryRun: opts.dryRun, idempotencyKey: d.idempotencyKey, vaultId: d.from,
      vaultLabel: labelOfVaultId(d.from), amountUsd: null, amountNormalized: null, actionId: null,
      status: 'error', txHashes: [], note: message, error: describeError(e),
    });
    return skip('position_unreadable', message);
  }
  const decimals = position.asset?.decimals ?? 6;
  const amountNormalized = fromBaseUnits(position.assets_in_vault ?? '0', decimals);
  const amountUsd = Number(amountNormalized);
  const withAmount: ExecutionResult = {...base, amountNormalized, amountUsd};
  const skipWithAmount = (code: string, message: string): ExecutionResult => ({...withAmount, skipped: code, skippedMessage: message, entries});

  if (parseDecimal(amountNormalized) <= 0n) {
    return skipWithAmount('source_empty', `${labelOfVaultId(d.from)} holds no assets any more; nothing to rotate`);
  }

  // --- per-action cap (the policy enforces it too; we do not even ask) -------------------------
  if (amountUsd > opts.perActionCapUsd) {
    const message = `${amountNormalized} ${position.asset.symbol} exceeds the ${opts.perActionCapUsd} per-action cap in the agent's policy; returned to the treasurer`;
    record({
      kind: 'denial', dryRun: opts.dryRun, idempotencyKey: d.idempotencyKey, vaultId: d.from,
      vaultLabel: labelOfVaultId(d.from), amountUsd, amountNormalized, actionId: null,
      status: 'denied', txHashes: [], note: message,
    });
    return skipWithAmount('per_action_cap', message);
  }

  // --- app-side rolling daily cap (both legs) --------------------------------------------------
  const requiredUsd = amountUsd * 2;
  withAmount.dailyCap = {capUsd: opts.dailyCapUsd, remainingUsdBefore: remainingBefore, requiredUsd};
  if (requiredUsd > remainingBefore) {
    const message = `a rotation needs ${requiredUsd} USD of daily cap (withdraw + deposit) but only ${remainingBefore} of the ${opts.dailyCapUsd} USD app-side cap is left in the trailing 24 h; no withdrawal is sent`;
    record({
      kind: 'denial', dryRun: opts.dryRun, idempotencyKey: d.idempotencyKey, vaultId: d.from,
      vaultLabel: labelOfVaultId(d.from), amountUsd, amountNormalized, actionId: null,
      status: 'denied', txHashes: [], note: message,
    });
    return skipWithAmount('daily_cap', message);
  }

  // --- dry run: log the decision, send nothing --------------------------------------------------
  if (opts.dryRun) {
    record({
      kind: 'decision', dryRun: true, idempotencyKey: d.idempotencyKey, vaultId: d.from,
      vaultLabel: labelOfVaultId(d.from), amountUsd, amountNormalized, actionId: null,
      status: 'recorded', txHashes: [], note: `DRY RUN would rotate ${amountNormalized} ${position.asset.symbol}: ${d.reason}`,
      decision: decisionRecord(d),
    });
    return skipWithAmount('dry_run', `DRY RUN: would move ${amountNormalized} ${position.asset.symbol} from ${labelOfVaultId(d.from)} to ${labelOfVaultId(d.to)}. Re-run with --execute to send it.`);
  }

  // --- leg 1: withdraw --------------------------------------------------------------------------
  const result: ExecutionResult = {...withAmount, attempted: true, entries};
  const withdrawKey = `${d.idempotencyKey}:withdraw:${randomUUID().slice(0, 8)}`;
  let withdrawOutcome: StepOutcome;
  try {
    const action = await opts.client.withdraw(opts.walletId, d.from, amountNormalized, withdrawKey);
    const final = action.status === 'pending' ? await opts.client.waitForAction(opts.walletId, action.id) : action;
    withdrawOutcome = {
      step: 'withdraw', vaultId: d.from, vaultLabel: labelOfVaultId(d.from), amountNormalized,
      actionId: final.id ?? action.id, status: final.status, txHashes: extractTxHashes(final),
    };
  } catch (e) {
    withdrawOutcome = {
      step: 'withdraw', vaultId: d.from, vaultLabel: labelOfVaultId(d.from), amountNormalized,
      actionId: null, status: isDenial(e) ? 'denied' : 'error', txHashes: [], error: describeError(e),
    };
  }
  record({
    kind: 'withdraw', dryRun: false, idempotencyKey: d.idempotencyKey, vaultId: d.from,
    vaultLabel: labelOfVaultId(d.from), amountUsd, amountNormalized, actionId: withdrawOutcome.actionId,
    status: withdrawOutcome.status, txHashes: withdrawOutcome.txHashes,
    note: `withdraw ${amountNormalized} ${position.asset.symbol} from ${labelOfVaultId(d.from)}`,
    ...(withdrawOutcome.error ? {error: withdrawOutcome.error} : {}),
    decision: decisionRecord(d),
  });
  result.withdraw = withdrawOutcome;

  if (withdrawOutcome.status !== 'succeeded') {
    const denied = withdrawOutcome.status === 'denied' || withdrawOutcome.status === 'rejected';
    const alert: ExecutionAlert = {
      code: denied ? 'withdraw_denied' : 'withdraw_failed',
      message: denied
        ? `the withdrawal from ${labelOfVaultId(d.from)} was denied and returned to the treasurer (${withdrawOutcome.error ?? withdrawOutcome.status}); the position is untouched`
        : `the withdrawal from ${labelOfVaultId(d.from)} ended as ${withdrawOutcome.status}; the position may be untouched, no deposit was attempted`,
      amountNormalized,
      vaultId: d.from,
    };
    record({
      kind: 'alert', dryRun: false, idempotencyKey: d.idempotencyKey, vaultId: d.from,
      vaultLabel: labelOfVaultId(d.from), amountUsd, amountNormalized, actionId: withdrawOutcome.actionId,
      status: withdrawOutcome.status, txHashes: withdrawOutcome.txHashes, note: alert.message,
    });
    result.alert = alert;
    return result;
  }

  // --- leg 2: deposit ---------------------------------------------------------------------------
  const depositKey = `${d.idempotencyKey}:deposit:${randomUUID().slice(0, 8)}`;
  let depositOutcome: StepOutcome;
  try {
    const action = await opts.client.deposit(opts.walletId, d.to, amountNormalized, depositKey);
    const final = action.status === 'pending' ? await opts.client.waitForAction(opts.walletId, action.id) : action;
    depositOutcome = {
      step: 'deposit', vaultId: d.to, vaultLabel: labelOfVaultId(d.to), amountNormalized,
      actionId: final.id ?? action.id, status: final.status, txHashes: extractTxHashes(final),
    };
  } catch (e) {
    depositOutcome = {
      step: 'deposit', vaultId: d.to, vaultLabel: labelOfVaultId(d.to), amountNormalized,
      actionId: null, status: isDenial(e) ? 'denied' : 'error', txHashes: [], error: describeError(e),
    };
  }
  record({
    kind: 'deposit', dryRun: false, idempotencyKey: d.idempotencyKey, vaultId: d.to,
    vaultLabel: labelOfVaultId(d.to), amountUsd, amountNormalized, actionId: depositOutcome.actionId,
    status: depositOutcome.status, txHashes: depositOutcome.txHashes,
    note: `deposit ${amountNormalized} ${position.asset.symbol} into ${labelOfVaultId(d.to)}`,
    ...(depositOutcome.error ? {error: depositOutcome.error} : {}),
  });
  result.deposit = depositOutcome;

  if (depositOutcome.status !== 'succeeded') {
    // The documented intermediate failure: the withdrawal went through, the deposit did not.
    const alert: ExecutionAlert = {
      code: 'idle_usdc',
      message:
        `withdraw from ${labelOfVaultId(d.from)} succeeded but the deposit into ${labelOfVaultId(d.to)} ended as ` +
        `${depositOutcome.status}${depositOutcome.error ? ` (${depositOutcome.error})` : ''}. ` +
        `${amountNormalized} ${position.asset.symbol} is now IDLE in the business wallet. ` +
        'The agent does not retry automatically: the treasurer decides whether to re-deposit or leave it idle.',
      amountNormalized,
      vaultId: d.to,
    };
    record({
      kind: 'alert', dryRun: false, idempotencyKey: d.idempotencyKey, vaultId: d.to,
      vaultLabel: labelOfVaultId(d.to), amountUsd, amountNormalized, actionId: depositOutcome.actionId,
      status: depositOutcome.status, txHashes: depositOutcome.txHashes, note: alert.message,
    });
    result.alert = alert;
    return result;
  }

  record({
    kind: 'rotation', dryRun: false, idempotencyKey: d.idempotencyKey, vaultId: d.to,
    vaultLabel: labelOfVaultId(d.to), amountUsd, amountNormalized,
    actionId: depositOutcome.actionId, status: 'succeeded',
    txHashes: [...withdrawOutcome.txHashes, ...depositOutcome.txHashes],
    note: `rotated ${amountNormalized} ${position.asset.symbol} from ${labelOfVaultId(d.from)} to ${labelOfVaultId(d.to)}`,
    decision: decisionRecord(d),
  });
  result.executed = true;
  return result;
}

function decisionRecord(d: Decision): NonNullable<LedgerEntry['decision']> {
  return {
    action: d.action,
    from: d.from,
    to: d.to,
    reason: d.reason,
    idempotencyKey: d.idempotencyKey,
    lastObservationBlock: d.lastObservationBlock,
    differentialBps: d.evidence.differentialBps,
    refusals: d.refusals.map((r) => ({code: r.code, message: r.message})),
    evidence: d.evidence,
  };
}
