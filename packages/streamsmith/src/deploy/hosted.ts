// Hosted deploy on The Graph Market via the Portal API HostedService (facts (e)).
// Sequence: CreateDeployment (unless --deployment-id) → HasDeploymentSecret (stop with the secret URL when the
// human has not staged the DB password) → Deploy (retry on DB cold start) → poll GetDeploymentState → head/lag.
// `attachHosted` is the read-only counterpart: it describes a deployment that is already running (GetDeploymentState
// + Logs + the sink's database + an independent chain head) and never calls a mutating endpoint.
import { join } from "node:path";
import type { Ctx } from "../util/ctx.ts";
import { paths } from "../util/ctx.ts";
import { writeJson, readJsonLenient } from "../util/fsx.ts";
import type { StreamsmithConfig } from "../config/streamsmith.ts";
import { hostFingerprint } from "../receipt.ts";
import { PortalClient, PortalError, asInt, field, isUnauthenticated, type ClickhouseOutput, type DeploymentStateSummary } from "./portal.ts";
import { chBlocksHead, chMaxBlock, chRowCounts } from "./clickhouse.ts";
import { ethBlockNumber, BASE_BLOCK_TIME_SECONDS } from "./rpc.ts";
import type { DeployRecord, ObservedExecutionConfig } from "./types.ts";

export const EXIT_AWAITING_SECRET = 40;

export class AwaitingSecretError extends Error {
  constructor(public deploymentId: string, public secretUrl: string) {
    super(`deployment ${deploymentId} has no stored clickhouse_password; a human must enter it at ${secretUrl} (never in chat or API), then re-run with --deployment-id ${deploymentId}`);
  }
}

export interface HostedDeployOptions {
  runId: string;
  streamsmith: StreamsmithConfig;
  spkgUrl: string;
  packageHash?: string;
  deploymentId?: string;
  name?: string;
  clickhouse: ClickhouseOutput;
  replica?: number;
  stopBlock?: number;
  /** raw module params string (e.g. `vaults[]=0x..&interval=1800`); omitted unless explicitly given — the
   * published spkg already carries the manifest defaults, and the raw string is rejected by hosted execution
   * (`param for module "vaults[]": module not found`, docs/build/sink-spike.md §7). */
  params?: string;
  /** call UpdateDeploymentConfig on `deploymentId` instead of Deploy — requires `deploymentId`. */
  update?: boolean;
  pollTimeoutSeconds?: number;
  pollIntervalSeconds?: number;
  deployRetries?: number;
  deployRetryWaitSeconds?: number;
  portal?: PortalClient;
}

export function summarizeState(s: DeploymentStateSummary): { headBlock?: number; chainHead?: number; lagBlocks?: number; lagSeconds?: number; state: string } {
  const exec = s.executionStates[0];
  const out: { headBlock?: number; chainHead?: number; lagBlocks?: number; lagSeconds?: number; state: string } = {
    state: [s.deploymentState ?? "UNKNOWN", exec?.state ?? ""].filter(Boolean).join("/"),
  };
  if (exec?.currentBlock !== undefined) out.headBlock = exec.currentBlock;
  if (exec?.headBlock !== undefined) out.chainHead = exec.headBlock;
  if (out.headBlock !== undefined && out.chainHead !== undefined) out.lagBlocks = Math.max(0, out.chainHead - out.headBlock);
  // head_block_time_drift is an int64 in the Portal proto but arrives fractional over JSON (e.g. 24.5);
  // specs/receipt.schema.json lagSeconds is an integer, so it is cast like the int64 it claims to be.
  if (exec?.headBlockTimeDrift !== undefined) out.lagSeconds = Math.trunc(exec.headBlockTimeDrift);
  return out;
}

export function isSettled(s: DeploymentStateSummary): "live" | "error" | "pending" {
  if (s.crashloopbackoff || s.deploymentState?.endsWith("ERROR") || s.executionStates.some((e) => e.state?.endsWith("FAILING"))) return "error";
  if (s.deploymentState?.endsWith("DEPLOYED") && (s.executionStates.length === 0 || s.executionStates.some((e) => e.state?.endsWith("LIVE") || e.state?.endsWith("CATCHING_UP")))) return "live";
  return "pending";
}

