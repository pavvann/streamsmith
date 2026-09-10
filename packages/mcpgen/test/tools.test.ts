import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Guardian } from "../runtime/guardian.ts";
import { runDataTool, runPipelineStatus } from "../runtime/tools.ts";
import type { Manifest } from "../runtime/types.ts";
import { FakeChainHead, FakeClickHouse, GENERATED_DIR, liveColumnsFromManifest, readFixtureReceipt, type FakeWorld } from "./helpers.ts";

const manifest = JSON.parse(readFileSync(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest;
const tool = (n: string) => manifest.tools.find((t) => t.name === n)!;

async function setup(over: Partial<FakeWorld> = {}, chain = new FakeChainHead(51_093_100)) {
  const w: FakeWorld = { columns: liveColumnsFromManifest(manifest), headBlock: 51_093_000, headTimestamp: 1_788_975_347, counts: {}, rows: [], ...over };
  const ch = new FakeClickHouse(w);
  const g = new Guardian({ manifest, readReceipt: async () => readFixtureReceipt(), clickhouse: ch, chainHead: chain, database: "vaultflows", maxLagBlocks: 300, checkIntervalMs: 60_000 });
  await g.check();
  ch.calls = [];
  return { ctx: { guardian: g, clickhouse: ch }, ch, w };
}

describe("generated tool handlers", () => {
  it("recent_share_migration answers unavailable when share_transfers is empty, with provenance", async () => {
    const { ctx, ch } = await setup({ counts: { share_transfers: 0 } });
    const r = await runDataTool(ctx, tool("recent_share_migration"), { limit: 5 });
    expect(r.isError).toBe(false);
    expect(r.payload).toMatchObject({ unavailable: true, reason: "share_transfers not populated in v0.1.0", tool: "recent_share_migration", source: "share_transfers" });
    expect((r.payload.provenance as { headBlock: number }).headBlock).toBe(51_093_000);
    expect(ch.calls.map((c) => c.sql)).toEqual(["SELECT count() AS c FROM share_transfers WHERE _deleted_ = 0"]);
  });

  it("recent_share_migration returns rows once the table is populated", async () => {
    const rows = [{ id: "8453-1-1", vault: manifest.vaults[0], from_owner: "0xa", to_owner: "0xb", shares_raw: "1" }];
    const { ctx } = await setup({ counts: { share_transfers: 1 }, rows });
    const r = await runDataTool(ctx, tool("recent_share_migration"), {});
    expect(r.payload.unavailable).toBeUndefined();
    expect(r.payload.rows).toEqual(rows);
  });

  it("vault_flows success carries rows, effective arguments and full provenance with the observed window", async () => {
    const rows = [{ id: "8453-51092263-406", vault: manifest.vaults[0], direction: "deposit" }];
    const { ctx, ch } = await setup({ rows });
    const r = await runDataTool(ctx, tool("vault_flows"), { vault: manifest.vaults[0], windowHours: 48, limit: 10 });
    expect(r.isError).toBe(false);
    expect(r.payload).toMatchObject({ tool: "vault_flows", source: "vault_flows", rowCount: 1, truncated: false, rows, arguments: { vault: manifest.vaults[0], direction: null, windowHours: 48, limit: 10 } });
    const p = r.payload.provenance as Record<string, unknown>;
    for (const k of ["packageHash", "outputModuleHash", "parametersHash", "deploymentMode", "deploymentId", "headBlock", "lagBlocks", "observedWindow", "checkedAt"]) expect(p[k], k).not.toBeUndefined();
    expect(p.observedWindow).toEqual({
      hours: 48, column: "block_timestamp", source: "vault_flows",
      observedFromTimestamp: 1_788_975_347 - 7 * 86400, observedToTimestamp: 1_788_975_347,
      startTimestamp: 1_788_975_347 - 48 * 3600, endTimestamp: 1_788_975_347,
    });
    expect(p.lagBlocks).toBe(100);
    // window-bounds query (min/max over live rows) then the data query; both parameterized
    expect(ch.calls.length).toBe(2);
    expect(ch.calls[0]!.sql).toBe("SELECT toUInt64(min(block_timestamp)) AS window_start, toUInt64(max(block_timestamp)) AS window_end, count() AS n FROM vault_flows WHERE _deleted_ = 0");
    expect(ch.calls[1]!.params).toEqual({ vault: manifest.vaults[0], windowHours: "48", limit: "10" });
  });

  it("the whole observed window (no windowHours) spans min..max of the data, and an empty table produces nulls", async () => {
    const { ctx } = await setup({ rows: [], counts: { share_value_observations: 5 } });
    const r = await runDataTool(ctx, tool("share_value_growth"), {});
    const w = (r.payload.provenance as { observedWindow: Record<string, unknown> }).observedWindow;
    expect(w).toMatchObject({ hours: null, source: "share_value_observations", startTimestamp: 1_788_975_347 - 7 * 86400, endTimestamp: 1_788_975_347 });
    const { ctx: ctx2 } = await setup({ rows: [], counts: { share_value_observations: 0 } });
    const r2 = await runDataTool(ctx2, tool("share_value_growth"), { windowHours: 24 });
    expect((r2.payload.provenance as { observedWindow: Record<string, unknown> }).observedWindow).toMatchObject({ hours: 24, observedFromTimestamp: null, observedToTimestamp: null, startTimestamp: null, endTimestamp: null });
  });

  it("truncated is reported when the page is full", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i) }));
    const { ctx } = await setup({ rows });
    const r = await runDataTool(ctx, tool("share_value_observations"), { limit: 3 });
    expect(r.payload.truncated).toBe(true);
  });

  it("every data tool refuses while the deployment is stale, and issues no data query", async () => {
    const { ctx, ch } = await setup({ headBlock: 1 }, new FakeChainHead(100_000));
    for (const t of manifest.tools.filter((x) => x.kind !== "status")) {
      const r = await runDataTool(ctx, t, {});
      expect(r.isError, t.name).toBe(true);
      expect(r.payload).toMatchObject({ refused: true, reason: "stale_data", tool: t.name });
      expect((r.payload.provenance as { lagBlocks: number }).lagBlocks).toBe(99_999);
    }
    expect(ch.calls.length).toBe(0);
  });

  it("every data tool refuses on schema mismatch with expected and actual", async () => {
    const { ctx } = await setup();
    ctx.guardian.lastState!.schema = null;
    (ctx.clickhouse as FakeClickHouse).world.columns.vault_flows = [];
    await ctx.guardian.check();
    const r = await runDataTool(ctx, tool("share_value_growth"), {});
    expect(r.payload).toMatchObject({ refused: true, reason: "schema_mismatch" });
    expect(r.payload.expected).toBeDefined();
    expect(r.payload.actual).toBeDefined();
  });

  it("an out-of-set vault that bypasses zod is still rejected before any SQL runs", async () => {
    const { ctx, ch } = await setup();
    const r = await runDataTool(ctx, tool("vault_flows"), { vault: "0x" + "1".repeat(40) });
    expect(r.isError).toBe(true);
    expect(r.payload).toMatchObject({ error: true, reason: "invalid_arguments" });
    expect(ch.calls.length).toBe(0);
  });

  it("a ClickHouse failure during the query is reported as query_failed, not as data", async () => {
    const { ctx, w } = await setup();
    w.failClickhouse = "HTTP 500: Code: 60. DB::Exception: Table vaultflows.vault_flows does not exist";
    const r = await runDataTool(ctx, tool("vault_flows"), {});
    expect(r.isError).toBe(true);
    expect(r.payload).toMatchObject({ error: true, reason: "query_failed" });
  });

  it("pipeline_status reports the verdict, live head/lag, schema check and policy", async () => {
    const { ctx } = await setup();
    const r = await runPipelineStatus(ctx);
    expect(r.isError).toBe(false);
    expect(r.payload).toMatchObject({
      tool: "pipeline_status", ok: true, refused: false, reason: null,
      live: { headBlock: 51_093_000, chainHead: 51_093_100, chainId: 8453, lagBlocks: 100 },
      schema: { ok: true, expectedColumnSetHash: manifest.expectedSchema.columnSetHash },
      policy: { maxLagBlocks: 300, checkIntervalSeconds: 60, queryTimeoutMs: 10_000, maxLimit: 500 },
      vaults: manifest.vaults,
    });
    expect((r.payload.receipt as { matchesManifest: boolean }).matchesManifest).toBe(true);
    expect(r.payload.tools).toEqual(manifest.tools.map((t) => t.name));
  });

  it("pipeline_status does not refuse but states the reason when the pipeline is stale", async () => {
    const { ctx } = await setup({ headBlock: 1 }, new FakeChainHead(5000));
    const r = await runPipelineStatus(ctx);
    expect(r.isError).toBe(false);
    expect(r.payload).toMatchObject({ ok: false, refused: true, reason: "stale_data" });
  });
});
