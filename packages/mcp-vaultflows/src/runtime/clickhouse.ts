// ClickHouse over HTTP. Read-only by construction: `readonly=1` on every request, a hard client timeout and a
// server-side max_execution_time, SQL text from the manifest only, values bound as `param_*`.
//
// One endpoint cannot take those settings: a credential whose PROFILE is already read-only (ClickHouse Cloud's
// `ro` user) may not set ANY setting, not even `readonly` itself, and answers
// `HTTP 500 Code: 164 ... Cannot modify 'max_execution_time' setting in readonly mode`. That refusal is a
// stronger guarantee than the one this client asks for, so the request is retried once with no settings at all
// and the discovered mode is cached for the process lifetime (see ClickHouseAccess in types.ts). The client-side
// AbortSignal timeout is enforced in both modes, so dropping `max_execution_time` loses no bound, and no code
// path in the generated server ever sends a statement other than the manifest's SELECTs.
import type { SqlQuery } from "./sql.ts";
import type { ClickHouseAccess } from "./types.ts";

export interface ClickHouseResult {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
  rows: number;
}

export interface ClickHouseClient {
  query(q: SqlQuery): Promise<ClickHouseResult>;
  /** How this connection is kept read-only, for `provenance` / `pipeline_status`. Optional: fakes may omit it. */
  access?(): ClickHouseAccess;
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
  log?: (message: string) => void;
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

/**
 * True for the one refusal that is safe to retry without settings: an HTTP error whose body is ClickHouse's
 * `Code: 164 ... in readonly mode`. Matched on the response body, not on the status alone, so an unrelated
 * HTTP 500 (or a network failure, which carries no status) is never retried.
 */
export function isProfileReadonlyError(e: unknown): boolean {
  if (!(e instanceof ClickHouseError) || e.status === undefined) return false;
  const text = `${e.body ?? ""}\n${e.message}`;
  return /Code:\s*164/.test(text) && /readonly mode/i.test(text);
}

export class HttpClickHouseClient implements ClickHouseClient {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly opts: HttpClickHouseOptions;
  /** Discovered on the first refusal and then fixed for the process lifetime. */
  private settingsMode: ClickHouseAccess["settingsMode"] = "request-readonly";

  constructor(opts: HttpClickHouseOptions) {
    this.opts = opts;
    const u = new URL(opts.url);
    u.search = "";
    u.pathname = "/";
    this.endpoint = u;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  access(): ClickHouseAccess {
    const profile = this.settingsMode === "readonly-profile";
    return {
      settingsMode: this.settingsMode,
      settingsSent: !profile,
      timeoutMs: this.timeoutMs,
      note: profile
        ? "the credential's ClickHouse profile is read-only server-side and refuses per-query settings, so none are sent; the client-side timeout still applies"
        : `every request carries readonly=${this.opts.readonly ?? 1} and max_execution_time`,
    };
  }

  async query(q: SqlQuery): Promise<ClickHouseResult> {
    try {
      return await this.post(q, this.settingsMode);
    } catch (e) {
      if (this.settingsMode === "request-readonly" && isProfileReadonlyError(e)) {
        this.settingsMode = "readonly-profile";
        this.opts.log?.("clickhouse: this credential's profile is already read-only and refuses per-query settings (Code: 164); retrying with no settings for the rest of the process");
        return this.post(q, this.settingsMode);
      }
      throw e;
    }
  }

  private async post(q: SqlQuery, mode: ClickHouseAccess["settingsMode"]): Promise<ClickHouseResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set("database", this.opts.database);
    if (mode === "request-readonly") {
      url.searchParams.set("readonly", String(this.opts.readonly ?? 1));
      url.searchParams.set("max_execution_time", String(Math.ceil(this.timeoutMs / 1000)));
      url.searchParams.set("output_format_json_quote_64bit_integers", "1");
    }
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
