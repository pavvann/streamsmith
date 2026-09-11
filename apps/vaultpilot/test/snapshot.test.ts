/**
 * One full cycle, offline: fixture rows in, snapshot and text summary out. `offline: true` means
 * no Privy call and no network of any kind, so this test also proves the UI/loop path works before
 * the wallet is funded and on a machine with no credentials.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FixtureSource} from '../src/data.js';
import {APP_DIR} from '../src/env.js';
import {renderSummary} from '../src/loop.js';
import {buildSnapshot} from '../src/snapshot.js';
import {WRAPPER_FEE_PERCENT, selfAddresses, BUSINESS_WALLET_ADDRESS, APPROVED_VAULTS} from '../src/vaults.js';

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'vaultpilot-snap-')), 'ledger.json');
}

function fixtureSource(name: string): FixtureSource {
  return FixtureSource.fromFile(resolve(APP_DIR, 'fixtures', `${name}.json`));
}

async function snapshotOf(name: string) {
  return buildSnapshot({source: fixtureSource(name), ledgerPath: ledgerPath(), offline: true, dryRun: true, now: 1788973600});
}

describe('buildSnapshot, offline', () => {
  it('decides to rotate on the rotate fixture and shows every fact behind it', async () => {
    const s = await snapshotOf('rotate');
    expect(s.decision.action).toBe('rotate');
    expect(s.mode.privy).toBe('fixture');
    expect(s.mode.dryRun).toBe(true);
    expect(s.vaults).toHaveLength(2);
    expect(s.vaults[0]!.growth?.observedHours).toBe(26);
    expect(s.vaults[0]!.wrapperFeePercent).toBe(WRAPPER_FEE_PERCENT);
    expect(s.pipeline.tool).toBe('pipeline_status');
    expect(s.policy.allowedVaultIds).toHaveLength(2);
    expect(s.policy.defaultDeny).toBe(true);
  });

  it('holds on each of the committed hold fixtures, for the reason the fixture is named after', async () => {
    const stale = await snapshotOf('hold-stale');
    expect(stale.decision.action).toBe('hold');
    expect(stale.decision.refusals.map((r) => r.code)).toContain('stale_pipeline');

    const short = await snapshotOf('hold-short-window');
    expect(short.decision.action).toBe('hold');
    expect(short.decision.refusals.map((r) => r.code)).toContain('observed_window_too_short');

    const guardrail = await snapshotOf('hold-guardrail');
    expect(guardrail.decision.action).toBe('hold');
    expect(guardrail.decision.refusals.map((r) => r.code)).toContain('destination_outflow_guardrail');
  });

  it('carries the pipeline provenance the MCP publishes, not a second source of truth', async () => {
    const s = await snapshotOf('rotate');
    expect(s.provenance.packageName).toBe('erc4626-flows');
    expect(s.provenance.packageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.provenance.outputModuleHash).toBeTruthy();
    expect(s.provenance.chainId).toBe(8453);
  });

  it('states who controls the wallet and how to revoke the agent', async () => {
    const s = await snapshotOf('rotate');
    expect(s.wallet.address).toBe(BUSINESS_WALLET_ADDRESS);
    expect(s.wallet.control).toContain('additional signer');
    expect(s.wallet.revocationCommand).toContain('detachAgentSigner');
  });

  it('discloses that the daily cap is enforced by this app and that the wrappers take a fee', async () => {
    const s = await snapshotOf('rotate');
    expect(s.policy.dailyCapDisclosure).toContain('enforced by this app');
    expect(s.policy.wrapperFeeDisclosure).toContain(`${WRAPPER_FEE_PERCENT}%`);
  });
});

describe('renderSummary', () => {
  it('puts the decision, the rule, the window, the guardrail and the revocation on one screen', async () => {
    const text = renderSummary(await snapshotOf('rotate'));
    expect(text).toContain('DECISION: ROTATE');
    expect(text).toContain('OBSERVED WINDOW AND SHARE-VALUE GROWTH');
    expect(text).toContain('GUARDRAIL');
    expect(text).toContain('DRY RUN (nothing is sent)');
    expect(text).toContain('revoke:');
    expect(text).toContain('fee 10% on generated returns');
  });

  it('lists every refusal when it holds', async () => {
    const text = renderSummary(await snapshotOf('hold-stale'));
    expect(text).toContain('DECISION: HOLD');
    expect(text).toContain('refusal [');
  });
});

describe('self-flow exclusion set', () => {
  it('is the business wallet plus both fee wrappers', () => {
    const set = selfAddresses();
    expect(set).toContain(BUSINESS_WALLET_ADDRESS);
    for (const v of APPROVED_VAULTS) expect(set).toContain(v.wrapperAddress);
    expect(set).toHaveLength(3);
  });

  it('lowercases and deduplicates anything a caller adds', () => {
    const set = selfAddresses(['0xAABBCCDDEEFF00112233445566778899AABBCCDD', BUSINESS_WALLET_ADDRESS.toUpperCase()]);
    expect(set).toContain('0xaabbccddeeff00112233445566778899aabbccdd');
    expect(set).toHaveLength(4);
  });
});
