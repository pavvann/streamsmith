import { describe, it, expect } from "vitest";
import { buildDescriptor, contractDescriptor, packageDescriptor } from "../src/proto/descriptor.ts";
import { makeTempRepo, hasBuf } from "./helpers.ts";
import { join } from "node:path";

const bufAvailable = await hasBuf();

describe.skipIf(!bufAvailable)("descriptor hashing with buf", () => {
  it("is deterministic and ignores comments/whitespace, but not fields", async () => {
    const repo = await makeTempRepo();
    try {
      const a = await buildDescriptor(repo.ctx, [{ name: "vaultflows.proto", source: repo.protoSource }]);
      const b = await buildDescriptor(repo.ctx, [{ name: "vaultflows.proto", source: repo.protoSource.replace(/\/\/[^\n]*/g, "").replace(/\n{2,}/g, "\n") }]);
      expect(a.hash).toBe(b.hash);
      expect(a.files).toEqual(["vaultflows.proto"]);
      const c = await buildDescriptor(repo.ctx, [{ name: "vaultflows.proto", source: repo.protoSource.replace("bool meta_valid = 20;", "bool meta_valid = 20;\n  string extra = 99;") }]);
      expect(c.hash).not.toBe(a.hash);
      const d = await buildDescriptor(repo.ctx, [{ name: "vaultflows.proto", source: repo.protoSource.replace('name: "vault_flows"', 'name: "vault_flowz"') }]);
      expect(d.hash).not.toBe(a.hash);
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("contract hash equals the hash of the source embedded in the package", async () => {
    const repo = await makeTempRepo();
    try {
      const expected = await contractDescriptor(repo.ctx, [join(repo.root, "specs", "vaultflows.proto")]);
      const actual = await packageDescriptor(repo.ctx, "substreams.yaml", "vaultflows.v1", join(repo.root, "packages", "erc4626-flows"));
      expect(actual.hash).toBe(expected.hash);
      expect(actual.info.name).toBe("erc4626-flows");
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("fails loudly when the package lacks the contract's proto package", async () => {
    const repo = await makeTempRepo({ infoOverride: (info) => { info.proto_source_code = { "other.v1": [{ filename: "x.proto", source: 'syntax = "proto3"; package other.v1;' }] }; } });
    try {
      await expect(packageDescriptor(repo.ctx, "substreams.yaml", "vaultflows.v1")).rejects.toThrow(/no proto files for package "vaultflows.v1"/);
    } finally {
      await repo.cleanup();
    }
  });
});
