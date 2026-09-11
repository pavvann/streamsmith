// The HTTP client against a mocked fetch. The case that matters in production: ClickHouse Cloud's `ro` user has a
// read-only PROFILE, so it may not set any per-query setting (not even `readonly`) and answers
// `HTTP 500 Code: 164 ... Cannot modify 'max_execution_time' setting in readonly mode`. The client must retry that
// one request without settings, remember the mode, and never widen the retry to any other failure.
import { describe, expect, it } from "vitest";
import { ClickHouseError, HttpClickHouseClient, isProfileReadonlyError } from "../runtime/clickhouse.ts";
import type { SqlQuery } from "../runtime/sql.ts";

const READONLY_164 =
  "Code: 164. DB::Exception: ro: Cannot modify 'max_execution_time' setting in readonly mode. " +
  "(READONLY) (version 26.2.1.1234 (official build))\n";

const OK_BODY = JSON.stringify({ meta: [{ name: "head_block", type: "UInt64" }], data: [{ head_block: "51093000" }], rows: 1 });

const Q: SqlQuery = { sql: "SELECT max(_block_number_) AS head_block FROM vault_flows", params: { limit: "5" } };

interface Call { url: URL; body: string }

/** fetch fake: each element of `responses` answers one call, in order. */
function fakeFetch(responses: Array<{ status: number; body: string } | Error>) {
  const calls: Call[] = [];
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), body: String(init?.body ?? "") });
    const r = responses[calls.length - 1];
    if (r === undefined) throw new Error(`unexpected call ${calls.length}`);
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(impl: typeof fetch, logs: string[] = []) {
  return new HttpClickHouseClient({
    url: "https://abc.clickhouse.cloud:8443",
    user: "ro",
    password: "secret",
    database: "vaultflows",
    timeoutMs: 10_000,
    fetchImpl: impl,
    log: (m) => logs.push(m),
  });
}

const settingsOf = (u: URL) => ({
  readonly: u.searchParams.get("readonly"),
  maxExecutionTime: u.searchParams.get("max_execution_time"),
  quote64: u.searchParams.get("output_format_json_quote_64bit_integers"),
});

describe("HttpClickHouseClient settings negotiation", () => {
  it("sends readonly=1 and max_execution_time by default", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: OK_BODY }]);
    const c = client(impl);
    const r = await c.query(Q);
    expect(r.data).toEqual([{ head_block: "51093000" }]);
    expect(calls).toHaveLength(1);
    expect(settingsOf(calls[0]!.url)).toEqual({ readonly: "1", maxExecutionTime: "10", quote64: "1" });
    expect(calls[0]!.url.searchParams.get("param_limit")).toBe("5");
    expect(c.access()).toMatchObject({ settingsMode: "request-readonly", settingsSent: true, timeoutMs: 10_000 });
  });

  it("a read-only PROFILE (500 / Code: 164) is retried once with no settings at all", async () => {
    const { impl, calls } = fakeFetch([{ status: 500, body: READONLY_164 }, { status: 200, body: OK_BODY }]);
    const logs: string[] = [];
    const c = client(impl, logs);
    const r = await c.query(Q);
    expect(r.data).toEqual([{ head_block: "51093000" }]);
    expect(calls).toHaveLength(2);
    // same query, same bound parameters, same database; only the settings are gone
    expect(calls[1]!.body).toBe(calls[0]!.body);
    expect(settingsOf(calls[1]!.url)).toEqual({ readonly: null, maxExecutionTime: null, quote64: null });
    expect(calls[1]!.url.searchParams.get("database")).toBe("vaultflows");
    expect(calls[1]!.url.searchParams.get("param_limit")).toBe("5");
    expect(c.access()).toMatchObject({ settingsMode: "readonly-profile", settingsSent: false, timeoutMs: 10_000 });
    expect(logs.join(" ")).toMatch(/Code: 164/);
  });

  it("remembers the mode for the process: later queries are sent without settings and are not retried", async () => {
    const { impl, calls } = fakeFetch([
      { status: 500, body: READONLY_164 },
      { status: 200, body: OK_BODY },
      { status: 200, body: OK_BODY },
      { status: 500, body: READONLY_164 },
    ]);
    const c = client(impl);
    await c.query(Q);
    await c.query(Q);
    expect(calls).toHaveLength(3);
    expect(settingsOf(calls[2]!.url)).toEqual({ readonly: null, maxExecutionTime: null, quote64: null });
    // a 164 in profile mode is a real failure, not another negotiation: it must surface, with no fourth call
    await expect(c.query(Q)).rejects.toThrow(/Code: 164/);
    expect(calls).toHaveLength(4);
    expect(c.access().settingsMode).toBe("readonly-profile");
  });

  it("an unrelated HTTP 500 is not retried and keeps the mode", async () => {
    const { impl, calls } = fakeFetch([{ status: 500, body: "Code: 241. DB::Exception: Memory limit exceeded" }]);
    const c = client(impl);
    await expect(c.query(Q)).rejects.toThrow(/clickhouse HTTP 500/);
    expect(calls).toHaveLength(1);
    expect(c.access()).toMatchObject({ settingsMode: "request-readonly", settingsSent: true });
  });

  it("an authentication failure and a transport failure are not retried either", async () => {
    const auth = fakeFetch([{ status: 403, body: "Code: 516. DB::Exception: ro: Authentication failed" }]);
    const ca = client(auth.impl);
    await expect(ca.query(Q)).rejects.toThrow(/clickhouse HTTP 403/);
    expect(auth.calls).toHaveLength(1);

    // a network error carries no status, so it can never be mistaken for the profile refusal
    const net = fakeFetch([new Error("fetch failed: ECONNRESET readonly mode Code: 164")]);
    const cn = client(net.impl);
    await expect(cn.query(Q)).rejects.toThrow(/clickhouse request failed/);
    expect(net.calls).toHaveLength(1);
    expect(cn.access().settingsMode).toBe("request-readonly");
  });

  it("isProfileReadonlyError matches only ClickHouse's 164-in-readonly-mode HTTP answer", () => {
    expect(isProfileReadonlyError(new ClickHouseError("clickhouse HTTP 500: x", 500, READONLY_164))).toBe(true);
    // the message alone is enough when the body was truncated away
    expect(isProfileReadonlyError(new ClickHouseError(`clickhouse HTTP 500: ${READONLY_164}`, 500))).toBe(true);
    expect(isProfileReadonlyError(new ClickHouseError("clickhouse HTTP 500: Code: 241 memory", 500, "Code: 241"))).toBe(false);
    expect(isProfileReadonlyError(new ClickHouseError("clickhouse HTTP 500: Code: 164 quota", 500, "Code: 164 something else"))).toBe(false);
    expect(isProfileReadonlyError(new ClickHouseError("clickhouse request failed: timeout"))).toBe(false);
    expect(isProfileReadonlyError(new Error(READONLY_164))).toBe(false);
  });
});
