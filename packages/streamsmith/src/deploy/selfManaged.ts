// Self-managed sink: spawn `substreams-sink-sql from-proto …` (or `substreams sink clickhouse …`) detached with a
// pid file, and a status check that computes head/lag from ClickHouse (max _block_number_) vs eth_blockNumber.
import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { stat, mkdir } from "node:fs/promises";
import type { Ctx } from "../util/ctx.ts";
import { paths } from "../util/ctx.ts";
import { exists, readJson, readText, writeJson, writeText } from "../util/fsx.ts";
import type { StreamsmithConfig } from "../config/streamsmith.ts";
import { hostFingerprint } from "../receipt.ts";
import { sha256File } from "../util/hash.ts";
import { chMaxBlock, chBlocksHead, chRowCounts } from "./clickhouse.ts";
import { ethBlockNumber, BASE_BLOCK_TIME_SECONDS } from "./rpc.ts";
import type { DeployRecord } from "./types.ts";

export type SinkFlavor = "substreams-sink-sql" | "substreams-cli";

export interface SelfManagedOptions {
  runId: string;
  streamsmith: StreamsmithConfig;
  dsn: string;
  spkg: string;
  module?: string;
  endpoint: string;
  network?: string;
  startBlock?: number;
  stopBlock?: number;
  cursorFile?: string;
  sinkBinary?: string;
  flavor?: SinkFlavor;
  extraArgs?: string[];
  /**
   * `substreams-sink-sql` (from-proto only) stores a per-schema `<database>_schema_hash.txt` here, default cwd
   * (docs/build/sink-spike.md §7). A folder left over from a run against a DIFFERENT database makes the sink skip
   * `CREATE TABLE` and crash on insert, so every run gets its own folder — default `runs/<runId>/sinkinfo`.
   */
  sinkInfoFolder?: string;
  /** from-proto only; default true (a bounded run does not flush its tail batch otherwise — sink-spike.md §6). */
  finalBlocksOnly?: boolean;
  /** injectable for tests */
  spawnImpl?: typeof spawn;
}

export interface DsnParts {
  host: string;
  port: number;
  database: string;
  user?: string;
}

