import { describe, it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PortalClient, PortalError, field, isUnauthenticated } from "../src/deploy/portal.ts";
import { deployHosted, AwaitingSecretError, summarizeState, isSettled } from "../src/deploy/hosted.ts";
import { buildSinkCommand, parseDsn, startSelfManaged, selfManagedStatus } from "../src/deploy/selfManaged.ts";
import { chQuery, chMaxBlock, chRowCounts, chDumpSchema, redactUrl, clickhouseHttpUrl, clickhouseDatabase } from "../src/deploy/clickhouse.ts";
import { splitSqlStatements, applyViews } from "../src/deploy/views.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { ethBlockNumber } from "../src/deploy/rpc.ts";
import { loadStreamsmithConfig } from "../src/config/streamsmith.ts";
import { createCtx } from "../src/util/ctx.ts";
import { makeTempRepo, REPO_ROOT } from "./helpers.ts";

const ss = await loadStreamsmithConfig(join(REPO_ROOT, "specs", "streamsmith.yaml"));

function fakeFetch(handler: (url: string, body: unknown) => unknown | { __status: number; body: string }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const f = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const res = handler(url, body) as { __status?: number; body?: string } | unknown;
    if (res && typeof res === "object" && "__status" in (res as object)) {
      const r = res as { __status: number; body: string };
      return new Response(r.body, { status: r.__status });
    }
    return new Response(typeof res === "string" ? res : JSON.stringify(res), { status: 200 });
  };
  return { fetch: f, calls };
}

describe("Portal client", () => {
  it("builds the sink_sql Deploy body per facts (e)", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" }, log: () => {} });
    const p = new PortalClient(ctx);
    const body = p.buildSinkSqlDeployBody({ deploymentId: "dep", name: "n", spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", network: "base", startBlock: 49276800, outputModule: "map_events", moduleOutputType: "proto:vaultflows.v1.Events", parameters: "vaults[]=0x1", clickhouse: { server: "x", port: 9440, user: "default", database: "default", secure: true } });
    expect(body).toMatchObject({ deployment_id: "dep", organization_id: "org", use_stored_secret: true, deployment_request: { sink_sql_deployment: { spkg: { url: expect.stringContaining("api.substreams.dev") }, network: "base", replica: 1, execution_config: { start_block: 49276800, output_module: "map_events", module_output_type: "proto:vaultflows.v1.Events", parameters: "vaults[]=0x1" }, outputConfig: { clickhouse: { server: "x", port: 9440, secure: true } } } } });
    expect(JSON.stringify(body)).not.toContain("password");
  });
  it("reads camelCase responses and coerces int64 strings", () => {
    expect(field({ deploymentId: "x" }, "deployment_id")).toBe("x");
    expect(field({ deployment_id: "y" }, "deployment_id")).toBe("y");
    const s = summarizeState({ success: true, deploymentState: "DEPLOYMENT_STATE_DEPLOYED", executionStates: [{ state: "STATE_LIVE", currentBlock: 100, headBlock: 105, headBlockTimeDrift: 9 }], raw: {} });
    expect(s).toEqual({ state: "DEPLOYMENT_STATE_DEPLOYED/STATE_LIVE", headBlock: 100, chainHead: 105, lagBlocks: 5, lagSeconds: 9 });
    expect(isSettled({ success: true, deploymentState: "DEPLOYMENT_STATE_DEPLOYED", executionStates: [{ state: "STATE_LIVE" }], raw: {} })).toBe("live");
    expect(isSettled({ success: true, crashloopbackoff: true, executionStates: [], raw: {} })).toBe("error");
    expect(isSettled({ success: true, deploymentState: "DEPLOYMENT_STATE_DEPLOYING", executionStates: [], raw: {} })).toBe("pending");
  });
  it("requires PORTAL_TOKEN / PORTAL_ORG_ID", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, env: {}, log: () => {} });
    await expect(new PortalClient(ctx).createDeployment()).rejects.toThrow(/PORTAL_TOKEN/);
  });
});

