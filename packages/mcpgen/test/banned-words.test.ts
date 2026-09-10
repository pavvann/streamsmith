// docs/PROJECT.md 4.2 metric-naming rules: none of the five banned terms may appear in code, SQL or docs we own.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_DIR, PKG_ROOT, VIEWS_SQL } from "./helpers.ts";

// bracketed letter so the definitions do not match themselves (contract-notes.md section 8)
const BANNED: Array<[string, RegExp]> = [
  ["y-i-e-l-d", /y[i]eld/i],
  ["A-P-Y", /\b[A]PY\b/],
  ["share p-r-i-c-e", /share[ _-][p]rice/i],
  ["T-V-L", /\b[T]VL\b/],
  ["r-i-s-k", /\b[r]isk/i],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

describe("banned words", () => {
  it("do not appear in mcpgen, the generated package or views.sql", () => {
    const files = [...walk(PKG_ROOT), ...walk(GENERATED_DIR), VIEWS_SQL];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const [label, re] of BANNED) {
        const m = re.exec(text);
        if (m) hits.push(`${relative(PKG_ROOT, f)}: ${label} at ${m.index}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
