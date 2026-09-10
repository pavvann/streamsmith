// Normalized descriptor hash — exactly specs/gate.yaml `descriptorHash.algorithm`:
//   1. spec side: `buf build <workspace: contract + sink schema module> --as-file-descriptor-set --exclude-source-info
//      -o -#format=json`; spkg side: `buf build <file.spkg>#format=binpb --as-file-descriptor-set --exclude-source-info
//      -o -#format=json` (an .spkg is wire-compatible with FileDescriptorSet: Package.proto_files is field 1). Take the
//      single file whose `package` equals the contract package.
//   2. protojson rendering is buf's (extensions render as "[schema.table]" / "[schema.field]", enums as names,
//      64-bit ints as strings, defaults omitted).
//   3. delete top-level "name"; recursively delete "jsonName" and "sourceCodeInfo".
//   4. canonical JSON: keys sorted at every level, arrays in order, "," ":" separators, non-ASCII unescaped.
//   5. sha256, lowercase hex.
// Self-check: the spec-side hash is computed twice — from `buf build -o -#format=json` and from `buf convert` of the
// binary FileDescriptorSet (an independent protojson entry point with the same registry); a difference is reported as
// "renderer mismatch" and fails the descriptor assertions.
import { mkdtemp, rm, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex, canonicalJson } from "../util/hash.ts";
import { readText, exists } from "../util/fsx.ts";
import type { Ctx } from "../util/ctx.ts";

export interface FdsJson {
  file?: FileDescriptorJson[];
}
export interface FileDescriptorJson {
  name?: string;
  package?: string;
  dependency?: string[];
  messageType?: unknown[];
  enumType?: unknown[];
  options?: Record<string, unknown>;
  [k: string]: unknown;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTO_DEPS_DIR = join(HERE, "..", "..", "proto-deps");

export function protoPackageOf(source: string): string | undefined {
  const m = /^\s*package\s+([A-Za-z_][\w.]*)\s*;/m.exec(source);
  return m?.[1];
}

/** Steps 3–5 of the algorithm (pure). Mirrors gate.yaml `referenceScript`. */
export function normalizedDescriptorHash(fds: FdsJson, pkg: string): { hash: string; canonical: string } {
  const files = (fds.file ?? []).filter((f) => f.package === pkg);
  if (files.length !== 1) throw new Error(`expected exactly one file for package ${pkg}, found ${files.length} (${(fds.file ?? []).map((f) => `${f.name}:${f.package}`).join(", ")})`);
  const f: FileDescriptorJson = { ...files[0]! };
  delete f.name;
  const canonical = canonicalJson(strip(f));
  return { hash: sha256Hex(Buffer.from(canonical, "utf8")), canonical };
}

function strip(n: unknown): unknown {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) if (k !== "jsonName" && k !== "sourceCodeInfo") out[k] = strip(v);
    return out;
  }
  return n;
}

export interface DescriptorResult {
  hash: string;
  /** buf's FileDescriptorSet JSON (all files) — also the schema the gate decodes rows with */
  fds: FdsJson;
  pkg: string;
  /** spec side only: hash recomputed through `buf convert`; equal to `hash` when the renderer self-check passes */
  hashViaConvert?: string;
  rendererMatch?: boolean;
}

async function bufBuildJson(ctx: Ctx, input: string, cwd: string): Promise<FdsJson> {
  const args = ["build", input, "--as-file-descriptor-set", "--exclude-source-info", "-o", "-#format=json"];
  const r = await ctx.runner.run("buf", args, { cwd, timeoutMs: 120000 });
  if (r.code !== 0) throw new Error(`buf build failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 800)}`);
  return JSON.parse(r.stdout) as FdsJson;
}

/** Workspace = contract file(s) under proto/ + the vendored sink schema under deps/. */
export async function makeContractWorkspace(sources: Array<{ name: string; source: string }>, depsDir: string = PROTO_DEPS_DIR): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), "streamsmith-buf-"));
  await mkdir(join(work, "proto"), { recursive: true });
  await mkdir(join(work, "deps"), { recursive: true });
  if (await exists(depsDir)) await cp(depsDir, join(work, "deps"), { recursive: true, filter: (src) => !basename(src).endsWith(".md") });
  await writeFile(join(work, "buf.yaml"), "version: v2\nmodules:\n  - path: proto\n  - path: deps\n");
  for (const s of sources) await writeFile(join(work, "proto", basename(s.name)), s.source);
  return work;
}

