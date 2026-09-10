// Independent chain head: eth_chainId + eth_blockNumber over JSON-RPC. Used only to measure the sink's lag.

export interface ChainHead {
  head(): Promise<{ blockNumber: number; chainId: number }>;
}

export class JsonRpcChainHead implements ChainHead {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, timeoutMs = 10_000, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  private async call(method: string): Promise<string> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(`rpc ${method}: ${json.error.message ?? "error"}`);
    if (typeof json.result !== "string") throw new Error(`rpc ${method}: unexpected result`);
    return json.result;
  }

  async head(): Promise<{ blockNumber: number; chainId: number }> {
    const [bn, cid] = await Promise.all([this.call("eth_blockNumber"), this.call("eth_chainId")]);
    return { blockNumber: Number.parseInt(bn, 16), chainId: Number.parseInt(cid, 16) };
  }
}
