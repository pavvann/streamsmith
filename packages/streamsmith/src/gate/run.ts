// Gate orchestrator — executes specs/gate.yaml as written (see its "Runner contract" header):
//   build -> runs (in file order) -> assertions -> runs/<runId>/gate.json
// Exit codes come from gate.yaml `exitCodes`: 0 every `severity: fail` assertion passed; 10 build failed (non-zero
// exit, timeout, or an expectedOutput missing); 20 a run failed (non-zero exit, timeout, unparseable jsonl, zero
// lines); 30 a `severity: fail` assertion failed. `severity: warn` results are recorded and never change the code.
import { join, resolve, isAbsolute, relative } from "node:path";
import type { Ctx } from "../util/ctx.ts";
import { paths } from "../util/ctx.ts";
import { exists, newRunId, readText, writeJson, writeText } from "../util/fsx.ts";
import { sha256Hex, sha256File } from "../util/hash.ts";
import { collectToolVersions } from "../util/tools.ts";
import { loadGateConfig, expandTemplate, type GateConfig, type GateRunSpec } from "../config/gate.ts";
import { loadStreamsmithConfig, type StreamsmithConfig } from "../config/streamsmith.ts";
import { decodeRun, type ParsedRun } from "./jsonl.ts";
import { ContractSchema } from "./contract.ts";
import { evaluateAssertions, exitStatus, type AssertionResult, type AssertionInputs, type DescriptorEvidence } from "./assertions.ts";
import { specDescriptor, spkgDescriptor, substreamsInfo, protoPackageOf, type SubstreamsInfo, type DescriptorResult } from "../proto/descriptor.ts";
import { gatherRpcEvidence, type RpcEvidence } from "./rpc.ts";

export type GateStatus = "passed" | "build_failed" | "run_failed" | "assertions_failed" | "config_error";

export interface GateRunReport {
  command: string;
  /** jsonl path, relative to the repo root */
  file: string;
  code: number;
  durationMs: number;
  timedOut?: boolean;
  lines: number;
  badLines: number;
  rows: Record<string, number>;
  blocks: [number | null, number | null];
  /** "start:stop" (stop exclusive) */
  range: string;
  stderrFile?: string;
  reused?: boolean;
}

export interface GateReport {
  gateVersion: 1;
  runId: string;
  status: GateStatus;
  passed: boolean;
  exitCode: number;
  /** one entry per run, "start:stop" — matches specs/receipt.schema.json gate.ranges */
  ranges: string[];
  assertions: AssertionResult[];
  /** names of warn-level assertions that did not pass (never affect exitCode) */
  warnings: string[];
  toolVersions: Record<string, string>;
  build?: { command: string; cwd: string; code: number; durationMs: number; skipped: boolean; timedOut?: boolean; logFile?: string; expectedOutputs: Record<string, boolean> };
  runs: Record<string, GateRunReport>;
  package: { dir: string; manifest: string; spkg?: string; spkgSha256?: string; name?: string; version?: string; outputModule?: string; moduleHash?: string; moduleHashes?: Record<string, string>; outputType?: string; network?: string; infoError?: string };
  descriptor?: DescriptorEvidence;
  rpc?: Omit<RpcEvidence, "receipts" | "convertToAssets"> & { receipts: number; calls: number };
  endpoint?: string;
  network?: string;
  authEnvPresent?: boolean;
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
  /** Skip build and runs; evaluate the jsonl already present at each run's output path. */
  reuseRuns?: boolean;
  skipBuild?: boolean;
  verbose?: boolean;
  /** Do not touch the public RPC for the warn-level cross-checks. */
  offline?: boolean;
  rpcUrl?: string;
}

export interface GateOutcome {
  exitCode: number;
  report: GateReport;
  reportPath: string;
}

export interface TemplateVars extends Record<string, string | number | undefined> {
  "package.dir": string;
  spkg: string;
  endpoint: string | undefined;
  network: string | undefined;
  runId: string;
}

