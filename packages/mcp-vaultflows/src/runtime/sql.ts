// Read-only, parameterized SQL for the generated tools. Every user-influenced value is bound as a ClickHouse
// query parameter (`{name:Type}` placeholder + `param_name` on the HTTP request); no user string is ever
// concatenated into the SQL text. Identifiers come from the manifest (generated from the proto/views) and are
// still validated against a strict regex before use.
import type { ParamSpec, ToolSpec, WindowSpec } from "./types.ts";

export interface SqlQuery {
  sql: string;
  /** bound parameters; ClickHouse HTTP takes them as `param_<name>=<value>` strings */
  params: Record<string, string>;
}

export interface ToolArgs {
  [name: string]: unknown;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ORDER_BY = /^[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?$/i;
const PARAM_TYPE = /^(String|Int32|UInt32|UInt64)$/;
export const WINDOW_MARKER = "/*@window*/";

export class SqlBuildError extends Error {}

export function assertIdent(name: string, what: string): string {
  if (!IDENT.test(name)) throw new SqlBuildError(`${what} ${JSON.stringify(name)} is not a plain identifier`);
  return name;
}

function checkWindow(w: WindowSpec): WindowSpec {
  assertIdent(w.column, "window column");
  assertIdent(w.table, "window table");
  if (!w.where || /[;{}]/.test(w.where) || w.where.length > 200) throw new SqlBuildError("window where-predicate must be a short expression without ';', '{' or '}'");
  return w;
}

/** `col >= (newest observed col) - windowHours*3600`; the upper bound is measured on the data, not on the clock. */
function windowPredicate(w: WindowSpec): string {
  checkWindow(w);
  return `${w.column} >= (SELECT max(${w.column}) FROM ${w.table} WHERE ${w.where}) - toUInt64({windowHours:UInt32}) * 3600`;
}

/** Effective integer argument after clamping to the spec's bounds; undefined when optional and omitted. */
export function effectiveInt(p: ParamSpec, raw: unknown): number | undefined {
  if (raw === undefined || raw === null) {
    if (p.optional) return undefined;
    if (p.default === undefined) throw new SqlBuildError(`argument ${p.name} is required`);
    return p.default;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n)) throw new SqlBuildError(`argument ${p.name} must be an integer`);
  if (p.min !== undefined && n < p.min) throw new SqlBuildError(`argument ${p.name} below minimum ${p.min}`);
  if (p.max !== undefined && n > p.max) throw new SqlBuildError(`argument ${p.name} above maximum ${p.max}`);
  return n;
}

/** Builds the data query for a table/view tool. Throws SqlBuildError on any argument outside the closed sets. */
export function buildToolQuery(spec: ToolSpec, args: ToolArgs): SqlQuery {
  if (spec.kind === "status") throw new SqlBuildError("status tool has no SQL");
  const source = assertIdent(spec.source, "source");
  const params: Record<string, string> = {};
  const where: string[] = [];

  const select = spec.columns.map((c) => {
    const name = assertIdent(c.name, "column");
    return c.stringify ? `toString(${name}) AS ${name}` : name;
  });
  if (select.length === 0) throw new SqlBuildError(`tool ${spec.name} has no columns`);

  if (spec.deletedFilter) where.push("_deleted_ = 0");

  let windowHours: number | undefined;
  let limit = 100;
  for (const p of spec.params) {
    const raw = args[p.name];
    switch (p.kind) {
      case "vault":
      case "enumFilter": {
        if (raw === undefined || raw === null) break;
        if (typeof raw !== "string") throw new SqlBuildError(`argument ${p.name} must be a string`);
        const allowed = p.values ?? [];
        const value = p.kind === "vault" ? raw.toLowerCase() : raw;
        if (!allowed.includes(value)) throw new SqlBuildError(`argument ${p.name}: ${JSON.stringify(raw)} is not one of the ${allowed.length} allowed values`);
        const column = assertIdent(p.column ?? p.name, "filter column");
        const chType = p.chType ?? "String";
        if (!PARAM_TYPE.test(chType)) throw new SqlBuildError(`unsupported parameter type ${chType}`);
        const pname = assertIdent(p.name, "parameter");
        where.push(`${column} = {${pname}:${chType}}`);
        params[pname] = p.valueMap ? String(p.valueMap[value]) : value;
        break;
      }
      case "windowHours":
        windowHours = effectiveInt(p, raw);
        break;
      case "limit":
        limit = effectiveInt(p, raw) ?? limit;
        break;
    }
  }

  let from: string;
  if (spec.kind === "view" && spec.window?.marker) {
    if (!spec.body) throw new SqlBuildError(`view tool ${spec.name} declares a window marker but has no body`);
    if (windowHours !== undefined) {
      params.windowHours = String(windowHours);
      from = `(${spec.body.replace(WINDOW_MARKER, "AND " + windowPredicate(spec.window))})`;
    } else {
      from = source;
    }
  } else {
    from = source;
    if (spec.window && !spec.window.marker && windowHours !== undefined) {
      params.windowHours = String(windowHours);
      where.push(windowPredicate(spec.window));
    }
  }

  const orderBy = spec.orderBy.map((o) => {
    if (!ORDER_BY.test(o.trim())) throw new SqlBuildError(`bad ORDER BY term ${JSON.stringify(o)}`);
    return o.trim();
  });

  params.limit = String(limit);
  const sql =
    `SELECT ${select.join(", ")}\n` +
    `FROM ${from}\n` +
    (where.length ? `WHERE ${where.join(" AND ")}\n` : "") +
    (orderBy.length ? `ORDER BY ${orderBy.join(", ")}\n` : "") +
    `LIMIT {limit:UInt32}`;
  return { sql, params };
}

/** Observed bounds of a tool's window column over live rows (min, max, count), for provenance.observedWindow. */
export function buildWindowBoundsQuery(spec: ToolSpec): SqlQuery | undefined {
  if (!spec.window) return undefined;
  const w = checkWindow(spec.window);
  return {
    sql: `SELECT toUInt64(min(${w.column})) AS window_start, toUInt64(max(${w.column})) AS window_end, count() AS n FROM ${w.table} WHERE ${w.where}`,
    params: {},
  };
}

/** `SELECT count()` over live rows of a table. */
export function buildCountQuery(table: string, deletedFilter: boolean): SqlQuery {
  const t = assertIdent(table, "table");
  return { sql: `SELECT count() AS c FROM ${t}${deletedFilter ? " WHERE _deleted_ = 0" : ""}`, params: {} };
}

/** system.columns for the expected tables of one database. */
export function buildColumnsQuery(database: string, tables: string[]): SqlQuery {
  tables.forEach((t) => assertIdent(t, "table"));
  return {
    sql: "SELECT table, name, type FROM system.columns WHERE database = {db:String} AND table IN {tables:Array(String)} ORDER BY table, position",
    params: { db: database, tables: "[" + tables.map((t) => `'${t}'`).join(",") + "]" },
  };
}

/**
 * Sink head across tables: max(_block_number_) (injected in every from-proto table) and max(block_timestamp)
 * where the table has that column.
 */
export function buildHeadQuery(tables: Array<{ table: string; hasBlockTimestamp: boolean }>): SqlQuery {
  if (tables.length === 0) throw new SqlBuildError("no tables for head query");
  const parts = tables.map(({ table, hasBlockTimestamp }) => {
    const t = assertIdent(table, "table");
    const ts = hasBlockTimestamp ? "toUInt64(max(block_timestamp))" : "toUInt64(0)";
    return `SELECT toUInt64(max(_block_number_)) AS head_block, ${ts} AS head_timestamp FROM ${t} WHERE _deleted_ = 0`;
  });
  return { sql: `SELECT max(head_block) AS head_block, max(head_timestamp) AS head_timestamp FROM (${parts.join(" UNION ALL ")})`, params: {} };
}
