// publish: `substreams pack` then `substreams registry publish`; capture spkg path, sha256, URL, timestamp.
import { join, isAbsolute, basename } from "node:path";
import type { Ctx } from "./util/ctx.ts";
import { paths } from "./util/ctx.ts";
import { exists, writeJson, writeText } from "./util/fsx.ts";
import { sha256File } from "./util/hash.ts";
import { substreamsInfo } from "./proto/descriptor.ts";
import { normalizeVersion } from "./config/streamsmith.ts";

export interface PublishRecord {
  packageName: string;
  packageVersion: string;
  spkgPath: string;
  spkgBytes: number;
  packageHash: string;
  /** binary download URL, https://api.substreams.dev/v1/packages/<name>/<version> */
  packageUrl?: string;
  /** human page, https://substreams.dev/packages/<name>/<version> */
  webUrl?: string;
  registryPublishedAt?: string;
  dryRun: boolean;
  commands: string[];
  publishOutput?: string;
  urlVerified?: boolean;
  outputModule?: string;
  /** module hash of outputModule — the reproducible identity (packageHash is the artifact's bytes only) */
  moduleHash?: string;
  moduleHashes?: Record<string, string>;
  runId: string;
  createdAt: string;
}

export interface PublishOptions {
  pkgDir: string;
  manifest?: string;
  /** Reuse an existing spkg instead of packing. */
  spkgPath?: string;
  dryRun?: boolean;
  teamSlug?: string;
  runId: string;
  outputModule?: string;
  /** HEAD the registry URL after publishing to confirm it serves a binary. */
  verifyUrl?: boolean;
}

export function registryUrls(name: string, version: string): { packageUrl: string; webUrl: string } {
  const v = normalizeVersion(version);
  return { packageUrl: `https://api.substreams.dev/v1/packages/${name}/${v}`, webUrl: `https://substreams.dev/packages/${name}/${v}` };
}

export async function runPublish(ctx: Ctx, opts: PublishOptions): Promise<{ record: PublishRecord; path: string }> {
  const pkgDir = isAbsolute(opts.pkgDir) ? opts.pkgDir : join(ctx.root, opts.pkgDir);
  const manifest = opts.manifest ?? "substreams.yaml";
  const commands: string[] = [];
  const runDir = paths.runs(ctx, opts.runId);

  const info = await substreamsInfo(ctx, opts.spkgPath ? (isAbsolute(opts.spkgPath) ? opts.spkgPath : join(ctx.root, opts.spkgPath)) : manifest, opts.spkgPath ? {} : { cwd: pkgDir });
  if (!info.name || !info.version) throw new Error("substreams info did not return package name/version");
  const name = info.name.replace(/_/g, "-");
  const version = normalizeVersion(info.version);

  let spkgPath = opts.spkgPath ? (isAbsolute(opts.spkgPath) ? opts.spkgPath : join(ctx.root, opts.spkgPath)) : undefined;
  if (!spkgPath) {
    spkgPath = join(pkgDir, `${name}-${version}.spkg`);
    const r = await ctx.runner.run("substreams", ["pack", manifest, "-o", spkgPath], { cwd: pkgDir, timeoutMs: 300000 });
    commands.push(r.command);
    if (r.code !== 0) throw new Error(`substreams pack failed (exit ${r.code}): ${r.stderr.trim()}`);
  }
  if (!(await exists(spkgPath))) throw new Error(`spkg not found after pack: ${spkgPath}`);
  const { stat } = await import("node:fs/promises");
  const spkgBytes = (await stat(spkgPath)).size;
  const packageHash = await sha256File(spkgPath);
  const mod = info.modules?.find((m) => m.name === (opts.outputModule ?? "map_events")) ?? info.modules?.[0];

  const record: PublishRecord = {
    packageName: name,
    packageVersion: version,
    spkgPath,
    spkgBytes,
    packageHash,
    dryRun: Boolean(opts.dryRun),
    commands,
    runId: opts.runId,
    createdAt: ctx.now().toISOString(),
  };
  if (mod) {
    record.outputModule = mod.name;
    if (mod.hash) record.moduleHash = mod.hash;
  }
  const hashes: Record<string, string> = {};
  for (const m of info.modules ?? []) if (m.name && m.hash) hashes[m.name] = m.hash;
  if (Object.keys(hashes).length) record.moduleHashes = hashes;
  const urls = registryUrls(name, version);
  if (opts.dryRun) {
    ctx.log(`publish: dry-run; would run: substreams registry publish ${basename(spkgPath)} --yes${opts.teamSlug ? ` --team-slug ${opts.teamSlug}` : ""}`);
    ctx.log(`publish: dry-run; expected URL ${urls.packageUrl}`);
  } else {
    const args = ["registry", "publish", spkgPath, "--yes"];
    if (opts.teamSlug) args.push("--team-slug", opts.teamSlug);
    const r = await ctx.runner.run("substreams", args, { cwd: pkgDir, timeoutMs: 300000, echoStderr: true });
    commands.push(r.command);
    record.publishOutput = `${r.stdout}\n${r.stderr}`.trim();
    await writeText(join(runDir, "publish.log"), `$ ${r.command}\n# exit ${r.code}\n${record.publishOutput}\n`);
    if (r.code !== 0) {
      await writeJson(join(runDir, "publish.json"), record);
      throw new Error(`substreams registry publish failed (exit ${r.code}); see runs/${opts.runId}/publish.log`);
    }
    record.registryPublishedAt = ctx.now().toISOString();
    const m = /https?:\/\/[^\s"']*substreams\.dev[^\s"']*/.exec(record.publishOutput);
    record.webUrl = m?.[0] ?? urls.webUrl;
    record.packageUrl = urls.packageUrl;
    if (opts.verifyUrl) {
      try {
        const res = await ctx.fetch(urls.packageUrl, { method: "HEAD", redirect: "follow" });
        record.urlVerified = res.ok;
        if (!res.ok) ctx.log(`publish: WARNING ${urls.packageUrl} returned HTTP ${res.status}`);
      } catch (err) {
        record.urlVerified = false;
        ctx.log(`publish: WARNING could not verify ${urls.packageUrl}: ${(err as Error).message}`);
      }
    }
  }
  const path = join(runDir, "publish.json");
  await writeJson(path, record);
  ctx.log(`publish: ${name} ${version} sha256=${packageHash} (${spkgBytes} bytes) -> ${path}`);
  return { record, path };
}