/** ${spkg} is the first build.expectedOutputs entry (gate.yaml "Variables"). */
export function templateVars(gate: GateConfig, runId: string): TemplateVars {
  const base: Record<string, string | number | undefined> = { "package.dir": gate.package.dir, endpoint: gate.endpoint, network: gate.network, runId };
  const first = gate.build.expectedOutputs[0];
  const spkg = first ? expandTemplate(first, base) : join(gate.package.dir, `${(gate.package.name ?? "package").replace(/_/g, "-")}-${gate.package.version ?? "v0.0.0"}.spkg`);
  return { ...base, spkg } as TemplateVars;
}

/**
 * The `substreams run …` argv for one run, from gate.yaml `runCommand` with the run's variables substituted.
 * `--limit-processed-blocks 0` is always present: substreams v1.22.0 refuses any request that would process more
 * than 10,000 blocks (stores included) unless the guard is disabled, and the gate ranges prepare stores from
 * initialBlock (gate.yaml primary run comment).
 */
export const LIMIT_PROCESSED_BLOCKS_FLAG = "--limit-processed-blocks";
export function runCommandArgv(gate: GateConfig, run: GateRunSpec, vars: TemplateVars): string[] {
  const expanded = expandTemplate(gate.runCommand, { ...vars, module: run.module, startBlock: run.startBlock, stopBlock: run.stopBlock });
  const argv = expanded.trim().split(/\s+/);
  argv.push(...run.extraFlags);
  if (!argv.some((a) => a === LIMIT_PROCESSED_BLOCKS_FLAG || a.startsWith(`${LIMIT_PROCESSED_BLOCKS_FLAG}=`))) argv.push(LIMIT_PROCESSED_BLOCKS_FLAG, "0");
  const unresolved = argv.filter((a) => /\$\{[\w.]+\}/.test(a));
  if (unresolved.length) throw new Error(`runCommand has unresolved variables: ${unresolved.join(" ")}`);
  return argv;
}

