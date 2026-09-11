#!/usr/bin/env -S node --import tsx
// streamsmith <command> — see README.md. Exit codes: gate 0/10/20/30 (pass/build/run/assertions), 1 usage or
// config error, 40 hosted deploy waiting for the human to stage the DB secret.
import { parseArgs } from "node:util";
import { readdir } from "node:fs/promises";
import { join, isAbsolute, relative } from "node:path";
import { createInterface } from "node:readline";
import { createCtx, paths, type Ctx } from "./util/ctx.ts";
import { exists, newRunId, readJson, readJsonLenient, readText, writeText, writeJson } from "./util/fsx.ts";
import { sha256File, sha256Hex } from "./util/hash.ts";
import { runGate, moduleHashesOf } from "./gate/run.ts";
import { loadStreamsmithConfig, parametersHash, receiptParameters, type StreamsmithConfig } from "./config/streamsmith.ts";
import { specDescriptor, spkgDescriptor, protoPackageOf, substreamsInfo } from "./proto/descriptor.ts";
import { runPublish, type PublishRecord } from "./publish.ts";
import { deployHosted, hostedStatus, portalLogin, AwaitingSecretError, EXIT_AWAITING_SECRET } from "./deploy/hosted.ts";
import { startSelfManaged, selfManagedStatus, stopSelfManaged } from "./deploy/selfManaged.ts";
import { chDumpSchema, clickhouseHttpUrl, clickhouseDatabase } from "./deploy/clickhouse.ts";
import { applyViews, DEFAULT_VIEWS_PATH } from "./deploy/views.ts";
import type { DeployRecord } from "./deploy/types.ts";
import { assembleReceipt, writeReceipt, hashSpkg, hashSchemaSql, loadReceipt, validateReceipt, loadReceiptSchema, receiptHash, receiptFileName } from "./receipt.ts";
import type { GateReport } from "./gate/run.ts";
import { manifestStart, manifestFinish } from "./manifest.ts";
import { writeCaseStudy } from "./casestudy.ts";
import { runMcp, DEFAULT_MCP_OUT } from "./mcp.ts";

const USAGE = `streamsmith <command> [options]

Commands
  new-run                              mint a run id, create runs/<id>/, remember it in runs/CURRENT
  gate        [--gate specs/gate.yaml] [--reuse-runs] [--skip-build] [--offline] [--rpc-url URL] [--verbose]
  publish     [--pkg-dir DIR] [--manifest substreams.yaml] [--spkg FILE] [--dry-run] [--team-slug S] [--verify-url]
  deploy hosted        --spkg-url URL [--deployment-id ID] [--update] [--name N] [--ch-server H --ch-port 9440 --ch-user U --ch-database D --ch-secure]
                       [--stop-block N] [--params STRING] [--poll-timeout SEC] [--views FILE]   (env PORTAL_TOKEN, PORTAL_ORG_ID, PORTAL_REFRESH_TOKEN; CLICKHOUSE_URL to apply views)
                       --params is omitted unless given explicitly (the spkg carries the manifest defaults); --update reconfigures --deployment-id instead of creating one
  deploy self-managed  --spkg FILE [--dsn DSN] [--endpoint E] [--network N] [--start-block N] [--stop-block N] [--sink-binary B]
                       [--flavor substreams-sink-sql|substreams-cli] [--sink-info-folder DIR] [--no-final-blocks-only] [--views FILE]
                       from-proto defaults: --final-blocks-only on, --clickhouse-sink-info-folder + cursor file under runs/<id>/ (never share a folder across databases)
  deploy views         [--views packages/erc4626-flows/sql/views.sql] [--clickhouse-url URL] [--database D] [--wait SEC]
                       --views resolves against --root, not cwd; a missing file is an error only when --views is given explicitly
  deploy status        [--clickhouse-url URL] [--rpc-url URL] [--deployment-id ID] [--database D] [--verbose]
                       self-managed with no deploy.json works when --clickhouse-url is given: head from _blocks_, chain head from --rpc-url, lag, row counts
                       --verbose logs each ClickHouse/RPC request URL+body and the response status + first 200 bytes of body
  deploy stop
  deploy login                         device-code login; prints export lines (never stores tokens)
  schema-dump [--clickhouse-url URL] [--database D] [--tables a,b] [--out FILE]
  receipt     --spkg FILE (--schema-sql FILE | --schema-hash HEX) [--mcp-manifest FILE] [--deploy-json FILE] [--force]
  receipt verify FILE                  validate a receipt file against specs/receipt.schema.json
  mcp         [--receipt FILE] [--out packages/mcp-vaultflows] [--proto specs/vaultflows.proto] [--views FILE]
                                       runs \`pnpm --filter @ethonline26/mcpgen generate …\`, binds mcpManifestHash into the receipt
  manifest start|finish [--receipt FILE] [--recording FILE]
  casestudy   [--name N] [--id S1.1] [--title T] [--skills a,b] [--model M] [--result R] [--receipt FILE]
  hash descriptor FILE | spkg FILE | sql FILE | params | file FILE

Common: --run-id ID (default runs/CURRENT or STREAMSMITH_RUN_ID)  --root DIR  --json`;

