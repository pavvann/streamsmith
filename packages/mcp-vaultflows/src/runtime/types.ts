// Shared types between mcpgen (generator) and the generated server. This file is copied verbatim into the
// generated package (src/runtime/types.ts), so it must not import anything from the generator.

export type ParamKind = "vault" | "enumFilter" | "windowHours" | "limit";

export interface ParamSpec {
  /** argument name as exposed to the MCP client */
  name: string;
  kind: ParamKind;
  description: string;
  /** vault / enumFilter: column compared with `=` */
  column?: string;
  /** vault / enumFilter: the closed set of accepted values (vault addresses or enum keys) */
  values?: string[];
  /** enumFilter: key -> stored integer (proto enum number) */
  valueMap?: Record<string, number>;
  /** ClickHouse type of the bound parameter: String | Int32 | UInt32 */
  chType?: string;
  min?: number;
  max?: number;
  default?: number;
  /** windowHours only: when true the argument may be omitted (whole observed window) */
  optional?: boolean;
}

export interface OutputColumn {
  name: string;
  /** ClickHouse type as the sink / view renders it */
  type: string;
  /** wide numerics and decimals are selected through toString() so JSON never renders them as floats */
  stringify: boolean;
  comment: string;
}

export interface WindowSpec {
  /** unix-seconds column the trailing window is applied to */
  column: string;
  /** base table the window bounds are measured on (min/max of `column` over rows matching `where`) */
  table: string;
  /** predicate selecting live rows for the bounds, e.g. "_deleted_ = 0" or "_deleted_ = 0 AND call_ok = true"; no user input ever enters it */
  where: string;
  /** true: the window predicate replaces the /*@window*\/ marker inside `body` (views); false: appended to WHERE (tables) */
  marker: boolean;
}

export interface ToolSpec {
  name: string;
  kind: "table" | "view" | "status";
  /** table or view name in ClickHouse */
  source: string;
  description: string;
  columns: OutputColumn[];
  params: ParamSpec[];
  /** append `_deleted_ = 0` (tables; views filter it themselves) */
  deletedFilter: boolean;
  window?: WindowSpec;
  /** views only: SELECT body used for the windowed form (contains the marker) */
  body?: string;
  /** e.g. ["block_number DESC", "log_index DESC"]; identifiers validated at build time */
  orderBy: string[];
  /** when the source table has no live rows, answer {unavailable: true, reason} instead of an empty list */
  whenEmpty?: { reason: string };
}

export interface ExpectedColumn { name: string; type: string }

export interface Manifest {
  manifestVersion: 1;
  generator: { name: string; version: string };
  package: {
    name: string;
    version: string;
    packageHash: string;
    outputModule: string;
    /** Substreams module hash of outputModule: the reproducible identity (packageHash is per-build) */
    outputModuleHash: string;
    deploymentMode: string;
    deploymentId: string | null;
    chainId: number;
    network: string;
    startBlock: number;
  };
  receipt: {
    sha256: string;
    parametersHash: string;
    protoDescriptorHash: string;
    sinkSchemaHash: string;
  };
  inputs: {
    proto: { file: string; sha256: string; package: string };
    views: { file: string; sha256: string };
    semantics: { file: string; sha256: string };
  };
  vaults: string[];
  expectedSchema: {
    /** table -> columns the from-proto sink creates (proto fields + injected columns; injected have type "*") */
    tables: Record<string, ExpectedColumn[]>;
    /** sha256 of the normalized column set; companion of receipt.sinkSchemaHash that the MCP can recompute from system.columns */
    columnSetHash: string;
  };
  views: Record<string, ExpectedColumn[]>;
  policy: {
    maxLagBlocksDefault: number;
    checkIntervalSeconds: number;
    queryTimeoutMs: number;
    maxLimit: number;
    defaultLimit: number;
    maxWindowHours: number;
    defaultWindowHours: number;
  };
  tools: ToolSpec[];
  /** sha256 of canonical JSON of `tools` */
  toolsHash: string;
}

/** The subset of the Deployment Receipt the server reads at runtime. */
export interface RuntimeReceipt {
  receiptVersion: number;
  packageName: string;
  packageVersion: string;
  packageHash: string;
  outputModule: string;
  outputModuleHash: string;
  protoDescriptorHash: string;
  parametersHash: string;
  parameters: { vaults: string[]; sampleIntervalBlocks: number; chainId: number };
  sinkSchemaHash: string;
  deploymentMode: string;
  deploymentId?: string;
  chainId: number;
  network: string;
  startBlock: number;
  headBlock?: number;
  lagBlocks?: number;
  gate: { passed: boolean; ranges: string[] };
  createdAt: string;
  [k: string]: unknown;
}

/**
 * The window a response was computed over. All timestamps come from the data (min/max of `column` over the live
 * rows of `source`), never from configuration such as the pipeline's start block.
 */
export interface ObservedWindow {
  /** requested trailing window in hours; null = the entire observed window */
  hours: number | null;
  /** unix-seconds column the window applies to */
  column: string;
  /** base table the bounds were measured on */
  source: string;
  /** min(column) over live rows: the pipeline's first observation (null when the table is empty) */
  observedFromTimestamp: number | null;
  /** max(column) over live rows: the newest observation and the window's end (null when empty) */
  observedToTimestamp: number | null;
  /** this query's lower bound: observedTo - hours*3600 when hours is set, else observedFrom */
  startTimestamp: number | null;
  /** this query's upper bound: observedToTimestamp */
  endTimestamp: number | null;
}

export interface Provenance {
  packageHash: string;
  outputModuleHash: string;
  parametersHash: string;
  protoDescriptorHash: string;
  sinkSchemaHash: string;
  schemaColumnSetHash: string;
  deploymentMode: string;
  deploymentId: string | null;
  chainId: number;
  headBlock: number | null;
  headTimestamp: number | null;
  chainHead: number | null;
  lagBlocks: number | null;
  observedWindow: ObservedWindow | null;
  checkedAt: string | null;
}

export type RefusalReason = "schema_mismatch" | "stale_data" | "chain_mismatch" | "receipt_mismatch" | "check_unavailable";

export interface Refusal {
  refused: true;
  reason: RefusalReason;
  detail: string;
  expected?: unknown;
  actual?: unknown;
  checkedAt: string | null;
  provenance: Provenance;
}