async function attemptDeployHosted(ctx: Ctx, opts: HostedDeployOptions, portal: PortalClient): Promise<{ record: DeployRecord; path: string }> {
  const ss = opts.streamsmith;
  const runDir = paths.runs(ctx, opts.runId);
  const path = join(runDir, "deploy.json");
  const notes: string[] = [];

  const deploymentId = opts.deploymentId ?? (await portal.createDeployment());
  if (!opts.deploymentId) notes.push(`CreateDeployment -> ${deploymentId}`);
  ctx.log(`deploy(hosted): deployment_id ${deploymentId}`);

  const record: DeployRecord = {
    deploymentMode: "graph-market-hosted",
    deploymentId,
    spkg: opts.spkgUrl,
    outputModule: ss.outputModule,
    network: ss.deployment?.network ?? ss.network,
    startBlock: ss.startBlock,
    runId: opts.runId,
    sink: { kind: "clickhouse", mode: "from-proto", database: opts.clickhouse.database, hostFingerprint: hostFingerprint(opts.clickhouse.server, opts.clickhouse.port) },
    notes,
  };
  if (opts.packageHash) record.packageHash = opts.packageHash;

  const hasSecret = await portal.hasDeploymentSecret(deploymentId);
  if (!hasSecret) {
    record.state = "awaiting_secret";
    await writeJson(path, record);
    throw new AwaitingSecretError(deploymentId, portal.secretPageUrl(deploymentId));
  }
  notes.push("HasDeploymentSecret(clickhouse_password) = true");

  const req = {
    deploymentId,
    name: opts.name ?? `${ss.packageName} ${ss.network} clickhouse`,
    spkgUrl: opts.spkgUrl,
    network: ss.deployment?.network ?? ss.network,
    startBlock: ss.startBlock,
    outputModule: ss.outputModule,
    moduleOutputType: ss.outputType ?? `proto:vaultflows.v1.Events`,
    replica: opts.replica ?? 1,
    clickhouse: opts.clickhouse,
    ...(opts.stopBlock !== undefined ? { stopBlock: opts.stopBlock } : {}),
    // omit unless --params was passed explicitly: the published spkg already carries the manifest defaults, and
    // the raw params string is rejected by hosted execution (docs/build/sink-spike.md §7).
    ...(opts.params ? { parameters: opts.params } : {}),
  };
  const rpcName = opts.update ? "UpdateDeploymentConfig" : "Deploy";
  const retries = opts.deployRetries ?? 3;
  const wait = (opts.deployRetryWaitSeconds ?? 45) * 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = opts.update ? await portal.updateDeploymentConfig(req) : await portal.deploy(req);
      notes.push(`${rpcName} attempt ${attempt}: ${JSON.stringify(res).slice(0, 200) || "{} (empty body = accepted)"}`);
      break;
    } catch (err) {
      const msg = (err as Error).message;
      const transient = /timeout|timed out|refused|unreachable|i\/o|EOF|503|502|deadline/i.test(msg);
      notes.push(`${rpcName} attempt ${attempt} failed: ${msg.slice(0, 200)}`);
      if (!transient || attempt === retries) {
        record.state = "deploy_failed";
        await writeJson(path, record);
        throw err instanceof PortalError ? err : new Error(`${rpcName} failed: ${msg}`);
      }
      ctx.log(`deploy(hosted): transient error (output DB waking up?), retrying in ${wait / 1000}s`);
      await ctx.sleep(wait);
    }
  }
  record.deployedAt = ctx.now().toISOString();

  const timeoutMs = (opts.pollTimeoutSeconds ?? 900) * 1000;
  const intervalMs = (opts.pollIntervalSeconds ?? 15) * 1000;
  const started = Date.now();
  let last: DeploymentStateSummary | undefined;
  for (;;) {
    last = await portal.getDeploymentState(deploymentId);
    const sum = summarizeState(last);
    Object.assign(record, sum, { checkedAt: ctx.now().toISOString() });
    ctx.log(`deploy(hosted): ${sum.state} head=${sum.headBlock ?? "?"} chain=${sum.chainHead ?? "?"} lag=${sum.lagBlocks ?? "?"} blocks / ${sum.lagSeconds ?? "?"} s`);
    const settled = isSettled(last);
    if (settled === "live") break;
    if (settled === "error") {
      record.state = `error:${sum.state}`;
      await writeJson(path, record);
      throw new Error(`hosted deployment ${deploymentId} is failing (${sum.state}); inspect with \`streamsmith deploy status\` / Portal Logs`);
    }
    if (Date.now() - started > timeoutMs) {
      await writeJson(path, record);
      throw new Error(`hosted deployment ${deploymentId} not live after ${timeoutMs / 1000}s (last state ${sum.state})`);
    }
    await ctx.sleep(intervalMs);
  }
  await writeJson(path, record);
  ctx.log(`deploy(hosted): live -> ${path}`);
  return { record, path };
}

