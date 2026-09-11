/**
 * Executor tests. The Privy Earn client is always a mock: no test in this file can reach the
 * network, and the mock records every call so "nothing was sent" is an assertion, not a hope.
 *
 * The case that matters most is the documented intermediate failure — withdraw succeeds, deposit
 * fails — where the money must be left idle, the treasurer alerted, and nothing retried.
 */
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {decide, type Decision} from '../src/decision.js';
import {
  basescanTxUrl,
  executeRotation,
  extractTxHashes,
  type EarnActionLike,
  type EarnClient,
  type EarnPositionLike,
} from '../src/executor.js';
import {appendLedger, dailySpentUsd, executedKeys, readLedger} from '../src/ledger.js';
import {GAUNTLET_ID, STEAKHOUSE_ID, rotateInput} from './helpers.js';

const WALLET = 'q4zcqb7leopoj7hocdtqhbfe';
const WITHDRAW_TX = '0x' + 'a'.repeat(64);
const DEPOSIT_TX = '0x' + 'b'.repeat(64);

interface MockOptions {
  assets?: string;
  withdrawStatus?: string;
  depositStatus?: string;
  withdrawThrows?: unknown;
  depositThrows?: unknown;
  positionThrows?: unknown;
}

interface MockClient extends EarnClient {
  calls: string[];
}

function mockClient(opts: MockOptions = {}): MockClient {
  const calls: string[] = [];
  const client: MockClient = {
    calls,
    async position(_walletId: string, vaultId: string): Promise<EarnPositionLike> {
      calls.push(`position:${vaultId}`);
      if (opts.positionThrows) throw opts.positionThrows;
      return {assets_in_vault: opts.assets ?? '50000000', shares_in_vault: '48000000000000000000', asset: {decimals: 6, symbol: 'USDC'}};
    },
    async withdraw(_walletId: string, vaultId: string, amount: string): Promise<EarnActionLike> {
      calls.push(`withdraw:${vaultId}:${amount}`);
      if (opts.withdrawThrows) throw opts.withdrawThrows;
      return {id: 'action-withdraw', status: 'pending'};
    },
    async deposit(_walletId: string, vaultId: string, amount: string): Promise<EarnActionLike> {
      calls.push(`deposit:${vaultId}:${amount}`);
      if (opts.depositThrows) throw opts.depositThrows;
      return {id: 'action-deposit', status: 'pending'};
    },
    async waitForAction(_walletId: string, actionId: string): Promise<EarnActionLike> {
      calls.push(`wait:${actionId}`);
      if (actionId === 'action-withdraw') {
        return {
          id: actionId,
          status: opts.withdrawStatus ?? 'succeeded',
          steps: [{transaction_hash: WITHDRAW_TX, block_hash: '0x' + 'c'.repeat(64)}],
        };
      }
      return {
        id: actionId,
        status: opts.depositStatus ?? 'succeeded',
        steps: [{transaction_hash: DEPOSIT_TX}],
      };
    },
  };
  return client;
}

let ledgerPath: string;
beforeEach(() => {
  ledgerPath = join(mkdtempSync(join(tmpdir(), 'vaultpilot-ledger-')), 'ledger.json');
});

function rotation(): Decision {
  const d = decide(rotateInput());
  expect(d.action).toBe('rotate');
  return d;
}

function run(client: EarnClient, over: Partial<Parameters<typeof executeRotation>[0]> = {}) {
  return executeRotation({
    decision: rotation(),
    walletId: WALLET,
    client,
    dryRun: false,
    perActionCapUsd: 60,
    dailyCapUsd: 120,
    ledgerPath,
    ...over,
  });
}

describe('executeRotation: dry run', () => {
  it('sends nothing and claims no idempotency key', async () => {
    const client = mockClient();
    const result = await run(client, {dryRun: true});
    expect(result.executed).toBe(false);
    expect(result.skipped).toBe('dry_run');
    expect(client.calls).toEqual([`position:${GAUNTLET_ID}`]);
    expect(executedKeys(readLedger(ledgerPath))).toEqual([]);
    expect(result.skippedMessage).toContain('Re-run with --execute');
  });

  it('is the default: only an explicit dryRun:false sends anything', async () => {
    const client = mockClient();
    await run(client, {dryRun: true});
    expect(client.calls.some((c) => c.startsWith('withdraw'))).toBe(false);
    expect(client.calls.some((c) => c.startsWith('deposit'))).toBe(false);
  });
});

