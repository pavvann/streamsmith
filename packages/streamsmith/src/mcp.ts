// `streamsmith mcp`: hand the receipt to the MCP generator (packages/mcpgen, owned by another agent) and bind the
// generated manifest back into the receipt as mcpManifestHash. Streamsmith does not generate MCP code itself.
import { join, isAbsolute, relative } from "node:path";
import type { Ctx } from "./util/ctx.ts";
import { paths } from "./util/ctx.ts";
import { exists, readJson, writeJson } from "./util/fsx.ts";
import { sha256File } from "./util/hash.ts";
import { loadReceipt, loadReceiptSchema, validateReceipt, receiptHash, type Receipt } from "./receipt.ts";

export const MCPGEN_FILTER = "@ethonline26/mcpgen";
export const DEFAULT_MCP_OUT = "packages/mcp-vaultflows";

export interface McpOptions {
  runId: string;
  receiptPath: string;
  outDir?: string;
  protoPath?: string;
  viewsPath?: string;
  filter?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

export interface McpRecord {
  command: string;
  code: number;
  durationMs: number;
  receiptPath: string;
  out: string;
  manifest: string;
  mcpManifestHash: string;
  receiptHash: string;
  stdoutTail: string;
  createdAt: string;
}

/** The generator's contract: its last non-empty stdout line is exactly {"manifest": "<path>"}. */
export function parseManifestLine(stdout: string): string {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new Error("mcpgen printed nothing on stdout; expected a final {\"manifest\": \"<path>\"} line");
  let obj: unknown;
  try {
    obj = JSON.parse(last);
  } catch {
    throw new Error(`mcpgen's last stdout line is not JSON: ${last.slice(0, 200)}`);
  }
  const m = obj && typeof obj === "object" ? (obj as { manifest?: unknown }).manifest : undefined;
  if (typeof m !== "string" || !m) throw new Error(`mcpgen's last stdout line lacks a "manifest" string: ${last.slice(0, 200)}`);
  return m;
}

export function mcpgenArgs(ctx: Ctx, o: McpOptions): { cmd: string; args: string[]; out: string; receipt: string } {
  const abs = (p: string) => (isAbsolute(p) ? p : join(ctx.root, p));
  const receipt = abs(o.receiptPath);
  const out = abs(o.outDir ?? DEFAULT_MCP_OUT);
  const args = ["--filter", o.filter ?? MCPGEN_FILTER, "generate", "--receipt", receipt];
  if (o.protoPath) args.push("--proto", abs(o.protoPath));
  if (o.viewsPath) args.push("--views", abs(o.viewsPath));
  args.push("--out", out, ...(o.extraArgs ?? []));
  return { cmd: "pnpm", args, out, receipt };
}

export async function runMcp(ctx: Ctx, o: McpOptions): Promise<{ record: McpRecord; path: string; receipt: Receipt }> {
  const { cmd, args, out, receipt: receiptAbs } = mcpgenArgs(ctx, o);
  if (!(await exists(receiptAbs))) throw new Error(`receipt not found: ${o.receiptPath}`);
  ctx.log(`mcp: ${cmd} ${args.join(" ")}`);
  const r = await ctx.runner.run(cmd, args, { cwd: ctx.root, timeoutMs: o.timeoutMs ?? 300000, echoStderr: true });
  const logPath = paths.runs(ctx, o.runId, "mcp.log");
  await writeJson(logPath + ".json", { command: r.command, code: r.code, stdout: r.stdout.slice(-20000), stderr: r.stderr.slice(-20000) });
  if (r.code !== 0) throw new Error(`mcpgen failed (exit ${r.code}${r.timedOut ? ", timeout" : ""}): ${(r.stderr || r.stdout).trim().slice(-600)}`);
  const manifestRaw = parseManifestLine(r.stdout);
  const manifest = isAbsolute(manifestRaw) ? manifestRaw : join(ctx.root, manifestRaw);
  if (!(await exists(manifest))) throw new Error(`mcpgen reported manifest ${manifestRaw} but the file does not exist`);
  const mcpManifestHash = await sha256File(manifest);

  const receipt = await loadReceipt(receiptAbs);
  receipt.mcpManifestHash = mcpManifestHash;
  const { errors } = validateReceipt(receipt, await loadReceiptSchema(ctx.root));
  if (errors.length) throw new Error(`receipt with mcpManifestHash no longer validates: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  await writeJson(receiptAbs, receipt);
  const hash = receiptHash(receipt);

  const record: McpRecord = {
    command: r.command,
    code: r.code,
    durationMs: r.durationMs,
    receiptPath: relative(ctx.root, receiptAbs),
    out: relative(ctx.root, out),
    manifest: relative(ctx.root, manifest),
    mcpManifestHash,
    receiptHash: hash,
    stdoutTail: r.stdout.trim().split("\n").slice(-5).join("\n"),
    createdAt: ctx.now().toISOString(),
  };
  const path = paths.runs(ctx, o.runId, "mcp.json");
  await writeJson(path, record);
  const manifestJson = paths.runs(ctx, o.runId, "manifest.json");
  if (await exists(manifestJson)) {
    const m = await readJson<{ receiptHash?: string }>(manifestJson);
    if (m.receiptHash && m.receiptHash !== hash) ctx.log(`mcp: runs/${o.runId}/manifest.json receiptHash is stale; run \`streamsmith manifest finish\` again`);
  }
  ctx.log(`mcp: manifest ${record.manifest} sha256 ${mcpManifestHash}; receipt ${record.receiptPath} receiptHash ${hash}`);
  return { record, path, receipt };
}
