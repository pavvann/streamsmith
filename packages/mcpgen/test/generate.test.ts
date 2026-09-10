import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generate } from "../src/cli.ts";
import { sha256Hex, sha256Canonical } from "../src/hash.ts";
import { parseReceipt, receiptParametersCanonical, validateJsonSchema } from "../src/receipt.ts";
import type { Manifest } from "../runtime/types.ts";
import { FIXTURE_RECEIPT, GENERATED_DIR, PKG_ROOT, SPEC_PROTO, SPEC_RECEIPT_SCHEMA, VIEWS_SQL } from "./helpers.ts";

const temps: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mcpgen-"));
  temps.push(d);
  return d;
}
afterAll(async () => { for (const d of temps) await rm(d, { recursive: true, force: true }); });

describe("fixture receipt", () => {
  it("is valid against specs/receipt.schema.json and its parametersHash is the canonical one", async () => {
    const schema = JSON.parse(await readFile(SPEC_RECEIPT_SCHEMA, "utf8"));
    const json = JSON.parse(await readFile(FIXTURE_RECEIPT, "utf8"));
    expect(validateJsonSchema(json, schema)).toEqual([]);
    const { receipt } = parseReceipt(json, schema);
    expect(sha256Canonical(receiptParametersCanonical(receipt.parameters))).toBe(receipt.parametersHash);
    expect(receipt.protoDescriptorHash).toBe("11b959fc25edfb3c135d6cc39119df8bb0b442b1b245e999c6912483a1fc2c8b");
  });

  it("the validator refuses what the schema refuses", async () => {
    const schema = JSON.parse(await readFile(SPEC_RECEIPT_SCHEMA, "utf8"));
    const json = JSON.parse(await readFile(FIXTURE_RECEIPT, "utf8"));
    expect(validateJsonSchema({ ...json, extra: 1 }, schema).map((e) => e.path)).toEqual(["$.extra"]);
    const { outputModuleHash: _drop, ...noHash } = json;
    expect(validateJsonSchema(noHash, schema).map((e) => e.message)).toEqual(["required property missing"]);
    expect(validateJsonSchema({ ...json, deploymentMode: "manual" }, schema).length).toBe(1);
    expect(validateJsonSchema({ ...json, parameters: { ...json.parameters, vaults: ["0xABC"] } }, schema).length).toBe(1);
    expect(() => parseReceipt({ ...json, receiptVersion: 2 }, schema)).toThrow(/receipt.schema.json/);
  });
});

