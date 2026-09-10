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
export const VIEWS_SQL = join(REPO_ROOT, "packages", "erc4626-flows", "sql", "views.sql");
export const FIXTURE_RECEIPT = join(PKG_ROOT, "fixtures", "receipt.example.json");
export const GENERATED_DIR = join(REPO_ROOT, "packages", "mcp-vaultflows");

export function readFixtureReceipt(): RuntimeReceipt {
  return JSON.parse(readFileSync(FIXTURE_RECEIPT, "utf8")) as RuntimeReceipt;
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
}

/** ClickHouse fake routed on the SQL text the runtime builds. Records every query. */
export class FakeClickHouse implements ClickHouseClient {
  calls: SqlQuery[] = [];
  constructor(public world: FakeWorld) {}
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
      return { meta: [], data: [{ window_start: String(this.world.headTimestamp - 7 * 86400), window_end: String(this.world.headTimestamp), n: String(n) }], rows: 1 };
    }
    return { meta: [{ name: "id", type: "String" }], data: this.world.rows, rows: this.world.rows.length };
  }
}

export class FakeChainHead implements ChainHead {
  constructor(public blockNumber: number, public chainId = 8453, public fail?: string) {}
  async head(): Promise<{ blockNumber: number; chainId: number }> {
    if (this.fail) throw new Error(this.fail);
    return { blockNumber: this.blockNumber, chainId: this.chainId };
  }
}
