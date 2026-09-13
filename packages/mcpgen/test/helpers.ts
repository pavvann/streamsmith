import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClickHouseClient, ClickHouseResult } from "../runtime/clickhouse.ts";
import type { ChainHead } from "../runtime/rpc.ts";
import type { SqlQuery } from "../runtime/sql.ts";
import type { ExpectedColumn, Manifest, RuntimeReceipt } from "../runtime/types.ts";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const SPEC_PROTO = join(REPO_ROOT, "specs", "vaultflows.proto");
export const SPEC_RECEIPT_SCHEMA = join(REPO_ROOT, "specs", "receipt.schema.json");
export const SPEC_GATE_YAML = join(REPO_ROOT, "specs", "gate.yaml");
export const VIEWS_SQL = join(REPO_ROOT, "packages", "erc4626-flows", "sql", "views.sql");
export const FIXTURE_RECEIPT = join(PKG_ROOT, "fixtures", "receipt.example.json");
export const GENERATED_DIR = join(REPO_ROOT, "packages", "mcp-vaultflows");
export const LIVE_PRIMARY_JSONL = join(REPO_ROOT, "runs", "live", "primary-51092254-51092454.jsonl");
export const LIVE_OBSERVATION_JSONL = join(REPO_ROOT, "runs", "live", "observation-51092998-51093002.jsonl");

/**
 * The receipt the checked-in packages/mcp-vaultflows was generated from — `generate` copies it next to
 * manifest.json, so it is the receipt that generated package's guardian must accept. It is NOT
 * fixtures/receipt.example.json: since the first real deployment the generated package is built from the real
 * receipt (now the hosted one, runs/20260912T103328Z-vipc), and pinning the tests to the fixture made every
 * guardian check refuse with `receipt_mismatch` against the real manifest.
 */
export const GENERATED_RECEIPT = join(GENERATED_DIR, "receipt.json");

export function readFixtureReceipt(): RuntimeReceipt {
  return JSON.parse(readFileSync(FIXTURE_RECEIPT, "utf8")) as RuntimeReceipt;
}

/** The receipt that matches `GENERATED_DIR/manifest.json`, whichever receipt that package was generated from. */
export function readGeneratedReceipt(): RuntimeReceipt {
  return JSON.parse(readFileSync(GENERATED_RECEIPT, "utf8")) as RuntimeReceipt;
}

/** Plausible live types for the injected columns (compared by name only, so any type must pass). */
const INJECTED_LIVE_TYPES: Record<string, string> = { _block_number_: "UInt64", _block_timestamp_: "DateTime", _version_: "Int64", _deleted_: "Bool" };

/** system.columns rows that match the manifest's expectation exactly. */
export function liveColumnsFromManifest(m: Manifest): Record<string, ExpectedColumn[]> {
  const out: Record<string, ExpectedColumn[]> = {};
  for (const [table, cols] of Object.entries(m.expectedSchema.tables)) {
    out[table] = cols.map((c) => ({ name: c.name, type: c.type === "*" ? (INJECTED_LIVE_TYPES[c.name] ?? "String") : c.type }));
  }
  return out;
}

export interface FakeWorld {
  columns: Record<string, ExpectedColumn[]>;
  headBlock: number;
  headTimestamp: number;
  counts: Record<string, number>;
  rows: Array<Record<string, unknown>>;
  failClickhouse?: string;
  /** span of the faked min..max window bounds, in seconds (default 7 days) */
  windowSpanSeconds?: number;
}

/** ClickHouse fake routed on the SQL text the runtime builds. Records every query. */
export class FakeClickHouse implements ClickHouseClient {
  calls: SqlQuery[] = [];
  world: FakeWorld;
  constructor(world: FakeWorld) {
    this.world = world;
  }
  async query(q: SqlQuery): Promise<ClickHouseResult> {
    this.calls.push(q);
    if (this.world.failClickhouse) throw new Error(this.world.failClickhouse);
    const sql = q.sql;
    if (sql.includes("FROM system.columns")) {
      const data: Array<Record<string, unknown>> = [];
      for (const [table, cols] of Object.entries(this.world.columns)) for (const c of cols) data.push({ table, name: c.name, type: c.type });
      return { meta: [], data, rows: data.length };
    }
    if (sql.includes("AS head_block")) return { meta: [], data: [{ head_block: String(this.world.headBlock), head_timestamp: String(this.world.headTimestamp) }], rows: 1 };
    if (sql.startsWith("SELECT count() AS c FROM ")) {
      const table = /FROM ([a-z_]+)/.exec(sql)![1]!;
      return { meta: [], data: [{ c: String(this.world.counts[table] ?? 0) }], rows: 1 };
    }
    if (sql.includes("AS window_end")) {
      const table = /FROM ([a-z_]+)/.exec(sql)![1]!;
      const n = this.world.counts[table] ?? 1;
      const span = this.world.windowSpanSeconds ?? 7 * 86400;
      return { meta: [], data: [{ window_start: String(this.world.headTimestamp - span), window_end: String(this.world.headTimestamp), n: String(n) }], rows: 1 };
    }
    return { meta: [{ name: "id", type: "String" }], data: this.world.rows, rows: this.world.rows.length };
  }
}

export class FakeChainHead implements ChainHead {
  blockNumber: number;
  chainId: number;
  fail?: string;
  constructor(blockNumber: number, chainId = 8453, fail?: string) {
    this.blockNumber = blockNumber;
    this.chainId = chainId;
    this.fail = fail;
  }
  async head(): Promise<{ blockNumber: number; chainId: number }> {
    if (this.fail) throw new Error(this.fail);
    return { blockNumber: this.blockNumber, chainId: this.chainId };
  }
}
