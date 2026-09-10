import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PortalClient, field } from "../src/deploy/portal.ts";
import { deployHosted, AwaitingSecretError, summarizeState, isSettled } from "../src/deploy/hosted.ts";
import { buildSinkCommand, parseDsn } from "../src/deploy/selfManaged.ts";
import { chMaxBlock, chDumpSchema, redactUrl, clickhouseHttpUrl, clickhouseDatabase } from "../src/deploy/clickhouse.ts";
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
    expect(args).toEqual(["from-proto", "clickhouse://sink:sinkpass@localhost:9000/vaultflows", "erc4626-flows-v0.1.0.spkg", "map_events", "-e", "base-mainnet.streamingfast.io:443", "--network", "base", "-s", "51001200", "--clickhouse-cursor-file-path", "runs/r/cursor.txt"]);
    const cli = buildSinkCommand({ runId: "r", streamsmith: ss, dsn: "d", spkg: "s", endpoint: "e", flavor: "substreams-cli", stopBlock: 5 });
    expect(cli.cmd).toBe("substreams");
    expect(cli.args.slice(0, 2)).toEqual(["sink", "clickhouse"]);
    expect(cli.args).toContain("--cursor-file-path");
    expect(parseDsn("clickhouse://sink:sinkpass@localhost:9000/vaultflows")).toEqual({ host: "localhost", port: 9000, database: "vaultflows", user: "sink" });
    expect(redactUrl("http://ro:ropass@localhost:8123/?database=vaultflows")).not.toContain("ropass");
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
});
