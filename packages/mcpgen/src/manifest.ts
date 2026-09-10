// Builds the tool specs and the manifest from (proto tables, views, receipt, semantics).
import { sha256Canonical, sha256Hex } from "./hash.ts";
import type { ColumnSpec, TableSpec } from "./proto.ts";
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
  /** enum name -> { VALUE_NAME: number }, from the proto; used to resolve enum-backed filter columns */
  enums: Record<string, Record<string, number>>;
  files: { proto: { name: string; text: string; pkg: string }; views: { name: string; text: string }; semantics: { name: string; text: string } };
}

/**
 * How a filter's tool-facing value names are stored in ClickHouse. Derived from the contract:
 *  - `String` column  -> the name itself, bound as {name:String}   (`direction = 'deposit'`)
 *  - enum-backed `Int32` column -> the proto enum's number, bound as {name:Int32}  (`direction = 1`)
 * Anything else is a generation error rather than a guess, because guessing here produces SQL that silently
 * matches no rows (substreams-facts.md (d): enums are stored as Int32, plain strings as String).
 */
export function resolveFilterValues(
  table: string,
  argName: string,
  column: ColumnSpec,
  names: string[],
  enums: Record<string, Record<string, number>>,
): { chType: string; valueMap: Record<string, string | number> } {
  if (column.type === "String") {
    return { chType: "String", valueMap: Object.fromEntries(names.map((n) => [n, n])) };
  }
  const enumValues = enums[column.protoType];
  if ((column.type === "Int32" || column.type === "UInt32") && enumValues) {
    const valueMap: Record<string, string | number> = {};
    for (const name of names) {
      const wanted = name.toUpperCase();
      const matches = Object.keys(enumValues).filter((k) => k === wanted || k.endsWith(`_${wanted}`));
      if (matches.length !== 1) {
        throw new Error(`semantics: filter ${argName} on ${table}: ${JSON.stringify(name)} matches ${matches.length} values of enum ${column.protoType} (${Object.keys(enumValues).join(", ")})`);
      }
      valueMap[name] = enumValues[matches[0]!]!;
    }
    return { chType: column.type, valueMap };
  }
  throw new Error(`semantics: filter ${argName} on ${table}: column ${column.name} is ${column.type} (proto ${column.protoType || "?"}); a closed-set filter needs a String column or an enum-backed Int32 column`);
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

export function toolFromTable(t: TableSpec, receipt: Receipt, sem: Semantics, vaults: string[], enums: Record<string, Record<string, number>> = {}): ToolSpec {
  const s = sem.tables[t.table] ?? {};
  const colNames = new Set(t.columns.map((c) => c.name));
  const columnByName = new Map<string, ColumnSpec>(t.columns.map((c) => [c.name, c]));
  const columns: OutputColumn[] = t.columns
    .filter((c) => !c.injected)
    .map((c) => ({ name: c.name, type: c.type, stringify: stringify(c.type), comment: c.comment }));
  const params: ParamSpec[] = [];
  if (colNames.has("vault")) params.push(vaultParam(vaults));
  for (const [argName, f] of Object.entries(s.filters ?? {})) {
    const column = columnByName.get(f.column);
    if (!column) throw new Error(`semantics: table ${t.table} has no column ${f.column} for filter ${argName}`);
    const { chType, valueMap } = resolveFilterValues(t.table, argName, column, f.values, enums);
    params.push({ name: argName, kind: "enumFilter", column: f.column, values: [...f.values], valueMap, chType, description: f.description ?? `Restrict ${f.column} to one of: ${f.values.join(", ")}.` });
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
    ...tables.map((t) => toolFromTable(t, receipt, semantics, vaults, inp.enums)),
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