const OPTIONS = {
  "run-id": { type: "string" }, root: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
  gate: { type: "string" }, "reuse-runs": { type: "boolean" }, "skip-build": { type: "boolean" }, verbose: { type: "boolean" }, offline: { type: "boolean" },
  "pkg-dir": { type: "string" }, manifest: { type: "string" }, spkg: { type: "string" }, "dry-run": { type: "boolean" }, "team-slug": { type: "string" }, "verify-url": { type: "boolean" },
  "spkg-url": { type: "string" }, "deployment-id": { type: "string" }, update: { type: "boolean" }, params: { type: "string" }, name: { type: "string" }, "ch-server": { type: "string" }, "ch-port": { type: "string" }, "ch-user": { type: "string" }, "ch-database": { type: "string" }, "ch-secure": { type: "boolean" },
  "stop-block": { type: "string" }, "start-block": { type: "string" }, "poll-timeout": { type: "string" }, dsn: { type: "string" }, endpoint: { type: "string" }, network: { type: "string" }, module: { type: "string" }, "sink-binary": { type: "string" }, flavor: { type: "string" }, "cursor-file": { type: "string" },
  "sink-info-folder": { type: "string" }, "no-final-blocks-only": { type: "boolean" },
  "clickhouse-url": { type: "string" }, "rpc-url": { type: "string" }, database: { type: "string" }, tables: { type: "string" }, out: { type: "string" }, views: { type: "string" }, wait: { type: "string" },
  "schema-sql": { type: "string" }, "schema-hash": { type: "string" }, "mcp-manifest": { type: "string" }, "deploy-json": { type: "string" }, "publish-json": { type: "string" }, "gate-json": { type: "string" }, force: { type: "boolean" },
  receipt: { type: "string" }, recording: { type: "string" }, proto: { type: "string" },
  id: { type: "string" }, title: { type: "string" }, skills: { type: "string" }, model: { type: "string" }, result: { type: "string" }, chain: { type: "string" }, goal: { type: "string" }, note: { type: "string", multiple: true },
} as const;

type Values = Record<string, string | boolean | string[] | undefined>;
const s = (v: Values, k: string): string | undefined => (typeof v[k] === "string" ? (v[k] as string) : undefined);
const b = (v: Values, k: string): boolean => v[k] === true;
const n = (v: Values, k: string): number | undefined => (s(v, k) !== undefined ? Number(s(v, k)) : undefined);

async function resolveRunId(ctx: Ctx, v: Values, create = false): Promise<string> {
  const explicit = s(v, "run-id") ?? ctx.env.STREAMSMITH_RUN_ID;
  if (explicit) return explicit;
  const current = join(ctx.root, "runs", "CURRENT");
  if (await exists(current)) return (await readText(current)).trim();
  if (!create) throw new Error("no run id: pass --run-id, set STREAMSMITH_RUN_ID, or run `streamsmith new-run` first");
  const id = newRunId(ctx.now());
  await writeText(current, id + "\n");
  return id;
}

