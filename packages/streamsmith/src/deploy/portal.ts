// Typed client for the StreamingFast Portal API (Connect-style JSON over POST {BASE_URL}/{Service}/{Method}).
// Requests use snake_case; responses arrive camelCase — `field()` reads both.
import type { Ctx } from "../util/ctx.ts";

export const DEFAULT_PORTAL_BASE_URL = "https://admin.streamingfast.io";
const PORTAL_API = "sf.portalapi.v1.PortalApi";
const HOSTED = "sf.portalapi.v1.HostedService";

export class PortalError extends Error {
  constructor(message: string, public status: number, public body: string, public method: string) {
    super(message);
  }
}

export function field<T = unknown>(obj: unknown, snake: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (snake in o) return o[snake] as T;
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return o[camel] as T | undefined;
}

export function asInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export interface PortalOptions {
  baseUrl?: string;
  token?: string;
  organizationId?: string;
}

export interface ExecutionState {
  podName?: string;
  cursor?: string;
  state?: string;
  currentBlock?: number;
  headBlock?: number;
  headBlockTimeDrift?: number;
  restartCount?: number;
}

export interface DeploymentStateSummary {
  success: boolean;
  message?: string;
  deploymentState?: string;
  resourceState?: string;
  replica?: number;
  readyReplicas?: number;
  healthyReplicas?: number;
  crashloopbackoff?: boolean;
  executionStates: ExecutionState[];
  raw: unknown;
}

export interface ClickhouseOutput {
  server: string;
  port: number;
  user: string;
  database: string;
  secure: boolean;
}

export interface SinkSqlDeployRequest {
  deploymentId: string;
  name: string;
  spkgUrl: string;
  network: string;
  startBlock: number;
  stopBlock?: number;
  outputModule: string;
  moduleOutputType: string;
  parameters?: string;
  replica?: number;
  clickhouse: ClickhouseOutput;
}

export class PortalClient {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly organizationId: string | undefined;

