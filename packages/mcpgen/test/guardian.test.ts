import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Guardian } from "../runtime/guardian.ts";
import { columnSetHash, diffColumnSets, normalizeType } from "../runtime/schemahash.ts";
import type { Manifest, RuntimeReceipt } from "../runtime/types.ts";
import { FakeChainHead, FakeClickHouse, GENERATED_DIR, liveColumnsFromManifest, readGeneratedReceipt, type FakeWorld } from "./helpers.ts";

const manifest = JSON.parse(readFileSync(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest;

function world(over: Partial<FakeWorld> = {}): FakeWorld {
  return { columns: liveColumnsFromManifest(manifest), headBlock: 51_093_000, headTimestamp: 1_788_975_347, counts: {}, rows: [], ...over };
}

function guardian(w: FakeWorld, opts: { chain?: FakeChainHead; receipt?: RuntimeReceipt; now?: () => Date; maxLag?: number } = {}) {
  const ch = new FakeClickHouse(w);
  const g = new Guardian({
    manifest,
    readReceipt: async () => opts.receipt ?? readGeneratedReceipt(),
    clickhouse: ch,
    chainHead: opts.chain ?? new FakeChainHead(51_093_100),
    database: "vaultflows",
    maxLagBlocks: opts.maxLag ?? 300,
    checkIntervalMs: 60_000,
    now: opts.now,
  });
  return { g, ch };
}

describe("fail-closed guardian", () => {
  it("refuses with check_unavailable before the first verification completed", () => {
    const { g } = guardian(world());
    const r = g.gate()!;
    expect(r.refused).toBe(true);
    expect(r.reason).toBe("check_unavailable");
    expect(r.provenance.packageHash).toBe(manifest.package.packageHash);
    expect(r.provenance.headBlock).toBeNull();
  });

  it("passes when receipt, schema, chain and lag all agree; provenance carries the live numbers", async () => {
    const { g } = guardian(world());
    const s = await g.check();
    expect(s.refusal).toBeNull();
    expect(s.schema!.ok).toBe(true);
    expect(s.schema!.actualHash).toBe(manifest.expectedSchema.columnSetHash);
    expect(s.lagBlocks).toBe(100);
    expect(g.gate()).toBeNull();
    const p = g.provenance({ hours: 24, endTimestamp: 1, startTimestamp: 0, column: "block_timestamp", source: "vault_flows", observedFromTimestamp: 0, observedToTimestamp: 1 });
    expect(p).toMatchObject({
      packageHash: manifest.package.packageHash,
      outputModuleHash: manifest.package.outputModuleHash,
      parametersHash: manifest.receipt.parametersHash,
      deploymentMode: "graph-market-hosted",
      deploymentId: manifest.package.deploymentId, // an id for a hosted deployment, null for a self-managed sink
      headBlock: 51_093_000,
      chainHead: 51_093_100,
      lagBlocks: 100,
      observedWindow: { hours: 24 },
    });
    expect(p.checkedAt).toBe(s.checkedAt.toISOString());
  });

  it("refuses schema_mismatch when a contract column is missing, with expected/actual and a diff", async () => {
    const w = world();
    w.columns.vault_flows = w.columns.vault_flows!.filter((c) => c.name !== "execution_rate");
    const { g } = guardian(w);
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("schema_mismatch");
    expect((r.expected as { columnSetHash: string }).columnSetHash).toBe(manifest.expectedSchema.columnSetHash);
    const actual = r.actual as { columnSetHash: string; diff: { missingColumns: string[] } };
    expect(actual.columnSetHash).not.toBe(manifest.expectedSchema.columnSetHash);
    expect(actual.diff.missingColumns).toEqual(["vault_flows.execution_rate"]);
  });

  it("refuses schema_mismatch on a type change of a contract column, and on an extra column", async () => {
    const w = world();
    w.columns.share_value_observations = w.columns.share_value_observations!.map((c) => (c.name === "assets_per_share_normalized" ? { ...c, type: "Decimal(38, 6)" } : c));
    const { g } = guardian(w);
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("schema_mismatch");
    expect((r.actual as { diff: { typeMismatches: unknown[] } }).diff.typeMismatches).toEqual([{ column: "share_value_observations.assets_per_share_normalized", expected: "Decimal(38, 18)", actual: "Decimal(38, 6)" }]);

    const w2 = world();
    w2.columns.vaults = [...w2.columns.vaults!, { name: "surprise", type: "String" }];
    const { g: g2 } = guardian(w2);
    await g2.check();
    expect((g2.gate()!.actual as { diff: { unexpectedColumns: string[] } }).diff.unexpectedColumns).toEqual(["vaults.surprise"]);
  });

  it("refuses schema_mismatch when an expected table does not exist", async () => {
    const w = world();
    delete w.columns.share_transfers;
    const { g } = guardian(w);
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("schema_mismatch");
    expect((r.actual as { diff: { missingTables: string[] } }).diff.missingTables).toEqual(["share_transfers"]);
  });

  it("injected sink columns are compared by name only (their live types are not pinned by the contract)", async () => {
    const w = world();
    for (const cols of Object.values(w.columns)) for (const c of cols) if (c.name === "_deleted_") c.type = "UInt8";
    const { g } = guardian(w);
    await g.check();
    expect(g.gate()).toBeNull();
    expect(normalizeType("Decimal(38,18)")).toBe(normalizeType("Decimal(38, 18)"));
    expect(columnSetHash({ t: [{ name: "a", type: "Decimal(38,18)" }] })).toBe(columnSetHash({ t: [{ name: "a", type: "Decimal(38, 18)" }] }));
    expect(diffColumnSets({ t: [{ name: "a", type: "*" }] }, { t: [{ name: "a", type: "Anything" }] }).typeMismatches).toEqual([]);
  });

  it("refuses stale_data when the sink lags more than MAX_LAG_BLOCKS", async () => {
    const { g } = guardian(world({ headBlock: 51_090_000 }), { chain: new FakeChainHead(51_093_100) });
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("stale_data");
    expect(r.expected).toEqual({ maxLagBlocks: 300 });
    expect(r.actual).toEqual({ lagBlocks: 3100, headBlock: 51_090_000, chainHead: 51_093_100 });
    expect(r.provenance.lagBlocks).toBe(3100);
  });

  it("lag exactly at the limit passes; one block over refuses", async () => {
    const a = guardian(world({ headBlock: 1000 }), { chain: new FakeChainHead(1300) });
    await a.g.check();
    expect(a.g.gate()).toBeNull();
    const b = guardian(world({ headBlock: 1000 }), { chain: new FakeChainHead(1301) });
    await b.g.check();
    expect(b.g.gate()!.reason).toBe("stale_data");
  });

  it("refuses chain_mismatch when the RPC answers for another chain", async () => {
    const { g } = guardian(world(), { chain: new FakeChainHead(51_093_100, 1) });
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("chain_mismatch");
    expect(r.expected).toEqual({ chainId: 8453 });
    expect(r.actual).toEqual({ chainId: 1 });
  });

  it("refuses receipt_mismatch when the receipt on disk no longer matches the generated manifest", async () => {
    const receipt = { ...readGeneratedReceipt(), packageHash: "0".repeat(64) };
    const { g } = guardian(world(), { receipt });
    await g.check();
    const r = g.gate()!;
    expect(r.reason).toBe("receipt_mismatch");
    expect(r.expected).toEqual({ packageHash: manifest.package.packageHash });
    expect(r.actual).toEqual({ packageHash: "0".repeat(64) });
  });

  it("refuses check_unavailable when ClickHouse or the RPC cannot be reached (never answers unverified)", async () => {
    const a = guardian(world({ failClickhouse: "ECONNREFUSED 127.0.0.1:8123" }));
    await a.g.check();
    const ra = a.g.gate()!;
    expect(ra.reason).toBe("check_unavailable");
    expect(ra.detail).toContain("ECONNREFUSED");
    const b = guardian(world(), { chain: new FakeChainHead(0, 8453, "rpc timeout") });
    await b.g.check();
    expect(b.g.gate()!.reason).toBe("check_unavailable");
    expect((b.g.gate()!.actual as { errors: string[] }).errors).toEqual(["rpc: rpc timeout"]);
  });

  it("schema_mismatch takes precedence over stale_data; receipt_mismatch over both", async () => {
    const w = world({ headBlock: 1 });
    w.columns.vaults = [];
    const { g } = guardian(w, { chain: new FakeChainHead(10_000) });
    await g.check();
    expect(g.gate()!.reason).toBe("schema_mismatch");
    const { g: g2 } = guardian(w, { chain: new FakeChainHead(10_000), receipt: { ...readGeneratedReceipt(), parametersHash: "f".repeat(64) } });
    await g2.check();
    expect(g2.gate()!.reason).toBe("receipt_mismatch");
  });

  it("a verification older than three intervals is itself a refusal", async () => {
    let t = new Date("2026-09-10T12:00:00Z");
    const { g } = guardian(world(), { now: () => t });
    await g.check();
    expect(g.gate()).toBeNull();
    t = new Date("2026-09-10T12:02:59Z");
    expect(g.gate()).toBeNull();
    t = new Date("2026-09-10T12:03:01Z");
    const r = g.gate()!;
    expect(r.reason).toBe("check_unavailable");
    expect(r.detail).toMatch(/181 s old/);
  });

  it("concurrent checks share one run and the SQL it issues is the read-only system/head pair", async () => {
    const { g, ch } = guardian(world());
    await Promise.all([g.check(), g.check(), g.check()]);
    expect(ch.calls.length).toBe(2);
    expect(ch.calls[0]!.sql).toContain("FROM system.columns");
    expect(ch.calls[1]!.sql).toContain("max(_block_number_)");
  });
});
