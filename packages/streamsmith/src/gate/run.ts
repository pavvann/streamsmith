// Gate orchestrator: build → fixed-range runs → assertions → runs/<runId>/gate.json, deterministic exit codes.
import { join, resolve, isAbsolute } from "node:path";
import type { Ctx } from "../util/ctx.ts";
import { paths } from "../util/ctx.ts";
import { exists, newRunId, readText, writeJson, writeText } from "../util/fsx.ts";
import { sha256Hex } from "../util/hash.ts";
import { collectToolVersions } from "../util/tools.ts";
import { loadGateConfig, type GateConfig, type GateRunSpec } from "../config/gate.ts";
import { loadStreamsmithConfig, type StreamsmithConfig } from "../config/streamsmith.ts";
import { parseJsonlFile, TABLES, type ParsedRun } from "./jsonl.ts";
import { evaluateAssertions, summarize, type AssertionResult, type DescriptorEvidence } from "./assertions.ts";
import { contractDescriptor, packageDescriptor, protoPackageOf, substreamsInfo } from "../proto/descriptor.ts";

export type GateStatus = "passed" | "build_failed" | "run_failed" | "assertions_failed" | "config_error";

export interface GateRunReport {
  command: string;
  file: string;
  code: number;
  durationMs: number;
  lines: number;
  rows: Record<string, number>;
  blocks: [number | null, number | null];
  range: string;
  stderrFile?: string;
}