describe("generator", () => {
  it("is deterministic: two runs produce byte-identical manifest.json and sources", async () => {
    const [a, b] = [await tmp(), await tmp()];
    const common = { receipt: FIXTURE_RECEIPT, proto: SPEC_PROTO, views: VIEWS_SQL, name: "@ethonline26/mcp-vaultflows" };
    const ra = await generate({ ...common, out: a });
    const rb = await generate({ ...common, out: b });
    for (const rel of ["manifest.json", "src/tools.generated.ts", "src/server.ts", "package.json", "README.md"]) {
      expect(await readFile(join(a, rel), "utf8"), rel).toBe(await readFile(join(b, rel), "utf8"));
    }
    expect(sha256Hex(await readFile(ra.manifestPath))).toBe(sha256Hex(await readFile(rb.manifestPath)));
    // and the checked-in generated package is what this generator produces from the fixture
    expect(await readFile(join(GENERATED_DIR, "manifest.json"), "utf8")).toBe(await readFile(ra.manifestPath, "utf8"));
  });

  it("manifest carries the receipt identity, expected column sets, hashes and 7 tools", async () => {
    const m = JSON.parse(await readFile(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest;
    expect(m.tools.map((t) => t.name)).toEqual(["vault_flows", "share_value_observations", "vaults", "recent_share_migration", "vault_flows_24h", "share_value_growth", "pipeline_status"]);
    expect(Object.keys(m.expectedSchema.tables)).toEqual(["vault_flows", "share_value_observations", "vaults", "share_transfers"]);
    expect(m.expectedSchema.columnSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.toolsHash).toBe(sha256Canonical(m.tools));
    expect(m.receipt.sha256).toBe(sha256Hex(await readFile(FIXTURE_RECEIPT)));
    expect(m.package).toMatchObject({ name: "erc4626-flows", version: "v0.1.0", outputModule: "map_events", outputModuleHash: "3f6c0a9e1d2b4c8f7a5e6d1c0b9a8f7e6d5c4b3a", chainId: 8453, deploymentMode: "self-managed-sink", startBlock: 51_001_200 });
    expect(m.vaults).toEqual(["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
    expect(m.policy).toMatchObject({ maxLagBlocksDefault: 300, checkIntervalSeconds: 60, queryTimeoutMs: 10_000, maxLimit: 500 });
    const vf = m.tools.find((t) => t.name === "vault_flows")!;
    expect(vf.params.find((p) => p.name === "vault")!.values).toEqual(m.vaults);
    expect(vf.params.find((p) => p.name === "limit")!.max).toBe(500);
    expect(m.tools.find((t) => t.name === "recent_share_migration")!.whenEmpty).toEqual({ reason: "share_transfers not populated in v0.1.0" });
    expect(JSON.stringify(m)).not.toMatch(/\/Users\//);
  });

  it("a different vault list changes the manifest hash and the generated enum", async () => {
    const d = await tmp();
    const json = JSON.parse(await readFile(FIXTURE_RECEIPT, "utf8"));
    json.parameters.vaults = [json.parameters.vaults[0]];
    json.parametersHash = sha256Canonical(receiptParametersCanonical(json.parameters));
    const rpath = join(d, "receipt.json");
    await (await import("node:fs/promises")).writeFile(rpath, JSON.stringify(json));
    const r = await generate({ receipt: rpath, proto: SPEC_PROTO, views: VIEWS_SQL, out: join(d, "out"), receiptSchema: SPEC_RECEIPT_SCHEMA });
    const m = JSON.parse(await readFile(r.manifestPath, "utf8")) as Manifest;
    expect(m.vaults).toEqual([json.parameters.vaults[0]]);
    expect(await readFile(join(d, "out", "src", "tools.generated.ts"), "utf8")).toContain(`export const VAULTS = ["${json.parameters.vaults[0]}"] as const;`);
    expect(m.toolsHash).not.toBe((JSON.parse(await readFile(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest).toolsHash);
  });

  it("refuses a receipt that fails the schema", async () => {
    const d = await tmp();
    const json = JSON.parse(await readFile(FIXTURE_RECEIPT, "utf8"));
    delete json.sinkSchemaHash;
    const rpath = join(d, "receipt.json");
    await (await import("node:fs/promises")).writeFile(rpath, JSON.stringify(json));
    await expect(generate({ receipt: rpath, proto: SPEC_PROTO, views: VIEWS_SQL, out: join(d, "out") })).rejects.toThrow(/sinkSchemaHash/);
  });

  it("CLI: last stdout line is exactly {\"manifest\": <absolute path>}", async () => {
    const d = await tmp();
    const r = spawnSync(process.execPath, [join(PKG_ROOT, "bin", "mcpgen.js"), "generate", "--receipt", FIXTURE_RECEIPT, "--proto", SPEC_PROTO, "--views", VIEWS_SQL, "--out", join(d, "gen")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split("\n");
    const last = JSON.parse(lines.at(-1)!);
    expect(Object.keys(last)).toEqual(["manifest"]);
    expect(last.manifest).toBe(join(d, "gen", "manifest.json"));
    expect(r.stderr).toContain("mcpgen: tools:");
    const usage = spawnSync(process.execPath, [join(PKG_ROOT, "bin", "mcpgen.js"), "generate"], { encoding: "utf8" });
    expect(usage.status).toBe(2);
    expect(usage.stdout).toBe("");
  });
});
