import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runGate, substreamsRunArgs } from "../src/gate/run.ts";
import { parseGateConfig, loadGateConfig } from "../src/config/gate.ts";
import { makeTempRepo, hasBuf, fixture } from "./helpers.ts";
import YAML from "yaml";

const bufAvailable = await hasBuf();
const withoutDescriptor = async () => {
  const g = YAML.parse(await fixture("gate.yaml")) as { assertions: Array<{ kind: string }> };
  g.assertions = g.assertions.filter((a) => a.kind !== "descriptor_hash_match");
  return YAML.stringify(g);
};

describe("gate.yaml parsing", () => {
  it("parses the fixture with sameAs runs and exit codes", async () => {
    const g = parseGateConfig(YAML.parse(await fixture("gate.yaml")));
    expect(Object.keys(g.runs)).toEqual(["primary", "rerun"]);
    expect(g.runs.rerun!.startBlock).toBe(51092200);
    expect(g.runs.rerun!.endpoint).toBe("base-mainnet.streamingfast.io:443");
    expect(g.assertions.map((a) => a.kind)).toContain("deterministic_rerun");
    expect(g.exitCodes).toEqual({ pass: 0, buildFailed: 10, runFailed: 20, assertionsFailed: 30 });
    expect(substreamsRunArgs("substreams.yaml", g.runs.primary!)).toEqual(["run", "substreams.yaml", "map_events", "-e", "base-mainnet.streamingfast.io:443", "-s", "51092200", "-t", "51093400", "-o", "jsonl", "--network", "base"]);
  });
  it("accepts snake_case and relative stop blocks, rejects unknown kinds", () => {
    const g = parseGateConfig({ package: { dir: "p" }, runs: { a: { module: "m", start_block: 10, stop_block: "+5", endpoint: "e" } }, assertions: [{ type: "rows-gt", threshold: 3 }] });
    expect(g.runs.a!.stopBlock).toBe(15);
    expect(g.assertions[0]).toMatchObject({ kind: "rows_gt", value: 3 });
    expect(() => parseGateConfig({ runs: { a: { module: "m", startBlock: 1, stopBlock: 2, endpoint: "e" } }, assertions: [{ kind: "bogus" }] })).toThrow(/unknown kind/);
    expect(() => parseGateConfig({ runs: {}, assertions: [{ kind: "rows_gt" }] })).toThrow(/at least one run/);
  });
});

describe("runGate exit codes", () => {
  it("passes on good fixtures (exit 0) and writes gate.json", async () => {
    const repo = await makeTempRepo(bufAvailable ? {} : { gateYaml: await withoutDescriptor() });
    try {
      const r = await runGate(repo.ctx, { runId: "t1" });
      expect(r.report.assertions.map((a) => [a.name, a.passed, a.detail])).toSatisfy((rows: unknown[][]) => rows.every((x) => x[1] === true));
      expect(r.exitCode).toBe(0);
      expect(r.report.status).toBe("passed");
      expect(r.report.ranges).toEqual(["51092200:51093400", "51092200:51093400"]);
      const onDisk = JSON.parse(await readFile(join(repo.root, "runs", "t1", "gate.json"), "utf8"));
      expect(onDisk.passed).toBe(true);
      expect(onDisk.package.name).toBe("erc4626-flows");
      expect(onDisk.toolVersions.substreams).toMatch(/1\.22\.0/);
      if (bufAvailable) expect(onDisk.descriptor.actualHash).toBe(onDisk.descriptor.expectedHash);
      const buildCall = repo.runner.fake.calls.find((c) => c.args[0] === "build");
      expect(buildCall?.opts.cwd).toBe(join(repo.root, "packages", "erc4626-flows"));
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("exits 10 on build failure", async () => {
    const repo = await makeTempRepo({ buildFails: true });
    try {
      const r = await runGate(repo.ctx, { runId: "t2" });
      expect(r.exitCode).toBe(10);
      expect(r.report.status).toBe("build_failed");
      expect(await readFile(join(repo.root, "runs", "t2", "build.log"), "utf8")).toMatch(/E0425/);
    } finally {
      await repo.cleanup();
    }
  });

  it("exits 20 on run failure", async () => {
    const repo = await makeTempRepo({ runFails: ["primary", "rerun"] });
    try {
      const r = await runGate(repo.ctx, { runId: "t3" });
      expect(r.exitCode).toBe(20);
      expect(r.report.status).toBe("run_failed");
      expect(r.report.error).toMatch(/failed with exit 1/);
    } finally {
      await repo.cleanup();
    }
  });

  it("exits 30 when assertions fail", async () => {
    const bad = await fixture("bad.jsonl");
    const repo = await makeTempRepo({ jsonl: { primary: bad, rerun: bad }, ...(bufAvailable ? {} : { gateYaml: await withoutDescriptor() }) });
    try {
      const r = await runGate(repo.ctx, { runId: "t4" });
      expect(r.exitCode).toBe(30);
      expect(r.report.status).toBe("assertions_failed");
      const failed = r.report.assertions.filter((a) => !a.passed).map((a) => a.name);
      expect(failed).toEqual(expect.arrayContaining(["known-vault-present", "observation-present", "execution-rate-sanity", "rpc-success"]));
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("exits 1 on a broken gate.yaml", async () => {
    const repo = await makeTempRepo({ gateYaml: "runs: {}\nassertions: []\n" });
    try {
      const r = await runGate(repo.ctx, { runId: "t5" });
      expect(r.exitCode).toBe(1);
      expect(r.report.status).toBe("config_error");
    } finally {
      await repo.cleanup();
    }
  });

  it("--reuse-runs evaluates existing jsonl without build/run", async () => {
    const repo = await makeTempRepo(bufAvailable ? {} : { gateYaml: await withoutDescriptor() });
    try {
      const first = await runGate(repo.ctx, { runId: "t6" });
      expect(first.exitCode).toBe(0);
      const before = repo.runner.fake.calls.length;
      const again = await runGate(repo.ctx, { runId: "t6", reuseRuns: true });
      expect(again.exitCode).toBe(0);
      expect(repo.runner.fake.calls.slice(before).some((c) => c.args[0] === "run" || c.args[0] === "build")).toBe(false);
      expect(again.report.build?.skipped).toBe(true);
    } finally {
      await repo.cleanup();
    }
  }, 60000);

  it("loads the real specs/gate.yaml when present", async () => {
    const real = join(import.meta.dirname, "..", "..", "..", "specs", "gate.yaml");
    const { access } = await import("node:fs/promises");
    try { await access(real); } catch { return; }
    const g = await loadGateConfig(real);
    expect(Object.keys(g.runs).length).toBeGreaterThan(0);
    expect(g.assertions.length).toBeGreaterThan(0);
  });
});
