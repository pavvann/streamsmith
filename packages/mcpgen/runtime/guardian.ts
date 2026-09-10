// Fail-closed guardian. On startup and every checkInterval it (a) re-reads the receipt and checks it still
// describes the package this server was generated for, (b) compares the live ClickHouse column set with the
// manifest's expectation, (c) measures lag = chain head (independent RPC) - sink head. Data tools consult the
// cached verdict; any failure to verify is itself a refusal (check_unavailable).
import type { ClickHouseClient } from "./clickhouse.ts";
import type { ChainHead } from "./rpc.ts";
import { buildColumnsQuery, buildHeadQuery } from "./sql.ts";
import { columnSetHash, diffColumnSets, wildcardsOf, type SchemaDiff } from "./schemahash.ts";
import type { ExpectedColumn, Manifest, ObservedWindow, Provenance, Refusal, RefusalReason, RuntimeReceipt } from "./types.ts";

export interface GuardianOptions {
  manifest: Manifest;
  /** re-read on every cycle; throws when unreadable */
  readReceipt: () => Promise<RuntimeReceipt>;
  clickhouse: ClickHouseClient;
  chainHead: ChainHead;
  database: string;
  maxLagBlocks: number;
  checkIntervalMs: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface SchemaCheck {
  ok: boolean;
  expectedHash: string;
  actualHash: string | null;
  diff: SchemaDiff | null;
  actual: Record<string, ExpectedColumn[]> | null;
}

export interface CheckState {
  checkedAt: Date;
  receipt: RuntimeReceipt | null;
  receiptMatchesManifest: boolean;
  receiptMismatch: Array<{ field: string; manifest: string; receipt: string }>;
  schema: SchemaCheck | null;
  headBlock: number | null;
  headTimestamp: number | null;
  chainHead: number | null;
  chainId: number | null;
  lagBlocks: number | null;
  errors: string[];
  refusal: { reason: RefusalReason; detail: string; expected?: unknown; actual?: unknown } | null;
}

export class Guardian {
  private state: CheckState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<CheckState> | null = null;
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly opts: GuardianOptions;

  constructor(opts: GuardianOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
  }

  get manifest(): Manifest { return this.opts.manifest; }
  get maxLagBlocks(): number { return this.opts.maxLagBlocks; }
  get lastState(): CheckState | null { return this.state; }