describe('executeRotation: the happy path', () => {
  it('withdraws all, polls, deposits, polls, and records the rotation', async () => {
    const client = mockClient();
    const result = await run(client);
    expect(client.calls).toEqual([
      `position:${GAUNTLET_ID}`,
      `withdraw:${GAUNTLET_ID}:50`,
      'wait:action-withdraw',
      `deposit:${STEAKHOUSE_ID}:50`,
      'wait:action-deposit',
    ]);
    expect(result.executed).toBe(true);
    expect(result.alert).toBeNull();
    expect(result.withdraw?.txHashes).toEqual([WITHDRAW_TX]);
    expect(result.deposit?.txHashes).toEqual([DEPOSIT_TX]);
    const kinds = readLedger(ledgerPath).entries.map((e) => e.kind);
    expect(kinds).toEqual(['withdraw', 'deposit', 'rotation']);
  });

  it('sends the amount as a decimal string, never as base units', async () => {
    const client = mockClient({assets: '25500000'});
    await run(client);
    expect(client.calls).toContain(`withdraw:${GAUNTLET_ID}:25.5`);
    expect(client.calls).toContain(`deposit:${STEAKHOUSE_ID}:25.5`);
  });

  it('claims the idempotency key so the same observation block cannot rotate twice', async () => {
    const client = mockClient();
    const first = await run(client);
    expect(first.executed).toBe(true);
    const second = await run(mockClient());
    expect(second.executed).toBe(false);
    expect(second.skipped).toBe('already_executed');
  });
});

describe('executeRotation: partial failure', () => {
  it('leaves the USDC idle and alerts the treasurer when the deposit fails after a good withdraw', async () => {
    const client = mockClient({depositStatus: 'failed'});
    const result = await run(client);
    expect(result.executed).toBe(false);
    expect(result.withdraw?.status).toBe('succeeded');
    expect(result.deposit?.status).toBe('failed');
    expect(result.alert?.code).toBe('idle_usdc');
    expect(result.alert?.message).toContain('IDLE');
    expect(result.alert?.message).toContain('does not retry automatically');
    // Exactly one deposit attempt: nothing is retried.
    expect(client.calls.filter((c) => c.startsWith('deposit')).length).toBe(1);
    const ledger = readLedger(ledgerPath);
    expect(ledger.entries.map((e) => e.kind)).toEqual(['withdraw', 'deposit', 'alert']);
    expect(ledger.entries.some((e) => e.kind === 'rotation')).toBe(false);
  });

  it('alerts the same way when the deposit call itself throws', async () => {
    const client = mockClient({depositThrows: Object.assign(new Error('bad gateway'), {status: 502})});
    const result = await run(client);
    expect(result.alert?.code).toBe('idle_usdc');
    expect(result.deposit?.status).toBe('error');
    expect(result.deposit?.error).toContain('502');
  });

  it('never attempts the deposit when the withdrawal was denied', async () => {
    const client = mockClient({withdrawThrows: Object.assign(new Error('policy denial'), {status: 403})});
    const result = await run(client);
    expect(result.withdraw?.status).toBe('denied');
    expect(result.alert?.code).toBe('withdraw_denied');
    expect(result.alert?.message).toContain('returned to the treasurer');
    expect(client.calls.some((c) => c.startsWith('deposit'))).toBe(false);
  });

  it('never attempts the deposit when the withdrawal ends in a non-terminal-success status', async () => {
    const client = mockClient({withdrawStatus: 'rejected'});
    const result = await run(client);
    expect(result.alert?.code).toBe('withdraw_denied');
    expect(client.calls.some((c) => c.startsWith('deposit'))).toBe(false);
  });

  it('sends nothing when the position cannot be read', async () => {
    const client = mockClient({positionThrows: new Error('privy down')});
    const result = await run(client);
    expect(result.skipped).toBe('position_unreadable');
    expect(client.calls).toEqual([`position:${GAUNTLET_ID}`]);
    expect(readLedger(ledgerPath).entries[0]?.kind).toBe('alert');
  });

  it('sends nothing when the source vault turns out to be empty', async () => {
    const client = mockClient({assets: '0'});
    const result = await run(client);
    expect(result.skipped).toBe('source_empty');
    expect(client.calls.some((c) => c.startsWith('withdraw'))).toBe(false);
  });
});

