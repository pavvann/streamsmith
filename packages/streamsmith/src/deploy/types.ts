import type { DeploymentMode, ReceiptSink } from "../receipt.ts";

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
  command?: string;
  notes?: string[];
}