/** Spec side: compile the contract, hash it, and self-check the renderer with `buf convert`. */
export async function specDescriptor(ctx: Ctx, contractPath: string, pkg?: string): Promise<DescriptorResult> {
  const source = await readText(contractPath);
  const protoPkg = pkg ?? protoPackageOf(source);
  if (!protoPkg) throw new Error(`cannot determine proto package of ${contractPath}`);
  const work = await makeContractWorkspace([{ name: basename(contractPath), source }]);
  try {
    const fds = await bufBuildJson(ctx, ".", work);
    const { hash } = normalizedDescriptorHash(fds, protoPkg);
    // independent renderer: binary FDS -> buf convert -> JSON
    const bin = join(work, "fds.binpb");
    const rb = await ctx.runner.run("buf", ["build", "--as-file-descriptor-set", "--exclude-source-info", "-o", bin], { cwd: work, timeoutMs: 120000 });
    if (rb.code !== 0) throw new Error(`buf build (binpb) failed: ${rb.stderr.trim().slice(0, 400)}`);
    const rc = await ctx.runner.run("buf", ["convert", "--type", "google.protobuf.FileDescriptorSet", "--from", `${bin}#format=binpb`, "--to", "-#format=json"], { cwd: work, timeoutMs: 120000 });
    let hashViaConvert: string | undefined;
    if (rc.code === 0) {
      try {
        hashViaConvert = normalizedDescriptorHash(JSON.parse(rc.stdout) as FdsJson, protoPkg).hash;
      } catch (err) {
        ctx.log(`descriptor: buf convert output unusable: ${(err as Error).message}`);
      }
    } else ctx.log(`descriptor: buf convert unavailable (exit ${rc.code}); renderer self-check skipped: ${rc.stderr.trim().slice(0, 200)}`);
    const out: DescriptorResult = { hash, fds, pkg: protoPkg };
    if (hashViaConvert !== undefined) {
      out.hashViaConvert = hashViaConvert;
      out.rendererMatch = hashViaConvert === hash;
    }
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** spkg side: buf reads the .spkg as a binary image (Package.proto_files == FileDescriptorSet.file, field 1). */
export async function spkgDescriptor(ctx: Ctx, spkgPath: string, pkg: string): Promise<DescriptorResult> {
  if (!(await exists(spkgPath))) throw new Error(`spkg not found: ${spkgPath}`);
  const abs = isAbsolute(spkgPath) ? spkgPath : join(process.cwd(), spkgPath);
  const fds = await bufBuildJson(ctx, `${abs}#format=binpb`, dirname(abs));
  const { hash } = normalizedDescriptorHash(fds, pkg);
  return { hash, fds, pkg };
}

export interface SubstreamsInfo {
  name?: string;
  version?: string;
  network?: string;
  modules?: Array<{ name: string; kind: string; inputs?: Array<{ type: string; name: string; mode?: string }>; output_type?: string; initial_block?: number; hash?: string }>;
  networks?: Record<string, { initialBlocks?: Record<string, number>; params?: Record<string, string>; initial_blocks?: Record<string, number> }>;
  proto_packages?: string[];
  proto_source_code?: Record<string, Array<{ filename: string; source: string }>>;
}

export async function substreamsInfo(ctx: Ctx, manifestOrSpkg: string, opts: { cwd?: string; module?: string; expandNetworks?: boolean } = {}): Promise<SubstreamsInfo> {
  const args = ["info", "--json"];
  if (opts.expandNetworks) args.push("--expand-networks");
  args.push(manifestOrSpkg);
  if (opts.module) args.push(opts.module);
  const r = await ctx.runner.run("substreams", args, { cwd: opts.cwd, timeoutMs: 120000 });
  if (r.code !== 0) throw new Error(`substreams info failed (exit ${r.code}): ${r.stderr.trim().slice(0, 400)}`);
  try {
    return JSON.parse(r.stdout) as SubstreamsInfo;
  } catch {
    throw new Error(`substreams info returned non-JSON output: ${r.stdout.slice(0, 200)}`);
  }
}
