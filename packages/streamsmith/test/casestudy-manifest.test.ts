import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderCaseStudy, writeCaseStudy } from "../src/casestudy.ts";
import { manifestStart, manifestFinish } from "../src/manifest.ts";
import { runGate } from "../src/gate/run.ts";
import { runPublish } from "../src/publish.ts";
import { makeTempRepo, hasBuf, REPO_ROOT } from "./helpers.ts";
import YAML from "yaml";

const bufAvailable = await hasBuf();

describe("case study rendering", () => {
  it("emits the skills-repo section order", () => {
    const md = renderCaseStudy({ id: "S1.1", title: "T", chain: "Base", skills: ["substreams-dev"], model: "m", result: "Build OK", goal: "g", prompt: "do it", provided: ["x"], files: [{ label: "a", path: "b" }], reproduce: ["substreams build"], notes: ["n"] });
    const idx = ["# S1.1 — T (Base)", "**Skill(s) exercised:**", "**Model:**", "**Result:**", "## Goal", "## Prompt", "> do it", "## What the skill provided", "## Files", "## Reproduce", "## Notes"].map((h) => md.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
});

describe("manifest + publish + case study over a gated run", () => {
  it("records commits, prompt hash, receipt hash and writes case-studies/<name>.md", async () => {
    let gateYaml: string | undefined;
    if (!bufAvailable) {
      const g = YAML.parse(await readFile(join(REPO_ROOT, "specs", "gate.yaml"), "utf8")) as { assertions: Array<{ name: string }> };
      g.assertions = g.assertions.filter((a) => !["spec_unmodified", "descriptor_hash_match", "numeric_strings_valid", "addresses_lowercase", "output_decodes_against_contract"].includes(a.name));
      gateYaml = YAML.stringify(g);
    }
    const repo = await makeTempRepo(gateYaml ? { gateYaml } : {});
    try {
      const m1 = await manifestStart(repo.ctx, { runId: "run1" });
      expect(m1.manifest.startingCommit).toBe("0123456789abcdef0123456789abcdef01234567");
      expect(m1.manifest.promptHash).toHaveLength(64);
      expect(m1.manifest.startingTags).toEqual(["v0.1.0-run"]);
      expect(m1.manifest.specHashes["specs/vaultflows.proto"]).toHaveLength(64);

      const gate = await runGate(repo.ctx, { runId: "run1", offline: true });
      expect(gate.exitCode).toBe(0);
      const pub = await runPublish(repo.ctx, { pkgDir: "packages/erc4626-flows", dryRun: true, runId: "run1" });
      expect(pub.record).toMatchObject({ packageName: "erc4626-flows", packageVersion: "v0.1.0", dryRun: true, outputModule: "map_events" });
      expect(pub.record.spkgBytes).toBeGreaterThan(0);
      expect(pub.record.packageHash).toHaveLength(64);
      expect(pub.record.moduleHash).toMatch(/^[0-9a-f]{40}$/);
      expect(pub.record.moduleHashes?.map_events).toBe(pub.record.moduleHash);
      expect(pub.record.packageUrl).toBeUndefined();
      const live = await runPublish(repo.ctx, { pkgDir: "packages/erc4626-flows", runId: "run1", spkgPath: pub.record.spkgPath });
      expect(live.record.packageUrl).toBe("https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0");
      expect(live.record.webUrl).toBe("https://substreams.dev/packages/erc4626-flows/v0.1.0");
      expect(live.record.registryPublishedAt).toBe("2026-09-11T10:00:00.000Z");

      const { assembleReceipt, writeReceipt } = await import("../src/receipt.ts");
      const { loadStreamsmithConfig } = await import("../src/config/streamsmith.ts");
      const ss = await loadStreamsmithConfig(join(repo.root, "specs", "streamsmith.yaml"));
      const receipt = assembleReceipt({ streamsmith: ss, gate: gate.report, packageHash: live.record.packageHash, protoDescriptorHash: gate.report.descriptor?.specHash ?? "e".repeat(64), sinkSchemaHash: "f".repeat(64), publish: live.record, runId: "run1", createdAt: repo.ctx.now().toISOString() });
      expect(receipt.outputModuleHash).toBe(live.record.moduleHash);
      expect(receipt.gate.ranges).toEqual(["51092254:51092454", "51092254:51092454", "51092998:51093002"]);
      expect(receipt.gate.assertions).toHaveLength(gateYaml ? 13 : 18);
      const w = await writeReceipt(repo.root, receipt);
      const rel = join("receipts", w.path.split("/").pop()!);

      const m2 = await manifestFinish(repo.ctx, { runId: "run1", receiptPath: rel });
      expect(m2.manifest.receiptHash).toBe(w.hash);
      expect(m2.manifest.endingCommit).toBeDefined();
      expect(m2.manifest.gateStatus).toBe("passed");
      expect(m2.manifest.gateJsonHash).toHaveLength(64);

      const cs = await writeCaseStudy(repo.ctx, { runId: "run1", receiptPath: rel, model: "claude-test" });
      const md = await readFile(cs.path, "utf8");
      expect(cs.path).toBe(join(repo.root, "case-studies", "erc4626-flows.md"));
      expect(md).toContain("# S1.1 — erc4626-flows");
      expect(md).toContain("**Model:** claude-test");
      expect(md).toContain("Gate PASS");
      expect(md).toContain("> Using the installed official Substreams skills and Streamsmith");
      expect(md).toContain("## Reproduce");
      expect(md).toContain("Receipt binds packageHash");
    } finally {
      await repo.cleanup();
    }
  }, 90000);
});