describe('executeRotation: caps', () => {
  it('refuses an amount above the per-action cap the policy enforces, without asking Privy', async () => {
    const client = mockClient({assets: '75000000'});
    const result = await run(client, {perActionCapUsd: 60});
    expect(result.skipped).toBe('per_action_cap');
    expect(client.calls.some((c) => c.startsWith('withdraw'))).toBe(false);
    expect(readLedger(ledgerPath).entries[0]?.kind).toBe('denial');
  });

  it('refuses to start a rotation whose two legs do not both fit inside the daily cap', async () => {
    const client = mockClient({assets: '50000000'});
    // 50 out + 50 in = 100 needed, only 60 of the cap is left.
    appendLedger(
      {
        kind: 'deposit', dryRun: false, idempotencyKey: null, vaultId: STEAKHOUSE_ID, vaultLabel: null,
        amountUsd: 60, amountNormalized: '60', actionId: 'earlier', status: 'succeeded', txHashes: [], note: 'earlier deposit',
      },
      ledgerPath,
    );
    const result = await run(client, {dailyCapUsd: 120});
    expect(result.skipped).toBe('daily_cap');
    expect(result.dailyCap.requiredUsd).toBe(100);
    expect(result.dailyCap.remainingUsdBefore).toBe(60);
    expect(client.calls.some((c) => c.startsWith('withdraw'))).toBe(false);
  });

  it('counts both legs of a completed rotation against the daily cap', async () => {
    await run(mockClient());
    expect(dailySpentUsd(readLedger(ledgerPath))).toBe(100);
  });

  it('lets the rotation through when the cap has room for both legs', async () => {
    const result = await run(mockClient(), {dailyCapUsd: 100});
    expect(result.executed).toBe(true);
  });
});

describe('executeRotation: the ledger', () => {
  it('writes the decision evidence with the rotation, so the action can be audited later', async () => {
    await run(mockClient());
    const rotationEntry = readLedger(ledgerPath).entries.find((e) => e.kind === 'rotation')!;
    expect(rotationEntry.decision?.idempotencyKey).toBe(`${GAUNTLET_ID}:${STEAKHOUSE_ID}:51093000`);
    expect(rotationEntry.decision?.evidence.observedWindow.vaults).toHaveLength(2);
    expect(rotationEntry.txHashes).toEqual([WITHDRAW_TX, DEPOSIT_TX]);
  });

  it('creates the ledger file on first write and keeps it valid JSON', async () => {
    expect(existsSync(ledgerPath)).toBe(false);
    await run(mockClient());
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).version).toBe(1);
  });

  it('refuses to act on a decision that is not a rotation', async () => {
    const hold = decide(rotateInput({positions: []}));
    const client = mockClient();
    const result = await executeRotation({
      decision: hold, walletId: WALLET, client, dryRun: false, perActionCapUsd: 60, dailyCapUsd: 120, ledgerPath,
    });
    expect(result.skipped).toBe('not_a_rotation');
    expect(client.calls).toEqual([]);
  });
});

describe('transaction hashes', () => {
  it('collects 32-byte hashes from nested action responses but never block hashes', () => {
    const hashes = extractTxHashes({
      id: 'a', status: 'succeeded',
      steps: [{transaction_hash: WITHDRAW_TX, block_hash: '0x' + 'c'.repeat(64)}, {hash: DEPOSIT_TX}],
    });
    expect(hashes).toEqual([WITHDRAW_TX, DEPOSIT_TX]);
  });

  it('links to Basescan', () => {
    expect(basescanTxUrl(WITHDRAW_TX)).toBe(`https://basescan.org/tx/${WITHDRAW_TX}`);
  });
});