export function runOutputPath(ctx: Ctx, gate: GateConfig, run: GateRunSpec, runId: string): string {
  const rel = run.output ? expandTemplate(run.output, { runId, "package.dir": gate.package.dir }) : join("runs", runId, `${run.name}.jsonl`);
  return isAbsolute(rel) ? rel : join(ctx.root, rel);
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
    const ssPath = resolve(ctx.root, opts.streamsmithPath ?? gate.contract.configuration ?? paths.specs(ctx, "streamsmith.yaml"));
    if (await exists(ssPath)) ss = await loadStreamsmithConfig(ssPath);
  } catch (err) {
    const report: GateReport = {
      gateVersion: 1, runId, status: "config_error", passed: false, exitCode: 1, ranges: [], assertions: [], warnings: [], toolVersions: {}, runs: {},
      package: { dir: "", manifest: "" }, gateConfigPath: gatePath, gateConfigHash: gateText ? sha256Hex(gateText) : "", startedAt, finishedAt: ctx.now().toISOString(),
      error: (err as Error).message,
    };
    await writeJson(reportPath, report);
    ctx.log(`gate: config error: ${report.error}`);
    return { exitCode: 1, report, reportPath };
  }

  const vars = templateVars(gate, runId);
  const pkgDir = isAbsolute(gate.package.dir) ? gate.package.dir : join(ctx.root, gate.package.dir);
  const spkgPath = isAbsolute(vars.spkg) ? vars.spkg : join(ctx.root, vars.spkg);
  const toolVersions = await collectToolVersions(ctx);
  const report: GateReport = {
    gateVersion: 1, runId, status: "passed", passed: false, exitCode: gate.exitCodes.pass, ranges: Object.values(gate.runs).map((r) => `${r.startBlock}:${r.stopBlock}`),
    assertions: [], warnings: [], toolVersions, runs: {},
    package: { dir: gate.package.dir, manifest: gate.package.manifest, spkg: vars.spkg },
    gateConfigPath: gatePath, gateConfigHash: sha256Hex(gateText), startedAt, finishedAt: startedAt,
  };
  for (const k of ["name", "version", "outputModule", "outputType"] as const) if (gate.package[k]) report.package[k] = gate.package[k]!;
  if (gate.endpoint) report.endpoint = gate.endpoint;
  if (gate.network) report.network = gate.network;
  report.authEnvPresent = gate.authEnvAny.some((k) => Boolean(ctx.env[k]));

  const finish = async (status: GateStatus, exitCode: number, error?: string): Promise<GateOutcome> => {
    report.status = status;
    report.passed = status === "passed";
    report.exitCode = exitCode;
    report.finishedAt = ctx.now().toISOString();
    if (error) report.error = error;
    await writeJson(reportPath, report);
    ctx.log(`gate: ${status} (exit ${exitCode}) -> ${relative(ctx.root, reportPath)}`);
    return { exitCode, report, reportPath };
  };

  // ---- 1. build ----
  const buildCwd = expandTemplate(gate.build.cwd, vars);
  const buildCwdAbs = isAbsolute(buildCwd) ? buildCwd : join(ctx.root, buildCwd);
  const expectedOutputs = gate.build.expectedOutputs.map((p) => expandTemplate(p, vars));
  const outputsPresent = async (): Promise<Record<string, boolean>> => {
    const out: Record<string, boolean> = {};
    for (const p of expectedOutputs) out[p] = await exists(isAbsolute(p) ? p : join(ctx.root, p));
    return out;
  };
  if (!opts.reuseRuns && !opts.skipBuild) {
    const [cmd, ...args] = gate.build.command;
    ctx.log(`gate: build in ${buildCwd}: ${gate.build.command.join(" ")}`);
    const r = await ctx.runner.run(cmd!, args, { cwd: buildCwdAbs, timeoutMs: gate.build.timeoutSeconds * 1000, echoStderr: opts.verbose });
    const logFile = join(runDir, "build.log");
    await writeText(logFile, `$ ${r.command}\n# cwd ${buildCwd}\n# exit ${r.code}${r.timedOut ? " (timed out)" : ""} in ${r.durationMs}ms\n\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
    const present = await outputsPresent();
    report.build = { command: r.command, cwd: buildCwd, code: r.code, durationMs: r.durationMs, skipped: false, logFile: relative(ctx.root, logFile), expectedOutputs: present };
    if (r.timedOut) report.build.timedOut = true;
    if (r.code !== 0) return finish("build_failed", gate.exitCodes.buildFailed, `build failed with exit ${r.code}${r.timedOut ? " (timeout)" : ""}; see ${relative(ctx.root, logFile)}`);
    const missing = Object.entries(present).filter(([, ok]) => !ok).map(([p]) => p);
    if (missing.length) return finish("build_failed", gate.exitCodes.buildFailed, `build exited 0 but expected output(s) missing: ${missing.join(", ")}`);
  } else {
    report.build = { command: gate.build.command.join(" "), cwd: buildCwd, code: 0, durationMs: 0, skipped: true, expectedOutputs: await outputsPresent() };
  }
  if (await exists(spkgPath)) report.package.spkgSha256 = await sha256File(spkgPath);

  // ---- contract descriptor (needed to decode rows; gate.yaml rowExtraction) ----
  const contractRel = gate.rowExtraction.decodeWith ?? gate.contract.proto;
  const contractPath = isAbsolute(contractRel) ? contractRel : join(ctx.root, contractRel);
  let spec: DescriptorResult | undefined;
  const descriptor: DescriptorEvidence = { contract: contractRel, protoPackage: gate.contract.protoPackage ?? "" };
  if (gate.expectedSpecSha256) descriptor.expectedSpecSha256 = gate.expectedSpecSha256;
  try {
    const source = await readText(contractPath);
    descriptor.protoPackage = gate.contract.protoPackage ?? protoPackageOf(source) ?? "";
    if (!descriptor.protoPackage) throw new Error(`cannot determine proto package of ${contractRel}`);
    spec = await specDescriptor(ctx, contractPath, descriptor.protoPackage);
    descriptor.specHash = spec.hash;
    if (spec.hashViaConvert !== undefined) descriptor.specHashViaConvert = spec.hashViaConvert;
    if (spec.rendererMatch !== undefined) descriptor.rendererMatch = spec.rendererMatch;
  } catch (err) {
    descriptor.error = (err as Error).message;
    ctx.log(`gate: contract descriptor unavailable (${descriptor.error}); rows will be parsed loosely`);
  }
  const rootType = gate.rowExtraction.expectType ?? gate.package.outputType?.replace(/^proto:/, "") ?? `${descriptor.protoPackage}.Events`;
  const schema = spec ? new ContractSchema(spec.fds, descriptor.protoPackage) : undefined;

  // ---- 2. runs ----
  const parsed: Record<string, ParsedRun> = {};
  const runTexts: Record<string, string> = {};
  if (!opts.reuseRuns && !report.authEnvPresent) ctx.log(`gate: none of ${gate.authEnvAny.join(", ")} is set; substreams run will likely fail with Unauthenticated`);
  for (const run of Object.values(gate.runs)) {
    const file = runOutputPath(ctx, gate, run, runId);
    const fileRel = relative(ctx.root, file);
    const stderrFile = join(runDir, `${run.name}.stderr.log`);
    const range = `${run.startBlock}:${run.stopBlock}`;
    const argv = runCommandArgv(gate, run, vars);
    const entry: GateRunReport = { command: argv.join(" "), file: fileRel, code: 0, durationMs: 0, lines: 0, badLines: 0, rows: {}, blocks: [null, null], range };
    report.runs[run.name] = entry;
    if (opts.reuseRuns) {
      entry.reused = true;
      if (!(await exists(file))) return finish("run_failed", gate.exitCodes.runFailed, `--reuse-runs: ${fileRel} does not exist`);
    } else {
      ctx.log(`gate: run ${run.name} ${range} -> ${fileRel}`);
      const [cmd, ...args] = argv;
      const r = await ctx.runner.run(cmd!, args, { cwd: ctx.root, stdoutFile: file, timeoutMs: run.timeoutSeconds * 1000, echoStderr: opts.verbose });
      await writeText(stderrFile, r.stderr);
      entry.command = r.command;
      entry.code = r.code;
      entry.durationMs = r.durationMs;
      entry.stderrFile = relative(ctx.root, stderrFile);
      if (r.timedOut) entry.timedOut = true;
      if (r.code !== 0) return finish("run_failed", gate.exitCodes.runFailed, `substreams run "${run.name}" failed with exit ${r.code}${r.timedOut ? " (timeout)" : ""}; see ${entry.stderrFile}`);
    }
    const text = await readText(file);
    runTexts[run.name] = text;
    const p = decodeRun(run.name, text, { rootType, module: run.module, rejectUnknownFields: gate.rowExtraction.rejectUnknownFields, ...(schema ? { schema } : {}) });
    parsed[run.name] = p;
    entry.lines = p.lines;
    entry.badLines = p.badLines;
    for (const [t, rows] of Object.entries(p.tables)) entry.rows[t] = rows.length;
    entry.blocks = [p.minBlock ?? null, p.maxBlock ?? null];
    if (p.lines === 0) return finish("run_failed", gate.exitCodes.runFailed, `run "${run.name}" produced zero jsonl lines (${fileRel})`);
    if (p.badLines > 0) return finish("run_failed", gate.exitCodes.runFailed, `run "${run.name}": ${p.badLines} of ${p.lines} lines are not JSON objects (${fileRel})`);
  }

  // ---- package evidence (spkg side): descriptor + substreams info ----
  let spkgInfo: SubstreamsInfo | undefined;
  let spkgInfoError: string | undefined;
  if (await exists(spkgPath)) {
    descriptor.spkgPath = vars.spkg;
    if (spec && !descriptor.error) {
      try {
        descriptor.spkgHash = (await spkgDescriptor(ctx, spkgPath, descriptor.protoPackage)).hash;
      } catch (err) {
        descriptor.error = `spkg side: ${(err as Error).message}`;
      }
    }
    try {
      spkgInfo = await substreamsInfo(ctx, spkgPath, { expandNetworks: true });
      if (spkgInfo.name) report.package.name = spkgInfo.name.replace(/_/g, "-");
      if (spkgInfo.version) report.package.version = spkgInfo.version;
      if (spkgInfo.network) report.package.network = spkgInfo.network;
      const outMod = gate.package.outputModule ?? ss?.outputModule ?? Object.values(gate.runs)[0]?.module;
      const mod = spkgInfo.modules?.find((m) => m.name === outMod);
      if (mod) {
        report.package.outputModule = mod.name;
        if (mod.hash) report.package.moduleHash = mod.hash;
        if (mod.output_type) report.package.outputType = mod.output_type;
      }
      const hashes = moduleHashesOf(spkgInfo);
      if (Object.keys(hashes).length) report.package.moduleHashes = hashes;
    } catch (err) {
      spkgInfoError = (err as Error).message;
      report.package.infoError = spkgInfoError;
      ctx.log(`gate: substreams info unavailable: ${spkgInfoError}`);
    }
  } else {
    spkgInfoError = `spkg not found at ${vars.spkg}`;
    report.package.infoError = spkgInfoError;
  }
  report.descriptor = descriptor;

  // ---- files for banned_words ----
  const files: Record<string, string | undefined> = {};
  for (const a of gate.assertions) for (const f of a.files ?? []) {
    const rel = expandTemplate(f, vars);
    const abs = isAbsolute(rel) ? rel : join(ctx.root, rel);
    files[rel] = (await exists(abs)) ? await readText(abs) : undefined;
  }

  // ---- live RPC evidence for the warn-level cross-checks ----
  const rpcOpts: Parameters<typeof gatherRpcEvidence>[2] = { shareDecimals: 18 };
  if (opts.offline) rpcOpts.offline = true;
  if (opts.rpcUrl) rpcOpts.rpcUrl = opts.rpcUrl;
  const rpc = await gatherRpcEvidence(ctx, gate, rpcOpts);
  if (rpc) {
    const { receipts, convertToAssets, ...rest } = rpc;
    report.rpc = { ...rest, receipts: Object.keys(receipts).length, calls: Object.keys(convertToAssets).length };
  }

  // ---- 3. assertions ----
  const inputs: AssertionInputs = {
    gate,
    rootType,
    runs: parsed,
    runTexts,
    descriptor,
    files,
    configuredVaults: gate.configuredVaults.length ? gate.configuredVaults : ss?.vaults.map((v) => v.address) ?? [],
  };
  if (ss) inputs.streamsmith = ss;
  if (schema) inputs.schema = schema;
  if (spkgInfo) inputs.spkgInfo = spkgInfo;
  if (spkgInfoError) inputs.spkgInfoError = spkgInfoError;
  if (rpc) inputs.rpc = rpc;
  report.assertions = evaluateAssertions(gate.assertions, inputs);
  for (const a of report.assertions) ctx.log(`gate: [${a.passed ? "PASS" : a.severity === "warn" ? "WARN" : "FAIL"}] ${a.name}: ${a.detail}`);
  const { passed, failed, warned } = exitStatus(report.assertions);
  report.warnings = warned.map((a) => a.name);
  if (!passed) return finish("assertions_failed", gate.exitCodes.assertionFailed, `${failed.length} fail-level assertion(s) failed: ${failed.map((a) => a.name).join(", ")}`);
  return finish("passed", gate.exitCodes.pass);
}

/** module name -> module hash, from `substreams info --json` (the reproducible identity of a build; spkg bytes are not). */
export function moduleHashesOf(info: SubstreamsInfo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of info.modules ?? []) if (m.name && m.hash) out[m.name] = m.hash;
  return out;
}

export { expandTemplate };