/**
 * CreateDeployment/Deploy (or, with `--update`, UpdateDeploymentConfig on an existing `--deployment-id`) → poll to
 * LIVE. On an `unauthenticated` Portal response, tries `RefreshToken` once with `PORTAL_REFRESH_TOKEN` and retries
 * the whole sequence exactly once with the refreshed token before giving up with the device-login instruction
 * (`streamsmith deploy login`) — a stale `PORTAL_TOKEN` (~8h refresh window, docs/build/sink-spike.md §7) should
 * not require a human every time.
 */
export async function deployHosted(ctx: Ctx, opts: HostedDeployOptions): Promise<{ record: DeployRecord; path: string }> {
  if (opts.update && !opts.deploymentId) throw new Error("--update requires --deployment-id (it reconfigures an existing deployment; drop --update to create a new one)");
  const portal = opts.portal ?? new PortalClient(ctx);
  try {
    return await attemptDeployHosted(ctx, opts, portal);
  } catch (err) {
    if (!isUnauthenticated(err)) throw err;
    const refreshToken = ctx.env.PORTAL_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error("unauthenticated (PORTAL_TOKEN expired or invalid); run `streamsmith deploy login` for a fresh device-code login, export the printed PORTAL_TOKEN / PORTAL_ORG_ID, and retry — or set PORTAL_REFRESH_TOKEN to retry automatically");
    }
    ctx.log("deploy(hosted): unauthenticated; retrying once via RefreshToken (PORTAL_REFRESH_TOKEN)");
    let refreshed: { accessToken: string; organizationId?: string };
    try {
      refreshed = await portal.refreshToken(refreshToken);
    } catch (refreshErr) {
      throw new Error(`unauthenticated, and RefreshToken failed (${(refreshErr as Error).message}); run \`streamsmith deploy login\` for a fresh device-code login, export the printed PORTAL_TOKEN / PORTAL_ORG_ID, and retry`);
    }
    const freshPortal = new PortalClient(ctx, { token: refreshed.accessToken, organizationId: refreshed.organizationId ?? portal.organizationId });
    return attemptDeployHosted(ctx, opts, freshPortal);
  }
}

export interface HostedAttachOptions {
  runId: string;
  streamsmith: StreamsmithConfig;
  /** the deployment to describe; never created, never reconfigured */
  deploymentId: string;
  /** the ClickHouse output the deployment writes to (non-secret fields only) */
  clickhouse: ClickhouseOutput;
  /** ClickHouse HTTP URL used to read head and row counts; credentials stay in the URL and are never recorded */
  clickhouseUrl?: string;
  rpcUrl?: string;
  tables?: string[];
  /** spkg URL to record when the pod log does not carry one */
  spkgUrl?: string;
  packageHash?: string;
  logTailLines?: number;
  blockTimeSeconds?: number;
  verbose?: boolean;
  portal?: PortalClient;
}

