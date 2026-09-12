import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { assembleReceipt, validateReceipt, writeReceipt, receiptHash, checkReceiptAgainstLive, hostFingerprint, normalizeSql, receiptFileName, type Receipt } from "../src/receipt.ts";
import { loadStreamsmithConfig } from "../src/config/streamsmith.ts";
import { validateAgainstSchema } from "../src/schema/jsonschema.ts";
import { REPO_ROOT, makeTempRepo, infoFixture } from "./helpers.ts";

const schema = JSON.parse(await readFile(join(REPO_ROOT, "specs", "receipt.schema.json"), "utf8"));
const ss = await loadStreamsmithConfig(join(REPO_ROOT, "specs", "streamsmith.yaml"));
const gate = { passed: true, ranges: ["51092254:51092454", "51092254:51092454", "51092998:51093002"], assertions: [{ name: "rows_gt", passed: true, detail: "5 rows" }, { name: "log_index_matches_rpc", passed: true, detail: "skipped" }], toolVersions: { substreams: "1.22.0" } };
// map_events module hash of the local build (fixtures/substreams-info.json, refreshed by `pnpm fixtures`)
const MH = (await infoFixture()).modules!.find((m) => m.name === "map_events")!.hash!;
const HASHES = { map_events: MH, map_flows: "af697e133efa2c7565b0bf853399f4153bdbced2" };
const H = "a".repeat(64);

