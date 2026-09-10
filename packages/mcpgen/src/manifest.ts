// Builds the tool specs and the manifest from (proto tables, views, receipt, semantics).
import { sha256Canonical, sha256Hex } from "./hash.ts";
import type { TableSpec } from "./proto.ts";
import type { Receipt } from "./receipt.ts";
import type { Semantics } from "./semantics.ts";
import type { ViewSpec } from "./views.ts";
import { columnSetHash } from "../runtime/schemahash.ts";
import type { ExpectedColumn, Manifest, OutputColumn, ParamSpec, ToolSpec } from "../runtime/types.ts";

export const GENERATOR_NAME = "@ethonline26/mcpgen";
export const GENERATOR_VERSION = "0.1.0";

export const POLICY: Manifest["policy"] = {
  maxLagBlocksDefault: 300, // ~10 min on Base (2 s blocks)
  checkIntervalSeconds: 60,
  queryTimeoutMs: 10_000,
  maxLimit: 500,
  defaultLimit: 100,
  maxWindowHours: 2160, // 90 days
  defaultWindowHours: 24,
};

const WIDE_NUMERIC = /^(Nullable\()?(UInt256|Int256|UInt128|Int128|Decimal)/;

export interface BuildInputs {
  tables: TableSpec[];
  views: ViewSpec[];
  receipt: Receipt;
  receiptJsonText: string;
  semantics: Semantics;
  files: { proto: { name: string; text: string; pkg: string }; views: { name: string; text: string }; semantics: { name: string; text: string } };
}

function stringify(type: string): boolean {
  return WIDE_NUMERIC.test(type);
}

function vaultParam(vaults: string[]): ParamSpec {
  return {
    name: "vault",
    kind: "vault",
    column: "vault",
    values: vaults,
    chType: "String",
    description: `Restrict to one vault. Only the ${vaults.length} vault(s) pinned by the Deployment Receipt are accepted (lowercase 0x hex).`,
  };
}

function windowParam(optional: boolean): ParamSpec {
  const p: ParamSpec = {
    name: "windowHours",
    kind: "windowHours",
    min: 1,
    max: POLICY.maxWindowHours,
    description: optional
      ? `Trailing window in hours, measured back from the newest observed row. Omit for the entire observed window. 1..${POLICY.maxWindowHours}.`
      : `Trailing window in hours, measured back from the newest observed row (not from now). 1..${POLICY.maxWindowHours}, default ${POLICY.defaultWindowHours}.`,
  };
  if (optional) p.optional = true; else p.default = POLICY.defaultWindowHours;
  return p;
}

function limitParam(): ParamSpec {
  return { name: "limit", kind: "limit", min: 1, max: POLICY.maxLimit, default: POLICY.defaultLimit, description: `Maximum rows returned, 1..${POLICY.maxLimit} (default ${POLICY.defaultLimit}).` };
}

export function toolFromTable(t: TableSpec, receipt: Receipt, sem: Semantics, vaults: string[]): ToolSpec {
  const s = sem.tables[t.table] ?? {};
  const colNames = new Set(t.columns.map((c) => c.name));
  const columns: OutputColumn[] = t.columns
    .filter((c) => !c.injected)
    .map((c) => ({ name: c.name, type: c.type, stringify: stringify(c.type), comment: c.comment }));
  const params: ParamSpec[] = [];
  if (colNames.has("vault")) params.push(vaultParam(vaults));
  for (const [argName, f] of Object.entries(s.filters ?? {})) {
    if (!colNames.has(f.column)) throw new Error(`semantics: table ${t.table} has no column ${f.column} for filter ${argName}`);
    const values = Object.keys(f.values ?? {});
    if (values.length === 0) throw new Error(`semantics: filter ${argName} on ${t.table} needs a values map`);
    params.push({ name: argName, kind: "enumFilter", column: f.column, values, valueMap: f.values ?? {}, chType: "Int32", description: f.description ?? `Restrict ${f.column} to one of: ${values.join(", ")}.` });
  }
  let window: ToolSpec["window"];
  if (colNames.has("block_timestamp")) {
    params.push(windowParam(false));
    window = { column: "block_timestamp", table: t.table, where: "_deleted_ = 0", marker: false };
  }
  params.push(limitParam());
  let orderBy: string[];
  if (s.orderBy) orderBy = s.orderBy;
  else if (colNames.has("block_number")) orderBy = ["block_number DESC", ...(colNames.has("log_index") ? ["log_index DESC"] : [])];
  else orderBy = t.orderBy.length ? t.orderBy.map((c) => `${c} ASC`) : [];
  const description = (s.description ?? `Rows of table ${t.table} (message ${t.message}). ${t.comment}`).replace(/\s+/g, " ").trim();
  const spec: ToolSpec = {
    name: s.tool ?? t.table,
    kind: "table",
    source: t.table,
    description,
    columns,
    params,
    deletedFilter: colNames.has("_deleted_"),
    orderBy,
  };
  if (window) spec.window = window;
  if (s.whenEmpty) spec.whenEmpty = { reason: s.whenEmpty.reason };
  void receipt;
  return spec;
}

export function toolFromView(v: ViewSpec, sem: Semantics, vaults: string[]): ToolSpec {
  const s = sem.views[v.name] ?? {};
  const colNames = new Set(v.columns.map((c) => c.name));
  const columns: OutputColumn[] = v.columns.map((c) => ({ name: c.name, type: c.type, stringify: stringify(c.type), comment: c.comment }));
  const params: ParamSpec[] = [];
  if (colNames.has("vault")) params.push(vaultParam(vaults));
  if (v.window) params.push(windowParam(true));
  params.push(limitParam());
  const first = v.columns[0]?.name;
  const orderBy = s.orderBy ?? (colNames.has("vault") ? ["vault ASC"] : first ? [`${first} ASC`] : []);
  const spec: ToolSpec = {
    name: s.tool ?? v.name,
    kind: "view",
    source: v.name,
    description: (s.description ?? v.description).replace(/\s+/g, " ").trim(),
    columns,
    params,
    deletedFilter: false,
    orderBy,
  };
  if (v.window) {
    spec.window = { column: v.window.column, table: v.window.table, where: v.window.where, marker: true };
    spec.body = v.body;
  }
  return spec;
}

export function statusTool(): ToolSpec {
  return {
    name: "pipeline_status",
    kind: "status",
    source: "",
    description:
      "Health of the pipeline behind the other tools: receipt identity (package hash, module hash, parameters hash), live ClickHouse schema check against the receipt, sink head vs chain head (lag in blocks), the fail-closed verdict and its reason, and the policy in force. Call this before acting on data; every other tool refuses when this reports refused = true.",
    columns: [],
    params: [],
    deletedFilter: false,
    orderBy: [],
  };
}

export function buildManifest(inp: BuildInputs): Manifest {
  const { tables, views, receipt, semantics } = inp;
  const vaults = [...receipt.parameters.vaults].map((v) => v.toLowerCase()).sort();

  const expectedTables: Record<string, ExpectedColumn[]> = {};
  for (const t of tables) expectedTables[t.table] = t.columns.map((c) => ({ name: c.name, type: c.type }));
  const viewCols: Record<string, ExpectedColumn[]> = {};
  for (const v of views) viewCols[v.name] = v.columns.map((c) => ({ name: c.name, type: c.type }));

  for (const name of Object.keys(semantics.tables)) if (!tables.some((t) => t.table === name)) throw new Error(`semantics: unknown table ${name}`);
  for (const name of Object.keys(semantics.views)) if (!views.some((v) => v.name === name)) throw new Error(`semantics: unknown view ${name}`);

  const tools: ToolSpec[] = [
    ...tables.map((t) => toolFromTable(t, receipt, semantics, vaults)),
    ...views.map((v) => toolFromView(v, semantics, vaults)),
    statusTool(),
  ];
  const names = new Set<string>();
  for (const t of tools) {
    if (names.has(t.name)) throw new Error(`duplicate tool name ${t.name}`);
    names.add(t.name);
  }

  return {
    manifestVersion: 1,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    package: {
      name: receipt.packageName,
      version: receipt.packageVersion,
      packageHash: receipt.packageHash,
      outputModule: receipt.outputModule,
      outputModuleHash: receipt.outputModuleHash,
      deploymentMode: receipt.deploymentMode,
      deploymentId: receipt.deploymentId ?? null,
      chainId: receipt.chainId,
      network: receipt.network,
      startBlock: receipt.startBlock,
    },
    receipt: {
      sha256: sha256Hex(inp.receiptJsonText),
      parametersHash: receipt.parametersHash,
      protoDescriptorHash: receipt.protoDescriptorHash,
      sinkSchemaHash: receipt.sinkSchemaHash,
    },
    inputs: {
      proto: { file: inp.files.proto.name, sha256: sha256Hex(inp.files.proto.text), package: inp.files.proto.pkg },
      views: { file: inp.files.views.name, sha256: sha256Hex(inp.files.views.text) },
      semantics: { file: inp.files.semantics.name, sha256: sha256Hex(inp.files.semantics.text) },
    },
    vaults,
    expectedSchema: { tables: expectedTables, columnSetHash: columnSetHash(expectedTables) },
    views: viewCols,
    policy: POLICY,
    tools,
    toolsHash: sha256Canonical(tools),
  };
}