/** The fields that only the runner's startup lines carry. Their absence means the log tail no longer reaches
 * back to pod start, not that the deployment lacks them — so the caller retries with a longer tail. */
export function isObservedConfigComplete(c: ObservedExecutionConfig | undefined): boolean {
  return Boolean(c && c.spkgUrl && c.outputModule && c.startBlock !== undefined);
}

/** Parse the hosted runner's own startup lines out of a `Logs` response. Best effort: a shape change downgrades
 * to "not observed", never to a wrong value. */
export function parsePodExecutionConfig(logsResponse: unknown): ObservedExecutionConfig | undefined {
  const pods = field<unknown[]>(logsResponse, "pod_logs") ?? [];
  for (const pod of pods) {
    const text = field<string>(pod, "logs");
    if (!text) continue;
    const out: ObservedExecutionConfig = {};
    const podName = field<string>(pod, "pod_name");
    if (podName) out.podName = podName;
    for (const line of text.split("\n")) {
      if (!line.startsWith("{")) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const message = String(rec.message ?? "");
      if (message === "sinker from CLI") {
        const url = field<string>(rec, "manifest_path"); if (url) out.spkgUrl = url;
        const mod = field<string>(rec, "output_module_name"); if (mod) out.outputModule = mod;
        const start = asInt(field(rec, "start_block")); if (start !== undefined) out.startBlock = start;
        const stop = asInt(field(rec, "stop_block")); if (stop !== undefined) out.stopBlock = stop;
        const params = field<unknown[]>(rec, "params"); if (Array.isArray(params)) out.parameters = params.map(String);
        const fbo = field(rec, "final_blocks_only"); if (fbo !== undefined) out.finalBlocksOnly = Boolean(fbo);
      } else if (message === "sinker configured") {
        const type = field<string>(rec, "output_module_type"); if (type) out.moduleOutputType = type;
        const hash = field<string>(rec, "output_module_hash"); if (hash) out.outputModuleHash = hash;
        const mod = field<string>(rec, "output_module_name"); if (mod) out.outputModule = mod;
      } else if (message === "creating schema" || message === "initializing schema") {
        const name = field<string>(rec, "name"); if (name) out.database = name;
      }
    }
    if (Object.keys(out).length > (out.podName ? 1 : 0)) return out;
  }
  return undefined;
}