function abs(ctx: Ctx, p: string): string {
  return isAbsolute(p) ? p : join(ctx.root, p);
}

function out(v: Values, human: string, data: unknown): void {
  if (b(v, "json")) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(human + "\n");
}

async function waitForEnter(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => rl.question("", () => resolve()));
  rl.close();
}

/** After a deploy: apply the optional views file when a ClickHouse HTTP URL is known; record the outcome honestly. */
async function applyViewsAfterDeploy(ctx: Ctx, v: Values, ss: StreamsmithConfig, record: DeployRecord, path: string, waitSeconds: number): Promise<void> {
  const url = clickhouseHttpUrl(ctx, s(v, "clickhouse-url"));
  record.notes = record.notes ?? [];
  if (!url) {
    record.notes.push("views not applied: no ClickHouse HTTP URL (set CLICKHOUSE_URL or pass --clickhouse-url, then `streamsmith deploy views`)");
    await writeJson(path, record);
    return;
  }
  const database = clickhouseDatabase(ctx, s(v, "database") ?? s(v, "ch-database"), record.sink?.database ?? ss.sink?.connection?.database);
  const vo: Parameters<typeof applyViews>[1] = { url, database, requiredTables: ss.sink?.tables ?? [], waitSeconds };
  if (s(v, "views")) { vo.viewsPath = s(v, "views")!; vo.viewsPathExplicit = true; }
  record.views = await applyViews(ctx, vo);
  await writeJson(path, record);
}

