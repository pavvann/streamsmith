/**
 * Data access for the decision service. One interface, two implementations:
 *
 *   ClickHouseHttpSource — the deployed erc4626-flows sink over ClickHouse HTTP, read-only
 *                          (`readonly=1`, bound `param_*` values, hard timeout), running the same
 *                          SQL as the generated MCP tools `share_value_growth` and
 *                          `vault_flows_24h`. Env selects local Docker (CLICKHOUSE_*) or
 *                          ClickHouse Cloud (CH_CLOUD_*).
 *   FixtureSource        — the same rows from a JSON fixture, for tests and for demoing the UI
 *                          without a database.
 *
 * Why the SQL is inlined instead of selecting from the views: the views are created by Streamsmith
 * after the sink has created the base tables, so a fresh deployment may not have them yet. The
 * statements below are the view bodies from packages/erc4626-flows/sql/views.sql verbatim (same
 * aggregates, same `_deleted_ = 0` / `call_ok` filters, same "window end = newest observed row"
 * semantics), so both paths answer identically. Set `useViews: true` to read the views instead.
 *
 * Everything a caller can influence is a bound parameter; identifiers are constants in this file.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {FlowWindow, GrowthObservation, LiquidityFact, ObservedSize, PipelineHealth, PositionSnapshot} from './decision.js';
import {fromBaseUnits} from './decimal.js';
import {APP_DIR, envOptional, loadEnv} from './env.js';

export interface SourceDescription {
  kind: 'clickhouse' | 'fixture';
  /** human-readable origin, safe to print (no credentials) */
  origin: string;
  database: string | null;
  readOnly: boolean;
  note?: string;
}

export interface PipelineStatusOptions {
  maxLagBlocks: number;
  /** chain id from the Deployment Receipt; a mismatch is a refusal. */
  expectedChainId: number | null;
}

export interface VaultflowsSource {
  describe(): SourceDescription;
  /** `share_value_growth`: first/last call_ok observation per vault over the observed window. */
  shareValueGrowth(opts?: {windowHours?: number}): Promise<GrowthObservation[]>;
  /** `vault_flows_24h`, plus the split of flows that are ours (guardrail self-exclusion). */
  flowWindow24h(selfAddresses: string[]): Promise<FlowWindow[]>;
  /** totalAssets at the newest call_ok observation: the guardrail's denominator. */
  observedSizes(): Promise<ObservedSize[]>;
  /** `_blocks_` max block vs `eth_blockNumber`, fail-closed. */
  pipelineStatus(opts: PipelineStatusOptions): Promise<PipelineHealth>;
}

// ---------------------------------------------------------------------------------------------
// ClickHouse over HTTP
// ---------------------------------------------------------------------------------------------

export interface ClickHouseHttpOptions {
  url: string;
  user?: string;
  password?: string;
  database: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** SELECT from the views instead of running their bodies against the base tables. */
  useViews?: boolean;
  /** JSON-RPC endpoint used only to measure the chain head. */
  rpcUrl?: string;
  originLabel?: string;
}

export interface ClickHouseRow {
  [column: string]: unknown;
}

export class ClickHouseQueryError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ClickHouseQueryError';
    this.status = status;
  }
}

/**
 * `request-readonly`: we send `readonly=1` per query.
 * `profile-readonly`: the credential itself is read-only server-side and refuses per-query
 * settings, so none are sent. Both are read-only; the second is enforced by the server.
 */
export type SettingsMode = 'request-readonly' | 'profile-readonly';

/** ClickHouse error 164 when the user's profile is already readonly. */
export function isProfileReadonlyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Code:\s*164/.test(msg) && /readonly mode/i.test(msg);
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(str(v));
  return Number.isFinite(n) ? n : 0;
}
function nullableFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

export class ClickHouseHttpSource implements VaultflowsSource {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly opts: ClickHouseHttpOptions;

