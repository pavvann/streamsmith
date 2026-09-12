// Deployment Receipt v1 — build, validate, hash, and check a live deployment against it.
// This module is the import surface for the MCP generator (packages/mcp-vaultflows): it has no CLI concerns.
import { join, isAbsolute } from "node:path";
import { readJson, readText, exists, writeJson } from "./util/fsx.ts";
import { sha256File, sha256Hex, sha256Canonical, canonicalJson } from "./util/hash.ts";
import { validateAgainstSchema, type SchemaError } from "./schema/jsonschema.ts";
import { parametersHash, receiptParameters, normalizeVersion, type StreamsmithConfig, type ReceiptParameters } from "./config/streamsmith.ts";
import type { GateReport } from "./gate/run.ts";
import type { PublishRecord } from "./publish.ts";
import type { DeployRecord } from "./deploy/types.ts";

export type DeploymentMode = "graph-market-hosted" | "self-managed-sink";

export interface ReceiptGate {
  passed: boolean;
  ranges: string[];
  assertions: Array<{ name: string; passed: boolean; detail?: string }>;
  toolVersions?: Record<string, unknown>;
}

export interface ReceiptSink {
  kind?: "clickhouse" | "postgres";
  mode?: "from-proto" | "database-changes";
  database?: string;
  /** sha256 of host:port — never the DSN */
  hostFingerprint?: string;
}

export interface Receipt {
  receiptVersion: 1;
  packageName: string;
  packageVersion: string;
  /** sha256 of the exact .spkg bytes — identifies the artifact, not the source (spkg bytes are not reproducible) */
  packageHash: string;
  packageUrl?: string;
  outputModule: string;
  /** Substreams module hash of outputModule (`substreams info <spkg> --json` modules[].hash) — the reproducible identity */
  outputModuleHash: string;
  /** module name -> module hash for every module in the package */
  moduleHashes?: Record<string, string>;
  protoDescriptorHash: string;
  parametersHash: string;
  parameters: ReceiptParameters;
  sinkSchemaHash: string;
  sink?: ReceiptSink;
  mcpManifestHash?: string;
  deploymentMode: DeploymentMode;
  deploymentId?: string;
  chainId: number;
  network: string;
  endpoint?: string;
  startBlock: number;
  headBlock?: number;
  lagBlocks?: number;
  lagSeconds?: number;
  gate: ReceiptGate;
  registryPublishedAt?: string;
  deployedAt?: string;
  createdAt: string;
  runId?: string;
}

export const RECEIPT_SCHEMA_RELPATH = join("specs", "receipt.schema.json");

export async function loadReceiptSchema(root: string): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(join(root, RECEIPT_SCHEMA_RELPATH));
}

export function validateReceipt(receipt: unknown, schema: Record<string, unknown>): { ok: boolean; errors: SchemaError[] } {
  const errors = validateAgainstSchema(receipt, schema);
  return { ok: errors.length === 0, errors };
}

/** sha256 of the canonical JSON of the receipt — what the run manifest records as receiptHash. */
export function receiptHash(receipt: Receipt): string {
  return sha256Canonical(receipt);
}

export function receiptFileName(r: Pick<Receipt, "packageName" | "packageVersion" | "runId">): string {
  return `${r.packageName}-${r.packageVersion}${r.runId ? `-${r.runId}` : ""}.json`;
}

export function hostFingerprint(host: string, port: number | string): string {
  return sha256Hex(`${host}:${port}`);
}

export function gateEvidence(gate: GateReport | ReceiptGate): ReceiptGate {
  const out: ReceiptGate = {
    passed: gate.passed,
    ranges: gate.ranges,
    assertions: gate.assertions.map((a) => ({ name: a.name, passed: a.passed, ...(a.detail !== undefined ? { detail: a.detail } : {}) })),
  };
  if (gate.toolVersions) out.toolVersions = gate.toolVersions;
  return out;
}

export interface BuildReceiptInputs {
  streamsmith: StreamsmithConfig;
  gate: GateReport | ReceiptGate;
  /** sha256 of the spkg bytes */
  packageHash: string;
  protoDescriptorHash: string;
  /** sha256 of the DDL applied to the sink */
  sinkSchemaHash: string;
  packageName?: string;
  packageVersion?: string;
  outputModule?: string;
  /** falls back to publish.moduleHash, then gate.package.moduleHash; required in the end */
  outputModuleHash?: string;
  moduleHashes?: Record<string, string>;
  packageUrl?: string;
  registryPublishedAt?: string;
  publish?: PublishRecord;
  deploy?: DeployRecord;
  mcpManifestHash?: string;
  runId?: string;
  createdAt: string;
  endpoint?: string;
}

