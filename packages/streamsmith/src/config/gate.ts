// specs/gate.yaml loader — executes the file as written by A2b (see its "Runner contract" header).
import YAML from "yaml";
import { readText } from "../util/fsx.ts";

export type Severity = "fail" | "warn";

export interface GateRunSpec {
  name: string;
  module: string;
  startBlock: number;
  /** exclusive */
  stopBlock: number;
  output?: string;
  timeoutSeconds: number;
  sameAs?: string;
  extraFlags: string[];
}

export interface ExitCodes {
  pass: number;
  buildFailed: number;
  runFailed: number;
  assertionFailed: number;
}
export const DEFAULT_EXIT_CODES: ExitCodes = { pass: 0, buildFailed: 10, runFailed: 20, assertionFailed: 30 };

export interface ReferenceRow {
  [key: string]: string | number | boolean;
}

export interface AssertionSpec {
  name: string;
  /** evaluator id; defaults to `name` */
  kind: string;
  severity: Severity;
  definition?: string;
  run?: string;
  runs?: string[];
  table?: string;
  tables?: string[];
  min?: string | number;
  max?: string | number;
  vaults?: string[];
  rows?: ReferenceRow[];
  range?: { min?: string | number; max?: string | number };
  block?: number;
  expected?: Record<string, unknown>;
  files?: string[];
  patterns?: string[];
  raw: Record<string, unknown>;
}

export interface GateConfig {
  gateVersion: number;
  exitCodes: ExitCodes;
  package: { dir: string; manifest: string; name?: string; version?: string; outputModule?: string; outputType?: string };
  contract: { proto: string; protoPackage?: string; configuration?: string; sinkSchemaFile?: string; sinkSchemaOfflineCopy?: string };
  build: { cwd: string; command: string[]; timeoutSeconds: number; expectedOutputs: string[]; recordSpkgSha256: boolean; toolVersionCommands: string[][] };
  endpoint?: string;
  network?: string;
  authEnvAny: string[];
  runCommand: string;
  runs: Record<string, GateRunSpec>;
  rowExtraction: { decodeWith?: string; rejectUnknownFields: boolean; expectType?: string };
  configuredVaults: string[];
  expectedSpecSha256?: string;
  assertions: AssertionSpec[];
  raw: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const pick = (o: Rec | undefined, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};
const toList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : undefined);
const splitCmd = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v).trim().split(/\s+/));

export const DEFAULT_RUN_COMMAND = "substreams run -e ${endpoint} ${spkg} ${module} -s ${startBlock} -t ${stopBlock} --network ${network} -o jsonl";

/** ${var} expansion; unknown variables are left in place so the caller can report them. */
export function expandTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\$\{([\w.]+)\}/g, (m, key: string) => {
    const v = vars[key];
    return v === undefined ? m : String(v);
  });
}

