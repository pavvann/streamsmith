/**
 * Ledger tests. The ledger is the only enforcement point for the three limits Privy cannot apply
 * to Earn actions — the rolling daily cap, the cooldown and idempotency — so its accounting rules
 * are asserted directly.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {
  appendLedger,
  cooldownState,
  countsAgainstDailyCap,
  dailyCapRemainingUsd,
  dailySpentUsd,
  executedKeys,
  lastRotation,
  openAlerts,
  readLedger,
  recentOutcomes,
  type LedgerEntry,
  type NewLedgerEntry,
} from '../src/ledger.js';

const NOW_MS = Date.parse('2026-09-10T12:00:00.000Z');
let path: string;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'vaultpilot-ledger-')), 'ledger.json');
});

function entry(over: Partial<NewLedgerEntry> = {}): LedgerEntry {
  return appendLedger(
    {
      kind: 'deposit',
      dryRun: false,
      idempotencyKey: 'a:b:100',
      vaultId: 'vault-a',
      vaultLabel: 'Vault A',
      amountUsd: 25,
      amountNormalized: '25',
      actionId: 'action-1',
      status: 'succeeded',
      txHashes: [],
      note: null,
      at: new Date(NOW_MS - 3600_000).toISOString(),
      ...over,
    },
    path,
  );
}

describe('an empty or missing ledger', () => {
  it('reads as empty rather than throwing', () => {
    expect(readLedger(path).entries).toEqual([]);
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(0);
    expect(cooldownState(readLedger(path))).toEqual({lastRotationAt: null, lastRotationBlock: null, executedKeys: []});
  });
});

describe('daily cap accounting', () => {
  it('sums deposits and withdrawals signed in the trailing 24 h', () => {
    entry({kind: 'deposit', amountUsd: 25});
    entry({kind: 'withdraw', amountUsd: 25});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(50);
    expect(dailyCapRemainingUsd(readLedger(path), 120, NOW_MS)).toBe(70);
  });

  it('drops actions older than 24 h out of the window', () => {
    entry({amountUsd: 100, at: new Date(NOW_MS - 25 * 3600_000).toISOString()});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(0);
  });

  it('never counts a dry run', () => {
    entry({dryRun: true, amountUsd: 50});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(0);
  });

  it('excludes rejected actions (Privy: failed before anything was signed or broadcast)', () => {
    entry({status: 'rejected', amountUsd: 50});
    entry({status: 'denied', amountUsd: 50});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(0);
  });

  it('counts a failed action, because a transaction was broadcast', () => {
    entry({status: 'failed', amountUsd: 40});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(40);
  });

  it('counts a still-pending action, so a slow action cannot be double-spent against the cap', () => {
    entry({status: 'pending', amountUsd: 40});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(40);
  });

  it('ignores entries that move nothing', () => {
    entry({kind: 'decision', amountUsd: 999});
    entry({kind: 'alert', amountUsd: 999});
    entry({kind: 'denial', amountUsd: 999});
    expect(dailySpentUsd(readLedger(path), NOW_MS)).toBe(0);
  });

  it('never reports a negative remaining cap', () => {
    entry({amountUsd: 500});
    expect(dailyCapRemainingUsd(readLedger(path), 120, NOW_MS)).toBe(0);
  });

  it('classifies one entry at a time', () => {
    expect(countsAgainstDailyCap(entry({kind: 'withdraw', status: 'succeeded'}))).toBe(true);
    expect(countsAgainstDailyCap(entry({kind: 'rotation', status: 'succeeded'}))).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('reports keys the executor really acted on', () => {
    entry({kind: 'withdraw', idempotencyKey: 'a:b:100'});
    expect(executedKeys(readLedger(path))).toEqual(['a:b:100']);
  });

  it('does not claim a key from a dry run or a denial', () => {
    entry({kind: 'withdraw', idempotencyKey: 'dry:key:1', dryRun: true});
    entry({kind: 'withdraw', idempotencyKey: 'denied:key:1', status: 'denied'});
    expect(executedKeys(readLedger(path))).toEqual([]);
  });

  it('deduplicates the two legs of one rotation', () => {
    entry({kind: 'withdraw', idempotencyKey: 'a:b:100'});
    entry({kind: 'deposit', idempotencyKey: 'a:b:100'});
    entry({kind: 'rotation', idempotencyKey: 'a:b:100'});
    expect(executedKeys(readLedger(path))).toEqual(['a:b:100']);
  });
});

describe('cooldown state', () => {
  it('is the timestamp and observation block of the newest completed rotation', () => {
    entry({kind: 'rotation', at: new Date(NOW_MS - 8 * 3600_000).toISOString(), decision: rotationDecision(100)});
    entry({kind: 'rotation', at: new Date(NOW_MS - 2 * 3600_000).toISOString(), decision: rotationDecision(200)});
    const state = cooldownState(readLedger(path));
    expect(state.lastRotationBlock).toBe(200);
    expect(lastRotation(readLedger(path)).at).toBe(new Date(NOW_MS - 2 * 3600_000).toISOString());
  });

  it('ignores a dry-run rotation', () => {
    entry({kind: 'rotation', dryRun: true, decision: rotationDecision(300)});
    expect(cooldownState(readLedger(path)).lastRotationAt).toBeNull();
  });
});

describe('what the UI reads', () => {
  it('lists open alerts', () => {
    entry({kind: 'alert', note: 'USDC is idle'});
    expect(openAlerts(readLedger(path))).toHaveLength(1);
  });

  it('lists the newest allow/deny outcomes first', () => {
    entry({kind: 'deposit', note: 'first'});
    entry({kind: 'denial', note: 'second'});
    expect(recentOutcomes(readLedger(path)).map((e) => e.note)).toEqual(['second', 'first']);
  });
});

type DecisionRecord = NonNullable<LedgerEntry['decision']>;

function rotationDecision(block: number): DecisionRecord {
  return {
    action: 'rotate',
    from: 'vault-a',
    to: 'vault-b',
    reason: 'test',
    idempotencyKey: `vault-a:vault-b:${block}`,
    lastObservationBlock: block,
    differentialBps: 5,
    refusals: [],
    evidence: {} as DecisionRecord['evidence'],
  };
}
