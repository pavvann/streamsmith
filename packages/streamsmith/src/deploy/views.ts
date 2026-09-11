// Views over the from-proto tables. The sink creates the base tables from the proto annotations; Streamsmith then
// applies packages/erc4626-flows/sql/views.sql (owned by the mcpgen agent; optional file) statement by statement over
// ClickHouse HTTP. Nothing here is hand-written DDL for the base tables.
import { isAbsolute, join } from "node:path";
import type { Ctx } from "../util/ctx.ts";
import { exists, readText } from "../util/fsx.ts";
import { sha256Hex } from "../util/hash.ts";
import { chQuery, quoteIdent } from "./clickhouse.ts";

export const DEFAULT_VIEWS_PATH = "packages/erc4626-flows/sql/views.sql";

export interface ViewsRecord {
  /** path as given (relative to the repo root when possible) */
  file: string;
  present: boolean;
  sha256?: string;
  statements: number;
  /** statements executed, in order, whitespace collapsed */
  applied: string[];
  /** views present in the database after applying (engine View / MaterializedView) */
  views: string[];
  /** set when nothing was applied and why */
  skipped?: string;
  appliedAt: string;
}

/** Split SQL on `;` outside single-quoted strings; drop `--` line comments and empty statements. */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  const lines = sql.replace(/\r\n/g, "\n").split("\n");
  const text = lines.map((l) => (inStrLine(l) ? l : l.replace(/--.*$/, ""))).join("\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" ) {
      inStr = !inStr;
      cur += c;
    } else if (c === ";" && !inStr) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// a line whose `--` sits inside a string literal is left alone (cheap heuristic: odd number of quotes before `--`)
function inStrLine(line: string): boolean {
  const idx = line.indexOf("--");
  if (idx < 0) return false;
  return (line.slice(0, idx).match(/'/g) ?? []).length % 2 === 1;
}

function sqlString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function chTablesPresent(ctx: Ctx, url: string, database: string, tables: string[]): Promise<Record<string, boolean>> {
  for (const t of tables) quoteIdent(t);
  const sql = `SELECT name FROM system.tables WHERE database = ${sqlString(database)} AND name IN (${tables.map(sqlString).join(", ")})`;
  const present = new Set((await chQuery(ctx, url, sql, "TSV")).split("\n").map((s) => s.trim()).filter(Boolean));
  const out: Record<string, boolean> = {};
  for (const t of tables) out[t] = present.has(t);
  return out;
}

export async function chViewNames(ctx: Ctx, url: string, database: string): Promise<string[]> {
  const sql = `SELECT name FROM system.tables WHERE database = ${sqlString(database)} AND engine IN ('View', 'MaterializedView') ORDER BY name`;
  return (await chQuery(ctx, url, sql, "TSV")).split("\n").map((s) => s.trim()).filter(Boolean);
}

export interface ApplyViewsOptions {
  url: string;
  database: string;
  viewsPath?: string;
  /**
   * True when the caller passed `--views` explicitly. The default views.sql is genuinely optional (it may not
   * exist yet — owned by the mcpgen agent — so a missing file is silently skipped); a file the caller *named* is
   * not optional, so a missing explicit path is a hard error instead of a silent no-op.
   */
  viewsPathExplicit?: boolean;
  /** base tables that must exist before views are applied (sink creates them) */
  requiredTables?: string[];
  /** how long to wait for the base tables (self-managed sink startup); 0 = check once */
  waitSeconds?: number;
  pollSeconds?: number;
}

export async function applyViews(ctx: Ctx, o: ApplyViewsOptions): Promise<ViewsRecord> {
  const rel = o.viewsPath ?? DEFAULT_VIEWS_PATH;
  // relative to the repo root (ctx.root, which --root overrides), never process.cwd()
  const abs = isAbsolute(rel) ? rel : join(ctx.root, rel);
  const rec: ViewsRecord = { file: rel, present: false, statements: 0, applied: [], views: [], appliedAt: ctx.now().toISOString() };
  if (!(await exists(abs))) {
    if (o.viewsPathExplicit) throw new Error(`--views ${rel} not found (resolved to ${abs}); pass an existing file, or drop --views to use the default ${DEFAULT_VIEWS_PATH}`);
    rec.skipped = `${rel} does not exist (optional; owned by the mcpgen agent)`;
    ctx.log(`views: ${rec.skipped}`);
    return rec;
  }
  rec.present = true;
  const sql = await readText(abs);
  rec.sha256 = sha256Hex(sql);
  const statements = splitSqlStatements(sql);
  rec.statements = statements.length;
  if (!statements.length) {
    rec.skipped = `${rel} has no statements`;
    return rec;
  }
  const required = o.requiredTables ?? [];
  if (required.length) {
    const deadline = Date.now() + (o.waitSeconds ?? 0) * 1000;
    for (;;) {
      const present = await chTablesPresent(ctx, o.url, o.database, required);
      const missing = Object.entries(present).filter(([, ok]) => !ok).map(([t]) => t);
      if (!missing.length) break;
      if (Date.now() >= deadline) {
        rec.skipped = `base tables missing in ${o.database}: ${missing.join(", ")} (sink has not created them yet)`;
        ctx.log(`views: ${rec.skipped}`);
        return rec;
      }
      ctx.log(`views: waiting for base tables ${missing.join(", ")}`);
      await ctx.sleep((o.pollSeconds ?? 10) * 1000);
    }
  }
  for (const st of statements) {
    await chQuery(ctx, o.url, st, undefined, o.database);
    rec.applied.push(st.replace(/\s+/g, " "));
  }
  rec.views = await chViewNames(ctx, o.url, o.database);
  rec.appliedAt = ctx.now().toISOString();
  ctx.log(`views: applied ${rec.applied.length} statement(s) from ${rel}; views now: ${rec.views.join(", ") || "(none)"}`);
  return rec;
}
