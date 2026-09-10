import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseSpecYaml } from "../src/util/yaml.ts";
import { runGate, runCommandArgv, templateVars, runOutputPath } from "../src/gate/run.ts";
import { parseGateConfig, loadGateConfig } from "../src/config/gate.ts";
import { makeTempRepo, hasBuf, runFixture, REPO_ROOT, fakeRpc } from "./helpers.ts";

const GATE_PATH = join(REPO_ROOT, "specs", "gate.yaml");
const bufAvailable = await hasBuf();
const realGate = await loadGateConfig(GATE_PATH);

/** Without buf the descriptor cannot be compiled; drop the assertions that need it so exit-0 paths stay testable. */
async function gateWithoutBuf(): Promise<string | undefined> {
  if (bufAvailable) return undefined;
  const g = parseSpecYaml<{ assertions: Array<{ name: string }> }>(await readFile(GATE_PATH, "utf8"));
  g.assertions = g.assertions.filter((a) => !["spec_unmodified", "descriptor_hash_match", "numeric_strings_valid", "addresses_lowercase", "output_decodes_against_contract"].includes(a.name));
  return YAML.stringify(g);
}

describe("specs/gate.yaml as written", () => {
  it("parses the runner contract: three runs in order, exclusive stop blocks, exit codes, 18 assertions with severities", () => {
    expect(Object.keys(realGate.runs)).toEqual(["primary", "primary_rerun", "observation"]);
    expect(realGate.runs.primary).toMatchObject({ module: "map_events", startBlock: 51092254, stopBlock: 51092454, timeoutSeconds: 1800, output: "runs/${runId}/primary.jsonl" });
    expect(realGate.runs.primary_rerun).toMatchObject({ sameAs: "primary", startBlock: 51092254, stopBlock: 51092454, timeoutSeconds: 1800 });
    expect(realGate.runs.observation).toMatchObject({ startBlock: 51092998, stopBlock: 51093002 });
    expect(realGate.exitCodes).toEqual({ pass: 0, buildFailed: 10, runFailed: 20, assertionFailed: 30 });
    expect(realGate.endpoint).toBe("base-mainnet.streamingfast.io:443");
    expect(realGate.network).toBe("base");
    expect(realGate.authEnvAny).toEqual(["SUBSTREAMS_API_TOKEN", "SUBSTREAMS_API_KEY"]);
    expect(realGate.assertions).toHaveLength(18);
    expect(realGate.assertions.filter((a) => a.severity === "warn").map((a) => a.name)).toEqual(["log_index_matches_rpc", "observation_matches_reference"]);
    expect(realGate.configuredVaults).toEqual(["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
    expect(realGate.expectedSpecSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(realGate.rowExtraction).toEqual({ decodeWith: "specs/vaultflows.proto", rejectUnknownFields: true, expectType: "vaultflows.v1.Events" });
    expect(realGate.build.expectedOutputs[0]).toBe("${package.dir}/erc4626-flows-v0.1.0.spkg");
  });

  it("expands runCommand with the file's variables (${spkg} = first expectedOutputs entry)", () => {
    const vars = templateVars(realGate, "r1");
    expect(vars.spkg).toBe("packages/erc4626-flows/erc4626-flows-v0.1.0.spkg");
    expect(runCommandArgv(realGate, realGate.runs.primary!, vars)).toEqual(["substreams", "run", "-e", "base-mainnet.streamingfast.io:443", "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg", "map_events", "-s", "51092254", "-t", "51092454", "--network", "base", "-o", "jsonl", "--limit-processed-blocks", "0"]);
    expect(runCommandArgv(realGate, realGate.runs.observation!, vars).slice(6, 10)).toEqual(["-s", "51092998", "-t", "51093002"]);
    // the guard flag is not duplicated when the file already carries it
    const withFlag = { ...realGate, runCommand: realGate.runCommand + " --limit-processed-blocks 0" };
    expect(runCommandArgv(withFlag, realGate.runs.primary!, vars).filter((a) => a === "--limit-processed-blocks")).toHaveLength(1);
    const ctx = { root: "/repo" } as never;
    expect(runOutputPath(ctx, realGate, realGate.runs.primary_rerun!, "r1")).toBe("/repo/runs/r1/primary_rerun.jsonl");
  });

  it("accepts snake_case keys, relative stop blocks and sameAs; rejects bad severities, unknown sameAs and empty runs", () => {
    const g = parseGateConfig({ package: { dir: "p" }, runs: { a: { module: "m", start_block: 10, stop_block: "+5" }, b: { sameAs: "a", timeoutSeconds: 7 } }, assertions: [{ name: "rows_gt", min: 3, in: "vault_flows" }] });
    expect(g.runs.a!.stopBlock).toBe(15);
    expect(g.runs.b).toMatchObject({ startBlock: 10, stopBlock: 15, module: "m", timeoutSeconds: 7, sameAs: "a" });
    expect(g.assertions[0]).toMatchObject({ kind: "rows_gt", min: 3, table: "vault_flows", severity: "fail" });
    expect(() => parseGateConfig({ runs: { a: { module: "m", startBlock: 1, stopBlock: 2 } }, assertions: [{ name: "x", severity: "maybe" }] })).toThrow(/unknown severity/);
    expect(() => parseGateConfig({ runs: { b: { sameAs: "a" } }, assertions: [{ name: "x" }] })).toThrow(/must be declared earlier/);
    expect(() => parseGateConfig({ runs: {}, assertions: [{ name: "rows_gt" }] })).toThrow(/at least one run/);
    expect(() => parseGateConfig({ runs: { a: { module: "m", startBlock: 5, stopBlock: 5 } }, assertions: [{ name: "x" }] })).toThrow(/exclusive/);
  });
});

describe("runGate over specs/gate.yaml (build and runs faked; buf and substreams info/pack real when installed)", () => {
  it("exits 0 on fixtures that satisfy the file and writes runs/<id>/gate.json", async () => {
    const repo = await makeTempRepo({ gateYaml: await gateWithoutBuf() });
    try {
      const r = await runGate(repo.ctx, { runId: "t1", offline: true });
      const failed = r.report.assertions.filter((a) => !a.passed).map((a) => `${a.name}: ${a.detail}`);
      expect(failed).toEqual([]);
      expect(r.exitCode).toBe(0);
      expect(r.report.status).toBe("passed");
      expect(r.report.passed).toBe(true);
      expect(r.report.ranges).toEqual(["51092254:51092454", "51092254:51092454", "51092998:51093002"]);
      expect(r.report.warnings).toEqual([]);
      expect(Object.keys(r.report.runs)).toEqual(["primary", "primary_rerun", "observation"]);
      expect(r.report.runs.primary).toMatchObject({ lines: 5, badLines: 0, rows: { vault_flows: 5, share_value_observations: 0 }, blocks: [51092263, 51092449], file: "runs/t1/primary.jsonl", range: "51092254:51092454" });
      expect(r.report.runs.observation!.rows.share_value_observations).toBe(2);
      const onDisk = JSON.parse(await readFile(join(repo.root, "runs", "t1", "gate.json"), "utf8"));
      expect(onDisk.passed).toBe(true);
      expect(onDisk.package).toMatchObject({ name: "erc4626-flows", version: "v0.1.0", network: "base", outputModule: "map_events", spkg: "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg" });
      expect(onDisk.package.spkgSha256).toHaveLength(64);
      expect(onDisk.package.moduleHash).toMatch(/^[0-9a-f]{40}$/);
      expect(onDisk.package.moduleHashes.map_events).toBe(onDisk.package.moduleHash);
      expect(onDisk.build.expectedOutputs).toEqual({ "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg": true, "packages/erc4626-flows/target/wasm32-unknown-unknown/release/erc4626_flows.wasm": true });
      if (bufAvailable) {
        expect(onDisk.descriptor).toMatchObject({ contract: "specs/vaultflows.proto", protoPackage: "vaultflows.v1", specHash: realGate.expectedSpecSha256, rendererMatch: true });
        expect(onDisk.descriptor.spkgHash).toBe(onDisk.descriptor.specHash);
      }
      // build ran in ${package.dir}; runs ran from the repo root with the file's command
      const buildCall = repo.runner.fake.calls.find((c) => c.cmd === "substreams" && c.args[0] === "build");
      expect(buildCall?.opts.cwd).toBe(repo.pkgDir);
      const runCalls = repo.runner.fake.calls.filter((c) => c.cmd === "substreams" && c.args[0] === "run");
      expect(runCalls.map((c) => c.args.slice(0, 6))).toEqual(Array(3).fill(["run", "-e", "base-mainnet.streamingfast.io:443", "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg", "map_events", "-s"]));
      expect(runCalls.map((c) => c.opts.timeoutMs)).toEqual([1800000, 1800000, 1800000]);
      expect(runCalls.every((c) => c.args.includes("--limit-processed-blocks") && c.args[c.args.indexOf("--limit-processed-blocks") + 1] === "0")).toBe(true);
      // warn-level RPC checks were skipped, not failed
      expect(r.report.assertions.find((a) => a.name === "log_index_matches_rpc")).toMatchObject({ passed: true, severity: "warn" });
      expect(r.report.assertions.find((a) => a.name === "log_index_matches_rpc")!.detail).toMatch(/skipped/);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

  it("warn-level failures are recorded but never change the exit code", async () => {
    const obs = (await runFixture("observation.jsonl")).replace('"assetsPerShareRaw": "1040743"', '"assetsPerShareRaw": "1040744"');
    expect(obs).toContain("1040744"); // guard: the fixture's JSON formatting must still match this replace
    const repo = await makeTempRepo({ gateYaml: await gateWithoutBuf(), runs: { primary: await runFixture("primary.jsonl"), primary_rerun: await runFixture("primary.jsonl"), observation: obs } });
    try {
      const r = await runGate(repo.ctx, { runId: "t-warn", offline: true });
      expect(r.exitCode).toBe(0);
      expect(r.report.passed).toBe(true);
      expect(r.report.warnings).toEqual(["observation_matches_reference"]);
      const w = r.report.assertions.find((a) => a.name === "observation_matches_reference")!;
      expect(w).toMatchObject({ severity: "warn", passed: false });
      expect(w.detail).toMatch(/1040744 != listed 1040743/);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

  it("uses the live RPC for the warn-level cross-checks when it answers", async () => {
    const rpc = fakeRpc({
      receipts: {
        "0x0fe8b63d99cbe6eac9baab1967e9011d7de8a52fa6d5d210b15b4aa4c80a12b4": { blockNumber: 51092263, logs: [{ address: "0x050ce30b927da55177a4914ec73480238bad56f0", logIndex: 406 }] },
        "0xf3188ffdb3d650e0f0a876391700726684bbb25ff54f802aea1dd87af514973b": { blockNumber: 51092316, logs: [{ address: "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", logIndex: 163 }] },
        "0x640557be0ab1dae20ea52973bdee493f7851919e2bdd745412bd8160876fd751": { blockNumber: 51092402, logs: [{ address: "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", logIndex: 521 }] },
        "0x4388fe4a9820e592dc85a9e140722c6c23ad28826f50a81399ed07c9a22d06c0": { blockNumber: 51092449, logs: [{ address: "0x050ce30b927da55177a4914ec73480238bad56f0", logIndex: 835 }] }, // wrong index on purpose
      },
      calls: { "0x050ce30b927da55177a4914ec73480238bad56f0@51093000": "1040743", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9@51093000": "1039913" },
    });
    const repo = await makeTempRepo({ gateYaml: await gateWithoutBuf(), fetch: rpc.fetch });
    try {
      const r = await runGate(repo.ctx, { runId: "t-rpc", rpcUrl: "https://rpc.test" });
      expect(r.exitCode).toBe(0); // both are warn-level
      expect(r.report.rpc).toMatchObject({ url: "https://rpc.test", reachable: true, chainId: 8453, receipts: 4, calls: 2 });
      const li = r.report.assertions.find((a) => a.name === "log_index_matches_rpc")!;
      expect(li.passed).toBe(false);
      expect(li.detail).toMatch(/has no log at block-wide index 836/);
      const om = r.report.assertions.find((a) => a.name === "observation_matches_reference")!;
      expect(om.passed).toBe(true);
      expect(om.detail).toMatch(/2 vault\(s\) confirmed by live eth_call/);
      expect(rpc.calls.filter((c) => c.method === "eth_call").map((c) => c.params[1])).toEqual(["0x30b9e08", "0x30b9e08"]);
      expect(r.report.warnings).toEqual(["log_index_matches_rpc"]);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

  it("exits 10 on build failure and on a build that leaves expectedOutputs missing", async () => {
    const repo = await makeTempRepo({ buildFails: true });
    try {
      const r = await runGate(repo.ctx, { runId: "t2", offline: true });
      expect(r.exitCode).toBe(10);
      expect(r.report.status).toBe("build_failed");
      expect(await readFile(join(repo.root, "runs", "t2", "build.log"), "utf8")).toMatch(/E0425/);
      expect(repo.runner.fake.calls.some((c) => c.args[0] === "run")).toBe(false);
    } finally {
      await repo.cleanup();
    }
    const repo2 = await makeTempRepo({ buildProducesNothing: true });
    try {
      const r = await runGate(repo2.ctx, { runId: "t2b", offline: true });
      expect(r.exitCode).toBe(10);
      expect(r.report.error).toMatch(/expected output\(s\) missing: packages\/erc4626-flows\/erc4626-flows-v0.1.0.spkg/);
    } finally {
      await repo2.cleanup();
    }
  }, 60000);

  it("exits 20 on a failed run, on zero lines, and on unparseable jsonl", async () => {
    const repo = await makeTempRepo({ runFails: ["primary"] });
    try {
      const r = await runGate(repo.ctx, { runId: "t3", offline: true });
      expect(r.exitCode).toBe(20);
      expect(r.report.status).toBe("run_failed");
      expect(r.report.error).toMatch(/"primary" failed with exit 1/);
      expect(await readFile(join(repo.root, "runs", "t3", "primary.stderr.log"), "utf8")).toMatch(/Unauthenticated/);
    } finally {
      await repo.cleanup();
    }
    const empty = await makeTempRepo({ runs: { primary: await runFixture("primary.jsonl"), primary_rerun: "", observation: await runFixture("observation.jsonl") } });
    try {
      const r = await runGate(empty.ctx, { runId: "t3b", offline: true });
      expect(r.exitCode).toBe(20);
      expect(r.report.error).toMatch(/"primary_rerun" produced zero jsonl lines/);
    } finally {
      await empty.cleanup();
    }
    const junk = await makeTempRepo({ runs: { primary: await runFixture("unparseable.jsonl"), primary_rerun: await runFixture("primary.jsonl"), observation: await runFixture("observation.jsonl") } });
    try {
      const r = await runGate(junk.ctx, { runId: "t3c", offline: true });
      expect(r.exitCode).toBe(20);
      expect(r.report.error).toMatch(/2 of 3 lines are not JSON objects/);
    } finally {
      await junk.cleanup();
    }
  }, 120000);

  it("exits 30 when fail-level assertions fail, naming them", async () => {
    const bad = await runFixture("bad-primary.jsonl");
    const repo = await makeTempRepo({ gateYaml: await gateWithoutBuf(), runs: { primary: bad, primary_rerun: bad, observation: await runFixture("bad-observation.jsonl") } });
    try {
      const r = await runGate(repo.ctx, { runId: "t4", offline: true });
      expect(r.exitCode).toBe(30);
      expect(r.report.status).toBe("assertions_failed");
      const failed = r.report.assertions.filter((a) => !a.passed && a.severity === "fail").map((a) => a.name);
      expect(failed).toEqual(expect.arrayContaining(["known_vault_present", "reference_flows_present", "execution_rate_sanity", "observation_present", "rpc_success_ratio_gte", "ids_unique"]));
      if (bufAvailable) expect(failed).toEqual(expect.arrayContaining(["numeric_strings_valid", "addresses_lowercase", "output_decodes_against_contract"]));
      expect(failed).not.toContain("deterministic_rerun");
      expect(r.report.error).toMatch(/fail-level assertion\(s\) failed: /);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

  it.skipIf(!bufAvailable)("exits 30 with 'renderer mismatch' when buf's two protojson renderings disagree", async () => {
    const tampered = JSON.stringify({ file: [{ name: "vaultflows.proto", package: "vaultflows.v1", messageType: [] }] });
    const repo = await makeTempRepo({ fakeBufConvert: tampered });
    try {
      const r = await runGate(repo.ctx, { runId: "t-renderer", offline: true });
      expect(r.exitCode).toBe(30);
      expect(r.report.descriptor?.rendererMatch).toBe(false);
      expect(r.report.assertions.find((a) => a.name === "descriptor_hash_match")!.detail).toBe("renderer mismatch");
      expect(r.report.assertions.find((a) => a.name === "spec_unmodified")!.detail).toMatch(/renderer mismatch/);
    } finally {
      await repo.cleanup();
    }
  }, 120000);

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

  it("--reuse-runs evaluates the existing jsonl without build or run", async () => {
    const repo = await makeTempRepo({ gateYaml: await gateWithoutBuf() });
    try {
      const first = await runGate(repo.ctx, { runId: "t6", offline: true });
      expect(first.exitCode).toBe(0);
      const before = repo.runner.fake.calls.length;
      const again = await runGate(repo.ctx, { runId: "t6", reuseRuns: true, offline: true });
      expect(again.exitCode).toBe(0);
      expect(repo.runner.fake.calls.slice(before).some((c) => c.args[0] === "run" || c.args[0] === "build")).toBe(false);
      expect(again.report.build?.skipped).toBe(true);
      expect(again.report.runs.primary?.reused).toBe(true);
      const missing = await runGate(repo.ctx, { runId: "t6-missing", reuseRuns: true, offline: true });
      expect(missing.exitCode).toBe(20);
      expect(missing.report.error).toMatch(/--reuse-runs: runs\/t6-missing\/primary.jsonl does not exist/);
    } finally {
      await repo.cleanup();
    }
  }, 120000);
});