export function assembleReceipt(i: BuildReceiptInputs): Receipt {
  const ss = i.streamsmith;
  const params = receiptParameters(ss);
  const outputModule = i.outputModule ?? ss.outputModule;
  const gatePkg = "package" in i.gate ? (i.gate as GateReport).package : undefined;
  const moduleHashes = i.moduleHashes ?? i.publish?.moduleHashes ?? gatePkg?.moduleHashes;
  const outputModuleHash = i.outputModuleHash ?? moduleHashes?.[outputModule] ?? i.publish?.moduleHash ?? gatePkg?.moduleHash;
  if (!outputModuleHash) throw new Error(`outputModuleHash is required (module hash of ${outputModule} from \`substreams info <spkg> --json\`); none in inputs, publish.json or gate.json`);
  const r: Receipt = {
    receiptVersion: 1,
    packageName: i.packageName ?? i.publish?.packageName ?? ss.packageName,
    packageVersion: normalizeVersion(i.packageVersion ?? i.publish?.packageVersion ?? ss.version),
    packageHash: i.packageHash,
    outputModule,
    outputModuleHash,
    protoDescriptorHash: i.protoDescriptorHash,
    parametersHash: parametersHash(params),
    parameters: params,
    sinkSchemaHash: i.sinkSchemaHash,
    deploymentMode: i.deploy?.deploymentMode ?? ss.deployment?.preferred ?? "self-managed-sink",
    chainId: ss.chainId,
    network: ss.network,
    startBlock: i.deploy?.startBlock ?? ss.startBlock,
    gate: gateEvidence(i.gate),
    createdAt: i.createdAt,
  };
  if (moduleHashes && Object.keys(moduleHashes).length) r.moduleHashes = moduleHashes;
  // A hosted deployment runs an spkg it fetched from a URL, and that URL is recorded in the deploy record even
  // when this repository never ran `publish` in the same run — the receipt should name the artifact the
  // deployment actually loads. A self-managed record's `spkg` is a local path, so only absolute URLs qualify.
  const deployedUrl = i.deploy?.spkg && /^https?:\/\//i.test(i.deploy.spkg) ? i.deploy.spkg : undefined;
  const url = i.packageUrl ?? i.publish?.packageUrl ?? deployedUrl;
  if (url) r.packageUrl = url;
  const publishedAt = i.registryPublishedAt ?? i.publish?.registryPublishedAt;
  if (publishedAt) r.registryPublishedAt = publishedAt;
  if (i.mcpManifestHash) r.mcpManifestHash = i.mcpManifestHash;
  if (i.runId) r.runId = i.runId;
  const endpoint = i.endpoint ?? i.deploy?.endpoint;
  if (endpoint) r.endpoint = endpoint;
  if (i.deploy) {
    if (i.deploy.deploymentId) r.deploymentId = i.deploy.deploymentId;
    if (i.deploy.headBlock !== undefined) r.headBlock = i.deploy.headBlock;
    if (i.deploy.lagBlocks !== undefined) r.lagBlocks = i.deploy.lagBlocks;
    if (i.deploy.lagSeconds !== undefined) r.lagSeconds = Math.round(i.deploy.lagSeconds);
    if (i.deploy.deployedAt) r.deployedAt = i.deploy.deployedAt;
    if (i.deploy.sink) r.sink = i.deploy.sink;
  } else if (ss.sink) {
    const sink: ReceiptSink = {};
    if (ss.sink.kind) sink.kind = ss.sink.kind;
    if (ss.sink.mode) sink.mode = ss.sink.mode;
    if (ss.sink.connection?.database) sink.database = ss.sink.connection.database;
    if (ss.sink.connection?.host && ss.sink.connection.port) sink.hostFingerprint = hostFingerprint(ss.sink.connection.host, ss.sink.connection.port);
    if (Object.keys(sink).length) r.sink = sink;
  }
  return r;
}

export interface WriteReceiptResult {
  receipt: Receipt;
  path: string;
  hash: string;
  errors: SchemaError[];
}

