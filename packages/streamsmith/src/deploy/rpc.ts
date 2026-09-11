import type { Ctx } from "../util/ctx.ts";

export const DEFAULT_BASE_RPC = "https://mainnet.base.org";
export const BASE_BLOCK_TIME_SECONDS = 2;

export async function ethBlockNumber(ctx: Ctx, rpcUrl: string = ctx.env.BASE_RPC_URL ?? DEFAULT_BASE_RPC, verbose?: boolean): Promise<number> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  if (verbose) ctx.log(`eth_blockNumber: POST ${rpcUrl} body=${body}`);
  const res = await ctx.fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const text = await res.text();
  if (verbose) ctx.log(`eth_blockNumber: -> HTTP ${res.status} first200=${JSON.stringify(text.slice(0, 200))}`);
  if (!res.ok) throw new Error(`eth_blockNumber: HTTP ${res.status} from ${rpcUrl}: ${text.length ? text.slice(0, 300) : "(empty response body)"}`);
  let j: { result?: string; error?: { message?: string } };
  try {
    j = text === "" ? {} : (JSON.parse(text) as typeof j);
  } catch (err) {
    throw new Error(`eth_blockNumber: HTTP ${res.status} from ${rpcUrl} but the response is not valid JSON (${(err as Error).message}): ${text.slice(0, 300) || "(empty response body)"}`);
  }
  if (!j.result) throw new Error(`eth_blockNumber: ${j.error?.message ?? "no result"} (HTTP ${res.status} from ${rpcUrl})`);
  return Number.parseInt(j.result, 16);
}