export interface GateReport {
  gateVersion: 1;
  runId: string;
  status: GateStatus;
  passed: boolean;
  exitCode: number;
  ranges: string[];
  assertions: AssertionResult[];
  toolVersions: Record<string, string>;
  build?: { command: string; code: number; durationMs: number; skipped: boolean; logFile?: string };
  runs: Record<string, GateRunReport>;
  package: { dir: string; manifest: string; spkg?: string; name?: string; version?: string; outputModule?: string; moduleHash?: string; outputType?: string; network?: string };
  descriptor?: DescriptorEvidence;
  gateConfigPath: string;
  gateConfigHash: string;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface GateOptions {
  gatePath?: string;
  streamsmithPath?: string;
  runId?: string;
  /** Skip build and runs; evaluate the jsonl already present in runs/<runId>/. */
  reuseRuns?: boolean;
  skipBuild?: boolean;
  /** Keep going after a failed assertion set is known (always true; exit code still reflects it). */
  verbose?: boolean;
}

export interface GateOutcome {
  exitCode: number;
  report: GateReport;
  reportPath: string;
}

export function substreamsRunArgs(manifest: string, spec: GateRunSpec): string[] {
  const args = ["run", manifest, spec.module, "-e", spec.endpoint, "-s", String(spec.startBlock), "-t", String(spec.stopBlock), "-o", "jsonl"];
  if (spec.network) args.push("--network", spec.network);
  for (const p of spec.params ?? []) args.push("-p", p);
  if (spec.productionMode) args.push("--production-mode");
  args.push(...(spec.extraArgs ?? []));
  return args;
}

export async function runGate(ctx: Ctx, opts: GateOptions = {}): Promise<GateOutcome> {
  const startedAt = ctx.now().toISOString();
  const runId = opts.runId ?? newRunId(ctx.now());
  const runDir = paths.runs(ctx, runId);
  const gatePath = resolve(ctx.root, opts.gatePath ?? paths.specs(ctx, "gate.yaml"));
  const reportPath = join(runDir, "gate.json");

  let gate: GateConfig;
  let gateText = "";
  let ss: StreamsmithConfig | undefined;
  try {
    gateText = await readText(gatePath);
    gate = await loadGateConfig(gatePath);
    const ssPath = resolve(ctx.root, opts.streamsmithPath ?? paths.specs(ctx, "streamsmith.yaml"));
    if (await exists(ssPath)) ss = await loadStreamsmithConfig(ssPath);
  } catch (err) {
    const report: GateReport = {
      gateVersion: 1, runId, status: "config_error", passed: false, exitCode: 1, ranges: [], assertions: [], toolVersions: {}, runs: {},
      package: { dir: "", manifest: "" }, gateConfigPath: gatePath, gateConfigHash: gateText ? sha256Hex(gateText) : "", startedAt, finishedAt: ctx.now().toISOString(),
      error: (err as Error).message,
    };
    await writeJson(reportPath, report);
    ctx.log(`gate: config error: ${report.error}`);
    return { exitCode: 1, report, reportPath };
  }

  const pkgDir = isAbsolute(gate.package.dir) ? gate.package.dir : join(ctx.root, gate.package.dir);
  const manifestPath = join(pkgDir, gate.package.manifest);
  const toolVersions = await collectToolVersions(ctx);
  const report: GateReport = {
    gateVersion: 1, runId, status: "passed", passed: false, exitCode: gate.exitCodes.pass, ranges: [], assertions: [], toolVersions, runs: {},
    package: { dir: gate.package.dir, manifest: gate.package.manifest }, gateConfigPath: gatePath, gateConfigHash: sha256Hex(gateText), startedAt, finishedAt: startedAt,
  };
  if (gate.package.outputModule) report.package.outputModule = gate.package.outputModule;
  const finish = async (status: GateStatus, exitCode: number, error?: string): Promise<GateOutcome> => {
    report.status = status;
    report.passed = status === "passed";
    report.exitCode = exitCode;
    report.finishedAt = ctx.now().toISOString();
    if (error) report.error = error;
    await writeJson(reportPath, report);
    ctx.log(`gate: ${status} (exit ${exitCode}) -> ${reportPath}`);
    return { exitCode, report, reportPath };
  };

  // 1. build
  if (!opts.reuseRuns && !opts.skipBuild && !gate.build.skip) {
    const [cmd, ...args] = gate.build.command;
    ctx.log(`gate: build in ${pkgDir}: ${gate.build.command.join(" ")}`);
    const r = await ctx.runner.run(cmd!, args, { cwd: pkgDir, timeoutMs: gate.build.timeoutSeconds * 1000, echoStderr: opts.verbose });
    const logFile = join(runDir, "build.log");
    await writeText(logFile, `$ ${r.command}\n# exit ${r.code}${r.timedOut ? " (timed out)" : ""} in ${r.durationMs}ms\n\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
    report.build = { command: r.command, code: r.code, durationMs: r.durationMs, skipped: false, logFile };
    if (r.code !== 0) return finish("build_failed", gate.exitCodes.buildFailed, `build failed with exit ${r.code}${r.timedOut ? " (timeout)" : ""}; see ${logFile}`);
  } else {
    report.build = { command: gate.build.command.join(" "), code: 0, durationMs: 0, skipped: true };
  }

  // package identity (name/version/module hash) — best effort, needs a built package
  let spkgPath: string | undefined;
  try {
    const info = await substreamsInfo(ctx, gate.package.manifest, pkgDir);
    report.package.name = info.name;
    report.package.version = info.version;
    report.package.network = info.network;
    const outMod = gate.package.outputModule ?? ss?.outputModule ?? Object.values(gate.runs)[0]?.module;
    const mod = info.modules?.find((m) => m.name === outMod);
    if (mod) {
      report.package.outputModule = mod.name;
      report.package.moduleHash = mod.hash;
      report.package.outputType = mod.output_type;
    }
    const candidate = gate.package.spkg ? join(pkgDir, gate.package.spkg) : info.name && info.version ? join(pkgDir, `${info.name.replace(/_/g, "-")}-${info.version}.spkg`) : undefined;
    if (candidate && (await exists(candidate))) {
      spkgPath = candidate;
      report.package.spkg = candidate;
    }
  } catch (err) {
    ctx.log(`gate: substreams info unavailable: ${(err as Error).message}`);
  }

  // 2. runs
  const parsed: Record<string, ParsedRun> = {};
  for (const [name, spec] of Object.entries(gate.runs)) {
    const file = join(runDir, `${name}.jsonl`);
    const stderrFile = join(runDir, `${name}.stderr.log`);
    const range = `${spec.startBlock}:${spec.stopBlock}`;
    report.ranges.push(range);
    const args = substreamsRunArgs(gate.package.manifest, spec);
    let code = 0;
    let durationMs = 0;
    let command = `substreams ${args.join(" ")}`;
    if (opts.reuseRuns) {
      if (!(await exists(file))) return finish("run_failed", gate.exitCodes.runFailed, `--reuse-runs: ${file} does not exist`);
    } else {
      ctx.log(`gate: run ${name} ${range} -> ${file}`);
      const r = await ctx.runner.run("substreams", args, { cwd: pkgDir, stdoutFile: file, timeoutMs: 60 * 60 * 1000, echoStderr: opts.verbose });
      await writeText(stderrFile, r.stderr);
      code = r.code;
      durationMs = r.durationMs;
      command = r.command;
      if (r.code !== 0) {
        report.runs[name] = { command, file, code, durationMs, lines: 0, rows: {}, blocks: [null, null], range, stderrFile };
        return finish("run_failed", gate.exitCodes.runFailed, `substreams run "${name}" failed with exit ${r.code}${r.timedOut ? " (timeout)" : ""}; see ${stderrFile}`);
      }
    }
    const p = await parseJsonlFile(file);
    parsed[name] = p;
    const rows: Record<string, number> = {};
    for (const t of TABLES) rows[t] = p.tables[t].length;
    report.runs[name] = { command, file, code, durationMs, lines: p.lines, rows, blocks: [p.minBlock ?? null, p.maxBlock ?? null], range, stderrFile };
    if (p.badLines > 0) ctx.log(`gate: run ${name}: ${p.badLines} unparseable lines`);
  }

  // 3. descriptor evidence (only if an assertion asks for it)
  const descSpec = gate.assertions.find((a) => a.kind === "descriptor_hash_match");
  if (descSpec) {
    const contractRel = descSpec.contract ?? ss?.contract ?? "specs/vaultflows.proto";
    const contractPath = isAbsolute(contractRel) ? contractRel : join(ctx.root, contractRel);
    const ev: DescriptorEvidence = { contract: contractRel, expectedHash: "" };
    try {
      const expected = await contractDescriptor(ctx, [contractPath]);
      ev.expectedHash = expected.hash;
      const pkgName = gate.package.protoPackage ?? protoPackageOf(await readText(contractPath));
      if (!pkgName) throw new Error(`cannot determine proto package of ${contractRel}`);
      const target = spkgPath ?? gate.package.manifest;
      const actual = await packageDescriptor(ctx, spkgPath ?? gate.package.manifest, pkgName, spkgPath ? undefined : pkgDir);
      ev.actualHash = actual.hash;
      ev.actualSource = target;
    } catch (err) {
      ev.error = (err as Error).message;
    }
    report.descriptor = ev;
  }

  // 4. assertions
  const defaultRun = Object.keys(gate.runs)[0]!;
  const inputs = {
    runs: parsed,
    defaultRun,
    configuredVaults: ss?.vaults.map((v) => v.address) ?? [],
    ...(ss ? { sampleIntervalBlocks: ss.sampleIntervalBlocks } : {}),
    ...(report.descriptor ? { descriptor: report.descriptor } : {}),
  };
  report.assertions = evaluateAssertions(gate.assertions, inputs);
  for (const a of report.assertions) ctx.log(`gate: [${a.passed ? "PASS" : "FAIL"}] ${a.name}: ${a.detail}`);
  const { passed } = summarize(report.assertions);
  if (!passed) return finish("assertions_failed", gate.exitCodes.assertionsFailed, `${report.assertions.filter((a) => !a.passed).length} assertion(s) failed`);
  return finish("passed", gate.exitCodes.pass);
}