export function parseGateConfig(raw: Rec): GateConfig {
  const pkgRaw = isRec(raw.package) ? raw.package : {};
  const pkg: GateConfig["package"] = { dir: String(pick(pkgRaw, "dir", "path") ?? "packages/erc4626-flows"), manifest: String(pick(pkgRaw, "manifest") ?? "substreams.yaml") };
  for (const k of ["name", "version", "outputModule", "outputType"] as const) if (pkgRaw[k] !== undefined) pkg[k] = String(pkgRaw[k]);

  const contractRaw = isRec(raw.contract) ? raw.contract : {};
  const contract: GateConfig["contract"] = { proto: String(pick(contractRaw, "proto", "file") ?? "specs/vaultflows.proto") };
  if (contractRaw.protoPackage !== undefined) contract.protoPackage = String(contractRaw.protoPackage);
  if (contractRaw.configuration !== undefined) contract.configuration = String(contractRaw.configuration);
  const sinkSchema = isRec(contractRaw.sinkSchema) ? contractRaw.sinkSchema : undefined;
  if (sinkSchema?.file !== undefined) contract.sinkSchemaFile = String(sinkSchema.file);
  if (sinkSchema?.offlineCopy !== undefined) contract.sinkSchemaOfflineCopy = String(sinkSchema.offlineCopy);

  const buildRaw = isRec(raw.build) ? raw.build : {};
  const record = isRec(buildRaw.record) ? buildRaw.record : {};
  const build: GateConfig["build"] = {
    cwd: String(pick(buildRaw, "cwd") ?? "${package.dir}"),
    command: buildRaw.command === undefined ? ["substreams", "build"] : splitCmd(buildRaw.command),
    timeoutSeconds: Number(pick(buildRaw, "timeoutSeconds", "timeout_seconds") ?? 1800),
    expectedOutputs: toList(buildRaw.expectedOutputs) ?? [],
    recordSpkgSha256: record.spkgSha256 !== false,
    toolVersionCommands: (toList(record.toolVersions) ?? ["substreams --version", "buf --version", "rustc --version", "cargo --version"]).map(splitCmd),
  };

  const codesRaw = isRec(pick(raw, "exitCodes", "exit_codes")) ? (pick(raw, "exitCodes", "exit_codes") as Rec) : {};
  const exitCodes: ExitCodes = {
    pass: Number(pick(codesRaw, "pass") ?? DEFAULT_EXIT_CODES.pass),
    buildFailed: Number(pick(codesRaw, "buildFailed", "build_failed") ?? DEFAULT_EXIT_CODES.buildFailed),
    runFailed: Number(pick(codesRaw, "runFailed", "run_failed") ?? DEFAULT_EXIT_CODES.runFailed),
    assertionFailed: Number(pick(codesRaw, "assertionFailed", "assertionsFailed", "assertion_failed", "assertions_failed") ?? DEFAULT_EXIT_CODES.assertionFailed),
  };

  const authRaw = isRec(raw.auth) ? raw.auth : {};
  const authEnvAny = toList(pick(authRaw, "envAny", "env_any")) ?? ["SUBSTREAMS_API_TOKEN", "SUBSTREAMS_API_KEY"];

  const runsRaw = isRec(raw.runs) ? raw.runs : {};
  const runs: Record<string, GateRunSpec> = {};
  for (const [name, r] of Object.entries(runsRaw)) {
    if (!isRec(r)) continue; // e.g. `onFailure: exit 20`
    const sameAs = pick(r, "sameAs", "same_as") as string | undefined;
    const base = sameAs ? runs[sameAs] : undefined;
    if (sameAs && !base) throw new Error(`gate.yaml: run "${name}" sameAs "${sameAs}" must be declared earlier`);
    const start = pick(r, "startBlock", "start_block") ?? base?.startBlock;
    let stop = pick(r, "stopBlock", "stop_block") ?? base?.stopBlock;
    if (typeof stop === "string" && stop.startsWith("+")) stop = Number(start) + Number(stop.slice(1));
    const spec: GateRunSpec = {
      name,
      module: String(pick(r, "module") ?? base?.module ?? pkg.outputModule ?? "map_events"),
      startBlock: Number(start),
      stopBlock: Number(stop),
      timeoutSeconds: Number(pick(r, "timeoutSeconds", "timeout_seconds") ?? base?.timeoutSeconds ?? 3600),
      extraFlags: toList(pick(r, "extraFlags", "extra_flags")) ?? base?.extraFlags ?? [],
    };
    const output = pick(r, "output");
    if (output !== undefined) spec.output = String(output);
    if (sameAs) spec.sameAs = sameAs;
    if (!Number.isFinite(spec.startBlock) || !Number.isFinite(spec.stopBlock)) throw new Error(`gate.yaml: run "${name}" needs numeric startBlock/stopBlock`);
    if (spec.stopBlock <= spec.startBlock) throw new Error(`gate.yaml: run "${name}" stopBlock (exclusive) must exceed startBlock`);
    runs[name] = spec;
  }
  if (Object.keys(runs).length === 0) throw new Error("gate.yaml: at least one run is required");

  const rowRaw = isRec(raw.rowExtraction) ? raw.rowExtraction : {};
  const rowExtraction: GateConfig["rowExtraction"] = { rejectUnknownFields: rowRaw.rejectUnknownFields !== false };
  if (rowRaw.decodeWith !== undefined) rowExtraction.decodeWith = String(rowRaw.decodeWith);
  if (rowRaw.expectType !== undefined) rowExtraction.expectType = String(rowRaw.expectType);

  const configuredVaults = (toList(raw.configuredVaults) ?? []).map((v) => v.toLowerCase());
  const dh = isRec(raw.descriptorHash) ? raw.descriptorHash : {};

  const assertionsRaw = raw.assertions;
  if (!Array.isArray(assertionsRaw) || assertionsRaw.length === 0) throw new Error("gate.yaml: assertions list is required");
  const seen = new Set<string>();
  const assertions: AssertionSpec[] = assertionsRaw.map((a, i) => {
    if (!isRec(a)) throw new Error(`gate.yaml: assertion #${i + 1} is not a mapping`);
    const name = String(pick(a, "name") ?? `assertion-${i + 1}`);
    if (seen.has(name)) throw new Error(`gate.yaml: duplicate assertion name "${name}"`);
    seen.add(name);
    const severityRaw = String(pick(a, "severity") ?? "fail").toLowerCase();
    if (severityRaw !== "fail" && severityRaw !== "warn") throw new Error(`gate.yaml: assertion "${name}" has unknown severity "${severityRaw}"`);
    const spec: AssertionSpec = { name, kind: String(pick(a, "kind", "type") ?? name).replace(/-/g, "_"), severity: severityRaw, raw: a };
    if (a.definition !== undefined) spec.definition = String(a.definition);
    if (a.run !== undefined) spec.run = String(a.run);
    const rs = toList(a.runs);
    if (rs) spec.runs = rs;
    const table = pick(a, "table", "in");
    if (table !== undefined) spec.table = String(table);
    const tables = toList(a.tables);
    if (tables) spec.tables = tables;
    if (a.min !== undefined) spec.min = a.min as string | number;
    if (a.max !== undefined) spec.max = a.max as string | number;
    const vaults = toList(a.vaults);
    if (vaults) spec.vaults = vaults.map((v) => v.toLowerCase());
    if (Array.isArray(a.rows)) spec.rows = a.rows.filter(isRec) as ReferenceRow[];
    if (isRec(a.range)) spec.range = a.range as AssertionSpec["range"];
    if (a.block !== undefined) spec.block = Number(a.block);
    if (isRec(a.expected)) spec.expected = a.expected;
    else if (a.expected !== undefined) spec.expected = { value: a.expected };
    const files = toList(a.files);
    if (files) spec.files = files;
    const patterns = toList(a.patterns);
    if (patterns) spec.patterns = patterns;
    return spec;
  });

  const cfg: GateConfig = {
    gateVersion: Number(pick(raw, "gateVersion", "version") ?? 1),
    exitCodes,
    package: pkg,
    contract,
    build,
    authEnvAny,
    runCommand: String(raw.runCommand ?? DEFAULT_RUN_COMMAND),
    runs,
    rowExtraction,
    configuredVaults,
    assertions,
    raw,
  };
  if (raw.endpoint !== undefined) cfg.endpoint = String(raw.endpoint);
  if (raw.network !== undefined) cfg.network = String(raw.network);
  if (dh.expectedSpecSha256 !== undefined) cfg.expectedSpecSha256 = String(dh.expectedSpecSha256).toLowerCase();
  return cfg;
}

export async function loadGateConfig(path: string): Promise<GateConfig> {
  const raw = YAML.parse(await readText(path)) as Rec;
  if (!isRec(raw)) throw new Error(`gate.yaml: empty or invalid at ${path}`);
  return parseGateConfig(raw);
}
