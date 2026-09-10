import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specDescriptor, spkgDescriptor, normalizedDescriptorHash, makeContractWorkspace, substreamsInfo } from "../src/proto/descriptor.ts";
import { ProcessRunner } from "../src/util/exec.ts";
import { createCtx } from "../src/util/ctx.ts";
import { moduleHashesOf } from "../src/gate/run.ts";
import { makeTempRepo, hasBuf, hasPython3, hasSubstreams, fdsFixture, pathExists, REPO_ROOT, REAL_SPKG } from "./helpers.ts";
import { parseSpecYaml } from "../src/util/yaml.ts";

const bufAvailable = await hasBuf();
const pythonAvailable = await hasPython3();
const substreamsAvailable = await hasSubstreams();
const realSpkgPresent = await pathExists(REAL_SPKG);
const gateYaml = parseSpecYaml<{ descriptorHash: { expectedSpecSha256: string; referenceScript: string } }>(await readFile(join(REPO_ROOT, "specs", "gate.yaml"), "utf8"));
// The one source of truth for the expected contract hash. It changes whenever specs/vaultflows.proto changes.
const EXPECTED = gateYaml.descriptorHash.expectedSpecSha256;

describe("normalized descriptor hash (specs/gate.yaml descriptorHash.algorithm, steps 3-5)", () => {
  it("reproduces expectedSpecSha256 from buf's FileDescriptorSet JSON (fixtures/vaultflows.fds.json)", async () => {
    const { hash, canonical } = normalizedDescriptorHash(await fdsFixture(), "vaultflows.v1");
    expect(EXPECTED).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(EXPECTED);
    expect(canonical.startsWith('{"dependency":["sf/substreams/sink/sql/schema/v1/schema.proto"],"messageType":')).toBe(true);
    // no enum fields in the contract: substreams-sink-sql 4.13.1 from-proto panics on a populated proto3 enum
    expect(canonical).not.toMatch(/"enumType"/);
    expect(canonical).not.toMatch(/jsonName|sourceCodeInfo|"name":"vaultflows.proto"/);
    expect(canonical).toMatch(/"\[schema.table\]":\{"clickhouseTableOptions"/);
  });

  it("requires exactly one file for the package", async () => {
    const fds = await fdsFixture();
    expect(() => normalizedDescriptorHash(fds, "nope.v1")).toThrow(/expected exactly one file for package nope.v1, found 0/);
    expect(() => normalizedDescriptorHash({ file: [...fds.file!, ...fds.file!] }, "vaultflows.v1")).toThrow(/found 2/);
  });

  it.skipIf(!pythonAvailable)("agrees with the Python reference script embedded in specs/gate.yaml (the oracle)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "streamsmith-oracle-"));
    try {
      const script = join(dir, "descriptor_hash.py");
      await writeFile(script, gateYaml.descriptorHash.referenceScript);
      const fdsPath = join(dir, "fds.json");
      await writeFile(fdsPath, JSON.stringify(await fdsFixture()));
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("python3", [script, "vaultflows.v1"], { input: await readFile(fdsPath), encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe(normalizedDescriptorHash(await fdsFixture(), "vaultflows.v1").hash);
      expect(r.stdout.trim()).toBe(EXPECTED);
      // and the oracle disagrees once a field is added, as does ours
      const fds = await fdsFixture();
      const file = fds.file!.find((f) => f.package === "vaultflows.v1")! as { messageType: Array<{ name: string; field: unknown[] }> };
      file.messageType.find((m) => m.name === "VaultFlow")!.field.push({ name: "extra", number: 99, label: "LABEL_OPTIONAL", type: "TYPE_STRING", jsonName: "extra" });
      const r2 = spawnSync("python3", [script, "vaultflows.v1"], { input: JSON.stringify(fds), encoding: "utf8" });
      expect(r2.stdout.trim()).toBe(normalizedDescriptorHash(fds, "vaultflows.v1").hash);
      expect(r2.stdout.trim()).not.toBe(EXPECTED);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!bufAvailable)("descriptor hashing with buf", () => {
  it("spec side: hash equals expectedSpecSha256, renderer self-check passes, fixture FDS is current", async () => {
    const repo = await makeTempRepo();
    try {
      const d = await specDescriptor(repo.ctx, join(repo.root, "specs", "vaultflows.proto"));
      expect(d.pkg).toBe("vaultflows.v1");
      expect(d.hash).toBe(EXPECTED);
      expect(d.hashViaConvert).toBe(EXPECTED);
      expect(d.rendererMatch).toBe(true);
      expect(normalizedDescriptorHash(d.fds, "vaultflows.v1").hash).toBe(normalizedDescriptorHash(await fdsFixture(), "vaultflows.v1").hash);
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("ignores comments and whitespace, not fields or sink annotations", async () => {
    const repo = await makeTempRepo();
    try {
      const write = async (name: string, source: string) => { const p = join(repo.root, name); await writeFile(p, source); return p; };
      const stripped = await specDescriptor(repo.ctx, await write("a.proto", repo.protoSource.replace(/\/\/[^\n]*/g, "").replace(/\n{2,}/g, "\n")));
      expect(stripped.hash).toBe(EXPECTED);
      const extra = await specDescriptor(repo.ctx, await write("b.proto", repo.protoSource.replace("bool meta_valid = 20;", "bool meta_valid = 20;\n  string extra = 99;")));
      expect(extra.hash).not.toBe(EXPECTED);
      const renamedTable = await specDescriptor(repo.ctx, await write("c.proto", repo.protoSource.replace('name: "vault_flows"', 'name: "vault_flowz"')));
      expect(renamedTable.hash).not.toBe(EXPECTED);
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("spkg side: a FileDescriptorSet binpb (wire-compatible with sf.substreams.v1.Package) hashes like the source", async () => {
    const repo = await makeTempRepo();
    try {
      const work = await makeContractWorkspace([{ name: "vaultflows.proto", source: repo.protoSource }]);
      const bin = join(work, "pkg.spkg");
      const r = await new ProcessRunner().run("buf", ["build", ".", "--as-file-descriptor-set", "-o", bin], { cwd: work, timeoutMs: 60000 });
      expect(r.code, r.stderr).toBe(0);
      const d = await spkgDescriptor(repo.ctx, bin, "vaultflows.v1");
      expect(d.hash).toBe(EXPECTED);
      await expect(spkgDescriptor(repo.ctx, bin, "other.v1")).rejects.toThrow(/expected exactly one file for package other.v1/);
      await expect(spkgDescriptor(repo.ctx, join(work, "missing.spkg"), "vaultflows.v1")).rejects.toThrow(/spkg not found/);
      await rm(work, { recursive: true, force: true });
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  /**
   * This is gate.yaml `descriptor_hash_match` against the artifact on disk: the .spkg must embed the current
   * contract. A failure here means packages/erc4626-flows needs `substreams build` (this package never builds it),
   * and the gate would fail for the same reason.
   */
  it.skipIf(!realSpkgPresent || !substreamsAvailable)("the local build packages/erc4626-flows/erc4626-flows-v0.1.0.spkg carries the frozen contract", async () => {
    const ctx = await createCtx({ root: REPO_ROOT, log: () => {} });
    const info = await substreamsInfo(ctx, REAL_SPKG, { expandNetworks: true });
    expect(info).toMatchObject({ name: "erc4626-flows", version: "v0.1.0", network: "base" });
    const hashes = moduleHashesOf(info);
    expect(hashes.map_events).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(hashes)).toEqual(expect.arrayContaining(["map_flows", "map_share_value_observations", "map_vault_probe", "map_events"]));

    expect(info.proto_source_code?.["vaultflows.v1"]?.some((f) => f.filename.endsWith("vaultflows.proto"))).toBe(true);
    const d = await spkgDescriptor(ctx, REAL_SPKG, "vaultflows.v1");
    expect(d.hash, "the local .spkg embeds a different contract than specs/vaultflows.proto — rebuild it with `substreams build` in packages/erc4626-flows").toBe(EXPECTED);
  }, 60000);
});
