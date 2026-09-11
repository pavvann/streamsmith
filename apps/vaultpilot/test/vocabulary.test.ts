/**
 * The repo's vocabulary rule, enforced instead of remembered (docs/PROJECT.md section 13):
 * "yield", "APY", "share price", "TVL" and "risk" appear nowhere in this app — not in code, not in
 * comments, not in UI copy, not in the fixtures. We say "share-value growth", "observed window",
 * "execution rate" and "share value".
 *
 * Type names that come from the Privy SDK's own surface are impossible to rename, so a single
 * explicit allowance is listed below and nothing else is permitted.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {extname, join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';
import {APP_DIR} from '../src/env.js';

const BANNED = [/\byields?\b/i, /\bAPYs?\b/i, /\bshare price\b/i, /\bTVL\b/i, /\brisks?\b/i, /\bAPRs?\b/i];

/** Third-party identifiers we quote but do not control. Keep this list empty if you can. */
const ALLOWED_LINES = [
  // Privy's SDK renames this response type across entrypoints; the note records the fact.
  /EthereumYieldPositionResponse/,
];

const DIRS = ['src', 'test', 'fixtures', 'web'];
/** This file is the one place the banned words are written down, so it excludes itself. */
const SELF = 'test/vocabulary.test.ts';
const EXTENSIONS = new Set(['.ts', '.tsx', '.json', '.css', '.md']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(name))) out.push(full);
  }
  return out;
}

describe('vocabulary', () => {
  it('never uses yield, APY, share price, TVL or risk anywhere in the app', () => {
    const offences: string[] = [];
    for (const dir of DIRS) {
      for (const file of walk(join(APP_DIR, dir))) {
        if (relative(APP_DIR, file) === SELF) continue;
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          if (ALLOWED_LINES.some((a) => a.test(line))) return;
          for (const pattern of BANNED) {
            if (pattern.test(line)) offences.push(`${relative(APP_DIR, file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offences).toEqual([]);
  });

  it('uses the words the contract does use', () => {
    const decision = readFileSync(join(APP_DIR, 'src', 'decision.ts'), 'utf8');
    expect(decision).toContain('share-value growth');
    expect(decision).toContain('observed window');
  });
});
