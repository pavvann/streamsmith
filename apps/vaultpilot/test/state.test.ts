/**
 * The ledger footer — and the JSON `/api/state` serves — must never carry this machine's
 * absolute filesystem layout. `toDisplayPath` and `withDisplaySafePaths` (in `web/lib/state.ts`)
 * are the one gate every path crosses before it can reach a client: this locks that gate down
 * so an absolute-path prefix (`/Users/...`, `/home/...`, a Windows drive letter) can never come
 * back, in `originDetail` or anywhere else in the payload the screen and `/api/state` share.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FixtureSource} from '../src/data.js';
import {APP_DIR, REPO_ROOT} from '../src/env.js';
import {buildSnapshot} from '../src/snapshot.js';
import {toDisplayPath, withDisplaySafePaths, type Snapshot} from '../web/lib/state.js';

const ABSOLUTE_PREFIX = /\/Users\/|\/home\/|^[A-Za-z]:[\\/]/;

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'vaultpilot-state-test-')), 'ledger.json');
}

describe('toDisplayPath', () => {
  it('turns the absolute snapshot-file path into a repo-relative one', () => {
    const abs = resolve(APP_DIR, '.vaultpilot-snapshot.json');
    expect(toDisplayPath(abs)).toBe('apps/vaultpilot/.vaultpilot-snapshot.json');
  });

  it('turns the absolute ledger-file path into a repo-relative one', () => {
    const abs = resolve(APP_DIR, '.vaultpilot-ledger.json');
    expect(toDisplayPath(abs)).toBe('apps/vaultpilot/.vaultpilot-ledger.json');
  });

  it('falls back to the bare file name for a path outside the repo', () => {
    expect(toDisplayPath(join(REPO_ROOT, '..', 'elsewhere', 'ledger.json'))).toBe('ledger.json');
    expect(toDisplayPath('/tmp/some-other-place/ledger.json')).toBe('ledger.json');
  });

  it('passes through a falsy path instead of inventing one', () => {
    expect(toDisplayPath('')).toBe('');
  });

  it('never returns an absolute path, for any input', () => {
    for (const abs of [
      resolve(APP_DIR, '.vaultpilot-snapshot.json'),
      resolve(APP_DIR, '.vaultpilot-ledger.json'),
      '/var/somewhere/deep/file.json',
    ]) {
      const displayed = toDisplayPath(abs);
      expect(isAbsolute(displayed)).toBe(false);
      expect(displayed).not.toMatch(ABSOLUTE_PREFIX);
      expect(displayed).not.toContain(REPO_ROOT);
    }
  });
});

describe('withDisplaySafePaths', () => {
  it('strips the absolute ledger and provenance paths a real Snapshot carries', async () => {
    const snapshot = await buildSnapshot({
      source: FixtureSource.fromFile(resolve(APP_DIR, 'fixtures', 'rotate.json')),
      ledgerPath: ledgerPath(),
      offline: true,
      dryRun: true,
      now: 1788973600,
    });

    // Sanity check: prove this test is not vacuous — the raw snapshot really does carry
    // absolute paths on this machine, the exact shape that used to reach the dashboard.
    expect(snapshot.mode.source.kind).toBe('fixture');
    expect(isAbsolute(snapshot.mode.source.origin)).toBe(true);
    expect(isAbsolute(snapshot.ledger.path)).toBe(true);
    expect(isAbsolute(snapshot.provenance.manifestPath)).toBe(true);
    expect(isAbsolute(snapshot.provenance.receiptPath)).toBe(true);

    const safe = withDisplaySafePaths(snapshot);
    expect(isAbsolute(safe.mode.source.origin)).toBe(false);
    expect(isAbsolute(safe.ledger.path)).toBe(false);
    expect(isAbsolute(safe.provenance.manifestPath)).toBe(false);
    expect(isAbsolute(safe.provenance.receiptPath)).toBe(false);
    expect(safe.mode.source.origin).toBe('apps/vaultpilot/fixtures/rotate.json');
    expect(safe.provenance.manifestPath).toBe('packages/mcp-vaultflows/manifest.json');
    expect(safe.provenance.receiptPath).toBe('packages/mcp-vaultflows/receipt.json');

    // The property under test: nowhere in the payload `/api/state` serves (or the page embeds
    // for hydration) can an absolute-path prefix survive.
    expect(JSON.stringify(safe)).not.toMatch(ABSOLUTE_PREFIX);
  });

  it('leaves the live source origin (a host, not a path) untouched', () => {
    const fake = {
      mode: {source: {kind: 'clickhouse', origin: 'https://clickhouse.example.com:8443'}},
      ledger: {path: resolve(APP_DIR, '.vaultpilot-ledger.json')},
      provenance: {
        manifestPath: resolve(REPO_ROOT, 'packages/mcp-vaultflows/manifest.json'),
        receiptPath: resolve(REPO_ROOT, 'packages/mcp-vaultflows/receipt.json'),
      },
    } as unknown as Snapshot;

    const safe = withDisplaySafePaths(fake);
    expect(safe.mode.source.origin).toBe('https://clickhouse.example.com:8443');
    expect(safe.ledger.path).toBe('apps/vaultpilot/.vaultpilot-ledger.json');
  });
});