function sample(): Receipt {
  return assembleReceipt({
    streamsmith: ss, gate, packageHash: H, moduleHashes: HASHES, protoDescriptorHash: "b".repeat(64), sinkSchemaHash: "c".repeat(64), runId: "20260911T100000Z-abcd", createdAt: "2026-09-11T10:00:00.000Z",
    publish: { packageName: "erc4626-flows", packageVersion: "v0.1.0", spkgPath: "x.spkg", spkgBytes: 1, packageHash: H, packageUrl: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0", registryPublishedAt: "2026-09-11T09:59:00.000Z", dryRun: false, commands: [], runId: "r", createdAt: "2026-09-11T09:59:00.000Z" },
    deploy: { deploymentMode: "graph-market-hosted", deploymentId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", headBlock: 51100000, chainHead: 51100010, lagBlocks: 10, lagSeconds: 20.4, deployedAt: "2026-09-11T09:59:30.000Z", runId: "r", sink: { kind: "clickhouse", mode: "from-proto", database: "default", hostFingerprint: hostFingerprint("x.clickhouse.cloud", 9440) }, startBlock: 49276800 },
  });
}

describe("receipt", () => {
  it("assembles a receipt that validates against specs/receipt.schema.json", () => {
    const r = sample();
    const res = validateReceipt(r, schema);
    expect(res.errors).toEqual([]);
    expect(r.parameters.vaults).toEqual(["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
    expect(r.packageVersion).toBe("v0.1.0");
    expect(r.lagSeconds).toBe(20);
    expect(r.deploymentMode).toBe("graph-market-hosted");
    expect(r.outputModuleHash).toBe(MH);
    expect(r.moduleHashes).toEqual(HASHES);
    expect(receiptFileName(r)).toBe("erc4626-flows-v0.1.0-20260911T100000Z-abcd.json");
    expect(receiptHash(r)).toBe(receiptHash(JSON.parse(JSON.stringify(r))));
  });

  it("fills deploymentMode/headBlock/lagBlocks from a self-managed `deploy status --json` record (cli.ts --deploy-json)", () => {
    // shaped exactly like selfManagedStatus()'s DeployRecord output (src/deploy/selfManaged.ts), the file
    // `streamsmith deploy status --json > status.json` writes and `receipt --deploy-json status.json` reads
    const deploy = { deploymentMode: "self-managed-sink" as const, runId: "r", headBlock: 51100000, chainHead: 51100171, lagBlocks: 171, lagSeconds: 342, checkedAt: "2026-09-11T10:00:00.000Z", rowCounts: { vault_flows: 171, _blocks_: 128 }, sink: { kind: "clickhouse" as const, mode: "from-proto" as const, database: "vaultflows", hostFingerprint: hostFingerprint("localhost", 9000) } };
    const r = assembleReceipt({ streamsmith: ss, gate, packageHash: H, moduleHashes: HASHES, protoDescriptorHash: "b".repeat(64), sinkSchemaHash: "c".repeat(64), runId: "r", createdAt: "2026-09-11T10:00:00.000Z", deploy });
    expect(r.deploymentMode).toBe("self-managed-sink");
    expect(r.headBlock).toBe(51100000);
    expect(r.lagBlocks).toBe(171);
    expect(r.sink).toEqual(deploy.sink);
    expect(validateReceipt(r, schema).errors).toEqual([]);
  });

  it("names the spkg URL a hosted deployment runs when there is no publish record in the run", () => {
    const base = { streamsmith: ss, gate, packageHash: H, moduleHashes: HASHES, protoDescriptorHash: "b".repeat(64), sinkSchemaHash: "c".repeat(64), runId: "r", createdAt: "2026-09-11T10:00:00.000Z" };
    const hosted = assembleReceipt({ ...base, deploy: { deploymentMode: "graph-market-hosted" as const, runId: "r", deploymentId: "dep", spkg: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0" } });
    expect(hosted.packageUrl).toBe("https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0");
    expect(validateReceipt(hosted, schema).errors).toEqual([]);
    // a self-managed record's spkg is a local path, which is not a URL and must not become one
    const selfManaged = assembleReceipt({ ...base, deploy: { deploymentMode: "self-managed-sink" as const, runId: "r", spkg: "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg" } });
    expect(selfManaged.packageUrl).toBeUndefined();
    // an explicit publish record still wins
    const withPublish = assembleReceipt({ ...base, packageUrl: "https://example.invalid/p", deploy: { deploymentMode: "graph-market-hosted" as const, runId: "r", spkg: "https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0" } });
    expect(withPublish.packageUrl).toBe("https://example.invalid/p");
  });

  it("requires outputModuleHash (spkg bytes are not reproducible; the module hash is the identity) and falls back to publish/gate module hashes", () => {
    const base = { streamsmith: ss, gate, packageHash: H, protoDescriptorHash: "b".repeat(64), sinkSchemaHash: "c".repeat(64), createdAt: "2026-09-11T10:00:00.000Z" };
    expect(() => assembleReceipt(base)).toThrow(/outputModuleHash is required/);
    expect(assembleReceipt({ ...base, outputModuleHash: "ab" }).outputModuleHash).toBe("ab");
    expect(assembleReceipt({ ...base, publish: { packageName: "erc4626-flows", packageVersion: "v0.1.0", spkgPath: "x", spkgBytes: 1, packageHash: H, moduleHash: "cd", dryRun: true, commands: [], runId: "r", createdAt: "2026-09-11T09:59:00.000Z" } }).outputModuleHash).toBe("cd");
    const fromGate = assembleReceipt({ ...base, gate: { ...gate, package: { dir: "p", manifest: "m", moduleHashes: { map_events: "ef" } } } as never });
    expect(fromGate.outputModuleHash).toBe("ef");
    expect(fromGate.moduleHashes).toEqual({ map_events: "ef" });
    const { outputModuleHash, ...noHash } = sample() as unknown as Record<string, unknown>;
    void outputModuleHash;
    expect(validateReceipt(noHash, schema).errors.map((e) => e.message)).toContain('missing required property "outputModuleHash"');
  });

  it("rejects schema violations (unknown property, bad address, missing required, wrong mode)", () => {
    const r = sample() as unknown as Record<string, unknown>;
    expect(validateReceipt({ ...r, extra: 1 }, schema).errors.map((e) => e.message)).toContain('unexpected property "extra"');
    expect(validateReceipt({ ...r, parameters: { ...(r.parameters as object), vaults: ["0xABC"] } }, schema).errors.some((e) => e.path.includes("vaults"))).toBe(true);
    const { sinkSchemaHash, ...missing } = r;
    void sinkSchemaHash;
    expect(validateReceipt(missing, schema).errors.map((e) => e.message)).toContain('missing required property "sinkSchemaHash"');
    expect(validateReceipt({ ...r, deploymentMode: "vps" }, schema).ok).toBe(false);
    expect(validateReceipt({ ...r, gate: { passed: true, ranges: ["a:b"], assertions: [] } }, schema).errors.some((e) => e.path.includes("ranges"))).toBe(true);
  });

  it("writeReceipt refuses invalid receipts unless forced", async () => {
    const repo = await makeTempRepo();
    try {
      const r = sample();
      const w = await writeReceipt(repo.root, r);
      expect(w.path).toBe(join(repo.root, "receipts", receiptFileName(r)));
      expect(JSON.parse(await readFile(w.path, "utf8")).packageHash).toBe(H);
      const broken = { ...r, chainId: "8453" } as unknown as Receipt;
      await expect(writeReceipt(repo.root, broken)).rejects.toThrow(/receipt.schema.json/);
      const forced = await writeReceipt(repo.root, broken, { force: true });
      expect(forced.errors.length).toBeGreaterThan(0);
    } finally {
      await repo.cleanup();
    }
  });

  it("fails closed against a live deployment that drifted or lags", () => {
    const r = sample();
    const live = { packageHash: H, sinkSchemaHash: "c".repeat(64), headBlock: 51100000, chainHead: 51100100 };
    expect(checkReceiptAgainstLive(r, live)).toMatchObject({ ok: true, reasons: [], provenance: { lagBlocks: 100, packageHash: H } });
    expect(checkReceiptAgainstLive(r, { ...live, packageHash: "d".repeat(64) }).reasons[0]).toMatch(/package hash mismatch/);
    expect(checkReceiptAgainstLive(r, { ...live, outputModuleHash: "ff" }).reasons[0]).toMatch(new RegExp(`output module hash mismatch: live ff vs receipt ${MH}`));
    expect(checkReceiptAgainstLive(r, { ...live, outputModuleHash: MH }).ok).toBe(true);
    expect(checkReceiptAgainstLive(r, live).provenance.outputModuleHash).toBe(MH);
    expect(checkReceiptAgainstLive(r, { ...live, sinkSchemaHash: undefined }).reasons[0]).toMatch(/schema hash unavailable/);
    expect(checkReceiptAgainstLive(r, { ...live, chainHead: 51103000 }).reasons[0]).toMatch(/lag 3000 blocks exceeds 1800/);
    expect(checkReceiptAgainstLive(r, { ...live, chainHead: 51103000 }, { maxLagBlocks: 5000 }).ok).toBe(true);
    expect(checkReceiptAgainstLive(r, { packageHash: H, sinkSchemaHash: "c".repeat(64) }).reasons[0]).toMatch(/cannot compute lag/);
  });

  it("normalizes SQL before hashing and fingerprints hosts without secrets", () => {
    expect(normalizeSql("CREATE TABLE a (x Int32)  \r\n\r\n")).toBe("CREATE TABLE a (x Int32)\n");
    expect(hostFingerprint("h", 9440)).toBe(hostFingerprint("h", "9440"));
    expect(hostFingerprint("h", 9440)).not.toContain("h:");
  });

  it("mini JSON-schema validator handles the keywords the receipt schema uses", () => {
    expect(validateAgainstSchema(5, { type: "integer", minimum: 1 })).toEqual([]);
    expect(validateAgainstSchema(5.5, { type: "integer" })[0]!.message).toMatch(/expected type integer/);
    expect(validateAgainstSchema("x", { const: 1 })).toHaveLength(1);
    expect(validateAgainstSchema("2026-09-11T10:00:00Z", { type: "string", format: "date-time" })).toEqual([]);
    expect(validateAgainstSchema("yesterday", { type: "string", format: "date-time" })).toHaveLength(1);
    expect(validateAgainstSchema(["1:2", "x"], { type: "array", items: { type: "string", pattern: "^\\d+:\\d+$" } })).toHaveLength(1);
  });
});
