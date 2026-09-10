// Normalized column-set hash: the MCP's runtime companion to receipt.sinkSchemaHash (which is a hash of the DDL
// the sink applied and cannot be recomputed from a read-only connection). Both the generator (from the proto)
// and the server (from system.columns) run this exact code, so the hashes are comparable.
import { createHash } from "node:crypto";
import type { ExpectedColumn } from "./types.ts";

/** Injected sink columns whose exact ClickHouse types are not pinned by the contract: compared by name only. */
export const WILDCARD_TYPE = "*";

/** Collapses whitespace and case differences in type spellings: `Decimal(38,18)` == `Decimal(38, 18)`. */
export function normalizeType(type: string): string {
  return type.replace(/\s+/g, "").toLowerCase();
}

/**
 * Canonical form: table names sorted, columns sorted by name, each `name:type` with the type normalized and
 * replaced by "*" for columns the expectation marks as wildcard. Returns the canonical string.
 */
export function canonicalColumnSet(
  tables: Record<string, ExpectedColumn[]>,
  wildcardTypes?: Record<string, Set<string>>,
): string {
  const lines: string[] = [];
  for (const table of Object.keys(tables).sort()) {
    const cols = [...(tables[table] ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const c of cols) {
      const wildcard = c.type === WILDCARD_TYPE || wildcardTypes?.[table]?.has(c.name);
      lines.push(`${table}.${c.name}:${wildcard ? WILDCARD_TYPE : normalizeType(c.type)}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function columnSetHash(tables: Record<string, ExpectedColumn[]>, wildcardTypes?: Record<string, Set<string>>): string {
  return createHash("sha256").update(canonicalColumnSet(tables, wildcardTypes)).digest("hex");
}

/** Columns whose type is "*" in the expectation, per table: the server applies the same wildcards to what it observes. */
export function wildcardsOf(expected: Record<string, ExpectedColumn[]>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [table, cols] of Object.entries(expected)) {
    out[table] = new Set(cols.filter((c) => c.type === WILDCARD_TYPE).map((c) => c.name));
  }
  return out;
}

export interface SchemaDiff {
  missingTables: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
  typeMismatches: Array<{ column: string; expected: string; actual: string }>;
}

/** Human-readable difference between the expected column set and the observed one (both keyed by table). */
export function diffColumnSets(expected: Record<string, ExpectedColumn[]>, actual: Record<string, ExpectedColumn[]>): SchemaDiff {
  const diff: SchemaDiff = { missingTables: [], missingColumns: [], unexpectedColumns: [], typeMismatches: [] };
  for (const [table, cols] of Object.entries(expected)) {
    const act = actual[table];
    if (!act || act.length === 0) { diff.missingTables.push(table); continue; }
    const actByName = new Map(act.map((c) => [c.name, c]));
    for (const c of cols) {
      const a = actByName.get(c.name);
      if (!a) { diff.missingColumns.push(`${table}.${c.name}`); continue; }
      if (c.type !== WILDCARD_TYPE && normalizeType(c.type) !== normalizeType(a.type)) {
        diff.typeMismatches.push({ column: `${table}.${c.name}`, expected: c.type, actual: a.type });
      }
    }
    const expNames = new Set(cols.map((c) => c.name));
    for (const a of act) if (!expNames.has(a.name)) diff.unexpectedColumns.push(`${table}.${a.name}`);
  }
  return diff;
}
