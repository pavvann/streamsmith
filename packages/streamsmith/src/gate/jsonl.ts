// `substreams run -o jsonl` output: one envelope per block {"@module","@block","@type","@data"}; @data is protojson
// of the module's output message (streamingfast/substreams protodecode/decoder.go `ModuleWrap`). Rows are decoded
// against the contract schema (gate.yaml rowExtraction) so omitted strings become "" and omitted bools become false,
// and unknown fields are rejected. Without a schema (buf unavailable) rows are parsed loosely: protojson camelCase keys
// are converted to proto snake_case and the four repeated fields are taken as tables; that mode is flagged so
// `output_decodes_against_contract` fails instead of silently passing.
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
  /** lines that were not valid JSON objects (a run failure per gate.yaml) */
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
  /** true when rows were parsed without the contract descriptor */
  loose: boolean;
}

/** The public contract's four tables (field name == (schema.table) name in specs/vaultflows.proto). */
export const TABLES = ["vault_flows", "share_value_observations", "vaults", "share_transfers"] as const;

export function camelToSnake(key: string): string {
  if (key.startsWith("@")) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
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
  /** contract descriptor; when absent, rows are parsed loosely (see file header) */
  schema?: ContractSchema;
  rootType: string; // e.g. vaultflows.v1.Events
  module?: string;
  rejectUnknownFields?: boolean;
}

/**
 * Legacy shape tolerance: earlier drafts of the contract carried `call_status: {ok, error}`; the frozen contract
 * reserves that name and flattens it to call_ok / call_error. The nested object is folded into the scalars so the
 * row is still usable, and the fold is reported so the contract-decoding assertion fails (the field is unknown).
 */
export function foldLegacyCallStatus(row: Record<string, unknown>): boolean {
  const key = "call_status" in row ? "call_status" : "callStatus" in row ? "callStatus" : undefined;
  if (!key) return false;
  const cs = row[key];
  if (cs && typeof cs === "object" && !Array.isArray(cs)) {
    const o = cs as Record<string, unknown>;
    if (!("call_ok" in row) && !("callOk" in row)) row.callOk = o.ok === true;
    if (!("call_error" in row) && !("callError" in row)) row.callError = typeof o.error === "string" ? o.error : "";
  }
  delete row[key];
  return true;
}

export function decodeRun(name: string, text: string, opts: DecodeOptions): ParsedRun {
  const { envelopes, lines, badLines } = parseEnvelopes(text);
  const run: ParsedRun = { name, lines, badLines, envelopes, blocks: [], tables: {}, decodeErrors: [], envelopeErrors: [], loose: !opts.schema };
  const tables = opts.schema ? opts.schema.tables(opts.rootType) : TABLES.map((t) => ({ field: { name: t }, table: t }));
  for (const t of tables) run.tables[t.table] = [];
  if (!opts.schema && envelopes.length) run.decodeErrors.push("contract descriptor unavailable: rows parsed loosely (camelCase -> snake_case), unknown fields not checked");
  const blocks = new Set<number>();
  envelopes.forEach((env, i) => {
    if (env.block !== undefined) blocks.add(env.block);
    if (opts.module && env.module !== undefined && env.module !== opts.module) run.envelopeErrors.push(`line ${i + 1}: @module "${env.module}" != "${opts.module}"`);
    if (env.type !== undefined && env.type !== opts.rootType) run.envelopeErrors.push(`line ${i + 1}: @type "${env.type}" != "${opts.rootType}"`);
    if (env.module === undefined || env.type === undefined) run.envelopeErrors.push(`line ${i + 1}: missing @module/@type envelope`);
    const where = `line ${i + 1}${env.block !== undefined ? ` (block ${env.block})` : ""}`;
    if (!env.data || typeof env.data !== "object" || Array.isArray(env.data)) {
      run.decodeErrors.push(`${where}: @data is not an object`);
      return;
    }
    // legacy call_status fold (before strict decoding)
    const data = env.data as Record<string, unknown>;
    let folded = 0;
    for (const v of Object.values(data)) if (Array.isArray(v)) for (const r of v) if (r && typeof r === "object" && foldLegacyCallStatus(r as Record<string, unknown>)) folded++;
    if (folded) run.decodeErrors.push(`${where}: ${folded} row(s) carried the legacy nested call_status object (reserved in the contract); folded into call_ok/call_error`);

    let decoded: Record<string, unknown>;
    if (opts.schema) {
      try {
        decoded = opts.schema.decode(opts.rootType, data, { rejectUnknownFields: opts.rejectUnknownFields !== false });
      } catch (err) {
        run.decodeErrors.push(`${where}: ${err instanceof DecodeError ? err.message : (err as Error).message}`);
        return;
      }
    } else {
      decoded = {};
      for (const [k, v] of Object.entries(data)) decoded[camelToSnake(k)] = Array.isArray(v) ? v.map((r) => (r && typeof r === "object" ? snakeKeys(r as Record<string, unknown>) : r)) : v;
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

function snakeKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[camelToSnake(k)] = v;
  return out;
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
/** call_ok / call_error as one object (scalars per the frozen contract; legacy objects were folded at decode time). */
export function callStatus(row: Row): { ok: boolean; error: string } {
  return { ok: bool(row, "call_ok"), error: str(row, "call_error") };
}
export function rowsOf(run: ParsedRun | undefined, table: string): Row[] {
  return run?.tables[table] ?? [];
}
export function totalRows(run: ParsedRun): number {
  return Object.values(run.tables).reduce((n, rows) => n + rows.length, 0);
}