describe("deployHosted", () => {
  it("stops with the secret URL when the password is not staged (exit 40 path)", async () => {
    const repo = await makeTempRepo();
    try {
      const ff = fakeFetch((url) => (url.endsWith("/CreateDeployment") ? { deploymentId: "dep-1" } : url.endsWith("/HasDeploymentSecret") ? { exists: false } : {}));
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" } };
      await expect(deployHosted(ctx, { runId: "d1", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", clickhouse: { server: "x", port: 9440, user: "default", database: "default", secure: true } })).rejects.toBeInstanceOf(AwaitingSecretError);
      const rec = JSON.parse(await readFile(join(repo.root, "runs", "d1", "deploy.json"), "utf8"));
      expect(rec).toMatchObject({ deploymentMode: "graph-market-hosted", deploymentId: "dep-1", state: "awaiting_secret" });
      expect(ff.calls.map((c) => c.url.split("/").pop())).toEqual(["CreateDeployment", "HasDeploymentSecret"]);
    } finally {
      await repo.cleanup();
    }
  });
  it("deploys, retries a cold DB, polls to LIVE and records head/lag", async () => {
    const repo = await makeTempRepo();
    try {
      let deployCalls = 0;
      let polls = 0;
      const ff = fakeFetch((url) => {
        const m = url.split("/").pop();
        if (m === "HasDeploymentSecret") return { exists: true };
        if (m === "Deploy") return ++deployCalls === 1 ? { __status: 500, body: "dial tcp: i/o timeout" } : "";
        if (m === "GetDeploymentState") return ++polls === 1
          ? { success: true, deploymentState: { deploymentState: "DEPLOYMENT_STATE_DEPLOYING", executionStates: [] } }
          : { success: true, deploymentState: { deploymentState: "DEPLOYMENT_STATE_DEPLOYED", replica: "1", readyReplicas: "1", executionStates: [{ podName: "p-0", state: "STATE_LIVE", currentBlock: "51100000", headBlock: "51100012", headBlockTimeDrift: 24.5 }] } };
        return {};
      });
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" } };
      const r = await deployHosted(ctx, { runId: "d2", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", deploymentId: "dep-2", packageHash: "ab", clickhouse: { server: "x", port: 9440, user: "default", database: "default", secure: true } });
      expect(deployCalls).toBe(2);
      expect(r.record).toMatchObject({ deploymentId: "dep-2", headBlock: 51100000, chainHead: 51100012, lagBlocks: 12, lagSeconds: 24, state: "DEPLOYMENT_STATE_DEPLOYED/STATE_LIVE", packageHash: "ab" });
      expect(r.record.sink?.hostFingerprint).toHaveLength(64);
      expect(ff.calls.map((c) => c.url.split("/").pop())).not.toContain("CreateDeployment");
    } finally {
      await repo.cleanup();
    }
  });
});

describe("self-managed sink", () => {
  it("builds the from-proto command and parses the DSN without leaking secrets", () => {
    const { cmd, args } = buildSinkCommand({ runId: "r", streamsmith: ss, dsn: "clickhouse://sink:sinkpass@localhost:9000/vaultflows", spkg: "erc4626-flows-v0.1.0.spkg", endpoint: "base-mainnet.streamingfast.io:443", cursorFile: "runs/r/cursor.txt" });
    expect(cmd).toBe("substreams-sink-sql");
    // --final-blocks-only defaults on (a bounded run does not flush its tail batch otherwise, sink-spike.md §6)
    expect(args).toEqual(["from-proto", "clickhouse://sink:sinkpass@localhost:9000/vaultflows", "erc4626-flows-v0.1.0.spkg", "map_events", "-e", "base-mainnet.streamingfast.io:443", "--network", "base", "-s", "51001200", "--final-blocks-only", "--clickhouse-cursor-file-path", "runs/r/cursor.txt"]);
    const cli = buildSinkCommand({ runId: "r", streamsmith: ss, dsn: "d", spkg: "s", endpoint: "e", flavor: "substreams-cli", stopBlock: 5 });
    expect(cli.cmd).toBe("substreams");
    expect(cli.args.slice(0, 2)).toEqual(["sink", "clickhouse"]);
    expect(cli.args).toContain("--cursor-file-path");
    expect(parseDsn("clickhouse://sink:sinkpass@localhost:9000/vaultflows")).toEqual({ host: "localhost", port: 9000, database: "vaultflows", user: "sink" });
    expect(redactUrl("http://ro:ropass@localhost:8123/?database=vaultflows")).not.toContain("ropass");
  });

  it("adds --clickhouse-sink-info-folder when given, and --no-final-blocks-only drops --final-blocks-only", () => {
    const withFolder = buildSinkCommand({ runId: "r", streamsmith: ss, dsn: "d", spkg: "s", endpoint: "e", cursorFile: "c.txt", sinkInfoFolder: "runs/r/sinkinfo" });
    expect(withFolder.args).toEqual(["from-proto", "d", "s", "map_events", "-e", "e", "--network", "base", "-s", "51001200", "--final-blocks-only", "--clickhouse-cursor-file-path", "c.txt", "--clickhouse-sink-info-folder", "runs/r/sinkinfo"]);
    const noFinal = buildSinkCommand({ runId: "r", streamsmith: ss, dsn: "d", spkg: "s", endpoint: "e", cursorFile: "c.txt", finalBlocksOnly: false });
    expect(noFinal.args).not.toContain("--final-blocks-only");
  });

  it("startSelfManaged spawns with a run-scoped sink-info folder and cursor file, and --final-blocks-only by default", async () => {
    const repo = await makeTempRepo();
    try {
      const captured: { cmd?: string; args?: string[] } = {};
      const fakeSpawn = ((cmd: string, args?: readonly string[]) => {
        captured.cmd = cmd;
        captured.args = args ? [...args] : [];
        return { pid: 4321, unref: () => {} } as unknown as ReturnType<typeof spawn>;
      }) as typeof spawn;
      const r = await startSelfManaged(repo.ctx, { runId: "sm1", streamsmith: ss, dsn: "clickhouse://sink:pw@localhost:9000/vaultflows", spkg: "erc4626-flows-v0.1.0.spkg", endpoint: "e", spawnImpl: fakeSpawn });
      expect(captured.cmd).toBe("substreams-sink-sql");
      const a = captured.args!;
      expect(a).toContain("--final-blocks-only");
      const cursorIdx = a.indexOf("--clickhouse-cursor-file-path");
      expect(a[cursorIdx + 1]).toBe(join(repo.root, "runs", "sm1", "clickhouse-cursor.txt"));
      const folderIdx = a.indexOf("--clickhouse-sink-info-folder");
      expect(folderIdx).toBeGreaterThan(-1);
      const sinkInfoFolder = a[folderIdx + 1]!;
      expect(sinkInfoFolder).toBe(join(repo.root, "runs", "sm1", "sinkinfo"));
      // the folder is pre-created so the sink does not fail on a missing directory
      expect(await access(sinkInfoFolder).then(() => true, () => false)).toBe(true);
      expect(r.record.command).not.toContain("pw");
    } finally {
      await repo.cleanup();
    }
  });

  it("startSelfManaged: --no-final-blocks-only (finalBlocksOnly: false) omits the flag", async () => {
    const repo = await makeTempRepo();
    try {
      const captured: { args?: string[] } = {};
      const fakeSpawn = ((cmd: string, args?: readonly string[]) => {
        captured.args = args ? [...args] : [];
        return { pid: 4322, unref: () => {} } as unknown as ReturnType<typeof spawn>;
      }) as typeof spawn;
      await startSelfManaged(repo.ctx, { runId: "sm2", streamsmith: ss, dsn: "clickhouse://sink:pw@localhost:9000/vaultflows", spkg: "erc4626-flows-v0.1.0.spkg", endpoint: "e", finalBlocksOnly: false, spawnImpl: fakeSpawn });
      expect(captured.args).not.toContain("--final-blocks-only");
    } finally {
      await repo.cleanup();
    }
  });
  it("computes head from ClickHouse and chain head from eth_blockNumber", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, fetch: async (url, init) => {
      const body = String(init?.body ?? "");
      if (url.startsWith("https://rpc")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x30bd6f0" }));
      if (body.startsWith("SHOW CREATE TABLE")) return new Response("CREATE TABLE default.vault_flows\\n(\\n    `id` String\\n)\\nENGINE = ReplacingMergeTree(_version_, _deleted_)");
      if (body.includes("vault_flows")) return new Response("51100000\n");
      if (body.includes("vaults")) return new Response("\\N\n");
      return new Response("51099000\n");
    } });
    expect(await ethBlockNumber(ctx, "https://rpc.example")).toBe(51107568);
    const m = await chMaxBlock(ctx, "http://ro:ropass@localhost:8123/", "default", ["vault_flows", "share_value_observations", "vaults"]);
    expect(m).toEqual({ maxBlock: 51100000, perTable: { vault_flows: 51100000, share_value_observations: 51099000, vaults: null } });
    const sql = await chDumpSchema(ctx, "http://ro:ropass@localhost:8123/", "default", ["vault_flows"]);
    expect(sql).toContain("-- default.vault_flows\nCREATE TABLE default.vault_flows\n(");
    expect(sql.endsWith(";\n")).toBe(true);
  });

  it("selfManagedStatus works with no deploy.json when --clickhouse-url is given: head from _blocks_, chain head from RPC, lag, row counts", async () => {
    const repo = await makeTempRepo();
    try {
      const fetch = async (url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (url.startsWith("https://rpc")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x30bb975" })); // 51100021
        if (body.includes("_blocks_") && body.includes("max(number)")) return new Response("51100000\n");
        if (body.startsWith("SELECT count()")) return new Response("171\n");
        return new Response("");
      };
      const ctx = { ...repo.ctx, fetch };
      const rec = await selfManagedStatus(ctx, { runId: "cold-1", streamsmith: ss, clickhouseUrl: "http://ro:ropass@localhost:8123/", rpcUrl: "https://rpc.example", database: "vaultflows" });
      expect(rec.deploymentMode).toBe("self-managed-sink");
      expect(rec.headBlock).toBe(51100000);
      expect(rec.chainHead).toBe(51100021);
      expect(rec.lagBlocks).toBe(21);
      expect(rec.rowCounts).toBeDefined();
      expect(Object.keys(rec.rowCounts!)).toContain("_blocks_");
      expect(rec.rowCounts!["vault_flows"]).toBe(171);
      const written = JSON.parse(await readFile(join(repo.root, "runs", "cold-1", "deploy.json"), "utf8"));
      expect(written.headBlock).toBe(51100000);
    } finally {
      await repo.cleanup();
    }
  });

  it("selfManagedStatus throws a clear error with no deploy.json and no --clickhouse-url", async () => {
    const repo = await makeTempRepo();
    try {
      await expect(selfManagedStatus(repo.ctx, { runId: "cold-2", streamsmith: ss })).rejects.toThrow(/no deploy\.json for run cold-2/);
    } finally {
      await repo.cleanup();
    }
  });

  // A12: `deploy status` against ClickHouse Cloud failed with "Unexpected end of JSON input" (--json) / "Unexpected
  // token 's', \"streamsmit\"... is not valid JSON" (without --json). Root cause: a pre-existing 0-byte (or
  // otherwise corrupted) runs/<id>/deploy.json was fed straight into JSON.parse with no guard and no context —
  // `readJson` named neither the file nor the run, and `selfManagedStatus` had no fallback even though it already
  // supports running with NO deploy.json at all when --clickhouse-url is given. Fix: read leniently, degrade a
  // corrupt file the same way a missing one degrades (recompute from ClickHouse + RPC) when possible, otherwise
  // throw an error that names the file and the JSON error instead of a bare native message.
  it("selfManagedStatus: an empty deploy.json (the exact A12 repro artifact) degrades to recompute-from-ClickHouse instead of crashing", async () => {
    const repo = await makeTempRepo();
    try {
      await mkdir(join(repo.root, "runs", "corrupt-1"), { recursive: true });
      await writeFile(join(repo.root, "runs", "corrupt-1", "deploy.json"), "");
      const fetch = async (url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (url.startsWith("https://rpc")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
        if (body.includes("_blocks_") && body.includes("max(number)")) return new Response("100\n");
        if (body.startsWith("SELECT count()")) return new Response("5\n");
        return new Response("");
      };
      const ctx = { ...repo.ctx, fetch };
      const rec = await selfManagedStatus(ctx, { runId: "corrupt-1", streamsmith: ss, clickhouseUrl: "http://ro:ropass@localhost:8123/", rpcUrl: "https://rpc.example", database: "vaultflows" });
      expect(rec.headBlock).toBe(100);
      expect(rec.chainHead).toBe(1);
      expect(rec.notes?.some((n) => n.includes("ignoring unreadable deploy.json"))).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it("selfManagedStatus: an empty deploy.json with no --clickhouse-url throws a clear error naming the file, not a bare JSON.parse message", async () => {
    const repo = await makeTempRepo();
    try {
      await mkdir(join(repo.root, "runs", "corrupt-2"), { recursive: true });
      await writeFile(join(repo.root, "runs", "corrupt-2", "deploy.json"), "");
      await expect(selfManagedStatus(repo.ctx, { runId: "corrupt-2", streamsmith: ss })).rejects.toThrow(/invalid JSON in .*corrupt-2.*deploy\.json \(empty file\)/);
    } finally {
      await repo.cleanup();
    }
  });

  it("selfManagedStatus: garbage (non-empty) deploy.json content — e.g. our own stderr text redirected into the file — is also named, not a raw parse crash", async () => {
    const repo = await makeTempRepo();
    try {
      await mkdir(join(repo.root, "runs", "corrupt-3"), { recursive: true });
      await writeFile(join(repo.root, "runs", "corrupt-3", "deploy.json"), "streamsmith: Unexpected end of JSON input\n");
      await expect(selfManagedStatus(repo.ctx, { runId: "corrupt-3", streamsmith: ss })).rejects.toThrow(/invalid JSON in .*corrupt-3.*deploy\.json/);
    } finally {
      await repo.cleanup();
    }
  });

  // A12, second bug on the same repro path: `clickhouseDatabase()` is the one place CLICKHOUSE_DATABASE/
  // CLICKHOUSE_DB are read from the environment, but selfManagedStatus's database resolution bypassed it — so
  // the documented repro (CLICKHOUSE_DATABASE=vaultflows, no --database) silently queried `default` instead and
  // returned all-null rows/head against ClickHouse Cloud (verified live).
  it("selfManagedStatus: CLICKHOUSE_DATABASE from the environment is honored with no --database flag", async () => {
    const repo = await makeTempRepo();
    try {
      const bodies: string[] = [];
      const fetch = async (url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        bodies.push(body);
        if (url.startsWith("https://rpc")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
        if (body.includes("_blocks_")) return new Response("1\n");
        return new Response("0\n");
      };
      const ctx = { ...repo.ctx, fetch, env: { ...repo.ctx.env, CLICKHOUSE_DATABASE: "vaultflows" } };
      await selfManagedStatus(ctx, { runId: "env-db-1", streamsmith: ss, clickhouseUrl: "http://ro:ropass@localhost:8123/", rpcUrl: "https://rpc.example" });
      expect(bodies.some((b) => b.includes("`vaultflows`.`_blocks_`"))).toBe(true);
      expect(bodies.some((b) => b.includes("`default`."))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("chQuery: clear errors instead of JSON parse failures (A12)", () => {
  it("a non-JSON text error body produces an error naming the query and the HTTP status, not a JSON parse error", async () => {
    const fetch = async () => new Response("Code: 60. DB::Exception: Unknown table expression identifier 'default._blocks_'", { status: 404 });
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, fetch });
    await expect(chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT max(number) FROM default._blocks_ WHERE deleted = 0")).rejects.toThrow(/ClickHouse HTTP 404/);
    await expect(chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT max(number) FROM default._blocks_ WHERE deleted = 0")).rejects.toThrow(/SELECT max\(number\)/);
    await expect(chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT max(number) FROM default._blocks_ WHERE deleted = 0")).rejects.toThrow(/Unknown table expression identifier/);
  });

  it("a non-OK empty response body is named as empty, never handed to a JSON parser", async () => {
    const fetch = async () => new Response("", { status: 500 });
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, fetch });
    await expect(chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT 1")).rejects.toThrow(/ClickHouse HTTP 500/);
    await expect(chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT 1")).rejects.toThrow(/\(empty response body\)/);
  });

  it("a valid FORMAT JSON response round-trips through chQuery unchanged (the format curl verified against ClickHouse Cloud)", async () => {
    const bodies: string[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ data: [{ "max(number)": "51100000" }] }), { status: 200 });
    };
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, fetch });
    const text = await chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT max(number) FROM t", "JSON");
    expect(bodies[0]).toBe("SELECT max(number) FROM t FORMAT JSON");
    expect(JSON.parse(text)).toMatchObject({ data: [{ "max(number)": "51100000" }] });
  });

  it("chRowCounts: an empty response body is a null count, not 0 (Number('') === 0 is not a row count)", async () => {
    const fetch = async () => new Response("", { status: 200 });
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, fetch });
    expect(await chRowCounts(ctx, "http://ro:ropass@localhost:8123/", "default", ["vault_flows"])).toEqual({ vault_flows: null });
  });

  it("--verbose logs the request URL/body and the response status + first 200 bytes, with credentials always redacted", async () => {
    const logs: string[] = [];
    const fetch = async () => new Response("51100000\n", { status: 200 });
    const ctx = await createCtx({ root: REPO_ROOT, log: (l) => logs.push(l), fetch });
    await chQuery(ctx, "http://ro:ropass@localhost:8123/", "SELECT max(number) FROM t", undefined, undefined, true);
    expect(logs.some((l) => l.includes("POST") && l.includes("SELECT max(number) FROM t"))).toBe(true);
    expect(logs.some((l) => l.includes("HTTP 200") && l.includes("51100000"))).toBe(true);
    expect(logs.every((l) => !l.includes("ropass"))).toBe(true);
  });
});

describe("views after deploy (packages/erc4626-flows/sql/views.sql, optional)", () => {
  it("splits SQL on ';' outside string literals and drops -- comments", () => {
    const sql = "-- header; not a statement\nCREATE VIEW a AS SELECT 'x;y' AS s, 1 -- trailing; comment\nFROM t;\n\nCREATE VIEW b AS SELECT 2;;\n";
    expect(splitSqlStatements(sql)).toEqual(["CREATE VIEW a AS SELECT 'x;y' AS s, 1 \nFROM t", "CREATE VIEW b AS SELECT 2"]);
    expect(splitSqlStatements("-- only comments\n")).toEqual([]);
  });

  it("clickhouseHttpUrl merges CLICKHOUSE_USER/PASSWORD into CLICKHOUSE_URL; clickhouseDatabase has a precedence", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {}, env: { CLICKHOUSE_URL: "https://ch.example:8443/", CLICKHOUSE_USER: "ro", CLICKHOUSE_PASSWORD: "p@ss", CLICKHOUSE_DATABASE: "vaultflows" } });
    expect(clickhouseHttpUrl(ctx)).toBe("https://ro:p%40ss@ch.example:8443/");
    expect(clickhouseHttpUrl(ctx, "http://u:p@localhost:8123/")).toBe("http://u:p@localhost:8123/");
    expect(clickhouseDatabase(ctx)).toBe("vaultflows");
    expect(clickhouseDatabase(ctx, "explicit")).toBe("explicit");
    const bare = await createCtx({ root: REPO_ROOT, log: () => {}, env: {} });
    expect(clickhouseHttpUrl(bare)).toBeUndefined();
    expect(clickhouseDatabase(bare, undefined, "fromSpec")).toBe("fromSpec");
  });

  it("applyViews: skips when the file is absent, waits for the base tables, then runs each statement over HTTP", async () => {
    const repo = await makeTempRepo();
    try {
      const bodies: string[] = [];
      const urls: string[] = [];
      let tablesPresent = false;
      const fetch = async (url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        bodies.push(body);
        urls.push(url);
        if (body.includes("system.tables") && body.includes("name IN")) return new Response(tablesPresent ? "vault_flows\nshare_value_observations\nvaults\nshare_transfers\n" : "vault_flows\n");
        if (body.includes("engine IN ('View'")) return new Response("share_value_growth\nvault_flows_24h\n");
        return new Response("");
      };
      const ctx = { ...repo.ctx, fetch };
      const tables = ["vault_flows", "share_value_observations", "vaults", "share_transfers"];
      const absent = await applyViews(ctx, { url: "http://localhost:8123/", database: "default", requiredTables: tables });
      expect(absent).toMatchObject({ present: false, statements: 0, applied: [], views: [] });
      expect(absent.skipped).toMatch(/views.sql does not exist \(optional/);
      expect(bodies).toEqual([]);
      const dir = join(repo.root, "packages", "erc4626-flows", "sql");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "views.sql"), "-- views\nCREATE OR REPLACE VIEW vault_flows_24h AS SELECT vault FROM vault_flows WHERE _deleted_ = 0;\nCREATE OR REPLACE VIEW share_value_growth AS SELECT vault FROM share_value_observations WHERE _deleted_ = 0 AND call_ok = 1;\n");
      const missing = await applyViews(ctx, { url: "http://localhost:8123/", database: "default", requiredTables: tables, waitSeconds: 0 });
      expect(missing.present).toBe(true);
      expect(missing.statements).toBe(2);
      expect(missing.skipped).toMatch(/base tables missing in default: share_value_observations, vaults, share_transfers/);
      expect(missing.applied).toEqual([]);
      tablesPresent = true;
      bodies.length = 0;
      urls.length = 0;
      const ok = await applyViews(ctx, { url: "http://localhost:8123/", database: "default", requiredTables: tables, waitSeconds: 30 });
      expect(ok.skipped).toBeUndefined();
      expect(ok.applied).toEqual(["CREATE OR REPLACE VIEW vault_flows_24h AS SELECT vault FROM vault_flows WHERE _deleted_ = 0", "CREATE OR REPLACE VIEW share_value_growth AS SELECT vault FROM share_value_observations WHERE _deleted_ = 0 AND call_ok = 1"]);
      expect(ok.views).toEqual(["share_value_growth", "vault_flows_24h"]);
      expect(ok.sha256).toHaveLength(64);
      expect(bodies.filter((b) => b.startsWith("CREATE OR REPLACE VIEW"))).toHaveLength(2);
      // the DDL body uses unqualified table names, so the session database has to travel with the request —
      // without it ClickHouse resolves them against `default` and the views land in the wrong database
      expect(urls.filter((_, i) => bodies[i]!.startsWith("CREATE OR REPLACE VIEW"))).toEqual(["http://localhost:8123/?database=default", "http://localhost:8123/?database=default"]);
      expect(bodies[0]).toMatch(/SELECT name FROM system.tables WHERE database = 'default' AND name IN \('vault_flows', 'share_value_observations', 'vaults', 'share_transfers'\)/);
    } finally {
      await repo.cleanup();
    }
  });

  it("--views explicit: a missing file is a hard error, not \"optional\"; a relative path resolves against ctx.root, never process.cwd()", async () => {
    const repo = await makeTempRepo();
    try {
      expect(repo.root).not.toBe(process.cwd()); // sanity: the real cwd is the package root, not the temp repo
      await expect(applyViews(repo.ctx, { url: "http://localhost:8123/", database: "default", viewsPath: "does/not/exist.sql", viewsPathExplicit: true })).rejects.toThrow(/--views does\/not\/exist\.sql not found/);
      // the default path missing is still "optional" (no --views given) and is skipped, not an error
      const skipped = await applyViews(repo.ctx, { url: "http://localhost:8123/", database: "default" });
      expect(skipped.skipped).toMatch(/optional/);
      // an explicit relative path resolves against ctx.root (repo.root here), not the real process.cwd()
      const dir = join(repo.root, "custom", "sql");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "custom-views.sql"), "CREATE OR REPLACE VIEW v AS SELECT 1;\n");
      const fetch = async (_url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        if (body.includes("engine IN ('View'")) return new Response("v\n");
        return new Response("");
      };
      const ctx = { ...repo.ctx, fetch };
      const rec = await applyViews(ctx, { url: "http://localhost:8123/", database: "default", viewsPath: "custom/sql/custom-views.sql", viewsPathExplicit: true });
      expect(rec.skipped).toBeUndefined();
      expect(rec.applied).toEqual(["CREATE OR REPLACE VIEW v AS SELECT 1"]);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("deployHosted: parameters, --update, and unauthenticated retry (docs/build/sink-spike.md §7)", () => {
  const clickhouse = { server: "x", port: 9440, user: "default", database: "default", secure: true };

  it("omits execution_config.parameters unless --params is passed explicitly, even though streamsmith.yaml carries params.value", async () => {
    const repo = await makeTempRepo();
    try {
      expect(ss.params?.value).toBeTruthy(); // sanity: the config-derived default this bug used to leak
      let execConfig: Record<string, unknown> | undefined;
      const ff = fakeFetch((url, body) => {
        const m = url.split("/").pop();
        if (m === "HasDeploymentSecret") return { exists: true };
        if (m === "Deploy") { execConfig = (body as { deployment_request: { sink_sql_deployment: { execution_config: Record<string, unknown> } } }).deployment_request.sink_sql_deployment.execution_config; return ""; }
        if (m === "GetDeploymentState") return { success: true, deploymentState: { deploymentState: "DEPLOYMENT_STATE_DEPLOYED", executionStates: [{ state: "STATE_LIVE", currentBlock: 1, headBlock: 1 }] } };
        return {};
      });
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" } };
      await deployHosted(ctx, { runId: "d10", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", deploymentId: "dep-10", clickhouse });
      expect(execConfig).not.toHaveProperty("parameters");

      await deployHosted(ctx, { runId: "d11", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", deploymentId: "dep-11", clickhouse, params: "vaults[]=0x1" });
      expect(execConfig).toMatchObject({ parameters: "vaults[]=0x1" });
    } finally {
      await repo.cleanup();
    }
  });

  it("--update calls UpdateDeploymentConfig on the existing --deployment-id instead of Deploy/CreateDeployment", async () => {
    const repo = await makeTempRepo();
    try {
      const calledMethods: string[] = [];
      const ff = fakeFetch((url) => {
        const m = url.split("/").pop()!;
        calledMethods.push(m);
        if (m === "HasDeploymentSecret") return { exists: true };
        if (m === "UpdateDeploymentConfig") return "";
        if (m === "GetDeploymentState") return { success: true, deploymentState: { deploymentState: "DEPLOYMENT_STATE_DEPLOYED", executionStates: [{ state: "STATE_LIVE", currentBlock: 1, headBlock: 1 }] } };
        return {};
      });
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" } };
      const r = await deployHosted(ctx, { runId: "d12", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", deploymentId: "dep-12", clickhouse, update: true });
      expect(calledMethods).not.toContain("CreateDeployment");
      expect(calledMethods).not.toContain("Deploy");
      expect(calledMethods).toContain("UpdateDeploymentConfig");
      expect(r.record.deploymentId).toBe("dep-12");
    } finally {
      await repo.cleanup();
    }
  });

  it("--update requires --deployment-id", async () => {
    const repo = await makeTempRepo();
    try {
      const ctx = { ...repo.ctx, env: { PORTAL_TOKEN: "t", PORTAL_ORG_ID: "org" } };
      await expect(deployHosted(ctx, { runId: "d13", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", clickhouse, update: true })).rejects.toThrow(/--update requires --deployment-id/);
    } finally {
      await repo.cleanup();
    }
  });

  it("retries once via RefreshToken on an unauthenticated response, then succeeds with the new token", async () => {
    const repo = await makeTempRepo();
    try {
      let createCalls = 0;
      const ff = fakeFetch((url) => {
        const m = url.split("/").pop();
        if (m === "CreateDeployment") { createCalls++; return createCalls === 1 ? { __status: 401, body: JSON.stringify({ code: "unauthenticated", message: "token expired" }) } : { deploymentId: "dep-14" }; }
        if (m === "RefreshToken") return { access_token: "new-token", organization_id: "org" };
        if (m === "HasDeploymentSecret") return { exists: true };
        if (m === "Deploy") return "";
        if (m === "GetDeploymentState") return { success: true, deploymentState: { deploymentState: "DEPLOYMENT_STATE_DEPLOYED", executionStates: [{ state: "STATE_LIVE", currentBlock: 1, headBlock: 1 }] } };
        return {};
      });
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "expired", PORTAL_ORG_ID: "org", PORTAL_REFRESH_TOKEN: "refresh-1" } };
      const r = await deployHosted(ctx, { runId: "d15", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", clickhouse });
      expect(createCalls).toBe(2);
      expect(r.record.deploymentId).toBe("dep-14");
      expect(ff.calls.map((c) => c.url.split("/").pop())).toContain("RefreshToken");
    } finally {
      await repo.cleanup();
    }
  });

  it("throws the device-login instruction when unauthenticated and there is no PORTAL_REFRESH_TOKEN", async () => {
    const repo = await makeTempRepo();
    try {
      const ff = fakeFetch((url) => (url.endsWith("/CreateDeployment") ? { __status: 401, body: JSON.stringify({ code: "unauthenticated" }) } : {}));
      const ctx = { ...repo.ctx, fetch: ff.fetch, env: { PORTAL_TOKEN: "expired", PORTAL_ORG_ID: "org" } };
      await expect(deployHosted(ctx, { runId: "d16", streamsmith: ss, spkgUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", clickhouse })).rejects.toThrow(/deploy login/);
    } finally {
      await repo.cleanup();
    }
  });

  it("isUnauthenticated recognizes 401 and the Connect-style unauthenticated code, but not other PortalErrors", () => {
    expect(isUnauthenticated(new PortalError("Deploy failed: HTTP 401 nope", 401, "nope", "Deploy"))).toBe(true);
    expect(isUnauthenticated(new PortalError("Deploy failed: HTTP 403 unauthenticated", 403, '{"code":"unauthenticated"}', "Deploy"))).toBe(true);
    expect(isUnauthenticated(new PortalError("Deploy failed: HTTP 500 boom", 500, "boom", "Deploy"))).toBe(false);
    expect(isUnauthenticated(new Error("network down"))).toBe(false);
  });
});
