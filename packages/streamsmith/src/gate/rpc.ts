// Live cross-checks for the two warn-level assertions that cite an RPC (specs/gate.yaml log_index_matches_rpc and
// observation_matches_reference). Everything goes through ctx.fetch so tests inject responses; when the RPC is
// unreachable the evidence says so and the evaluators record "skipped" instead of failing.
import type { Ctx } from "../util/ctx.ts";
import type { GateConfig } from "../config/gate.ts";
import { DEFAULT_BASE_RPC } from "../deploy/rpc.ts";

export interface RpcLog {
  address: string;
  logIndex: number;
  topic0?: string;
}

export type RpcReceipt = { blockNumber?: number; logs: RpcLog[] } | { error: string };
export type RpcCallResult = { raw: string } | { error: string };

export interface RpcEvidence {
  url: string;
  reachable: boolean;
  error?: string;
  chainId?: number;
  /** tx_hash (lowercase) -> receipt logs */
  receipts: Record<string, RpcReceipt>;
  /** `${vault}@${block}` -> convertToAssets(10^shareDecimals) result as a decimal string */
  convertToAssets: Record<string, RpcCallResult>;
}

export const CONVERT_TO_ASSETS_SELECTOR = "0x07a2d13a"; // convertToAssets(uint256)

export function convertToAssetsCalldata(shares: bigint): string {
  return CONVERT_TO_ASSETS_SELECTOR + shares.toString(16).padStart(64, "0");
}

export async function rpcCall<T = unknown>(ctx: Ctx, url: string, method: string, params: unknown[], timeoutMs = 15000): Promise<T> {
  const res = await ctx.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
  if (j.error) throw new Error(`${method}: ${j.error.message ?? `code ${j.error.code}`}`);
  if (j.result === undefined || j.result === null) throw new Error(`${method}: null result`);
  return j.result;
}

export interface GatherOptions {
  rpcUrl?: string;
  offline?: boolean;
  shareDecimals?: number;
}

/** What the gate needs from the RPC, derived from the assertions present in gate.yaml. Returns undefined when nothing asks for it. */
export function rpcNeeds(gate: GateConfig): { txHashes: string[]; calls: Array<{ vault: string; block: number }> } | undefined {
  const txHashes = new Set<string>();
  const calls: Array<{ vault: string; block: number }> = [];
  for (const a of gate.assertions) {
    if (a.kind === "log_index_matches_rpc") for (const r of a.rows ?? []) if (typeof r.tx_hash === "string") txHashes.add(r.tx_hash.toLowerCase());
    if (a.kind === "observation_matches_reference" && a.block !== undefined) for (const vault of Object.keys(a.expected ?? {})) calls.push({ vault: vault.toLowerCase(), block: a.block });
  }
  if (!txHashes.size && !calls.length) return undefined;
  return { txHashes: [...txHashes], calls };
}

export async function gatherRpcEvidence(ctx: Ctx, gate: GateConfig, opts: GatherOptions = {}): Promise<RpcEvidence | undefined> {
  const needs = rpcNeeds(gate);
  if (!needs) return undefined;
  const url = opts.rpcUrl ?? ctx.env.BASE_RPC_URL ?? DEFAULT_BASE_RPC;
  const ev: RpcEvidence = { url, reachable: false, receipts: {}, convertToAssets: {} };
  if (opts.offline || ctx.env.STREAMSMITH_OFFLINE === "1") {
    ev.error = "offline mode (--offline / STREAMSMITH_OFFLINE=1)";
    return ev;
  }
  try {
    const cid = await rpcCall<string>(ctx, url, "eth_chainId", [], 10000);
    ev.chainId = Number.parseInt(cid, 16);
    ev.reachable = true;
  } catch (err) {
    ev.error = `RPC ${url} unreachable: ${(err as Error).message}`;
    ctx.log(`gate: ${ev.error}; live RPC cross-checks skipped`);
    return ev;
  }
  for (const tx of needs.txHashes) {
    try {
      const r = await rpcCall<{ blockNumber?: string; logs?: Array<{ address?: string; logIndex?: string; topics?: string[] }> }>(ctx, url, "eth_getTransactionReceipt", [tx]);
      const logs: RpcLog[] = (r.logs ?? []).map((l) => {
        const out: RpcLog = { address: String(l.address ?? "").toLowerCase(), logIndex: Number.parseInt(String(l.logIndex ?? "0x0"), 16) };
        if (l.topics?.[0]) out.topic0 = l.topics[0].toLowerCase();
        return out;
      });
      const rec: { blockNumber?: number; logs: RpcLog[] } = { logs };
      if (r.blockNumber) rec.blockNumber = Number.parseInt(r.blockNumber, 16);
      ev.receipts[tx] = rec;
    } catch (err) {
      ev.receipts[tx] = { error: (err as Error).message };
    }
  }
  const shares = 10n ** BigInt(opts.shareDecimals ?? 18);
  for (const c of needs.calls) {
    const key = `${c.vault}@${c.block}`;
    try {
      const hex = await rpcCall<string>(ctx, url, "eth_call", [{ to: c.vault, data: convertToAssetsCalldata(shares) }, "0x" + c.block.toString(16)]);
      if (!/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 3) throw new Error(`eth_call returned "${hex}"`);
      ev.convertToAssets[key] = { raw: BigInt(hex).toString(10) };
    } catch (err) {
      ev.convertToAssets[key] = { error: (err as Error).message };
    }
  }
  return ev;
}