async function findReceiptForRun(ctx: Ctx, runId: string): Promise<string | undefined> {
  const dir = paths.receipts(ctx);
  if (!(await exists(dir))) return undefined;
  const f = (await readdir(dir)).filter((x) => x.endsWith(`-${runId}.json`))[0];
  return f ? join("receipts", f) : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS as never, allowPositionals: true, strict: true });
  const v = values as Values;
  const [cmd, sub, ...rest] = positionals;
  if (!cmd || b(v, "help")) {
    process.stdout.write(USAGE + "\n");
    // an explicit --help is a request, not a usage error; bare `streamsmith` is a usage error
    return b(v, "help") ? 0 : 1;
  }
  const ctx = await createCtx({ ...(s(v, "root") ? { root: s(v, "root")! } : {}) });
  const ssPath = paths.specs(ctx, "streamsmith.yaml");

  switch (cmd) {
    case "new-run": {
      const id = newRunId(ctx.now());
      await writeText(join(ctx.root, "runs", "CURRENT"), id + "\n");
      await writeText(paths.runs(ctx, id, ".keep"), "");
      out(v, id, { runId: id });
      return 0;
    }
    case "gate": {
      const runId = await resolveRunId(ctx, v, true);
      const opts: Parameters<typeof runGate>[1] = { runId, reuseRuns: b(v, "reuse-runs"), skipBuild: b(v, "skip-build"), verbose: b(v, "verbose"), offline: b(v, "offline") };
      if (s(v, "gate")) opts.gatePath = s(v, "gate")!;
      if (s(v, "rpc-url")) opts.rpcUrl = s(v, "rpc-url")!;
      const r = await runGate(ctx, opts);
      const failLevel = r.report.assertions.filter((a) => a.severity === "fail");
      out(v, `${r.report.status}: ${failLevel.filter((a) => a.passed).length}/${failLevel.length} fail-level assertions passed${r.report.warnings.length ? `; warnings: ${r.report.warnings.join(", ")}` : ""}; report ${relative(ctx.root, r.reportPath)}`, r.report);
      return r.exitCode;
    }
    case "publish": {
      const runId = await resolveRunId(ctx, v, true);
      const ss = await loadStreamsmithConfig(ssPath);
      const po: Parameters<typeof runPublish>[1] = { pkgDir: s(v, "pkg-dir") ?? `packages/${ss.packageName}`, dryRun: b(v, "dry-run"), verifyUrl: b(v, "verify-url"), runId, outputModule: ss.outputModule };
      if (s(v, "manifest")) po.manifest = s(v, "manifest")!;
      if (s(v, "spkg")) po.spkgPath = s(v, "spkg")!;
      if (s(v, "team-slug")) po.teamSlug = s(v, "team-slug")!;
      const r = await runPublish(ctx, po);
      out(v, `${r.record.dryRun ? "dry-run " : ""}${r.record.packageName} ${r.record.packageVersion} sha256 ${r.record.packageHash}${r.record.packageUrl ? ` ${r.record.packageUrl}` : ""}`, r.record);
      return 0;
    }
    case "deploy": {
      const ss = await loadStreamsmithConfig(ssPath);
      if (sub === "login") {
        const t = await portalLogin(ctx, waitForEnter);
        process.stdout.write(`export PORTAL_TOKEN=${t.accessToken}\n${t.organizationId ? `export PORTAL_ORG_ID=${t.organizationId}\n` : ""}`);
        return 0;
      }
      const runId = await resolveRunId(ctx, v, true);
      if (sub === "hosted") {
        const spkgUrl = s(v, "spkg-url") ?? (await (async () => { const p = paths.runs(ctx, runId, "publish.json"); return (await exists(p)) ? (await readJson<PublishRecord>(p)).packageUrl : undefined; })());
        if (!spkgUrl) throw new Error("--spkg-url is required (or publish first so runs/<id>/publish.json has packageUrl)");
        const conn = ss.sink?.connection ?? {};
        const server = s(v, "ch-server") ?? ctx.env.CLICKHOUSE_SERVER ?? conn.host;
        if (!server) throw new Error("ClickHouse server required: --ch-server or CLICKHOUSE_SERVER");
        const clickhouse = { server, port: n(v, "ch-port") ?? Number(ctx.env.CLICKHOUSE_NATIVE_PORT ?? conn.port ?? 9440), user: s(v, "ch-user") ?? ctx.env.CLICKHOUSE_USER ?? conn.user ?? "default", database: clickhouseDatabase(ctx, s(v, "ch-database"), conn.database), secure: b(v, "ch-secure") || (conn.secure ?? true) };
        const publishPath = paths.runs(ctx, runId, "publish.json");
        const pub = (await exists(publishPath)) ? await readJson<PublishRecord>(publishPath) : undefined;
        try {
          const ho: Parameters<typeof deployHosted>[1] = { runId, streamsmith: ss, spkgUrl, clickhouse };
          if (pub?.packageHash) ho.packageHash = pub.packageHash;
          if (s(v, "deployment-id")) ho.deploymentId = s(v, "deployment-id")!;
          if (b(v, "update")) ho.update = true;
          if (s(v, "name")) ho.name = s(v, "name")!;
          if (n(v, "stop-block") !== undefined) ho.stopBlock = n(v, "stop-block")!;
          if (s(v, "params")) ho.params = s(v, "params")!;
          if (n(v, "poll-timeout") !== undefined) ho.pollTimeoutSeconds = n(v, "poll-timeout")!;
          const r = await deployHosted(ctx, ho);
          await applyViewsAfterDeploy(ctx, v, ss, r.record, r.path, n(v, "wait") ?? 0);
          out(v, `hosted ${r.record.deploymentId} ${r.record.state ?? ""} head=${r.record.headBlock ?? "?"} lag=${r.record.lagBlocks ?? "?"} blocks; views ${r.record.views ? (r.record.views.skipped ?? `${r.record.views.applied.length} statements`) : "not applied"}`, r.record);
          return 0;
        } catch (err) {
          if (err instanceof AwaitingSecretError) {
            ctx.log(`deploy(hosted): STOP — ${err.message}`);
            return EXIT_AWAITING_SECRET;
          }
          throw err;
        }
      }
      if (sub === "self-managed") {
        const spkg = s(v, "spkg");
        if (!spkg) throw new Error("--spkg is required");
        const dsn = s(v, "dsn") ?? ctx.env.CLICKHOUSE_DSN;
        if (!dsn) throw new Error("--dsn or CLICKHOUSE_DSN is required (native DSN clickhouse://user:pw@host:9440/db?secure=true)");
        const endpoint = s(v, "endpoint") ?? ctx.env.SUBSTREAMS_ENDPOINT;
        if (!endpoint) throw new Error("--endpoint or SUBSTREAMS_ENDPOINT is required");
        const so: Parameters<typeof startSelfManaged>[1] = { runId, streamsmith: ss, dsn, spkg, endpoint };
        if (s(v, "module")) so.module = s(v, "module")!;
        if (s(v, "network")) so.network = s(v, "network")!;
        if (n(v, "start-block") !== undefined) so.startBlock = n(v, "start-block")!;
        if (n(v, "stop-block") !== undefined) so.stopBlock = n(v, "stop-block")!;
        if (s(v, "cursor-file")) so.cursorFile = s(v, "cursor-file")!;
        if (s(v, "sink-binary")) so.sinkBinary = s(v, "sink-binary")!;
        if (s(v, "flavor")) so.flavor = s(v, "flavor") as "substreams-sink-sql" | "substreams-cli";
        if (s(v, "sink-info-folder")) so.sinkInfoFolder = s(v, "sink-info-folder")!;
        so.finalBlocksOnly = !b(v, "no-final-blocks-only");
        const r = await startSelfManaged(ctx, so);
        await applyViewsAfterDeploy(ctx, v, ss, r.record, r.path, n(v, "wait") ?? 120);
        out(v, `self-managed pid ${r.record.pid} -> ${relative(ctx.root, r.path)}; views ${r.record.views ? (r.record.views.skipped ?? `${r.record.views.applied.length} statements`) : "not applied"}`, r.record);
        return 0;
      }
      if (sub === "views") {
        const url = clickhouseHttpUrl(ctx, s(v, "clickhouse-url"));
        if (!url) throw new Error("--clickhouse-url or CLICKHOUSE_URL is required");
        const p = paths.runs(ctx, runId, "deploy.json");
        const existing = (await exists(p)) ? await readJson<DeployRecord>(p) : undefined;
        const database = clickhouseDatabase(ctx, s(v, "database"), existing?.sink?.database ?? ss.sink?.connection?.database);
        const vo: Parameters<typeof applyViews>[1] = { url, database, requiredTables: ss.sink?.tables ?? [], waitSeconds: n(v, "wait") ?? 0 };
        if (s(v, "views")) { vo.viewsPath = s(v, "views")!; vo.viewsPathExplicit = true; }
        const rec = await applyViews(ctx, vo);
        if (existing) {
          existing.views = rec;
          await writeJson(p, existing);
        } else await writeJson(paths.runs(ctx, runId, "views.json"), rec);
        out(v, rec.skipped ? `skipped: ${rec.skipped}` : `${rec.applied.length} statement(s) from ${rec.file}; views: ${rec.views.join(", ") || "(none)"}`, rec);
        return 0;
      }
      if (sub === "status") {
        const p = paths.runs(ctx, runId, "deploy.json");
        // A12: this used to be an unguarded `readJson`, so a corrupt/truncated deploy.json (crashed writer,
        // concurrent write) turned "peek at the mode" into a bare JSON.parse crash before either status path
        // below ever ran — read leniently and fall back to mode detection as if the file were absent, same as
        // `selfManagedStatus`/`hostedStatus` now do for the record itself.
        const { value: existing } = await readJsonLenient<DeployRecord>(p);
        const mode = existing?.deploymentMode ?? (s(v, "deployment-id") ? "graph-market-hosted" : "self-managed-sink");
        let rec: DeployRecord;
        if (mode === "graph-market-hosted") {
          const hs: Parameters<typeof hostedStatus>[1] = { runId };
          if (s(v, "deployment-id")) hs.deploymentId = s(v, "deployment-id")!;
          rec = await hostedStatus(ctx, hs);
        } else {
          const st: Parameters<typeof selfManagedStatus>[1] = { runId, streamsmith: ss };
          const url = clickhouseHttpUrl(ctx, s(v, "clickhouse-url"));
          if (url) st.clickhouseUrl = url;
          if (s(v, "rpc-url")) st.rpcUrl = s(v, "rpc-url")!;
          if (s(v, "database")) st.database = s(v, "database")!;
          if (s(v, "tables")) st.tables = s(v, "tables")!.split(",");
          if (b(v, "verbose")) st.verbose = true;
          rec = await selfManagedStatus(ctx, st);
        }
        out(v, `${rec.deploymentMode} ${rec.state ?? ""} head=${rec.headBlock ?? "?"} chain=${rec.chainHead ?? "?"} lag=${rec.lagBlocks ?? "?"} blocks${rec.lagSeconds !== undefined ? ` / ${rec.lagSeconds}s` : ""}${rec.rowCounts ? `; rows ${JSON.stringify(rec.rowCounts)}` : ""}`, rec);
        return 0;
      }
      if (sub === "stop") {
        const ok = await stopSelfManaged(ctx, runId);
        out(v, ok ? "stopped" : "nothing to stop", { stopped: ok });
        return ok ? 0 : 1;
      }
      throw new Error(`unknown deploy subcommand "${sub ?? ""}" (hosted | self-managed | views | status | stop | login)`);
    }
    case "schema-dump": {
      const runId = await resolveRunId(ctx, v, true);
      const ss = await loadStreamsmithConfig(ssPath);
      const url = clickhouseHttpUrl(ctx, s(v, "clickhouse-url"));
      if (!url) throw new Error("--clickhouse-url or CLICKHOUSE_URL is required");
      const database = clickhouseDatabase(ctx, s(v, "database"), ss.sink?.connection?.database);
      const tables = s(v, "tables")?.split(",") ?? ss.sink?.tables ?? ["vault_flows", "share_value_observations", "vaults", "share_transfers"];
      const sql = await chDumpSchema(ctx, url, database, tables);
      const file = s(v, "out") ? abs(ctx, s(v, "out")!) : paths.runs(ctx, runId, "schema.sql");
      await writeText(file, sql);
      out(v, `${relative(ctx.root, file)} sha256 ${sha256Hex(sql)} (${tables.length} tables)`, { file, sinkSchemaHash: sha256Hex(sql), tables });
      return 0;
    }
    case "receipt": {
      if (sub === "verify") {
        const file = rest[0] ?? s(v, "receipt");
        if (!file) throw new Error("receipt verify FILE");
        const receipt = await loadReceipt(abs(ctx, file));
        const res = validateReceipt(receipt, await loadReceiptSchema(ctx.root));
        out(v, res.ok ? `valid; receiptHash ${receiptHash(receipt)}` : res.errors.map((e) => `${e.path}: ${e.message}`).join("\n"), { ...res, receiptHash: receiptHash(receipt) });
        return res.ok ? 0 : 1;
      }
      const runId = await resolveRunId(ctx, v);
      const ss = await loadStreamsmithConfig(ssPath);
      const gatePath = s(v, "gate-json") ? abs(ctx, s(v, "gate-json")!) : paths.runs(ctx, runId, "gate.json");
      if (!(await exists(gatePath))) throw new Error(`gate.json not found for run ${runId}; run \`streamsmith gate\` first`);
      const gate = await readJson<GateReport>(gatePath);
      const publishPath = s(v, "publish-json") ? abs(ctx, s(v, "publish-json")!) : paths.runs(ctx, runId, "publish.json");
      const publish = (await exists(publishPath)) ? await readJson<PublishRecord>(publishPath) : undefined;
      const deployPath = s(v, "deploy-json") ? abs(ctx, s(v, "deploy-json")!) : paths.runs(ctx, runId, "deploy.json");
      const deploy = (await exists(deployPath)) ? await readJson<DeployRecord>(deployPath) : undefined;
      const spkg = s(v, "spkg") ?? publish?.spkgPath ?? gate.package.spkg;
      if (!spkg) throw new Error("--spkg is required (no publish.json / gate.json spkg path to fall back on)");
      const packageHash = await hashSpkg(abs(ctx, spkg));
      let sinkSchemaHash = s(v, "schema-hash")?.toLowerCase();
      if (!sinkSchemaHash) {
        const sqlPath = s(v, "schema-sql") ? abs(ctx, s(v, "schema-sql")!) : paths.runs(ctx, runId, "schema.sql");
        if (!(await exists(sqlPath))) throw new Error(`schema.sql not found (${relative(ctx.root, sqlPath)}); run \`streamsmith schema-dump\` or pass --schema-sql / --schema-hash`);
        sinkSchemaHash = await hashSchemaSql(sqlPath);
      }
      let protoDescriptorHash = gate.descriptor?.specHash;
      if (!protoDescriptorHash) protoDescriptorHash = (await specDescriptor(ctx, abs(ctx, ss.contract))).hash;
      if (gate.descriptor?.spkgHash && gate.descriptor.spkgHash !== protoDescriptorHash && !b(v, "force")) {
        throw new Error(`refusing to write a receipt: gate descriptor mismatch (package ${gate.descriptor.spkgHash} vs contract ${protoDescriptorHash})`);
      }
      if (!gate.passed && !b(v, "force")) throw new Error(`refusing to write a receipt: gate status is ${gate.status} (use --force only for a non-canonical receipt)`);
      // module hashes from the spkg being receipted (the reproducible identity; spkg bytes are not reproducible)
      const outputModule = gate.package.outputModule ?? ss.outputModule;
      let moduleHashes: Record<string, string> | undefined;
      try {
        moduleHashes = moduleHashesOf(await substreamsInfo(ctx, abs(ctx, spkg), { expandNetworks: true }));
      } catch (err) {
        ctx.log(`receipt: substreams info on ${spkg} failed (${(err as Error).message}); falling back to publish.json / gate.json module hashes`);
        moduleHashes = publish?.moduleHashes ?? gate.package.moduleHashes;
      }
      const gatedHash = gate.package.moduleHash ?? gate.package.moduleHashes?.[outputModule];
      const liveHash = moduleHashes?.[outputModule];
      if (gatedHash && liveHash && gatedHash !== liveHash && !b(v, "force")) {
        throw new Error(`refusing to write a receipt: ${outputModule} module hash ${liveHash} in ${spkg} differs from the gated build ${gatedHash} (rebuilt after the gate?)`);
      }
      const inputs: Parameters<typeof assembleReceipt>[0] = { streamsmith: ss, gate, packageHash, protoDescriptorHash, sinkSchemaHash, runId, createdAt: ctx.now().toISOString() };
      if (moduleHashes && Object.keys(moduleHashes).length) inputs.moduleHashes = moduleHashes;
      if (publish) inputs.publish = publish;
      if (deploy) inputs.deploy = deploy;
      if (gate.package.outputModule) inputs.outputModule = gate.package.outputModule;
      if (gate.endpoint) inputs.endpoint = gate.endpoint;
      if (s(v, "mcp-manifest")) inputs.mcpManifestHash = await sha256File(abs(ctx, s(v, "mcp-manifest")!));
      const receipt = assembleReceipt(inputs);
      const r = await writeReceipt(ctx.root, receipt, { force: b(v, "force"), ...(s(v, "out") ? { outDir: s(v, "out")! } : {}) });
      if (r.errors.length) ctx.log(`receipt: WARNING written with --force despite ${r.errors.length} schema errors`);
      out(v, `${relative(ctx.root, r.path)} receiptHash ${r.hash}`, { path: r.path, receiptHash: r.hash, receipt: r.receipt, errors: r.errors });
      return 0;
    }
    case "mcp": {
      const runId = await resolveRunId(ctx, v);
      const ss = await loadStreamsmithConfig(ssPath);
      const receiptPath = s(v, "receipt") ?? (await findReceiptForRun(ctx, runId));
      if (!receiptPath) throw new Error(`no receipt for run ${runId} (expected receipts/${receiptFileName({ packageName: ss.packageName, packageVersion: ss.version, runId })}); run \`streamsmith receipt\` first or pass --receipt`);
      const mo: Parameters<typeof runMcp>[1] = { runId, receiptPath, outDir: s(v, "out") ?? DEFAULT_MCP_OUT, protoPath: s(v, "proto") ?? ss.contract };
      const views = s(v, "views") ?? DEFAULT_VIEWS_PATH;
      if (await exists(abs(ctx, views))) mo.viewsPath = views;
      const r = await runMcp(ctx, mo);
      out(v, `${r.record.manifest} sha256 ${r.record.mcpManifestHash}; receipt ${r.record.receiptPath} receiptHash ${r.record.receiptHash}`, r.record);
      return 0;
    }
    case "manifest": {
      const runId = await resolveRunId(ctx, v, sub === "start");
      if (sub === "start") {
        const r = await manifestStart(ctx, { runId });
        out(v, `${relative(ctx.root, r.path)} commit ${r.manifest.startingCommit ?? "?"} prompt ${r.manifest.promptHash}`, r.manifest);
        return 0;
      }
      if (sub === "finish") {
        const mo: Parameters<typeof manifestFinish>[1] = { runId };
        const rp = s(v, "receipt") ?? (await findReceiptForRun(ctx, runId));
        if (rp) mo.receiptPath = rp;
        if (s(v, "recording")) mo.recordingPath = s(v, "recording")!;
        const r = await manifestFinish(ctx, mo);
        out(v, `${relative(ctx.root, r.path)} ending commit ${r.manifest.endingCommit ?? "?"} receiptHash ${r.manifest.receiptHash ?? "(none)"}`, r.manifest);
        return 0;
      }
      throw new Error("manifest start | finish");
    }
    case "casestudy": {
      const runId = await resolveRunId(ctx, v);
      const co: Parameters<typeof writeCaseStudy>[1] = { runId };
      for (const k of ["name", "id", "title", "chain", "model", "result", "goal"] as const) if (s(v, k)) (co as unknown as Record<string, unknown>)[k] = s(v, k);
      if (s(v, "skills")) co.skills = s(v, "skills")!.split(",").map((x) => x.trim());
      if (s(v, "receipt")) co.receiptPath = s(v, "receipt")!;
      if (s(v, "pkg-dir")) co.pkgDir = s(v, "pkg-dir")!;
      if (s(v, "out")) co.outDir = s(v, "out")!;
      if (Array.isArray(v.note)) co.extraNotes = v.note as string[];
      const r = await writeCaseStudy(ctx, co);
      out(v, relative(ctx.root, r.path), { path: r.path });
      return 0;
    }
    case "hash": {
      const target = rest[0];
      switch (sub) {
        case "descriptor": {
          if (!target) throw new Error("hash descriptor FILE.proto");
          const r = await specDescriptor(ctx, abs(ctx, target));
          out(v, r.hash, { hash: r.hash, package: r.pkg, rendererMatch: r.rendererMatch });
          return 0;
        }
        case "spkg": {
          if (!target) throw new Error("hash spkg FILE.spkg");
          const ss = await loadStreamsmithConfig(ssPath);
          const pkg = protoPackageOf(await readText(abs(ctx, ss.contract))) ?? "vaultflows.v1";
          const r = await spkgDescriptor(ctx, abs(ctx, target), pkg);
          const packageHash = await sha256File(abs(ctx, target));
          out(v, `packageHash ${packageHash}\nprotoDescriptorHash ${r.hash}`, { packageHash, protoDescriptorHash: r.hash, package: pkg });
          return 0;
        }
        case "sql": {
          if (!target) throw new Error("hash sql FILE.sql");
          const h = await hashSchemaSql(abs(ctx, target));
          out(v, h, { sinkSchemaHash: h });
          return 0;
        }
        case "params": {
          const ss = await loadStreamsmithConfig(ssPath);
          const params = receiptParameters(ss);
          out(v, parametersHash(params), { parametersHash: parametersHash(params), parameters: params });
          return 0;
        }
        case "file": {
          if (!target) throw new Error("hash file FILE");
          const h = await sha256File(abs(ctx, target));
          out(v, h, { sha256: h });
          return 0;
        }
        default:
          throw new Error("hash descriptor|spkg|sql|params|file");
      }
    }
    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${USAGE}\n`);
      return 1;
  }
}

const isMain = process.argv[1] && /cli\.ts$/.test(process.argv[1]);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`streamsmith: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