  /** Start the periodic check (first run immediately). Returns the first check's result. */
  async start(): Promise<CheckState> {
    const first = await this.check();
    this.timer = setInterval(() => { void this.check().catch((e) => this.log(`check failed: ${(e as Error).message}`)); }, this.opts.checkIntervalMs);
    this.timer.unref?.();
    return first;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs one full check cycle; never throws (errors become check_unavailable). Concurrent calls share one run. */
  check(): Promise<CheckState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runCheck().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async runCheck(): Promise<CheckState> {
    const m = this.opts.manifest;
    const s: CheckState = {
      checkedAt: this.now(), receipt: null, receiptMatchesManifest: false, receiptMismatch: [], schema: null,
      headBlock: null, headTimestamp: null, chainHead: null, chainId: null, lagBlocks: null, errors: [], refusal: null,
    };

    // (a) receipt
    try {
      const r = await this.opts.readReceipt();
      s.receipt = r;
      const pairs: Array<[string, string, string]> = [
        ["packageHash", m.package.packageHash, r.packageHash],
        ["outputModuleHash", m.package.outputModuleHash, r.outputModuleHash],
        ["parametersHash", m.receipt.parametersHash, r.parametersHash],
        ["protoDescriptorHash", m.receipt.protoDescriptorHash, r.protoDescriptorHash],
        ["sinkSchemaHash", m.receipt.sinkSchemaHash, r.sinkSchemaHash],
      ];
      for (const [field, a, b] of pairs) if ((a ?? "").toLowerCase() !== (b ?? "").toLowerCase()) s.receiptMismatch.push({ field, manifest: a, receipt: b });
      s.receiptMatchesManifest = s.receiptMismatch.length === 0;
    } catch (e) {
      s.errors.push(`receipt: ${(e as Error).message}`);
    }

    // (b) schema
    const tables = Object.keys(m.expectedSchema.tables);
    try {
      const res = await this.opts.clickhouse.query(buildColumnsQuery(this.opts.database, tables));
      const actual: Record<string, ExpectedColumn[]> = Object.fromEntries(tables.map((t) => [t, []]));
      for (const row of res.data) {
        const t = String(row.table);
        (actual[t] ??= []).push({ name: String(row.name), type: String(row.type) });
      }
      const actualHash = columnSetHash(actual, wildcardsOf(m.expectedSchema.tables));
      const ok = actualHash === m.expectedSchema.columnSetHash;
      s.schema = { ok, expectedHash: m.expectedSchema.columnSetHash, actualHash, diff: ok ? null : diffColumnSets(m.expectedSchema.tables, actual), actual };
    } catch (e) {
      s.errors.push(`schema: ${(e as Error).message}`);
    }

    // (c) lag
    try {
      const withTs = tables.map((t) => ({ table: t, hasBlockTimestamp: (m.expectedSchema.tables[t] ?? []).some((c) => c.name === "block_timestamp") }));
      const res = await this.opts.clickhouse.query(buildHeadQuery(withTs));
      const row = res.data[0] ?? {};
      s.headBlock = toInt(row.head_block);
      s.headTimestamp = toInt(row.head_timestamp);
    } catch (e) {
      s.errors.push(`head: ${(e as Error).message}`);
    }
    try {
      const h = await this.opts.chainHead.head();
      s.chainHead = h.blockNumber;
      s.chainId = h.chainId;
    } catch (e) {
      s.errors.push(`rpc: ${(e as Error).message}`);
    }
    if (s.headBlock !== null && s.chainHead !== null) s.lagBlocks = Math.max(0, s.chainHead - s.headBlock);

    // verdict, in precedence order
    if (!s.receiptMatchesManifest && s.receipt) {
      s.refusal = { reason: "receipt_mismatch", detail: "the receipt on disk no longer describes the package this server was generated from; regenerate the MCP", expected: Object.fromEntries(s.receiptMismatch.map((x) => [x.field, x.manifest])), actual: Object.fromEntries(s.receiptMismatch.map((x) => [x.field, x.receipt])) };
    } else if (s.schema && !s.schema.ok) {
      s.refusal = { reason: "schema_mismatch", detail: "live ClickHouse column set differs from the receipt's contract", expected: { columnSetHash: s.schema.expectedHash, tables: m.expectedSchema.tables }, actual: { columnSetHash: s.schema.actualHash, tables: s.schema.actual, diff: s.schema.diff } };
    } else if (s.chainId !== null && s.chainId !== m.package.chainId) {
      s.refusal = { reason: "chain_mismatch", detail: "BASE_RPC_URL answers for a different chain than the receipt", expected: { chainId: m.package.chainId }, actual: { chainId: s.chainId } };
    } else if (s.lagBlocks !== null && s.lagBlocks > this.opts.maxLagBlocks) {
      s.refusal = { reason: "stale_data", detail: `sink head is ${s.lagBlocks} blocks behind the chain head (limit ${this.opts.maxLagBlocks})`, expected: { maxLagBlocks: this.opts.maxLagBlocks }, actual: { lagBlocks: s.lagBlocks, headBlock: s.headBlock, chainHead: s.chainHead } };
    } else if (s.errors.length > 0 || !s.schema || s.lagBlocks === null || !s.receipt) {
      s.refusal = { reason: "check_unavailable", detail: "could not verify the deployment against the receipt: " + (s.errors.join("; ") || "incomplete check"), expected: { receipt: true, schema: true, lag: true }, actual: { receipt: !!s.receipt, schema: !!s.schema, lag: s.lagBlocks !== null, errors: s.errors } };
    }
    this.state = s;
    this.log(`check ${s.checkedAt.toISOString()}: ${s.refusal ? `REFUSE ${s.refusal.reason}` : "ok"} head=${s.headBlock} chain=${s.chainHead} lag=${s.lagBlocks}`);
    return s;
  }

  /**
   * Verdict for a data tool call from the cached state. A missing or stale cache (older than 3 intervals) is a
   * refusal too: the server never answers from an unverified state.
   */
  gate(observedWindow: ObservedWindow | null = null): Refusal | null {
    const s = this.state;
    const ageMs = s ? this.now().getTime() - s.checkedAt.getTime() : Number.POSITIVE_INFINITY;
    if (!s || ageMs > this.opts.checkIntervalMs * 3) {
      return { refused: true, reason: "check_unavailable", detail: s ? `last verification is ${Math.round(ageMs / 1000)} s old` : "no verification has completed yet", checkedAt: s?.checkedAt.toISOString() ?? null, provenance: this.provenance(observedWindow) };
    }
    if (!s.refusal) return null;
    return { refused: true, reason: s.refusal.reason, detail: s.refusal.detail, expected: s.refusal.expected, actual: s.refusal.actual, checkedAt: s.checkedAt.toISOString(), provenance: this.provenance(observedWindow) };
  }

  provenance(observedWindow: ObservedWindow | null = null): Provenance {
    const m = this.opts.manifest;
    const s = this.state;
    return {
      packageHash: m.package.packageHash,
      outputModuleHash: m.package.outputModuleHash,
      parametersHash: m.receipt.parametersHash,
      protoDescriptorHash: m.receipt.protoDescriptorHash,
      sinkSchemaHash: m.receipt.sinkSchemaHash,
      schemaColumnSetHash: m.expectedSchema.columnSetHash,
      deploymentMode: m.package.deploymentMode,
      deploymentId: m.package.deploymentId,
      chainId: m.package.chainId,
      headBlock: s?.headBlock ?? null,
      headTimestamp: s?.headTimestamp ?? null,
      chainHead: s?.chainHead ?? null,
      lagBlocks: s?.lagBlocks ?? null,
      observedWindow,
      checkedAt: s?.checkedAt.toISOString() ?? null,
    };
  }
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}
