// Run manifest (PROJECT.md §5): startingCommit, promptHash, startedAt, toolVersions, endingCommit, receiptHash.
import { join } from "node:path";
import type { Ctx } from "./util/ctx.ts";
import { paths } from "./util/ctx.ts";
import { exists, readJson, readText, writeJson } from "./util/fsx.ts";
import { sha256Hex, sha256File } from "./util/hash.ts";
import { collectToolVersions, gitRevParse, gitStatusPorcelain, gitTagsAtHead } from "./util/tools.ts";
import { loadReceipt, receiptHash } from "./receipt.ts";

export interface RunManifest {
  manifestVersion: 1;
  runId: string;
  startingCommit?: string;
  startingTags?: string[];
  startingTreeClean?: boolean;
  promptPath: string;
  promptHash: string;
  specHashes: Record<string, string>;
  startedAt: string;
  toolVersions: Record<string, string>;
  endingCommit?: string;
  endingTreeClean?: boolean;
  finishedAt?: string;
  receiptPath?: string;
  receiptHash?: string;
  gateStatus?: string;
  gateJsonHash?: string;
  publishJsonHash?: string;
  deployJsonHash?: string;
  recordingPath?: string;
  recordingSha256?: string;
  notes?: string[];
}

const SPEC_FILES = ["specs/streamsmith.yaml", "specs/gate.yaml", "specs/vaultflows.proto", "specs/receipt.schema.json", "specs/prompt.md"];

export async function manifestStart(ctx: Ctx, opts: { runId: string; promptPath?: string }): Promise<{ manifest: RunManifest; path: string }> {
  const promptRel = opts.promptPath ?? "specs/prompt.md";
  const promptAbs = join(ctx.root, promptRel);
  if (!(await exists(promptAbs))) throw new Error(`prompt file not found: ${promptRel}`);
  const specHashes: Record<string, string> = {};
  for (const f of SPEC_FILES) if (await exists(join(ctx.root, f))) specHashes[f] = await sha256File(join(ctx.root, f));
  const manifest: RunManifest = {
    manifestVersion: 1,
    runId: opts.runId,
    promptPath: promptRel,
    promptHash: sha256Hex(await readText(promptAbs)),
    specHashes,
    startedAt: ctx.now().toISOString(),
    toolVersions: await collectToolVersions(ctx),
  };
  const commit = await gitRevParse(ctx);
  if (commit) manifest.startingCommit = commit;
  const tags = await gitTagsAtHead(ctx);
  if (tags.length) manifest.startingTags = tags;
  const status = await gitStatusPorcelain(ctx);
  if (status !== undefined) manifest.startingTreeClean = status.trim() === "";
  const path = paths.runs(ctx, opts.runId, "manifest.json");
  await writeJson(path, manifest);
  return { manifest, path };
}

export async function manifestFinish(ctx: Ctx, opts: { runId: string; receiptPath?: string; recordingPath?: string }): Promise<{ manifest: RunManifest; path: string }> {
  const path = paths.runs(ctx, opts.runId, "manifest.json");
  if (!(await exists(path))) throw new Error(`manifest not started for run ${opts.runId} (run \`streamsmith manifest start\` first)`);
  const manifest = await readJson<RunManifest>(path);
  manifest.finishedAt = ctx.now().toISOString();
  const commit = await gitRevParse(ctx);
  if (commit) manifest.endingCommit = commit;
  const status = await gitStatusPorcelain(ctx);
  if (status !== undefined) manifest.endingTreeClean = status.trim() === "";
  if (opts.receiptPath) {
    const abs = join(ctx.root, opts.receiptPath);
    const receipt = await loadReceipt((await exists(abs)) ? abs : opts.receiptPath);
    manifest.receiptPath = opts.receiptPath;
    manifest.receiptHash = receiptHash(receipt);
  }
  for (const [key, file] of [["gateJsonHash", "gate.json"], ["publishJsonHash", "publish.json"], ["deployJsonHash", "deploy.json"]] as const) {
    const p = paths.runs(ctx, opts.runId, file);
    if (await exists(p)) manifest[key] = await sha256File(p);
  }
  const gatePath = paths.runs(ctx, opts.runId, "gate.json");
  if (await exists(gatePath)) manifest.gateStatus = (await readJson<{ status?: string }>(gatePath)).status;
  if (opts.recordingPath) {
    manifest.recordingPath = opts.recordingPath;
    manifest.recordingSha256 = await sha256File(join(ctx.root, opts.recordingPath));
  }
  await writeJson(path, manifest);
  return { manifest, path };
}