async function attemptAttachHosted(ctx: Ctx, o: HostedAttachOptions, portal: PortalClient): Promise<{ record: DeployRecord; path: string }> {
  const ss = o.streamsmith;
  const path = paths.runs(ctx, o.runId, "deploy.json");
  const notes: string[] = [];

  const state = await portal.getDeploymentState(o.deploymentId);
  const summary = summarizeState(state);
  notes.push(`GetDeploymentState: ${summary.state}`);

  // The execution config lives only in the runner's startup lines, so a pod that has been up for a while pushes
  // them past a short tail: the first attempt here silently recorded a deployment with no spkg URL because the
  // default tail no longer reached block zero. Ask for a modest tail, then once for a much longer one when the
  // startup lines are not in it, and say so plainly when even that does not reach them.
  let observed: ObservedExecutionConfig | undefined;
  const firstTail = o.logTailLines ?? 1000;
  try {
    observed = parsePodExecutionConfig(await portal.logs(o.deploymentId, firstTail));
    if (!isObservedConfigComplete(observed)) {
      const longTail = Math.max(firstTail * 20, 20000);
      notes.push(`Logs(tail ${firstTail}) did not reach the runner's startup lines; retrying with tail ${longTail}`);
      const retry = parsePodExecutionConfig(await portal.logs(o.deploymentId, longTail));
      if (isObservedConfigComplete(retry) || (retry && !observed)) observed = retry;
    }
    if (isObservedConfigComplete(observed)) notes.push(`execution config read from pod log (${observed!.podName ?? "pod"})`);
    else notes.push(`execution config not fully observed: the runner's startup lines are no longer in the retained pod log${observed ? ` (partial: ${Object.keys(observed).join(", ")})` : ""}`);
  } catch (err) {
    notes.push(`Logs failed: ${(err as Error).message.slice(0, 200)}`);
  }

  const record: DeployRecord = {
    deploymentMode: "graph-market-hosted",
    deploymentId: o.deploymentId,
    spkg: observed?.spkgUrl ?? o.spkgUrl,
    outputModule: observed?.outputModule ?? ss.outputModule,
    network: ss.deployment?.network ?? ss.network,
    startBlock: observed?.startBlock ?? ss.startBlock,
    state: summary.state,
    sink: { kind: "clickhouse", mode: "from-proto", database: o.clickhouse.database, hostFingerprint: hostFingerprint(o.clickhouse.server, o.clickhouse.port) },
    runId: o.runId,
  };
  if (record.spkg === undefined) delete record.spkg;
  if (o.packageHash) record.packageHash = o.packageHash;
  if (observed) record.executionConfig = observed;
  if (observed?.database && observed.database !== o.clickhouse.database) {
    notes.push(`pod log initialized schema "${observed.database}" but --ch-database is "${o.clickhouse.database}"`);
  }
  // The Portal reports the sink's own progress as `head_block` with no `current_block` on a catching-up pod, so
  // head and lag are taken from the database the sink writes to and an independent chain head, exactly as the
  // self-managed path does. Portal numbers are kept as notes, never silently relabelled.
  if (summary.headBlock !== undefined) notes.push(`portal current_block: ${summary.headBlock}`);
  if (summary.chainHead !== undefined) notes.push(`portal head_block: ${summary.chainHead}`);
  if (summary.lagSeconds !== undefined) notes.push(`portal head_block_time_drift: ${summary.lagSeconds}s`);

  const tables = o.tables ?? ss.sink?.tables ?? ["vault_flows", "share_value_observations", "vaults", "share_transfers"];
  if (o.clickhouseUrl) {
    const blocksHead = await chBlocksHead(ctx, o.clickhouseUrl, o.clickhouse.database, o.verbose);
    if (blocksHead !== undefined) {
      record.headBlock = blocksHead;
      notes.push(`clickhouse _blocks_ max(number): ${blocksHead}`);
    } else {
      const m = await chMaxBlock(ctx, o.clickhouseUrl, o.clickhouse.database, tables, o.verbose);
      if (m.maxBlock !== undefined) record.headBlock = m.maxBlock;
      notes.push(`clickhouse max(_block_number_): ${JSON.stringify(m.perTable)}`);
    }
    record.rowCounts = await chRowCounts(ctx, o.clickhouseUrl, o.clickhouse.database, tables.includes("_blocks_") ? tables : [...tables, "_blocks_"], o.verbose);
    notes.push(`row counts: ${JSON.stringify(record.rowCounts)}`);
  } else notes.push("no ClickHouse HTTP URL (pass --clickhouse-url); headBlock and row counts not recorded");

  try {
    record.chainHead = await ethBlockNumber(ctx, o.rpcUrl, o.verbose);
  } catch (err) {
    notes.push(`eth_blockNumber failed: ${(err as Error).message.slice(0, 200)}`);
  }
  if (record.headBlock !== undefined && record.chainHead !== undefined) {
    record.lagBlocks = Math.max(0, record.chainHead - record.headBlock);
    record.lagSeconds = record.lagBlocks * (o.blockTimeSeconds ?? BASE_BLOCK_TIME_SECONDS);
  }
  record.checkedAt = ctx.now().toISOString();
  record.notes = notes;
  await writeJson(path, record);
  ctx.log(`deploy(hosted --attach): ${record.state} head=${record.headBlock ?? "?"} chain=${record.chainHead ?? "?"} lag=${record.lagBlocks ?? "?"} blocks -> ${path}`);
  return { record, path };
}

