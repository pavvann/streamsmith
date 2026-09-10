/**
 * Append-only JSON ledger at apps/vaultpilot/.vaultpilot-ledger.json (gitignored).
 *
 * It is the app's own record of everything the agent did: every decision, every Earn action with
 * its Privy action id and transaction hashes, every denial, every alert. Three of the rule's
 * requirements are enforced from it, because Privy cannot enforce them for Earn:
 *   - the rolling DAILY CAP (Privy aggregations only cover eth_signTransaction /
 *     eth_signUserOperation, never earn_deposit / earn_withdraw — docs/build/privy-facts.md (d)),
 *   - the COOLDOWN between rotations,
 *   - IDEMPOTENCY: one rotation per `${from}:${to}:${lastObservationBlock}`.
 *
 * Daily cap accounting, disclosed as such in the UI: it sums the `amount` of every Earn action
 * that was signed in the trailing 24 h — deposits and withdrawals alike. `rejected` actions are
 * excluded because Privy documents them as "failed before any transaction was signed or
 * broadcast"; `failed` actions ARE counted, because a transaction was broadcast.
 */
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {CooldownState, Decision} from './decision.js';
import {APP_DIR} from './env.js';

export const LEDGER_PATH = resolve(APP_DIR, '.vaultpilot-ledger.json');

export type LedgerEntryKind = 'decision' | 'withdraw' | 'deposit' | 'rotation' | 'denial' | 'alert';

export interface LedgerEntry {
  id: string;
  at: string;
  kind: LedgerEntryKind;
  /** false only when the action really was sent to Privy. */
  dryRun: boolean;
  idempotencyKey: string | null;
  vaultId: string | null;
  vaultLabel: string | null;
  /** USD == USDC for these vaults; null for entries that move nothing. */
  amountUsd: number | null;
  amountNormalized: string | null;
  /** Privy wallet action id. */
  actionId: string | null;
  /** pending | succeeded | rejected | failed | denied | skipped | recorded */
  status: string | null;
  txHashes: string[];
  note: string | null;
  error?: string | null;
  /** attached to `rotation` and `decision` entries: the evidence the action was based on. */
  decision?: {
    action: Decision['action'];
    from: string | null;
    to: string | null;
    reason: string;
    idempotencyKey: string | null;
    lastObservationBlock: number | null;
    differentialBps: number | null;
    refusals: {code: string; message: string}[];
    evidence: Decision['evidence'];
  };
}

export interface Ledger {
  version: 1;
  entries: LedgerEntry[];
}

const EMPTY_LEDGER: Ledger = {version: 1, entries: []};

export function readLedger(path: string = LEDGER_PATH): Ledger {
  if (!existsSync(path)) return {...EMPTY_LEDGER, entries: []};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>;
    return {version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : []};
  } catch (e) {
    throw new Error(`ledger at ${path} is not readable JSON (${(e as Error).message}); fix or move it before running the agent`);
  }
}

function writeLedger(ledger: Ledger, path: string): void {
  mkdirSync(dirname(path), {recursive: true});
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(tmp, path);
}

export type NewLedgerEntry = Omit<LedgerEntry, 'id' | 'at'> & {id?: string; at?: string};

export function appendLedger(entry: NewLedgerEntry, path: string = LEDGER_PATH): LedgerEntry {
  const full: LedgerEntry = {id: entry.id ?? randomUUID(), at: entry.at ?? new Date().toISOString(), ...entry} as LedgerEntry;
  const ledger = readLedger(path);
  ledger.entries.push(full);
  writeLedger(ledger, path);
  return full;
}

/** Statuses that mean a transaction may have been signed or broadcast: they count against the cap. */
const SPENDING_STATUSES = new Set(['pending', 'succeeded', 'failed', 'unknown', null as unknown as string]);

export function countsAgainstDailyCap(e: LedgerEntry): boolean {
  if (e.dryRun) return false;
  if (e.kind !== 'deposit' && e.kind !== 'withdraw') return false;
  if (e.amountUsd === null) return false;
  if (e.status === 'rejected' || e.status === 'denied' || e.status === 'skipped') return false;
  return SPENDING_STATUSES.has(e.status as string) || e.status === null;
}

/** Sum of Earn action amounts signed in the trailing 24 h. */
export function dailySpentUsd(ledger: Ledger, nowMs: number = Date.now()): number {
  const cutoff = nowMs - 24 * 3600 * 1000;
  return ledger.entries
    .filter((e) => countsAgainstDailyCap(e) && Date.parse(e.at) >= cutoff)
    .reduce((sum, e) => sum + (e.amountUsd ?? 0), 0);
}

export function dailyCapRemainingUsd(ledger: Ledger, capUsd: number, nowMs: number = Date.now()): number {
  return Math.max(0, capUsd - dailySpentUsd(ledger, nowMs));
}

/** Idempotency keys the executor has already acted on (a dry run never claims a key). */
export function executedKeys(ledger: Ledger): string[] {
  const keys = ledger.entries
    .filter((e) => !e.dryRun && e.idempotencyKey && (e.kind === 'rotation' || e.kind === 'withdraw' || e.kind === 'deposit'))
    .filter((e) => e.status !== 'rejected' && e.status !== 'denied' && e.status !== 'skipped')
    .map((e) => e.idempotencyKey!);
  return [...new Set(keys)];
}

export function lastRotation(ledger: Ledger): {at: string | null; block: number | null} {
  const rotations = ledger.entries
    .filter((e) => e.kind === 'rotation' && !e.dryRun && e.status !== 'skipped' && e.status !== 'denied')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = rotations[rotations.length - 1];
  if (!last) return {at: null, block: null};
  return {at: last.at, block: last.decision?.lastObservationBlock ?? null};
}

/** Cooldown + idempotency state for the decision service, read from the ledger. */
export function cooldownState(ledger: Ledger): CooldownState {
  const {at, block} = lastRotation(ledger);
  return {lastRotationAt: at, lastRotationBlock: block, executedKeys: executedKeys(ledger)};
}

/** Outstanding alerts (e.g. USDC left idle by a failed deposit) that the treasurer must clear. */
export function openAlerts(ledger: Ledger): LedgerEntry[] {
  return ledger.entries.filter((e) => e.kind === 'alert');
}

/** Most recent policy outcomes (allow/deny) for the UI panel. */
export function recentOutcomes(ledger: Ledger, limit = 8): LedgerEntry[] {
  return ledger.entries
    .filter((e) => e.kind === 'deposit' || e.kind === 'withdraw' || e.kind === 'denial' || e.kind === 'alert')
    .slice(-limit)
    .reverse();
}
