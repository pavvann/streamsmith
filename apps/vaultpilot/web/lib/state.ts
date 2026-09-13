/**
 * The one place the UI gets its facts.
 *
 * Order of preference:
 *   1. the read-only state service (`pnpm agent:serve`, default http://127.0.0.1:8787/state),
 *      which recomputes the decision from the sink and the wallet on every request;
 *   2. `.vaultpilot-snapshot.json`, the file every agent cycle writes, so the screen still shows
 *      the last real cycle when the service is not running.
 *
 * The UI never signs anything and never reaches Privy itself: it renders what the agent decided.
 * `Snapshot` is imported as a TYPE ONLY, so the Next bundle contains no agent code at all.
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {basename, isAbsolute, relative, resolve, sep} from 'node:path';
import type {Snapshot} from '../../src/snapshot.js';

export type {Snapshot};

export interface LoadedState {
  snapshot: Snapshot | null;
  /** where this screen's numbers came from, shown on the page */
  origin: 'state service' | 'snapshot file' | 'unavailable';
  originDetail: string;
  /** when the snapshot itself was produced, and when this page read it */
  readAt: string;
  error: string | null;
}

const PACKAGE_DIR = resolve(process.cwd(), process.cwd().endsWith('/web') ? '..' : '.');
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');
const SNAPSHOT_FILE = resolve(PACKAGE_DIR, '.vaultpilot-snapshot.json');
const SERVICE_URL = process.env.VAULTPILOT_AGENT_URL ?? 'http://127.0.0.1:8787/state';

/**
 * The screen (and the JSON `/api/state` serves) must never carry this machine's absolute
 * filesystem layout. Every path that reaches a client goes through here first: a path inside
 * the repo becomes repo-relative (`apps/vaultpilot/.vaultpilot-snapshot.json`); anything else
 * — already-relative, or somehow outside the repo — collapses to its bare file name.
 */
export function toDisplayPath(absPath: string): string {
  if (absPath.length === 0) return absPath;
  const rel = relative(REPO_ROOT, absPath);
  if (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.split(sep).join('/');
  }
  return basename(absPath);
}

/**
 * Strips every absolute path a `Snapshot` can carry — `ledger.path`, the MCP manifest/receipt
 * paths in `provenance`, and (when the data source is the offline fixture) the fixture file path
 * in `mode.source.origin` — before it leaves this module, so neither the SSR'd page nor the JSON
 * `/api/state` serves ever exposes this machine's directory layout. The live ClickHouse source's
 * `origin` is a host, not a path, and is left untouched.
 */
export function withDisplaySafePaths(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    mode: {
      ...snapshot.mode,
      source:
        snapshot.mode.source.kind === 'fixture'
          ? {...snapshot.mode.source, origin: toDisplayPath(snapshot.mode.source.origin)}
          : snapshot.mode.source,
    },
    ledger: {...snapshot.ledger, path: toDisplayPath(snapshot.ledger.path)},
    provenance: {
      ...snapshot.provenance,
      manifestPath: toDisplayPath(snapshot.provenance.manifestPath),
      receiptPath: toDisplayPath(snapshot.provenance.receiptPath),
    },
  };
}

export async function loadState(): Promise<LoadedState> {
  const readAt = new Date().toISOString();
  try {
    const res = await fetch(SERVICE_URL, {cache: 'no-store', signal: AbortSignal.timeout(4000)});
    if (res.ok) {
      return {
        snapshot: withDisplaySafePaths((await res.json()) as Snapshot),
        origin: 'state service',
        originDetail: SERVICE_URL,
        readAt,
        error: null,
      };
    }
  } catch {
    // the service is optional; fall through to the file the agent writes every cycle
  }
  if (existsSync(SNAPSHOT_FILE)) {
    try {
      return {
        snapshot: withDisplaySafePaths(JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as Snapshot),
        origin: 'snapshot file',
        originDetail: `${toDisplayPath(SNAPSHOT_FILE)} (written ${statSync(SNAPSHOT_FILE).mtime.toISOString()})`,
        readAt,
        error: null,
      };
    } catch (e) {
      return {
        snapshot: null,
        origin: 'unavailable',
        originDetail: toDisplayPath(SNAPSHOT_FILE),
        readAt,
        error: (e as Error).message,
      };
    }
  }
  return {
    snapshot: null,
    origin: 'unavailable',
    originDetail: toDisplayPath(SNAPSHOT_FILE),
    readAt,
    error:
      'No state yet. Run `pnpm agent:once` (one cycle, dry run) or `pnpm agent:serve` (live read-only service) in apps/vaultpilot.',
  };
}