/** Validate then write receipts/<packageName>-<version>-<runId>.json. Throws on schema violation unless `force`. */
export async function writeReceipt(root: string, receipt: Receipt, opts: { force?: boolean; outDir?: string } = {}): Promise<WriteReceiptResult> {
  const schema = await loadReceiptSchema(root);
  const { errors } = validateReceipt(receipt, schema);
  if (errors.length && !opts.force) {
    throw new Error(`receipt does not satisfy specs/receipt.schema.json:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  }
  const dir = opts.outDir ? (isAbsolute(opts.outDir) ? opts.outDir : join(root, opts.outDir)) : join(root, "receipts");
  const path = join(dir, receiptFileName(receipt));
  await writeJson(path, receipt);
  return { receipt, path, hash: receiptHash(receipt), errors };
}

export async function loadReceipt(path: string): Promise<Receipt> {
  return readJson<Receipt>(path);
}

export async function hashSpkg(path: string): Promise<string> {
  if (!(await exists(path))) throw new Error(`spkg not found: ${path}`);
  return sha256File(path);
}

export async function hashSchemaSql(path: string): Promise<string> {
  return sha256Hex(normalizeSql(await readText(path)));
}

/** Normalize DDL before hashing: CRLF→LF, trailing whitespace stripped, trailing newline. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim() + "\n";
}

// ---- fail-closed contract for the MCP ----
export interface LiveState {
  /** sha256 of the spkg the sink is running (hosted: from GetDeployment spkg url → download; self-managed: local spkg) */
  packageHash?: string;
  /** sha256 of `SHOW CREATE TABLE` output for the receipt's tables, normalized with normalizeSql */
  sinkSchemaHash?: string;
  /** module hash of the output module the sink is running (`substreams info` on the deployed spkg) */
  outputModuleHash?: string;
  protoDescriptorHash?: string;
  parametersHash?: string;
  /** highest block the sink has written */
  headBlock?: number;
  /** current chain head from an independent RPC */
  chainHead?: number;
  /** seconds since the sink's head block timestamp */
  lagSeconds?: number;
}

export interface FailClosedPolicy {
  maxLagBlocks: number;
  maxLagSeconds?: number;
  requirePackageHash?: boolean;
  requireSchemaHash?: boolean;
}

export const DEFAULT_FAIL_CLOSED_POLICY: FailClosedPolicy = { maxLagBlocks: 1800, requirePackageHash: true, requireSchemaHash: true };

export interface FailClosedVerdict {
  ok: boolean;
  reasons: string[];
  provenance: {
    packageHash: string;
    outputModuleHash: string;
    parametersHash: string;
    protoDescriptorHash: string;
    sinkSchemaHash: string;
    deploymentMode: DeploymentMode;
    headBlock?: number;
    chainHead?: number;
    lagBlocks?: number;
    lagSeconds?: number;
  };
}

/** Pure check the MCP runs before answering: any mismatch with the receipt, or excessive lag, refuses. */
export function checkReceiptAgainstLive(receipt: Receipt, live: LiveState, policy: FailClosedPolicy = DEFAULT_FAIL_CLOSED_POLICY): FailClosedVerdict {
  const reasons: string[] = [];
  if (live.packageHash === undefined) {
    if (policy.requirePackageHash) reasons.push("live package hash unavailable");
  } else if (live.packageHash.toLowerCase() !== receipt.packageHash.toLowerCase()) reasons.push(`package hash mismatch: live ${live.packageHash} vs receipt ${receipt.packageHash}`);
  if (live.sinkSchemaHash === undefined) {
    if (policy.requireSchemaHash) reasons.push("live sink schema hash unavailable");
  } else if (live.sinkSchemaHash.toLowerCase() !== receipt.sinkSchemaHash.toLowerCase()) reasons.push(`sink schema hash mismatch: live ${live.sinkSchemaHash} vs receipt ${receipt.sinkSchemaHash}`);
  if (live.outputModuleHash !== undefined && live.outputModuleHash.toLowerCase() !== receipt.outputModuleHash.toLowerCase()) reasons.push(`output module hash mismatch: live ${live.outputModuleHash} vs receipt ${receipt.outputModuleHash}`);
  if (live.protoDescriptorHash !== undefined && live.protoDescriptorHash.toLowerCase() !== receipt.protoDescriptorHash.toLowerCase()) reasons.push("proto descriptor hash mismatch");
  if (live.parametersHash !== undefined && live.parametersHash.toLowerCase() !== receipt.parametersHash.toLowerCase()) reasons.push("parameters hash mismatch");
  let lagBlocks: number | undefined;
  if (live.headBlock !== undefined && live.chainHead !== undefined) {
    lagBlocks = Math.max(0, live.chainHead - live.headBlock);
    if (lagBlocks > policy.maxLagBlocks) reasons.push(`lag ${lagBlocks} blocks exceeds ${policy.maxLagBlocks}`);
  } else reasons.push("cannot compute lag (headBlock or chainHead unavailable)");
  if (policy.maxLagSeconds !== undefined && live.lagSeconds !== undefined && live.lagSeconds > policy.maxLagSeconds) reasons.push(`lag ${live.lagSeconds}s exceeds ${policy.maxLagSeconds}s`);
  const provenance: FailClosedVerdict["provenance"] = {
    packageHash: receipt.packageHash,
    outputModuleHash: receipt.outputModuleHash,
    parametersHash: receipt.parametersHash,
    protoDescriptorHash: receipt.protoDescriptorHash,
    sinkSchemaHash: receipt.sinkSchemaHash,
    deploymentMode: receipt.deploymentMode,
  };
  if (live.headBlock !== undefined) provenance.headBlock = live.headBlock;
  if (live.chainHead !== undefined) provenance.chainHead = live.chainHead;
  if (lagBlocks !== undefined) provenance.lagBlocks = lagBlocks;
  if (live.lagSeconds !== undefined) provenance.lagSeconds = live.lagSeconds;
  return { ok: reasons.length === 0, reasons, provenance };
}

export { parametersHash, receiptParameters, canonicalJson, sha256Canonical };
