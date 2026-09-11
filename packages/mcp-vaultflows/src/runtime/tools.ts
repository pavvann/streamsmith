// Tool handlers: pure functions over (manifest, guardian, clickhouse) that return structured results, plus the
// glue that registers them on an McpServer. Kept free of MCP types so the refusal paths are unit-testable.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClickHouseClient } from "./clickhouse.ts";
import type { Guardian } from "./guardian.ts";
import { buildCountQuery, buildToolQuery, buildWindowBoundsQuery, effectiveInt, SqlBuildError, type ToolArgs } from "./sql.ts";
import type { ObservedWindow, ToolSpec } from "./types.ts";

export interface ToolOutcome {
  /** what the client receives, both as JSON text and as structuredContent */
  payload: Record<string, unknown>;
  isError: boolean;
}

export interface HandlerContext {
  guardian: Guardian;
  clickhouse: ClickHouseClient;
  log?: (message: string) => void;
}

interface WindowBounds { from: number | null; to: number | null }

function observedWindowFor(spec: ToolSpec, args: ToolArgs, bounds: WindowBounds | null): ObservedWindow | null {
  if (!spec.window) return null;
  const p = spec.params.find((x) => x.kind === "windowHours");
  const hours = p ? effectiveInt(p, args[p.name]) ?? null : null;
  const from = bounds?.from ?? null;
  const to = bounds?.to ?? null;
  return {
    hours,
    column: spec.window.column,
    source: spec.window.table,
    observedFromTimestamp: from,
    observedToTimestamp: to,
    startTimestamp: to === null ? null : hours === null ? from : Math.max(from ?? 0, to - hours * 3600),
    endTimestamp: to,
  };
}

async function readWindowBounds(ctx: HandlerContext, spec: ToolSpec): Promise<WindowBounds | null> {
  const q = buildWindowBoundsQuery(spec);
  if (!q) return null;
  const r = await ctx.clickhouse.query(q);
  const row = r.data[0] ?? {};
  if (Number(row.n ?? 0) === 0) return { from: null, to: null };
  return { from: Number(row.window_start), to: Number(row.window_end) };
}

/** Runs a table/view tool with fail-closed gating and provenance. */
export async function runDataTool(ctx: HandlerContext, spec: ToolSpec, rawArgs: ToolArgs): Promise<ToolOutcome> {
  const args: ToolArgs = { ...rawArgs };
  const refusal = ctx.guardian.gate();
  if (refusal) return { payload: { ...refusal, tool: spec.name }, isError: true };

  let query;
  try {
    query = buildToolQuery(spec, args);
  } catch (e) {
    if (e instanceof SqlBuildError) return { payload: { error: true, reason: "invalid_arguments", detail: e.message, tool: spec.name, provenance: ctx.guardian.provenance() }, isError: true };
    throw e;
  }

  try {
    if (spec.whenEmpty) {
      const count = await ctx.clickhouse.query(buildCountQuery(spec.source, spec.deletedFilter));
      const c = Number(count.data[0]?.c ?? 0);
      if (c === 0) {
        return { payload: { unavailable: true, reason: spec.whenEmpty.reason, tool: spec.name, source: spec.source, provenance: ctx.guardian.provenance(observedWindowFor(spec, args, null)) }, isError: false };
      }
    }
    const bounds = await readWindowBounds(ctx, spec);
    const res = await ctx.clickhouse.query(query);
    const limit = Number(query.params.limit);
    const window = observedWindowFor(spec, args, bounds);
    return {
      payload: {
        tool: spec.name,
        source: spec.source,
        rowCount: res.data.length,
        truncated: res.data.length >= limit,
        columns: res.meta,
        rows: res.data,
        arguments: effectiveArguments(spec, args),
        provenance: ctx.guardian.provenance(window),
      },
      isError: false,
    };
  } catch (e) {
    ctx.log?.(`tool ${spec.name} failed: ${(e as Error).message}`);
    return { payload: { error: true, reason: "query_failed", detail: (e as Error).message, tool: spec.name, provenance: ctx.guardian.provenance() }, isError: true };
  }
}

function effectiveArguments(spec: ToolSpec, args: ToolArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params) {
    if (p.kind === "windowHours" || p.kind === "limit") out[p.name] = effectiveInt(p, args[p.name]) ?? null;
    else out[p.name] = args[p.name] ?? null;
  }
  return out;
}

/** pipeline_status: runs a fresh check and reports everything the fail-closed policy looked at. */
export async function runPipelineStatus(ctx: HandlerContext): Promise<ToolOutcome> {
  const s = await ctx.guardian.check();
  const m = ctx.guardian.manifest;
  const refusal = ctx.guardian.gate();
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    payload: {
      tool: "pipeline_status",
      ok: refusal === null,
      refused: refusal !== null,
      reason: refusal?.reason ?? null,
      detail: refusal?.detail ?? null,
      package: m.package,
      receipt: s.receipt ? {
        packageHash: s.receipt.packageHash, parametersHash: s.receipt.parametersHash, protoDescriptorHash: s.receipt.protoDescriptorHash,
        sinkSchemaHash: s.receipt.sinkSchemaHash, deploymentMode: s.receipt.deploymentMode, deploymentId: s.receipt.deploymentId ?? null,
        startBlock: s.receipt.startBlock, gatePassed: s.receipt.gate?.passed ?? null, gateRanges: s.receipt.gate?.ranges ?? null, createdAt: s.receipt.createdAt,
        matchesManifest: s.receiptMatchesManifest, mismatch: s.receiptMismatch,
      } : null,
      live: {
        headBlock: s.headBlock,
        headTimestamp: s.headTimestamp,
        headAgeSeconds: s.headTimestamp !== null ? Math.max(0, nowSec - s.headTimestamp) : null,
        chainHead: s.chainHead,
        chainId: s.chainId,
        lagBlocks: s.lagBlocks,
      },
      schema: s.schema ? { ok: s.schema.ok, expectedColumnSetHash: s.schema.expectedHash, actualColumnSetHash: s.schema.actualHash, diff: s.schema.diff } : null,
      clickhouse: ctx.clickhouse.access?.() ?? null,
      policy: { maxLagBlocks: ctx.guardian.maxLagBlocks, checkIntervalSeconds: m.policy.checkIntervalSeconds, queryTimeoutMs: m.policy.queryTimeoutMs, maxLimit: m.policy.maxLimit },
      vaults: m.vaults,
      tools: m.tools.map((t) => t.name),
      errors: s.errors,
      checkedAt: s.checkedAt.toISOString(),
      provenance: ctx.guardian.provenance(),
    },
    isError: false,
  };
}

/** Registers every manifest tool on the server; `shapes` are the generated zod raw shapes keyed by tool name. */
export function registerTools(server: McpServer, ctx: HandlerContext, shapes: Record<string, Record<string, unknown>>): void {
  const m = ctx.guardian.manifest;
  for (const spec of m.tools) {
    const shape = shapes[spec.name];
    if (!shape) throw new Error(`no generated input schema for tool ${spec.name}`);
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        // The generated shapes are zod v4 raw shapes; the SDK accepts them (ZodRawShapeCompat).
        inputSchema: shape as never,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      (async (args: unknown) => {
        const outcome = spec.kind === "status"
          ? await runPipelineStatus(ctx)
          : await runDataTool(ctx, spec, (args ?? {}) as ToolArgs);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(outcome.payload, null, 2) }],
          structuredContent: outcome.payload,
          ...(outcome.isError ? { isError: true } : {}),
        };
      }) as never,
    );
  }
}