export function parseDsn(dsn: string): DsnParts {
  const u = new URL(dsn);
  const port = u.port ? Number(u.port) : 9000;
  const out: DsnParts = { host: u.hostname, port, database: u.pathname.replace(/^\//, "") || "default" };
  if (u.username) out.user = decodeURIComponent(u.username);
  return out;
}

export function buildSinkCommand(o: SelfManagedOptions): { cmd: string; args: string[] } {
  const module = o.module ?? o.streamsmith.outputModule;
  const network = o.network ?? o.streamsmith.network;
  const start = o.startBlock ?? o.streamsmith.startBlock;
  const cursorFile = o.cursorFile ?? "cursor.txt";
  const flavor = o.flavor ?? "substreams-sink-sql";
  if (flavor === "substreams-cli") {
    const args = ["sink", "clickhouse", o.spkg, module, "--dsn", o.dsn, "-e", o.endpoint, "--network", network, "-s", String(start), "--cursor-file-path", cursorFile];
    if (o.stopBlock !== undefined) args.push("-t", String(o.stopBlock));
    args.push(...(o.extraArgs ?? []));
    return { cmd: o.sinkBinary ?? "substreams", args };
  }
  const args = ["from-proto", o.dsn, o.spkg, module, "-e", o.endpoint, "--network", network, "-s", String(start)];
  if (o.finalBlocksOnly ?? true) args.push("--final-blocks-only");
  args.push("--clickhouse-cursor-file-path", cursorFile);
  if (o.sinkInfoFolder) args.push("--clickhouse-sink-info-folder", o.sinkInfoFolder);
  if (o.stopBlock !== undefined) args.push("-t", String(o.stopBlock));
  args.push(...(o.extraArgs ?? []));
  return { cmd: o.sinkBinary ?? "substreams-sink-sql", args };
}

function redactDsn(s: string): string {
  return s.replace(/(:\/\/[^:@/]+:)[^@]*@/, "$1***@");
}

export async function startSelfManaged(ctx: Ctx, o: SelfManagedOptions): Promise<{ record: DeployRecord; path: string }> {
  const runDir = paths.runs(ctx, o.runId);
  const path = join(runDir, "deploy.json");
  const cursorFile = o.cursorFile ?? join(runDir, "clickhouse-cursor.txt");
  const sinkInfoFolder = o.sinkInfoFolder ?? join(runDir, "sinkinfo");
  const logFile = join(runDir, "sink.log");
  const pidFile = join(runDir, "sink.pid");
  await writeText(logFile, "");
  await mkdir(sinkInfoFolder, { recursive: true });
  const { cmd, args } = buildSinkCommand({ ...o, cursorFile, sinkInfoFolder });
  const spawnImpl = o.spawnImpl ?? spawn;
  const fd = openSync(logFile, "a");
  const child: ChildProcess = spawnImpl(cmd, args, { cwd: ctx.root, detached: true, stdio: ["ignore", fd, fd], env: { ...process.env, ...ctx.env } });
  const pid = child.pid;
  child.unref();
  closeSync(fd);
  if (!pid) throw new Error(`failed to spawn ${cmd}`);
  await writeText(pidFile, `${pid}\n`);
  const dsn = parseDsn(o.dsn);
  const spkgPath = isAbsolute(o.spkg) ? o.spkg : join(ctx.root, o.spkg);
  const record: DeployRecord = {
    deploymentMode: "self-managed-sink",
    deploymentId: `self-managed:${hostname()}:${pid}:${o.runId}`,
    spkg: o.spkg,
    outputModule: o.module ?? o.streamsmith.outputModule,
    network: o.network ?? o.streamsmith.network,
    endpoint: o.endpoint,
    startBlock: o.startBlock ?? o.streamsmith.startBlock,
    state: "started",
    sink: { kind: "clickhouse", mode: "from-proto", database: dsn.database, hostFingerprint: hostFingerprint(dsn.host, dsn.port) },
    deployedAt: ctx.now().toISOString(),
    runId: o.runId,
    pid,
    pidFile,
    logFile,
    cursorFile,
    command: [cmd, ...args.map((a) => (a === o.dsn ? redactDsn(a) : a))].join(" "),
    notes: [],
  };
  if (await exists(spkgPath)) record.packageHash = await sha256File(spkgPath);
  await writeJson(path, record);
  ctx.log(`deploy(self-managed): pid ${pid}, log ${logFile}, cursor ${cursorFile}`);
  return { record, path };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface StatusOptions {
  runId: string;
  clickhouseUrl?: string;
  database?: string;
  tables?: string[];
  rpcUrl?: string;
  blockTimeSeconds?: number;
  streamsmith?: StreamsmithConfig;
}

export async function selfManagedStatus(ctx: Ctx, o: StatusOptions): Promise<DeployRecord> {
  const path = paths.runs(ctx, o.runId, "deploy.json");
  const hasRecord = await exists(path);
  const chUrl = o.clickhouseUrl ?? ctx.env.CLICKHOUSE_RO_HTTP_URL;
  if (!hasRecord && !chUrl) throw new Error(`no deploy.json for run ${o.runId} (pass --clickhouse-url to compute status without a prior \`deploy self-managed\` run)`);
  const record: DeployRecord = hasRecord ? await readJson<DeployRecord>(path) : { deploymentMode: "self-managed-sink", runId: o.runId };
  const notes: string[] = [];
  if (record.pid !== undefined) {
    const alive = pidAlive(record.pid);
    record.state = alive ? "running" : "exited";
    notes.push(`pid ${record.pid} ${alive ? "alive" : "not running"}`);
  } else if (!hasRecord) {
    notes.push(`no deploy.json for run ${o.runId}; status computed from ClickHouse + RPC only`);
  }
  if (record.cursorFile) {
    if (await exists(record.cursorFile)) {
      const st = await stat(record.cursorFile);
      const raw = (await readText(record.cursorFile)).trim();
      record.cursor = { present: true, mtime: st.mtime.toISOString(), raw: raw.slice(0, 200) };
    } else record.cursor = { present: false };
  }
  const database = o.database ?? record.sink?.database ?? o.streamsmith?.sink?.connection?.database ?? "default";
  const tables = o.tables ?? o.streamsmith?.sink?.tables ?? ["vault_flows", "share_value_observations", "vaults", "share_transfers"];
  if (chUrl) {
    // `_blocks_` (number, deleted — no leading-underscore injected columns) is created by every from-proto run
    // regardless of the vault schema, so it is the head source of record; fall back to the data tables if it is
    // absent or empty (e.g. an older sink run, or `_blocks_` not among `tables`).
    const blocksHead = await chBlocksHead(ctx, chUrl, database);
    if (blocksHead !== undefined) {
      record.headBlock = blocksHead;
      notes.push(`clickhouse _blocks_ max(number): ${blocksHead}`);
    } else {
      const m = await chMaxBlock(ctx, chUrl, database, tables);
      if (m.maxBlock !== undefined) record.headBlock = m.maxBlock;
      notes.push(`clickhouse max(_block_number_): ${JSON.stringify(m.perTable)}`);
    }
    record.rowCounts = await chRowCounts(ctx, chUrl, database, tables.includes("_blocks_") ? tables : [...tables, "_blocks_"]);
    notes.push(`row counts: ${JSON.stringify(record.rowCounts)}`);
  } else notes.push("no ClickHouse URL (set CLICKHOUSE_RO_HTTP_URL or --clickhouse-url); headBlock not refreshed");
  try {
    record.chainHead = await ethBlockNumber(ctx, o.rpcUrl);
  } catch (err) {
    notes.push(`eth_blockNumber failed: ${(err as Error).message}`);
  }
  if (record.headBlock !== undefined && record.chainHead !== undefined) {
    record.lagBlocks = Math.max(0, record.chainHead - record.headBlock);
    record.lagSeconds = record.lagBlocks * (o.blockTimeSeconds ?? BASE_BLOCK_TIME_SECONDS);
  }
  record.checkedAt = ctx.now().toISOString();
  record.notes = notes;
  await writeJson(path, record);
  ctx.log(`deploy(self-managed): ${record.state ?? "?"} head=${record.headBlock ?? "?"} chain=${record.chainHead ?? "?"} lag=${record.lagBlocks ?? "?"} blocks`);
  return record;
}

export async function stopSelfManaged(ctx: Ctx, runId: string): Promise<boolean> {
  const path = paths.runs(ctx, runId, "deploy.json");
  const record = await readJson<DeployRecord>(path);
  if (record.pid === undefined) return false;
  try {
    process.kill(record.pid, "SIGTERM");
    record.state = "stopped";
    await writeJson(path, record);
    return true;
  } catch {
    return false;
  }
}
