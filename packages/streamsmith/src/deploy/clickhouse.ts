// ClickHouse over HTTP (port 8123/8443). Credentials travel in the URL the caller provides (never logged).
import type { Ctx } from "../util/ctx.ts";
import { normalizeSql } from "../receipt.ts";
import { sha256Hex } from "../util/hash.ts";

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) { u.username = "***"; u.password = ""; }
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

/**
 * POST a query; returns the raw response body (default format TSV).
 * `database` sets the session database (`?database=`), which is what unqualified table names in a
 * `CREATE VIEW` body resolve against — without it they resolve to `default` wherever the views land.
 */
export async function chQuery(ctx: Ctx, url: string, sql: string, format?: string, database?: string): Promise<string> {
  const u = new URL(url);
  if (database) u.searchParams.set("database", database);
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (u.username || u.password) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`;
    u.username = "";
    u.password = "";
  }
  const body = format ? `${sql} FORMAT ${format}` : sql;
  const res = await ctx.fetch(u.toString(), { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse HTTP ${res.status} at ${redactUrl(url)}: ${text.slice(0, 300)}`);
  return text;
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `\`${name}\``;
}

export async function chMaxBlock(ctx: Ctx, url: string, database: string, tables: string[]): Promise<{ maxBlock?: number; perTable: Record<string, number | null> }> {
  const perTable: Record<string, number | null> = {};
  let maxBlock: number | undefined;
  for (const t of tables) {
    const sql = `SELECT max(_block_number_) FROM ${quoteIdent(database)}.${quoteIdent(t)} WHERE _deleted_ = 0`;
    try {
      const out = (await chQuery(ctx, url, sql)).trim();
      const n = out === "" || out === "\\N" ? null : Number(out);
      perTable[t] = n !== null && Number.isFinite(n) ? n : null;
      if (perTable[t] !== null && (maxBlock === undefined || perTable[t]! > maxBlock)) maxBlock = perTable[t]!;
    } catch (err) {
      ctx.log(`clickhouse: ${t}: ${(err as Error).message}`);
      perTable[t] = null;
    }
  }
  return maxBlock === undefined ? { perTable } : { maxBlock, perTable };
}

/**
 * Head from the sink's own per-block audit table. `_blocks_` (`number, hash, timestamp, version, deleted` — no
 * leading-underscore injected columns, unlike the data tables) is created by every from-proto sink run regardless
 * of which vault tables exist, so it is the most reliable head source when there is no deploy.json to say which
 * data tables to trust (`deploy status` with no prior `deploy self-managed` run). Missing table -> undefined.
 */
export async function chBlocksHead(ctx: Ctx, url: string, database: string): Promise<number | undefined> {
  const sql = `SELECT max(number) FROM ${quoteIdent(database)}.${quoteIdent("_blocks_")} WHERE deleted = 0`;
  try {
    const out = (await chQuery(ctx, url, sql)).trim();
    const n = out === "" || out === "\\N" ? undefined : Number(out);
    return n !== undefined && Number.isFinite(n) ? n : undefined;
  } catch (err) {
    ctx.log(`clickhouse: _blocks_: ${(err as Error).message}`);
    return undefined;
  }
}

/** Row counts per table for status output. `_blocks_` filters on `deleted`; every from-proto data table on `_deleted_`. */
export async function chRowCounts(ctx: Ctx, url: string, database: string, tables: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const t of tables) {
    const deletedCol = t === "_blocks_" ? "deleted" : "_deleted_";
    const sql = `SELECT count() FROM ${quoteIdent(database)}.${quoteIdent(t)} WHERE ${quoteIdent(deletedCol)} = 0`;
    try {
      const raw = (await chQuery(ctx, url, sql)).trim();
      const n = Number(raw);
      out[t] = Number.isFinite(n) ? n : null;
    } catch (err) {
      ctx.log(`clickhouse: row count ${t}: ${(err as Error).message}`);
      out[t] = null;
    }
  }
  return out;
}

/** `SHOW CREATE TABLE` for each table, concatenated — the DDL the sink actually applied. */
export async function chDumpSchema(ctx: Ctx, url: string, database: string, tables: string[]): Promise<string> {
  const parts: string[] = [];
  for (const t of tables) {
    const ddl = (await chQuery(ctx, url, `SHOW CREATE TABLE ${quoteIdent(database)}.${quoteIdent(t)}`, "TSVRaw")).trim();
    parts.push(`-- ${database}.${t}\n${ddl.replace(/\\n/g, "\n")};`);
  }
  return normalizeSql(parts.join("\n\n"));
}

export function schemaHash(sql: string): string {
  return sha256Hex(normalizeSql(sql));
}

/**
 * ClickHouse HTTP URL from the environment: CLICKHOUSE_URL (http(s)://host:8123|8443) with CLICKHOUSE_USER /
 * CLICKHOUSE_PASSWORD merged in when the URL carries no credentials. CLICKHOUSE_RO_HTTP_URL is the legacy name.
 */
export function clickhouseHttpUrl(ctx: Ctx, explicit?: string): string | undefined {
  const base = explicit ?? ctx.env.CLICKHOUSE_URL ?? ctx.env.CLICKHOUSE_RO_HTTP_URL;
  if (!base) return undefined;
  const u = new URL(base);
  if (!u.username && ctx.env.CLICKHOUSE_USER) u.username = encodeURIComponent(ctx.env.CLICKHOUSE_USER);
  if (!u.password && ctx.env.CLICKHOUSE_PASSWORD) u.password = encodeURIComponent(ctx.env.CLICKHOUSE_PASSWORD);
  return u.toString();
}

export function clickhouseDatabase(ctx: Ctx, explicit?: string, fallback?: string): string {
  return explicit ?? ctx.env.CLICKHOUSE_DATABASE ?? ctx.env.CLICKHOUSE_DB ?? fallback ?? "default";
}
