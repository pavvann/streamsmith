import type { DeploymentMode, ReceiptSink } from "../receipt.ts";
import type { ViewsRecord } from "./views.ts";

export interface DeployRecord {
  deploymentMode: DeploymentMode;
  deploymentId?: string;
  /** spkg the deployment runs (hosted: registry URL; self-managed: local path) */
  spkg?: string;
  packageHash?: string;
  outputModule?: string;
  network?: string;
  endpoint?: string;
  startBlock?: number;
  /** highest block the sink has processed / written */
  headBlock?: number;
  /** independent chain head (RPC or Portal head_block) at the time of the check */
  chainHead?: number;
  lagBlocks?: number;
  lagSeconds?: number;
  state?: string;
  sink?: ReceiptSink;
  deployedAt?: string;
  checkedAt?: string;
  runId: string;
  /** self-managed only */
  pid?: number;
  pidFile?: string;
  logFile?: string;
  cursorFile?: string;
  cursor?: { present: boolean; mtime?: string; raw?: string };
  /** row counts per table (`deploy status`); null when the count query failed (e.g. table missing) */
  rowCounts?: Record<string, number | null>;
  command?: string;
  /** ClickHouse views applied after the sink created the base tables (packages/erc4626-flows/sql/views.sql) */
  views?: ViewsRecord;
  /** hosted only: the execution config the running pod reports, read back from Portal `Logs` (`deploy hosted --attach`) */
  executionConfig?: ObservedExecutionConfig;
  notes?: string[];
}

/**
 * What the hosted runner says it started with. Read from the pod's own startup log lines rather than from the
 * request we would have sent, so the record describes the deployment that is running — the Portal read-only API
 * has no call that returns a deployment's stored config.
 */
export interface ObservedExecutionConfig {
  /** where the log lines came from (`Logs` pod name) */
  podName?: string;
  /** manifest_path: the spkg URL the runner resolved */
  spkgUrl?: string;
  outputModule?: string;
  moduleOutputType?: string;
  outputModuleHash?: string;
  startBlock?: number;
  /** 0 means unbounded */
  stopBlock?: number;
  /** module parameters the runner received; an empty array is the fix for the start-command failure in docs/build/sink-spike.md §7 */
  parameters?: string[];
  /** database (from-proto schema name) the runner initialized */
  database?: string;
  finalBlocksOnly?: boolean;
}
