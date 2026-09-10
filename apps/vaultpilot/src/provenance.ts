/**
 * Pipeline provenance for the decision log and the UI: the identity of the deployment the numbers
 * came from. Read from the generated MCP package (packages/mcp-vaultflows/manifest.json and its
 * copy of the Deployment Receipt) so the app reports exactly the hashes the MCP server verifies —
 * the same `pipeline_status` shape, not a second source of truth.
 */
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {PipelineHealth} from './decision.js';
import {REPO_ROOT, envOptional, loadEnv} from './env.js';

export interface PipelineProvenance {
  available: boolean;
  manifestPath: string;
  receiptPath: string;
  packageName: string | null;
  packageVersion: string | null;
  packageHash: string | null;
  outputModule: string | null;
  outputModuleHash: string | null;
  parametersHash: string | null;
  protoDescriptorHash: string | null;
  sinkSchemaHash: string | null;
  schemaColumnSetHash: string | null;
  deploymentMode: string | null;
  deploymentId: string | null;
  chainId: number | null;
  network: string | null;
  startBlock: number | null;
  sampleIntervalBlocks: number | null;
  vaults: string[];
  tools: string[];
  maxLagBlocksDefault: number | null;
  gatePassed: boolean | null;
  gateRanges: string[];
  receiptCreatedAt: string | null;
  error?: string;
}

interface ManifestShape {
  package?: {
    name?: string;
    version?: string;
    packageHash?: string;
    outputModule?: string;
    outputModuleHash?: string;
    deploymentMode?: string;
    deploymentId?: string | null;
    chainId?: number;
    network?: string;
    startBlock?: number;
  };
  receipt?: {parametersHash?: string; protoDescriptorHash?: string; sinkSchemaHash?: string};
  expectedSchema?: {columnSetHash?: string};
  vaults?: string[];
  tools?: {name?: string}[];
  policy?: {maxLagBlocksDefault?: number};
}

interface ReceiptShape {
  parameters?: {sampleIntervalBlocks?: number};
  gate?: {passed?: boolean; ranges?: string[]};
  createdAt?: string;
}

const EMPTY: PipelineProvenance = {
  available: false,
  manifestPath: '',
  receiptPath: '',
  packageName: null,
  packageVersion: null,
  packageHash: null,
  outputModule: null,
  outputModuleHash: null,
  parametersHash: null,
  protoDescriptorHash: null,
  sinkSchemaHash: null,
  schemaColumnSetHash: null,
  deploymentMode: null,
  deploymentId: null,
  chainId: null,
  network: null,
  startBlock: null,
  sampleIntervalBlocks: null,
  vaults: [],
  tools: [],
  maxLagBlocksDefault: null,
  gatePassed: null,
  gateRanges: [],
  receiptCreatedAt: null,
};

export function readProvenance(): PipelineProvenance {
  loadEnv();
  const manifestPath = envOptional('MCP_MANIFEST_PATH') ?? resolve(REPO_ROOT, 'packages', 'mcp-vaultflows', 'manifest.json');
  const receiptPath = envOptional('MCP_RECEIPT_PATH') ?? resolve(REPO_ROOT, 'packages', 'mcp-vaultflows', 'receipt.json');
  const base = {...EMPTY, manifestPath, receiptPath};
  if (!existsSync(manifestPath)) {
    return {...base, error: `no MCP manifest at ${manifestPath}; provenance unavailable`};
  }
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestShape;
    const r = existsSync(receiptPath) ? (JSON.parse(readFileSync(receiptPath, 'utf8')) as ReceiptShape) : {};
    return {
      ...base,
      available: true,
      packageName: m.package?.name ?? null,
      packageVersion: m.package?.version ?? null,
      packageHash: m.package?.packageHash ?? null,
      outputModule: m.package?.outputModule ?? null,
      outputModuleHash: m.package?.outputModuleHash ?? null,
      parametersHash: m.receipt?.parametersHash ?? null,
      protoDescriptorHash: m.receipt?.protoDescriptorHash ?? null,
      sinkSchemaHash: m.receipt?.sinkSchemaHash ?? null,
      schemaColumnSetHash: m.expectedSchema?.columnSetHash ?? null,
      deploymentMode: m.package?.deploymentMode ?? null,
      deploymentId: m.package?.deploymentId ?? null,
      chainId: m.package?.chainId ?? null,
      network: m.package?.network ?? null,
      startBlock: m.package?.startBlock ?? null,
      sampleIntervalBlocks: r.parameters?.sampleIntervalBlocks ?? null,
      vaults: m.vaults ?? [],
      tools: (m.tools ?? []).map((t) => t.name ?? '').filter(Boolean),
      maxLagBlocksDefault: m.policy?.maxLagBlocksDefault ?? null,
      gatePassed: r.gate?.passed ?? null,
      gateRanges: r.gate?.ranges ?? [],
      receiptCreatedAt: r.createdAt ?? null,
    };
  } catch (e) {
    return {...base, error: `MCP manifest unreadable: ${(e as Error).message}`};
  }
}

/** The MCP's `pipeline_status` shape, filled from our own live check plus the manifest. */
export function pipelineStatusView(prov: PipelineProvenance, health: PipelineHealth, maxLagBlocks: number): Record<string, unknown> {
  return {
    tool: 'pipeline_status',
    ok: !health.refused,
    refused: health.refused,
    reason: health.reason,
    detail: health.detail,
    package: {
      name: prov.packageName,
      version: prov.packageVersion,
      packageHash: prov.packageHash,
      outputModule: prov.outputModule,
      outputModuleHash: prov.outputModuleHash,
      deploymentMode: prov.deploymentMode,
      deploymentId: prov.deploymentId,
      chainId: prov.chainId,
      network: prov.network,
      startBlock: prov.startBlock,
    },
    live: {
      headBlock: health.headBlock,
      chainHead: health.chainHead,
      chainId: health.chainId,
      lagBlocks: health.lagBlocks,
    },
    policy: {maxLagBlocks},
    vaults: prov.vaults,
    checkedAt: health.checkedAt,
    provenance: {
      packageHash: prov.packageHash,
      outputModuleHash: prov.outputModuleHash,
      parametersHash: prov.parametersHash,
      protoDescriptorHash: prov.protoDescriptorHash,
      sinkSchemaHash: prov.sinkSchemaHash,
      schemaColumnSetHash: prov.schemaColumnSetHash,
      deploymentMode: prov.deploymentMode,
      deploymentId: prov.deploymentId,
      chainId: prov.chainId,
      headBlock: health.headBlock,
      chainHead: health.chainHead,
      lagBlocks: health.lagBlocks,
      checkedAt: health.checkedAt,
    },
  };
}