/**
 * Record an already-running hosted deployment into `runs/<id>/deploy.json` without deploying anything.
 *
 * Only read-only Portal calls are made (`GetDeploymentState`, `Logs`): `Deploy`, `UpdateDeploymentConfig` and
 * `CreateDeployment` all restart or duplicate the running pod, so a cut-over that only needs a receipt must not
 * reach for them. Head, lag and row counts come from the sink's own database plus an independent chain head.
 */
export async function attachHosted(ctx: Ctx, o: HostedAttachOptions): Promise<{ record: DeployRecord; path: string }> {
  if (!o.deploymentId) throw new Error("--attach requires --deployment-id (it describes an existing deployment; it never creates one)");
  const portal = o.portal ?? new PortalClient(ctx);
  try {
    return await attemptAttachHosted(ctx, o, portal);
  } catch (err) {
    if (!isUnauthenticated(err)) throw err;
    const refreshToken = ctx.env.PORTAL_REFRESH_TOKEN;
    if (!refreshToken) throw new Error("unauthenticated (PORTAL_TOKEN expired or invalid); run `streamsmith deploy login`, export the printed PORTAL_TOKEN / PORTAL_ORG_ID, and retry — or set PORTAL_REFRESH_TOKEN to retry automatically");
    ctx.log("deploy(hosted --attach): unauthenticated; retrying once via RefreshToken (PORTAL_REFRESH_TOKEN)");
    const refreshed = await portal.refreshToken(refreshToken);
    const fresh = new PortalClient(ctx, { token: refreshed.accessToken, organizationId: refreshed.organizationId ?? portal.organizationId });
    return attemptAttachHosted(ctx, o, fresh);
  }
}

export async function hostedStatus(ctx: Ctx, opts: { runId: string; deploymentId?: string; portal?: PortalClient }): Promise<DeployRecord> {
  const portal = opts.portal ?? new PortalClient(ctx);
  const path = paths.runs(ctx, opts.runId, "deploy.json");
  // Lenient read: a corrupt deploy.json must not crash `deploy status` with a raw JSON.parse error when
  // --deployment-id is passed explicitly (or the deployment id can't be recovered, the existing "no deployment
  // id" error below already tells the human what to do).
  const { value: existing, error: corrupt } = await readJsonLenient<DeployRecord>(path);
  const record: DeployRecord = existing ?? { deploymentMode: "graph-market-hosted", runId: opts.runId };
  const id = opts.deploymentId ?? record.deploymentId;
  if (!id) throw new Error(corrupt ? `${corrupt} (pass --deployment-id; deploy.json could not be read to recover it)` : "no deployment id (pass --deployment-id or run deploy hosted first)");
  if (corrupt) record.notes = [...(record.notes ?? []), `ignoring unreadable deploy.json for run ${opts.runId}: ${corrupt}`];
  const s = await portal.getDeploymentState(id);
  Object.assign(record, summarizeState(s), { deploymentId: id, checkedAt: ctx.now().toISOString() });
  await writeJson(path, record);
  return record;
}

/** RFC 8628 device-code login. Prints URL + code, waits for Enter, exchanges once. Tokens are printed as export lines, never stored. */
export async function portalLogin(ctx: Ctx, waitForHuman: () => Promise<void>): Promise<{ accessToken: string; organizationId?: string; refreshToken?: string }> {
  const portal = new PortalClient(ctx);
  const a = await portal.deviceAuthorize();
  ctx.log(`Open ${a.verificationUriComplete ?? a.verificationUri} and enter code ${a.userCode} (expires in ${a.expiresIn}s). Press Enter here after approving.`);
  await waitForHuman();
  const t = await portal.deviceToken(a.deviceCode);
  if (!t.status.endsWith("APPROVED") || !t.accessToken) throw new Error(`DeviceToken status ${t.status || "unknown"}; the device code is single-use — start again`);
  const out: { accessToken: string; organizationId?: string; refreshToken?: string } = { accessToken: t.accessToken };
  if (t.organizationId) out.organizationId = t.organizationId;
  if (t.refreshToken) out.refreshToken = t.refreshToken;
  return out;
}
