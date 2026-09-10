// Boots the generated server over stdio with unreachable ClickHouse/RPC endpoints and speaks MCP to it:
// tools/list must expose the generated schemas, and every data call must refuse (check_unavailable) because the
// deployment could not be verified. Exercises registerTool with the zod v4 shapes at runtime.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_DIR } from "./helpers.ts";

interface Rpc { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } }

async function talk(messages: Array<Record<string, unknown>>): Promise<{ responses: Rpc[]; stderr: string }> {
  const child = spawn(process.execPath, [join(GENERATED_DIR, "bin", "server.js")], {
    cwd: GENERATED_DIR,
    env: { ...process.env, CLICKHOUSE_URL: "http://127.0.0.1:9", BASE_RPC_URL: "http://127.0.0.1:9", CHECK_INTERVAL_SECONDS: "1", NODE_NO_WARNINGS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += String(d); });
  const responses: Rpc[] = [];
  const wanted = messages.filter((m) => m.id !== undefined).length;
  const done = new Promise<void>((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += String(d);
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) responses.push(JSON.parse(line) as Rpc);
        if (responses.length >= wanted) resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited early (${code}): ${stderr}`)));
    setTimeout(() => reject(new Error(`timeout; got ${responses.length}/${wanted}: ${stderr}`)), 20_000).unref();
  });
  for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  try { await done; } finally { child.kill(); }
  return { responses, stderr };
}

describe("generated server over stdio", () => {
  it("lists the generated tools and refuses data calls when the deployment cannot be verified", async () => {
    const { responses } = await talk([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vault_flows", arguments: { limit: 1 } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vault_flows", arguments: { vault: "0x" + "9".repeat(40) } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "pipeline_status", arguments: {} } },
    ]);
    const byId = new Map(responses.map((r) => [r.id, r]));
    expect((byId.get(1)!.result!.serverInfo as { name: string }).name).toBe("@ethonline26/mcp-vaultflows");

    const tools = byId.get(2)!.result!.tools as Array<{ name: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }>;
    expect(tools.map((t) => t.name)).toEqual(["vault_flows", "share_value_observations", "vaults", "recent_share_migration", "vault_flows_24h", "share_value_growth", "pipeline_status"]);
    const vf = tools.find((t) => t.name === "vault_flows")!;
    const props = vf.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.vault!.enum).toEqual(["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
    expect(props.direction!.enum).toEqual(["deposit", "withdraw"]);
    expect(props.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 500, default: 100 });
    expect(props.windowHours).toMatchObject({ type: "integer", minimum: 1, maximum: 2160, default: 24 });
    expect(vf.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });

    const refusal = byId.get(3)!.result!;
    expect(refusal.isError).toBe(true);
    expect(refusal.structuredContent).toMatchObject({ refused: true, reason: "check_unavailable", tool: "vault_flows" });
    expect((refusal.structuredContent as { provenance: { packageHash: string } }).provenance.packageHash).toBe("ee3ec8930c790036ac477aca1e821fbcd76a339e89a35d2b26a7976446d54d82");

    // an out-of-set vault is rejected by the protocol layer (zod enum) before the handler runs
    const bad = byId.get(4)!;
    const rejected = bad.error !== undefined || (bad.result as { isError?: boolean }).isError === true;
    expect(rejected).toBe(true);
    expect(JSON.stringify(bad)).toMatch(/vault|invalid|Invalid/i);

    const status = byId.get(5)!.result!.structuredContent as Record<string, unknown>;
    expect(status).toMatchObject({ tool: "pipeline_status", ok: false, refused: true, reason: "check_unavailable" });
    expect((status.errors as string[]).length).toBeGreaterThan(0);
  });
});
