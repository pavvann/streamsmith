import type { Ctx } from "../util/ctx.ts";

export const DEFAULT_BASE_RPC = "https://mainnet.base.org";
export const BASE_BLOCK_TIME_SECONDS = 2;

export async function ethBlockNumber(ctx: Ctx, rpcUrl: string = ctx.env.BASE_RPC_URL ?? DEFAULT_BASE_RPC): Promise<number> {
  const res = await ctx.fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  if (!res.ok) throw new Error(`eth_blockNumber: HTTP ${res.status} from ${rpcUrl}`);
  const j = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!j.result) throw new Error(`eth_blockNumber: ${j.error?.message ?? "no result"}`);
  return Number.parseInt(j.result, 16);
}
