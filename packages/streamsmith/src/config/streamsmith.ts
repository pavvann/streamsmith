import { parseSpecYaml } from "../util/yaml.ts";
import { readText } from "../util/fsx.ts";
import { sha256Canonical } from "../util/hash.ts";

export interface VaultEntry {
  address: string;
  label?: string;
}

export interface StreamsmithConfig {
  chainId: number;
  network: string;
  packageName: string;
  version: string;
  outputModule: string;
  outputType?: string;
  contract: string;
  vaults: VaultEntry[];
  sampleIntervalBlocks: number;
  startBlock: number;
  params?: { encoding?: string; value?: string };
  sink?: {
    kind?: "clickhouse" | "postgres";
    mode?: "from-proto" | "database-changes";
    tables?: string[];
    views?: string[];
    connection?: { host?: string; port?: number; secure?: boolean; database?: string; user?: string };
  };
  deployment?: { preferred?: "graph-market-hosted" | "self-managed-sink"; network?: string };
  raw: Record<string, unknown>;
}

export async function loadStreamsmithConfig(path: string): Promise<StreamsmithConfig> {
  const raw = parseSpecYaml<Record<string, unknown>>(await readText(path));
  const req = <T>(k: string): T => {
    if (raw[k] === undefined || raw[k] === null) throw new Error(`streamsmith.yaml: missing "${k}"`);
    return raw[k] as T;
  };
  const vaultsRaw = req<Array<string | VaultEntry>>("vaults");
  const vaults = vaultsRaw.map((v) => (typeof v === "string" ? { address: v } : v)).map((v) => ({ ...v, address: normalizeAddress(v.address) }));
  return {
    chainId: Number(req("chainId")),
    network: String(req("network")),
    packageName: String(req("packageName")),
    version: normalizeVersion(String(req("version"))),
    outputModule: String(req("outputModule")),
    outputType: raw.outputType as string | undefined,
    contract: String(raw.contract ?? "specs/vaultflows.proto"),
    vaults,
    sampleIntervalBlocks: Number(req("sampleIntervalBlocks")),
    startBlock: Number(req("startBlock")),
    params: raw.params as StreamsmithConfig["params"],
    sink: raw.sink as StreamsmithConfig["sink"],
    deployment: raw.deployment as StreamsmithConfig["deployment"],
    raw,
  };
}

export function normalizeAddress(a: string): string {
  const s = a.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) throw new Error(`invalid address: ${a}`);
  return s;
}

/** "0.1.0" and "v0.1.0" are the same version; receipts carry the manifest form "v0.1.0". */
export function normalizeVersion(v: string): string {
  const s = v.trim();
  return s.startsWith("v") ? s : `v${s}`;
}

export interface ReceiptParameters {
  vaults: string[];
  sampleIntervalBlocks: number;
  chainId: number;
}

export function receiptParameters(cfg: Pick<StreamsmithConfig, "vaults" | "sampleIntervalBlocks" | "chainId">): ReceiptParameters {
  return {
    vaults: [...new Set(cfg.vaults.map((v) => v.address.toLowerCase()))].sort(),
    sampleIntervalBlocks: cfg.sampleIntervalBlocks,
    chainId: cfg.chainId,
  };
}

/** sha256 of canonical JSON {chainId, sampleIntervalBlocks, vaults: sorted lowercase}. */
export function parametersHash(params: ReceiptParameters): string {
  return sha256Canonical({
    vaults: [...new Set(params.vaults.map((v) => v.toLowerCase()))].sort(),
    sampleIntervalBlocks: params.sampleIntervalBlocks,
    chainId: params.chainId,
  });
}