  constructor(private ctx: Ctx, opts: PortalOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ctx.env.PORTAL_BASE_URL ?? DEFAULT_PORTAL_BASE_URL).replace(/\/$/, "");
    this.token = opts.token ?? ctx.env.PORTAL_TOKEN;
    this.organizationId = opts.organizationId ?? ctx.env.PORTAL_ORG_ID;
  }

  requireAuth(): { token: string; organizationId: string } {
    if (!this.token) throw new Error("PORTAL_TOKEN is not set (run `streamsmith deploy login` or export the access token)");
    if (!this.organizationId) throw new Error("PORTAL_ORG_ID is not set (returned by DeviceToken as organization_id)");
    return { token: this.token, organizationId: this.organizationId };
  }

  async call<T = Record<string, unknown>>(service: string, method: string, body: Record<string, unknown>, auth = true): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (auth) headers.Authorization = `Bearer ${this.requireAuth().token}`;
    const url = `${this.baseUrl}/${service}/${method}`;
    const res = await this.ctx.fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new PortalError(`${method} failed: HTTP ${res.status} ${text.slice(0, 400)}`, res.status, text, method);
    if (!text.trim()) return {} as T; // Deploy may return 200 + empty body
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PortalError(`${method}: non-JSON response ${text.slice(0, 200)}`, res.status, text, method);
    }
  }

  // ---- auth (RFC 8628 device code) ----
  async deviceAuthorize(clientName = "streamsmith"): Promise<{ deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; interval: number; expiresIn: number }> {
    const r = await this.call(PORTAL_API, "DeviceAuthorize", { client_name: clientName }, false);
    return {
      deviceCode: String(field(r, "device_code") ?? ""),
      userCode: String(field(r, "user_code") ?? ""),
      verificationUri: String(field(r, "verification_uri") ?? "https://thegraph.market/device"),
      verificationUriComplete: field<string>(r, "verification_uri_complete"),
      interval: asInt(field(r, "interval")) ?? 5,
      expiresIn: asInt(field(r, "expires_in")) ?? 600,
    };
  }

  async deviceToken(deviceCode: string): Promise<{ status: string; accessToken?: string; refreshToken?: string; organizationId?: string }> {
    const r = await this.call(PORTAL_API, "DeviceToken", { device_code: deviceCode }, false);
    return {
      status: String(field(r, "status") ?? ""),
      accessToken: field<string>(r, "access_token"),
      refreshToken: field<string>(r, "refresh_token"),
      organizationId: field<string>(r, "organization_id"),
    };
  }

  // ---- hosted service ----
  async createDeployment(): Promise<string> {
    const { organizationId } = this.requireAuth();
    const r = await this.call(HOSTED, "CreateDeployment", { organization_id: organizationId });
    const id = field<string>(r, "deployment_id");
    if (!id) throw new Error(`CreateDeployment returned no deployment_id: ${JSON.stringify(r).slice(0, 300)}`);
    return id;
  }

  async hasDeploymentSecret(deploymentId: string, key = "clickhouse_password"): Promise<boolean> {
    const { organizationId } = this.requireAuth();
    const r = await this.call(HOSTED, "HasDeploymentSecret", { deployment_id: deploymentId, organization_id: organizationId, key });
    return Boolean(field(r, "exists"));
  }

  secretPageUrl(deploymentId: string, output: "clickhouse" | "postgres" = "clickhouse"): string {
    return `https://thegraph.market/sinks/${deploymentId}/secret?output=${output}`;
  }

  buildSinkSqlDeployBody(req: SinkSqlDeployRequest): Record<string, unknown> {
    const { organizationId } = this.requireAuth();
    const execution_config: Record<string, unknown> = {
      start_block: req.startBlock,
      output_module: req.outputModule,
      module_output_type: req.moduleOutputType,
    };
    if (req.stopBlock !== undefined) execution_config.stop_block = req.stopBlock;
    if (req.parameters) execution_config.parameters = req.parameters;
    return {
      deployment_id: req.deploymentId,
      name: req.name,
      organization_id: organizationId,
      use_stored_secret: true,
      deployment_request: {
        sink_sql_deployment: {
          spkg: { url: req.spkgUrl },
          network: req.network,
          replica: req.replica ?? 1,
          execution_config,
          // camelCase on purpose: the proto field is named outputConfig
          outputConfig: {
            clickhouse: {
              server: req.clickhouse.server,
              port: req.clickhouse.port,
              user: req.clickhouse.user,
              database: req.clickhouse.database,
              secure: req.clickhouse.secure,
            },
          },
        },
      },
    };
  }

  async deploy(req: SinkSqlDeployRequest): Promise<unknown> {
    return this.call(HOSTED, "Deploy", this.buildSinkSqlDeployBody(req));
  }

  async getDeploymentState(deploymentId: string): Promise<DeploymentStateSummary> {
    const { organizationId } = this.requireAuth();
    const r = await this.call(HOSTED, "GetDeploymentState", { deployment_id: deploymentId, organization_id: organizationId });
    const ds = field(r, "deployment_state") ?? {};
    const exec = (field<unknown[]>(ds, "execution_states") ?? []).map((e): ExecutionState => {
      const out: ExecutionState = {};
      const pod = field<string>(e, "pod_name"); if (pod) out.podName = pod;
      const cursor = field<string>(e, "cursor"); if (cursor) out.cursor = cursor;
      const state = field<string>(e, "state"); if (state) out.state = state;
      const cur = asInt(field(e, "current_block")); if (cur !== undefined) out.currentBlock = cur;
      const head = asInt(field(e, "head_block")); if (head !== undefined) out.headBlock = head;
      const drift = asInt(field(e, "head_block_time_drift")); if (drift !== undefined) out.headBlockTimeDrift = drift;
      const rc = asInt(field(e, "restart_count")); if (rc !== undefined) out.restartCount = rc;
      return out;
    });
    const out: DeploymentStateSummary = { success: field(r, "success") !== false, executionStates: exec, raw: r };
    const msg = field<string>(r, "message"); if (msg) out.message = msg;
    const dstate = field<string>(ds, "deployment_state"); if (dstate) out.deploymentState = String(dstate);
    const rstate = field<string>(ds, "resource_state"); if (rstate) out.resourceState = String(rstate);
    const rep = asInt(field(ds, "replica")); if (rep !== undefined) out.replica = rep;
    const ready = asInt(field(ds, "ready_replicas")); if (ready !== undefined) out.readyReplicas = ready;
    const healthy = asInt(field(ds, "healthy_replicas")); if (healthy !== undefined) out.healthyReplicas = healthy;
    const cl = field(ds, "crashloopbackoff"); if (cl !== undefined) out.crashloopbackoff = Boolean(cl);
    return out;
  }

  async getDeploymentEvents(deploymentId: string, limit = 20): Promise<unknown> {
    const { organizationId } = this.requireAuth();
    return this.call(HOSTED, "GetDeploymentEvents", { deployment_id: deploymentId, organization_id: organizationId, limit });
  }

  async logs(deploymentId: string, tailLines = 100): Promise<unknown> {
    const { organizationId } = this.requireAuth();
    return this.call(HOSTED, "Logs", { deployment_id: deploymentId, organization_id: organizationId, tail_lines: tailLines });
  }
}
