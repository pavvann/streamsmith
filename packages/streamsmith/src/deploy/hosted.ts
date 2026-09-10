// Hosted deploy on The Graph Market via the Portal API HostedService (facts (e)).
// Sequence: CreateDeployment (unless --deployment-id) → HasDeploymentSecret (stop with the secret URL when the
// human has not staged the DB password) → Deploy (retry on DB cold start) → poll GetDeploymentState → head/lag.
import { join } from "node:path";
import type { Ctx } from "../util/ctx.ts";
import { paths } from "../util/ctx.ts";
import { writeJson, readJson, exists } from "../util/fsx.ts";
import type { StreamsmithConfig } from "../config/streamsmith.ts";
import { hostFingerprint } from "../receipt.ts";
import { PortalClient, PortalError, type ClickhouseOutput, type DeploymentStateSummary } from "./portal.ts";
import type { DeployRecord } from "./types.ts";

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

export async function deployHosted(ctx: Ctx, opts: HostedDeployOptions): Promise<{ record: DeployRecord; path: string }> {
  const portal = opts.portal ?? new PortalClient(ctx);
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
    ...(ss.params?.value ? { parameters: ss.params.value } : {}),
  };
  const retries = opts.deployRetries ?? 3;
  const wait = (opts.deployRetryWaitSeconds ?? 45) * 1000;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await portal.deploy(req);
      notes.push(`Deploy attempt ${attempt}: ${JSON.stringify(res).slice(0, 200) || "{} (empty body = accepted)"}`);
      break;
    } catch (err) {
      const msg = (err as Error).message;
      const transient = /timeout|timed out|refused|unreachable|i\/o|EOF|503|502|deadline/i.test(msg);
      notes.push(`Deploy attempt ${attempt} failed: ${msg.slice(0, 200)}`);
      if (!transient || attempt === retries) {
        record.state = "deploy_failed";
        await writeJson(path, record);
        throw err instanceof PortalError ? err : new Error(`Deploy failed: ${msg}`);
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

export async function hostedStatus(ctx: Ctx, opts: { runId: string; deploymentId?: string; portal?: PortalClient }): Promise<DeployRecord> {
  const portal = opts.portal ?? new PortalClient(ctx);
  const path = paths.runs(ctx, opts.runId, "deploy.json");
  const record: DeployRecord = (await exists(path)) ? await readJson<DeployRecord>(path) : { deploymentMode: "graph-market-hosted", runId: opts.runId };
  const id = opts.deploymentId ?? record.deploymentId;
  if (!id) throw new Error("no deployment id (pass --deployment-id or run deploy hosted first)");
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
