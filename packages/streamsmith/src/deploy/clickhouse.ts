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

/** POST a query; returns the raw response body (default format TSV). */
export async function chQuery(ctx: Ctx, url: string, sql: string, format?: string): Promise<string> {
  const u = new URL(url);
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
