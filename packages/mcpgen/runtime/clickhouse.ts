// ClickHouse over HTTP. Read-only by construction: `readonly=1` on every request, a hard client timeout and a
// server-side max_execution_time, SQL text from the manifest only, values bound as `param_*`.
import type { SqlQuery } from "./sql.ts";

export interface ClickHouseResult {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
  rows: number;
}

export interface ClickHouseClient {
  query(q: SqlQuery): Promise<ClickHouseResult>;
}

export interface HttpClickHouseOptions {
  /** e.g. http://localhost:8123 (path and query string are ignored) */
  url: string;
  user?: string;
  password?: string;
  database: string;
  /** default 10000 */
  timeoutMs?: number;
  /** 1 (default): read-only, settings frozen. 2: read-only, settings changeable — use if the server rejects readonly=1 together with the other settings */
  readonly?: 1 | 2;
  fetchImpl?: typeof fetch;
}

export class ClickHouseError extends Error {
  readonly status: number | undefined;
  readonly body: string | undefined;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class HttpClickHouseClient implements ClickHouseClient {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly opts: HttpClickHouseOptions;

  constructor(opts: HttpClickHouseOptions) {
    this.opts = opts;
    const u = new URL(opts.url);
    u.search = "";
    u.pathname = "/";
    this.endpoint = u;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async query(q: SqlQuery): Promise<ClickHouseResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set("database", this.opts.database);
    url.searchParams.set("readonly", String(this.opts.readonly ?? 1));
    url.searchParams.set("max_execution_time", String(Math.ceil(this.timeoutMs / 1000)));
    url.searchParams.set("output_format_json_quote_64bit_integers", "1");
    for (const [k, v] of Object.entries(q.params)) url.searchParams.set(`param_${k}`, v);
    const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8" };
    if (this.opts.user !== undefined) headers["x-clickhouse-user"] = this.opts.user;
    if (this.opts.password !== undefined) headers["x-clickhouse-key"] = this.opts.password;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: q.sql + "\nFORMAT JSON",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ClickHouseError(`clickhouse request failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ClickHouseError(`clickhouse HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, text);
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new ClickHouseError(`clickhouse returned non-JSON: ${text.slice(0, 200)}`); }
    const r = json as Partial<ClickHouseResult>;
    return { meta: r.meta ?? [], data: r.data ?? [], rows: r.rows ?? (r.data?.length ?? 0) };
  }
}
