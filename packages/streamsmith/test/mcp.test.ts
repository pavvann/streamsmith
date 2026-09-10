import { describe, it, expect } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runMcp, mcpgenArgs, parseManifestLine } from "../src/mcp.ts";
import { assembleReceipt, writeReceipt, loadReceipt } from "../src/receipt.ts";
import { loadStreamsmithConfig } from "../src/config/streamsmith.ts";
import { sha256Hex } from "../src/util/hash.ts";
import { makeTempRepo, type TempRepo } from "./helpers.ts";

const gate = { passed: true, ranges: ["51092254:51092454"], assertions: [{ name: "rows_gt", passed: true, detail: "5 rows" }] };

async function receiptIn(repo: TempRepo): Promise<string> {
  const ss = await loadStreamsmithConfig(join(repo.root, "specs", "streamsmith.yaml"));
  const r = assembleReceipt({ streamsmith: ss, gate, packageHash: "a".repeat(64), outputModuleHash: "1f9e1dff75f677a6493655ab5e9126384b045459", protoDescriptorHash: "b".repeat(64), sinkSchemaHash: "c".repeat(64), runId: "m1", createdAt: "2026-09-11T10:00:00.000Z" });
  const w = await writeReceipt(repo.root, r);
  return join("receipts", w.path.split("/").pop()!);
}

describe("streamsmith mcp", () => {
  it("parses the generator's last stdout line", () => {
    expect(parseManifestLine('generating...\nwrote 4 tools\n{"manifest": "/abs/manifest.json"}\n')).toBe("/abs/manifest.json");
    expect(() => parseManifestLine("")).toThrow(/printed nothing/);
    expect(() => parseManifestLine("done\n")).toThrow(/not JSON/);
    expect(() => parseManifestLine('{"tools": 4}')).toThrow(/lacks a "manifest" string/);
  });

  it("builds the pnpm --filter command from the brief", async () => {
    const repo = await makeTempRepo();
    try {
      const a = mcpgenArgs(repo.ctx, { runId: "r", receiptPath: "receipts/x.json", protoPath: "specs/vaultflows.proto", viewsPath: "packages/erc4626-flows/sql/views.sql" });
      expect(a.cmd).toBe("pnpm");
      expect(a.args).toEqual(["--filter", "@ethonline26/mcpgen", "generate", "--receipt", join(repo.root, "receipts/x.json"), "--proto", join(repo.root, "specs/vaultflows.proto"), "--views", join(repo.root, "packages/erc4626-flows/sql/views.sql"), "--out", join(repo.root, "packages/mcp-vaultflows")]);
    } finally {
      await repo.cleanup();
    }
  });

  it("shells out to mcpgen, hashes the manifest it names and binds mcpManifestHash into the receipt", async () => {
    const repo = await makeTempRepo();
    try {
      const receiptPath = await receiptIn(repo);
      const manifestBody = JSON.stringify({ tools: ["vault_flows", "share_value_growth", "recent_share_migration", "pipeline_status"] });
      repo.runner.fake.add({
        match: (c, a) => c === "pnpm" && a[0] === "--filter" && a[1] === "@ethonline26/mcpgen" && a[2] === "generate",
        onCall: async (_c, a) => {
          const out = a[a.indexOf("--out") + 1]!;
          await mkdir(out, { recursive: true });
          await writeFile(join(out, "manifest.json"), manifestBody);
        },
        result: { code: 0, stdout: `mcpgen: 4 tools\n{"manifest": "${join(repo.root, "packages/mcp-vaultflows/manifest.json")}"}\n` },
      });
      const r = await runMcp(repo.ctx, { runId: "m1", receiptPath, protoPath: "specs/vaultflows.proto" });
      expect(r.record.mcpManifestHash).toBe(sha256Hex(manifestBody));
      expect(r.record.manifest).toBe("packages/mcp-vaultflows/manifest.json");
      expect(r.record.receiptPath).toBe(receiptPath);
      const call = repo.runner.fake.calls.find((c) => c.cmd === "pnpm")!;
      expect(call.opts.cwd).toBe(repo.root);
      expect(call.args.slice(0, 5)).toEqual(["--filter", "@ethonline26/mcpgen", "generate", "--receipt", join(repo.root, receiptPath)]);
      const updated = await loadReceipt(join(repo.root, receiptPath));
      expect(updated.mcpManifestHash).toBe(sha256Hex(manifestBody));
      expect(updated.outputModuleHash).toBe("1f9e1dff75f677a6493655ab5e9126384b045459");
      const rec = JSON.parse(await readFile(join(repo.root, "runs", "m1", "mcp.json"), "utf8"));
      expect(rec.mcpManifestHash).toBe(r.record.mcpManifestHash);
      expect(rec.receiptHash).toHaveLength(64);
    } finally {
      await repo.cleanup();
    }
  });

  it("fails loudly when the generator fails, prints no manifest line, or names a missing file", async () => {
    const repo = await makeTempRepo();
    try {
      const receiptPath = await receiptIn(repo);
      repo.runner.fake.add({ match: (c, a) => c === "pnpm" && a.includes("--out") && a.includes("fail"), result: { code: 1, stderr: "mcpgen: receipt invalid" } });
      await expect(runMcp(repo.ctx, { runId: "m2", receiptPath, extraArgs: ["fail"] })).rejects.toThrow(/mcpgen failed \(exit 1\): mcpgen: receipt invalid/);
      repo.runner.fake.add({ match: (c, a) => c === "pnpm" && a.includes("noline"), result: { code: 0, stdout: "all good\n" } });
      await expect(runMcp(repo.ctx, { runId: "m3", receiptPath, extraArgs: ["noline"] })).rejects.toThrow(/not JSON/);
      repo.runner.fake.add({ match: (c, a) => c === "pnpm" && a.includes("ghost"), result: { code: 0, stdout: '{"manifest": "packages/mcp-vaultflows/ghost.json"}\n' } });
      await expect(runMcp(repo.ctx, { runId: "m4", receiptPath, extraArgs: ["ghost"] })).rejects.toThrow(/does not exist/);
      await expect(runMcp(repo.ctx, { runId: "m5", receiptPath: "receipts/nope.json" })).rejects.toThrow(/receipt not found/);
      expect((await loadReceipt(join(repo.root, receiptPath))).mcpManifestHash).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });
});
