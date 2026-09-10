// `substreams run -o jsonl` output: one envelope per block {"@module","@block","@type","@data"}; @data is protojson
// of the module's output message. Rows are decoded against the contract schema (gate.yaml rowExtraction) so omitted
// strings become "" and omitted bools become false, and unknown fields are rejected.
import { readText } from "../util/fsx.ts";
import { ContractSchema, DecodeError } from "./contract.ts";

export type Row = Record<string, unknown> & { __block?: number };

export interface Envelope {
  module?: string;
  block?: number;
  type?: string;
  data: unknown;
  raw: Record<string, unknown>;
}

export interface ParsedRun {
  name: string;
  lines: number;
  /** lines that were not valid JSON (a run failure per gate.yaml) */
  badLines: number;
  envelopes: Envelope[];
  blocks: number[];
  minBlock?: number;
  maxBlock?: number;
  tables: Record<string, Row[]>;
  /** decode problems (output_decodes_against_contract) */
  decodeErrors: string[];
  /** envelope problems: wrong @module / @type */
  envelopeErrors: string[];
}

export function parseEnvelopes(text: string): { envelopes: Envelope[]; lines: number; badLines: number } {
  const envelopes: Envelope[] = [];
  let lines = 0;
  let badLines = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    lines++;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      badLines++;
      continue;
    }
    const raw = obj as Record<string, unknown>;
    const env: Envelope = { data: "@data" in raw ? raw["@data"] : raw, raw };
    if (typeof raw["@module"] === "string") env.module = raw["@module"];
    if (typeof raw["@type"] === "string") env.type = raw["@type"];
    const b = raw["@block"];
    if (typeof b === "number") env.block = b;
    else if (typeof b === "string" && /^\d+$/.test(b)) env.block = Number(b);
    envelopes.push(env);
  }
  return { envelopes, lines, badLines };
}

export interface DecodeOptions {
  schema: ContractSchema;
  rootType: string; // e.g. vaultflows.v1.Events
  module?: string;
  rejectUnknownFields?: boolean;
}

export function decodeRun(name: string, text: string, opts: DecodeOptions): ParsedRun {
  const { envelopes, lines, badLines } = parseEnvelopes(text);
  const run: ParsedRun = { name, lines, badLines, envelopes, blocks: [], tables: {}, decodeErrors: [], envelopeErrors: [] };
  const tables = opts.schema.tables(opts.rootType);
  for (const t of tables) run.tables[t.table] = [];
  const blocks = new Set<number>();
  envelopes.forEach((env, i) => {
    if (env.block !== undefined) blocks.add(env.block);
    if (opts.module && env.module !== undefined && env.module !== opts.module) run.envelopeErrors.push(`line ${i + 1}: @module "${env.module}" != "${opts.module}"`);
    if (env.type !== undefined && env.type !== opts.rootType) run.envelopeErrors.push(`line ${i + 1}: @type "${env.type}" != "${opts.rootType}"`);
    if (env.module === undefined || env.type === undefined) run.envelopeErrors.push(`line ${i + 1}: missing @module/@type envelope`);
    let decoded: Record<string, unknown>;
    try {
      decoded = opts.schema.decode(opts.rootType, env.data, { rejectUnknownFields: opts.rejectUnknownFields !== false });
    } catch (err) {
      run.decodeErrors.push(`line ${i + 1}${env.block !== undefined ? ` (block ${env.block})` : ""}: ${err instanceof DecodeError ? err.message : (err as Error).message}`);
      return;
    }
    for (const t of tables) {
      const rows = decoded[t.field.name];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const row = { ...(r as Record<string, unknown>) } as Row;
        if (env.block !== undefined) row.__block = env.block;
        run.tables[t.table]!.push(row);
      }
    }
  });
  run.blocks = [...blocks].sort((a, b) => a - b);
  if (run.blocks.length) {
    run.minBlock = run.blocks[0];
    run.maxBlock = run.blocks[run.blocks.length - 1];
  }
  return run;
}

export async function decodeRunFile(name: string, path: string, opts: DecodeOptions): Promise<ParsedRun> {
  return decodeRun(name, await readText(path), opts);
}

// ---- accessors ----
export function str(row: Row, key: string): string {
  const v = row[key];
  return v === undefined || v === null ? "" : String(v);
}
export function num(row: Row, key: string): number | undefined {
  const v = row[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
export function bool(row: Row, key: string): boolean {
  return row[key] === true;
}
export function rowsOf(run: ParsedRun | undefined, table: string): Row[] {
  return run?.tables[table] ?? [];
}
export function totalRows(run: ParsedRun): number {
  return Object.values(run.tables).reduce((n, rows) => n + rows.length, 0);
}
