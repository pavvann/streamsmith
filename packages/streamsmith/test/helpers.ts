import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeRunner, ProcessRunner, type Runner, type RunOptions, type RunResult } from "../src/util/exec.ts";
import { createCtx, type Ctx } from "../src/util/ctx.ts";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const FIXTURES = join(PKG_ROOT, "fixtures");

export async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

export async function hasBuf(): Promise<boolean> {
  const r = await new ProcessRunner().run("buf", ["--version"], { timeoutMs: 10000 });
  return r.code === 0;
}

/** Fake `substreams`/`cargo`/`git`/version probes; pass `buf` through to the real binary. */
export class HybridRunner implements Runner {
  readonly fake = new FakeRunner();
  private real = new ProcessRunner();
  constructor(private passthrough: string[] = ["buf"]) {}
  async run(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult> {
    if (this.passthrough.includes(cmd)) return this.real.run(cmd, args, opts);
    return this.fake.run(cmd, args, opts);
  }
}

export interface TempRepo {
  root: string;
  ctx: Ctx;
  runner: HybridRunner;
  protoSource: string;
  cleanup: () => Promise<void>;
}

/** A throwaway repo root with real specs copied in, the fixture gate.yaml, and a stub package dir. */
export async function makeTempRepo(opts: { gateYaml?: string; jsonl?: Record<string, string>; buildFails?: boolean; runFails?: string[]; infoOverride?: (info: Record<string, unknown>) => void; now?: Date } = {}): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), "streamsmith-test-"));
  await mkdir(join(root, "specs"), { recursive: true });
  for (const f of ["vaultflows.proto", "streamsmith.yaml", "receipt.schema.json", "prompt.md"]) await cp(join(REPO_ROOT, "specs", f), join(root, "specs", f));
  await writeFile(join(root, "specs", "gate.yaml"), opts.gateYaml ?? (await fixture("gate.yaml")));
  const pkgDir = join(root, "packages", "erc4626-flows");
  await mkdir(join(pkgDir, "proto"), { recursive: true });
  await cp(join(FIXTURES, "substreams.yaml"), join(pkgDir, "substreams.yaml"));
  const protoSource = await readFile(join(root, "specs", "vaultflows.proto"), "utf8");
  await writeFile(join(pkgDir, "proto", "vaultflows.proto"), protoSource);
  const runner = new HybridRunner();
  const info: Record<string, unknown> = {
    name: "erc4626-flows",
    version: "v0.1.0",
    network: "base",
    modules: [{ name: "map_events", kind: "map", output_type: "proto:vaultflows.v1.Events", initial_block: 49276800, hash: "deadbeef00000000000000000000000000000000" }],
    proto_packages: ["vaultflows.v1", "schema"],
    proto_source_code: { "vaultflows.v1": [{ filename: "proto/vaultflows.proto", source: protoSource }] },
  };
  opts.infoOverride?.(info);
  runner.fake
    .add({ match: (c, a) => c === "substreams" && a[0] === "build", result: opts.buildFails ? { code: 1, stderr: "error[E0425]: cannot find value `x`" } : { code: 0, stdout: "built" } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "info", result: { code: 0, stdout: JSON.stringify(info) } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "pack", onCall: async (_c, a) => { const o = a.indexOf("-o"); await writeFile(a[o + 1]!, "fake-spkg-bytes"); } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "registry" && a[1] === "publish", result: { code: 0, stdout: "Published https://substreams.dev/packages/erc4626-flows/v0.1.0" } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "--version", result: { code: 0, stdout: "substreams version 1.22.0 (Commit be35ad3)" } })
    .add({ match: (c, a) => c === "git" && a[0] === "rev-parse", result: { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n" } })
    .add({ match: (c, a) => c === "git" && a[0] === "status", result: { code: 0, stdout: "" } })
    .add({ match: (c, a) => c === "git" && a[0] === "tag", result: { code: 0, stdout: "v0.1.0-run\n" } })
    .add({ match: (c, a) => a[0] === "--version", result: { code: 0, stdout: "fake 1.0.0" } });
  const jsonl = opts.jsonl ?? { primary: await fixture("primary.jsonl"), rerun: await fixture("rerun.jsonl") };
  for (const [name, content] of Object.entries(jsonl)) {
    runner.fake.add({
      match: (c, a) => c === "substreams" && a[0] === "run" && a.includes("-o") && (a.includes("-s") ? true : false) && a.join(" ").includes(name.length ? "" : "") && matchesRun(a, name),
      stdoutFileContent: content,
      result: opts.runFails?.includes(name) ? { code: 1, stderr: "rpc error: code = Unauthenticated" } : { code: 0 },
    });
  }
  const ctx = await createCtx({ root, runner, log: () => {}, now: () => opts.now ?? new Date("2026-09-11T10:00:00Z"), sleep: async () => {}, env: { PATH: process.env.PATH } });
  return { root, ctx, runner, protoSource, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// The run name is only visible through the stdoutFile path (runs/<id>/<name>.jsonl); FakeRunner receives opts so
// we key on it via a closure-free trick: match all `run` calls and let onCall pick the right content.
function matchesRun(_args: string[], _name: string): boolean {
  return true;
}

export { FakeRunner };