  constructor(opts: ClickHouseHttpOptions) {
    this.opts = opts;
    const u = new URL(opts.url);
    u.search = '';
    u.pathname = '/';
    this.endpoint = u;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  describe(): SourceDescription {
    return {
      kind: 'clickhouse',
      origin: this.opts.originLabel ?? `${this.endpoint.protocol}//${this.endpoint.host}`,
      database: this.opts.database,
      readOnly: true,
      note:
        (this.opts.useViews ? 'reading the share_value_growth / vault_flows_24h views' : 'running the view bodies against the base tables') +
        (this.settingsMode === 'profile-readonly'
          ? '; the credential is read-only server-side (it may not set query settings)'
          : '; queries are sent with readonly=1'),
    };
  }

  /**
   * POST one statement with bound parameters; returns JSON rows.
   *
   * `readonly=1` and a server-side `max_execution_time` are requested per query. A user whose
   * PROFILE is already read-only (ClickHouse Cloud's `ro` user is) cannot set any setting at all
   * and answers `Code: 164 ... Cannot modify 'max_execution_time'/'readonly' setting in readonly
   * mode`; that is a stronger guarantee than the one we asked for, so the request is retried once
   * without the settings and the mode is remembered for the rest of the process. The client-side
   * AbortSignal timeout applies either way, and no code path in this app ever sends a write.
   */
  async query(sql: string, params: Record<string, string> = {}): Promise<ClickHouseRow[]> {
    try {
      return await this.post(sql, params, this.settingsMode);
    } catch (e) {
      if (this.settingsMode === 'request-readonly' && isProfileReadonlyError(e)) {
        this.settingsMode = 'profile-readonly';
        return this.post(sql, params, this.settingsMode);
      }
      throw e;
    }
  }

  /** How this endpoint accepts per-query settings; discovered on the first refusal. */
  private settingsMode: SettingsMode = 'request-readonly';

  /** Which read-only guarantee is actually in force, for the UI/provenance line. */
  get readOnlyMode(): SettingsMode {
    return this.settingsMode;
  }

  private async post(sql: string, params: Record<string, string>, mode: SettingsMode): Promise<ClickHouseRow[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set('database', this.opts.database);
    if (mode === 'request-readonly') {
      url.searchParams.set('readonly', '1');
      url.searchParams.set('max_execution_time', String(Math.ceil(this.timeoutMs / 1000)));
      url.searchParams.set('output_format_json_quote_64bit_integers', '0');
    }
    for (const [k, v] of Object.entries(params)) {
      if (!IDENT.test(k)) throw new ClickHouseQueryError(`parameter name ${JSON.stringify(k)} is not an identifier`);
      url.searchParams.set(`param_${k}`, v);
    }
    const headers: Record<string, string> = {'content-type': 'text/plain; charset=utf-8'};
    if (this.opts.user !== undefined) headers['x-clickhouse-user'] = this.opts.user;
    if (this.opts.password !== undefined) headers['x-clickhouse-key'] = this.opts.password;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: `${sql}\nFORMAT JSON`,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ClickHouseQueryError(`clickhouse request failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ClickHouseQueryError(`clickhouse HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    try {
      const json = JSON.parse(text) as {data?: ClickHouseRow[]};
      return json.data ?? [];
    } catch {
      throw new ClickHouseQueryError(`clickhouse returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  async shareValueGrowth(opts: {windowHours?: number} = {}): Promise<GrowthObservation[]> {
    const hours = opts.windowHours;
    const params: Record<string, string> = {};
    let sql: string;
    if (this.opts.useViews) {
      sql = GROWTH_FROM_VIEW;
      if (hours !== undefined) {
        // The generated view tool takes windowHours; the view itself carries the whole window.
        params.windowHours = String(Math.trunc(hours));
        sql = GROWTH_FROM_VIEW_WINDOWED;
      }
    } else {
      sql = hours === undefined ? growthSql(null) : growthSql('window');
      if (hours !== undefined) params.windowHours = String(Math.trunc(hours));
    }
    const rows = await this.query(sql, params);
    return rows.map((r) => ({
      vaultAddress: str(r.vault).toLowerCase(),
      firstBlockNumber: num(r.first_block_number),
      firstBlockTimestamp: num(r.first_block_timestamp),
      firstAssetsPerShareNormalized: str(r.first_assets_per_share_normalized),
      lastBlockNumber: num(r.last_block_number),
      lastBlockTimestamp: num(r.last_block_timestamp),
      lastAssetsPerShareNormalized: str(r.last_assets_per_share_normalized),
      growth: nullableFloat(r.growth),
      observedHours: num(r.observed_hours),
      observationCount: num(r.observation_count),
    }));
  }

  async flowWindow24h(selfAddresses: string[]): Promise<FlowWindow[]> {
    const addresses = [...new Set(selfAddresses.filter(Boolean).map((a) => a.toLowerCase()))];
    const params: Record<string, string> = {};
    addresses.forEach((a, i) => {
      params[`self${i}`] = a;
    });
    const selfPredicate = addresses.length === 0
      ? '0'
      : `(lower(owner) IN (${addresses.map((_, i) => `{self${i}:String}`).join(', ')})` +
        ` OR lower(receiver) IN (${addresses.map((_, i) => `{self${i}:String}`).join(', ')})` +
        ` OR lower(caller) IN (${addresses.map((_, i) => `{self${i}:String}`).join(', ')}))`;
    const rows = await this.query(flowsSql(selfPredicate), params);
    return rows.map((r) => ({
      vaultAddress: str(r.vault).toLowerCase(),
      windowStartTimestamp: num(r.window_start_timestamp),
      windowEndTimestamp: num(r.window_end_timestamp),
      assetsInNormalized: str(r.assets_in_normalized),
      assetsOutNormalized: str(r.assets_out_normalized),
      netAssetsNormalized: str(r.net_assets_normalized),
      selfAssetsInNormalized: str(r.self_assets_in_normalized),
      selfAssetsOutNormalized: str(r.self_assets_out_normalized),
      depositCount: num(r.deposit_count),
      withdrawCount: num(r.withdraw_count),
      flowsWithoutMetadata: num(r.flows_without_metadata),
    }));
  }

  async observedSizes(): Promise<ObservedSize[]> {
    const [sizes, decimals] = await Promise.all([this.query(SIZES_SQL), this.query(ASSET_DECIMALS_SQL)]);
    const dp = new Map(decimals.map((d) => [str(d.vault).toLowerCase(), num(d.asset_decimals)]));
    const out: ObservedSize[] = [];
    for (const r of sizes) {
      const vault = str(r.vault).toLowerCase();
      const d = dp.get(vault);
      // No metadata anywhere means the denominator is not trustworthy: leave the row out and let
      // the decision refuse (guardrail_not_computable) rather than guess the asset's decimals.
      if (d === undefined || d === 0) continue;
      out.push({
        vaultAddress: vault,
        totalAssetsNormalized: fromBaseUnits(str(r.total_assets_raw), d),
        blockNumber: num(r.observed_block),
      });
    }
    return out;
  }

  async pipelineStatus(opts: PipelineStatusOptions): Promise<PipelineHealth> {
    const checkedAt = new Date().toISOString();
    const errors: string[] = [];
    let headBlock: number | null = null;
    try {
      const rows = await this.query(HEAD_SQL);
      const v = rows[0]?.head_block;
      headBlock = v === null || v === undefined ? null : num(v);
      if (headBlock === 0) headBlock = null;
    } catch (e) {
      errors.push(`sink head: ${(e as Error).message}`);
    }
    if (headBlock === null) {
      try {
        const rows = await this.query(HEAD_FALLBACK_SQL);
        const v = rows[0]?.head_block;
        headBlock = v === null || v === undefined ? null : num(v);
        if (headBlock === 0) headBlock = null;
      } catch (e) {
        errors.push(`sink head fallback: ${(e as Error).message}`);
      }
    }
    let chainHead: number | null = null;
    let chainId: number | null = null;
    const rpcUrl = this.opts.rpcUrl;
    if (!rpcUrl) {
      errors.push('BASE_RPC_URL is not set, so the chain head cannot be measured');
    } else {
      try {
        const head = await chainHeadOf(rpcUrl, this.timeoutMs, this.fetchImpl);
        chainHead = head.blockNumber;
        chainId = head.chainId;
      } catch (e) {
        errors.push(`rpc: ${(e as Error).message}`);
      }
    }
    const lagBlocks = headBlock !== null && chainHead !== null ? Math.max(0, chainHead - headBlock) : null;
    let reason: string | null = null;
    let detail: string | null = null;
    if (opts.expectedChainId !== null && chainId !== null && chainId !== opts.expectedChainId) {
      reason = 'chain_mismatch';
      detail = `BASE_RPC_URL answers for chain ${chainId}, the receipt pins ${opts.expectedChainId}`;
    } else if (lagBlocks !== null && lagBlocks > opts.maxLagBlocks) {
      reason = 'stale_data';
      detail = `sink head ${headBlock} is ${lagBlocks} blocks behind chain head ${chainHead} (limit ${opts.maxLagBlocks})`;
    } else if (errors.length > 0 || lagBlocks === null) {
      reason = 'check_unavailable';
      detail = errors.join('; ') || 'incomplete check';
    }
    return {refused: reason !== null, reason, detail, headBlock, chainHead, lagBlocks, chainId, checkedAt};
  }
}

/** eth_blockNumber + eth_chainId. Mirrors packages/mcp-vaultflows/src/runtime/rpc.ts. */
export async function chainHeadOf(url: string, timeoutMs = 10_000, fetchImpl: typeof fetch = fetch): Promise<{blockNumber: number; chainId: number}> {
  const call = async (method: string): Promise<string> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params: []}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
    const json = (await res.json()) as {result?: unknown; error?: {message?: string}};
    if (json.error) throw new Error(`rpc ${method}: ${json.error.message ?? 'error'}`);
    if (typeof json.result !== 'string') throw new Error(`rpc ${method}: unexpected result`);
    return json.result;
  };
  const [bn, cid] = await Promise.all([call('eth_blockNumber'), call('eth_chainId')]);
  return {blockNumber: Number.parseInt(bn, 16), chainId: Number.parseInt(cid, 16)};
}

// ---------------------------------------------------------------------------------------------
// SQL (view bodies from packages/erc4626-flows/sql/views.sql)
// ---------------------------------------------------------------------------------------------

const WINDOW_PREDICATE =
  'AND block_timestamp >= (SELECT max(block_timestamp) FROM share_value_observations WHERE _deleted_ = 0 AND call_ok = true)' +
  ' - toUInt64({windowHours:UInt32}) * 3600';

function growthSql(window: 'window' | null): string {
  return `SELECT
  vault,
  min(block_number) AS first_block_number,
  argMin(block_timestamp, block_number) AS first_block_timestamp,
  toString(argMin(assets_per_share_normalized, block_number)) AS first_assets_per_share_normalized,
  max(block_number) AS last_block_number,
  argMax(block_timestamp, block_number) AS last_block_timestamp,
  toString(argMax(assets_per_share_normalized, block_number)) AS last_assets_per_share_normalized,
  if(argMin(assets_per_share_normalized, block_number) = 0, NULL,
     toFloat64(argMax(assets_per_share_normalized, block_number)) / toFloat64(argMin(assets_per_share_normalized, block_number)) - 1) AS growth,
  (argMax(block_timestamp, block_number) - argMin(block_timestamp, block_number)) / 3600 AS observed_hours,
  count() AS observation_count
FROM share_value_observations
WHERE _deleted_ = 0 AND call_ok = true ${window === 'window' ? WINDOW_PREDICATE : ''}
GROUP BY vault
ORDER BY vault ASC
LIMIT 500`;
}

const GROWTH_FROM_VIEW = `SELECT vault, first_block_number, first_block_timestamp,
  toString(first_assets_per_share_normalized) AS first_assets_per_share_normalized,
  last_block_number, last_block_timestamp,
  toString(last_assets_per_share_normalized) AS last_assets_per_share_normalized,
  growth, observed_hours, observation_count
FROM share_value_growth ORDER BY vault ASC LIMIT 500`;

/** The view is not parameterized, so a windowed read of the view falls back to the whole window. */
const GROWTH_FROM_VIEW_WINDOWED = GROWTH_FROM_VIEW;

function flowsSql(selfPredicate: string): string {
  return `WITH (SELECT max(block_timestamp) FROM vault_flows WHERE _deleted_ = 0) AS window_end
SELECT
  vault,
  toUInt64(window_end) AS window_end_timestamp,
  toUInt64(window_end - 86400) AS window_start_timestamp,
  countIf(direction = 'deposit') AS deposit_count,
  countIf(direction = 'withdraw') AS withdraw_count,
  toString(sumIf(assets_normalized, direction = 'deposit' AND meta_valid = true)) AS assets_in_normalized,
  toString(sumIf(assets_normalized, direction = 'withdraw' AND meta_valid = true)) AS assets_out_normalized,
  toString(sumIf(assets_normalized, direction = 'deposit' AND meta_valid = true) - sumIf(assets_normalized, direction = 'withdraw' AND meta_valid = true)) AS net_assets_normalized,
  toString(sumIf(assets_normalized, direction = 'deposit' AND meta_valid = true AND ${selfPredicate})) AS self_assets_in_normalized,
  toString(sumIf(assets_normalized, direction = 'withdraw' AND meta_valid = true AND ${selfPredicate})) AS self_assets_out_normalized,
  countIf(meta_valid = false) AS flows_without_metadata
FROM vault_flows
WHERE _deleted_ = 0 AND block_timestamp > window_end - 86400
GROUP BY vault
ORDER BY vault ASC
LIMIT 500`;
}

/**
 * The alias must NOT be `block_number`: ClickHouse resolves `argMax(total_assets_raw, block_number)`
 * against the SELECT alias and fails with "Aggregate function max(block_number) is found inside
 * another aggregate function" (code 184). Verified against ClickHouse Cloud 26.2.1.
 */
const SIZES_SQL = `SELECT
  vault,
  toString(argMax(total_assets_raw, block_number)) AS total_assets_raw,
  max(block_number) AS observed_block
FROM share_value_observations
WHERE _deleted_ = 0 AND call_ok = true
GROUP BY vault
ORDER BY vault ASC
LIMIT 500`;

/**
 * Asset decimals for the guardrail denominator: from the metadata probe when present, else from
 * any meta_valid flow row on the same vault. Both are pipeline output, never a hardcoded guess.
 */
const ASSET_DECIMALS_SQL = `SELECT vault, max(asset_decimals) AS asset_decimals FROM (
  SELECT vault, asset_decimals FROM vaults WHERE _deleted_ = 0 AND call_ok = true
  UNION ALL
  SELECT vault, asset_decimals FROM vault_flows WHERE _deleted_ = 0 AND meta_valid = true
) GROUP BY vault ORDER BY vault ASC LIMIT 500`;

/** substreams-sink-sql's cursor/block table. */
const HEAD_SQL = 'SELECT max(number) AS head_block FROM _blocks_ WHERE deleted = 0';
const HEAD_FALLBACK_SQL = `SELECT max(head) AS head_block FROM (
  SELECT max(_block_number_) AS head FROM vault_flows WHERE _deleted_ = 0
  UNION ALL
  SELECT max(_block_number_) AS head FROM share_value_observations WHERE _deleted_ = 0
)`;

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

export interface VaultflowsFixture {
  name: string;
  note?: string;
  growth: GrowthObservation[];
  flows: FlowWindow[];
  sizes: ObservedSize[];
  pipeline: PipelineHealth;
  /** optional Privy-side facts so the whole cycle can run without credentials */
  positions?: PositionSnapshot[];
  liquidity?: LiquidityFact[];
}

export class FixtureSource implements VaultflowsSource {
  constructor(private readonly fixture: VaultflowsFixture, private readonly origin = 'fixture') {}

  static fromFile(path: string): FixtureSource {
    const abs = resolve(path);
    return new FixtureSource(JSON.parse(readFileSync(abs, 'utf8')) as VaultflowsFixture, abs);
  }

  get data(): VaultflowsFixture {
    return this.fixture;
  }

  describe(): SourceDescription {
    return {
      kind: 'fixture',
      origin: this.origin,
      database: null,
      readOnly: true,
      ...(this.fixture.note ? {note: this.fixture.note} : {}),
    };
  }

  async shareValueGrowth(opts: {windowHours?: number} = {}): Promise<GrowthObservation[]> {
    if (opts.windowHours === undefined) return this.fixture.growth;
    // Fixtures carry whole-window rows; a shorter request cannot invent observations, so the rows
    // are returned as they are and `observedHours` still describes the real observed window.
    return this.fixture.growth;
  }

  async flowWindow24h(_selfAddresses: string[]): Promise<FlowWindow[]> {
    return this.fixture.flows;
  }

  async observedSizes(): Promise<ObservedSize[]> {
    return this.fixture.sizes;
  }

  async pipelineStatus(opts: PipelineStatusOptions): Promise<PipelineHealth> {
    const p = this.fixture.pipeline;
    if (p.lagBlocks !== null && p.lagBlocks > opts.maxLagBlocks && !p.refused) {
      return {...p, refused: true, reason: 'stale_data', detail: `lag ${p.lagBlocks} > ${opts.maxLagBlocks}`};
    }
    return p;
  }
}

// ---------------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------------

export type SourceSelection = 'local' | 'cloud' | 'fixture' | 'auto';

export interface CreateSourceOptions {
  selection?: SourceSelection;
  fixturePath?: string;
  useViews?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Build the source the environment describes.
 *   VAULTPILOT_SOURCE=local   -> CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD / CLICKHOUSE_DATABASE
 *   VAULTPILOT_SOURCE=cloud   -> CH_CLOUD_URL / CH_CLOUD_RO_USER / CH_CLOUD_RO_PASSWORD / CH_CLOUD_DATABASE
 *   VAULTPILOT_SOURCE=fixture -> VAULTPILOT_FIXTURE (default fixtures/rotate.json)
 *   unset / auto              -> local if configured, else cloud, else fixture
 * The cloud path always uses the read-only user; the admin/sink users are never read here.
 */
export function createSource(opts: CreateSourceOptions = {}): VaultflowsSource {
  loadEnv();
  const rpcUrl = envOptional('BASE_RPC_URL');
  const selection: SourceSelection = opts.selection ?? (envOptional('VAULTPILOT_SOURCE') as SourceSelection | undefined) ?? 'auto';
  const localUrl = envOptional('CLICKHOUSE_URL');
  const cloudUrl = envOptional('CH_CLOUD_URL');
  const wantLocal = selection === 'local' || (selection === 'auto' && !!localUrl);
  const wantCloud = selection === 'cloud' || (selection === 'auto' && !localUrl && !!cloudUrl);

  if (wantLocal) {
    if (!localUrl) throw new Error('VAULTPILOT_SOURCE=local but CLICKHOUSE_URL is not set');
    // Prefer the read-only user. CLICKHOUSE_USER in the repo root .env is the sink's WRITER, which
    // this app must never use; `readonly=1` would stop a write anyway, but the credential the agent
    // holds should not be able to write in the first place.
    const localUser = envOptional('CLICKHOUSE_RO_USER') ?? envOptional('CLICKHOUSE_USER');
    const localPassword = envOptional('CLICKHOUSE_RO_USER')
      ? envOptional('CLICKHOUSE_RO_PASSWORD')
      : envOptional('CLICKHOUSE_PASSWORD');
    return new ClickHouseHttpSource({
      url: localUrl,
      ...(localUser ? {user: localUser} : {}),
      ...(localPassword ? {password: localPassword} : {}),
      database: envOptional('CLICKHOUSE_DATABASE') ?? 'vaultflows',
      ...(rpcUrl ? {rpcUrl} : {}),
      ...(opts.useViews !== undefined ? {useViews: opts.useViews} : {}),
      ...(opts.fetchImpl ? {fetchImpl: opts.fetchImpl} : {}),
      originLabel: `local ClickHouse (docker)${localUser ? ` as ${localUser}` : ''}`,
    });
  }
  if (wantCloud) {
    if (!cloudUrl) throw new Error('VAULTPILOT_SOURCE=cloud but CH_CLOUD_URL is not set');
    return new ClickHouseHttpSource({
      url: cloudUrl,
      ...(envOptional('CH_CLOUD_RO_USER') ? {user: envOptional('CH_CLOUD_RO_USER')!} : {}),
      ...(envOptional('CH_CLOUD_RO_PASSWORD') ? {password: envOptional('CH_CLOUD_RO_PASSWORD')!} : {}),
      database: envOptional('CH_CLOUD_DATABASE') ?? 'vaultflows',
      ...(rpcUrl ? {rpcUrl} : {}),
      ...(opts.useViews !== undefined ? {useViews: opts.useViews} : {}),
      ...(opts.fetchImpl ? {fetchImpl: opts.fetchImpl} : {}),
      originLabel: 'ClickHouse Cloud (read-only user)',
    });
  }
  const path = opts.fixturePath ?? envOptional('VAULTPILOT_FIXTURE') ?? resolve(APP_DIR, 'fixtures', 'rotate.json');
  return FixtureSource.fromFile(path);
}
