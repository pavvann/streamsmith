// Test scaffolding. Real tools are used where they are cheap and side-effect free (`buf`, `substreams info`,
// `substreams pack`); `substreams build` (cargo) and `substreams run` (paid endpoint) are always faked.
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeRunner, ProcessRunner, type Runner, type RunOptions, type RunResult } from "../src/util/exec.ts";
import { createCtx, type Ctx, type FetchLike } from "../src/util/ctx.ts";
import { ContractSchema } from "../src/gate/contract.ts";
import { PROTO_DEPS_DIR, makeContractWorkspace, type FdsJson, type SubstreamsInfo } from "../src/proto/descriptor.ts";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const FIXTURES = join(PKG_ROOT, "fixtures");
/** Local build output (gitignored); tests that need it skip when it is absent. */
export const REAL_SPKG = join(REPO_ROOT, "packages", "erc4626-flows", "erc4626-flows-v0.1.0.spkg");

export async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}
export async function runFixture(name: string): Promise<string> {
  return fixture(join("runs", name));
}
export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const toolCache = new Map<string, Promise<boolean>>();
function probe(cmd: string, args: string[]): Promise<boolean> {
  if (!toolCache.has(cmd)) toolCache.set(cmd, new ProcessRunner().run(cmd, args, { timeoutMs: 15000 }).then((r) => r.code === 0));
  return toolCache.get(cmd)!;
}
export const hasBuf = (): Promise<boolean> => probe("buf", ["--version"]);
export const hasSubstreams = (): Promise<boolean> => probe("substreams", ["--version"]);
export const hasPython3 = (): Promise<boolean> => probe("python3", ["--version"]);

export async function fdsFixture(): Promise<FdsJson> {
  return JSON.parse(await fixture("vaultflows.fds.json")) as FdsJson;
}
export async function schemaFixture(): Promise<ContractSchema> {
  return new ContractSchema(await fdsFixture(), "vaultflows.v1");
}
export async function infoFixture(): Promise<SubstreamsInfo> {
  return JSON.parse(await fixture("substreams-info.json")) as SubstreamsInfo;
}

/** Default fetch for tests: the network is unreachable. */
export const offlineFetch: FetchLike = async () => {
  throw new Error("offline (test)");
};

/** JSON-RPC fake: answers eth_chainId, eth_getTransactionReceipt and eth_call from canned tables. */
export function fakeRpc(opts: { receipts?: Record<string, { blockNumber: number; logs: Array<{ address: string; logIndex: number }> }>; calls?: Record<string, string | { error: string }> } = {}): { fetch: FetchLike; calls: Array<{ method: string; params: unknown[] }> } {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const fetch: FetchLike = async (_url, init) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string; params: unknown[] };
    calls.push({ method: req.method, params: req.params });
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { status: 200 });
    const error = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } }), { status: 200 });
    switch (req.method) {
      case "eth_chainId": return reply("0x2105");
      case "eth_getTransactionReceipt": {
        const r = opts.receipts?.[String(req.params[0]).toLowerCase()];
        if (!r) return reply(null);
        return reply({ blockNumber: "0x" + r.blockNumber.toString(16), logs: r.logs.map((l) => ({ address: l.address, logIndex: "0x" + l.logIndex.toString(16), topics: [] })) });
      }
      case "eth_call": {
        const to = String((req.params[0] as { to: string }).to).toLowerCase();
        const block = Number.parseInt(String(req.params[1]), 16);
        const r = opts.calls?.[`${to}@${block}`];
        if (r === undefined) return error("missing trie node");
        if (typeof r !== "string") return error(r.error);
        return reply("0x" + BigInt(r).toString(16).padStart(64, "0"));
      }
      default: return error(`unsupported ${req.method}`);
    }
  };
  return { fetch, calls };
}

/** Routes some (cmd, args) to the real binary and everything else to a FakeRunner. */
export class HybridRunner implements Runner {
  readonly fake = new FakeRunner();
  private real = new ProcessRunner();
  constructor(private passthrough: (cmd: string, args: string[]) => boolean) {}
  async run(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult> {
    if (this.passthrough(cmd, args)) return this.real.run(cmd, args, opts);
    return this.fake.run(cmd, args, opts);
  }
}

export interface TempRepoOptions {
  /** gate.yaml text; default: the real specs/gate.yaml */
  gateYaml?: string;
  /** run name -> jsonl text; default: fixtures for primary, primary_rerun, observation */
  runs?: Record<string, string>;
  buildFails?: boolean;
  /** build exits 0 but writes no spkg (expectedOutputs missing) */
  buildProducesNothing?: boolean;
  runFails?: string[];
  /** only consulted when the substreams CLI is not installed (fake `substreams info`) */
  infoOverride?: (info: SubstreamsInfo) => void;
  /** stdout to return from `buf convert` instead of running it (renderer self-check tests) */
  fakeBufConvert?: string;
  now?: Date;
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
}

export interface TempRepo {
  root: string;
  pkgDir: string;
  spkgPath: string;
  ctx: Ctx;
  runner: HybridRunner;
  protoSource: string;
  substreamsReal: boolean;
  bufReal: boolean;
  cleanup: () => Promise<void>;
}

export const SPKG_NAME = "erc4626-flows-v0.1.0.spkg";

/** A throwaway repo root: real specs copied in, a stub package dir that `substreams pack` can package, fake build/run. */
export async function makeTempRepo(opts: TempRepoOptions = {}): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), "streamsmith-test-"));
  await mkdir(join(root, "specs"), { recursive: true });
  for (const f of ["vaultflows.proto", "streamsmith.yaml", "receipt.schema.json", "prompt.md"]) await cp(join(REPO_ROOT, "specs", f), join(root, "specs", f));
  await writeFile(join(root, "specs", "gate.yaml"), opts.gateYaml ?? (await readFile(join(REPO_ROOT, "specs", "gate.yaml"), "utf8")));
  for (const f of ["docs/build/contract-notes.md", "packages/erc4626-flows/README.md"]) {
    if (await pathExists(join(REPO_ROOT, f))) {
      await mkdir(dirname(join(root, f)), { recursive: true });
      await cp(join(REPO_ROOT, f), join(root, f));
    }
  }
  const pkgDir = join(root, "packages", "erc4626-flows");
  const protoSource = await readFile(join(root, "specs", "vaultflows.proto"), "utf8");
  await mkdir(join(pkgDir, "proto"), { recursive: true });
  await cp(join(FIXTURES, "substreams.yaml"), join(pkgDir, "substreams.yaml"));
  await writeFile(join(pkgDir, "proto", "vaultflows.proto"), protoSource);
  await cp(join(PROTO_DEPS_DIR, "sf"), join(pkgDir, "proto", "sf"), { recursive: true });
  await writeFile(join(pkgDir, "placeholder.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  const spkgPath = join(pkgDir, SPKG_NAME);
  const wasmOut = join(pkgDir, "target", "wasm32-unknown-unknown", "release", "erc4626_flows.wasm");

  const substreamsReal = await hasSubstreams();
  const bufReal = await hasBuf();
  const runner = new HybridRunner((cmd, args) => {
    if (cmd === "buf") return !(opts.fakeBufConvert !== undefined && args[0] === "convert");
    if (cmd === "substreams" && substreamsReal) return args[0] === "info" || args[0] === "pack" || args[0] === "--version";
    return false;
  });
  const real = new ProcessRunner();

  const produceSpkg = async (): Promise<void> => {
    await mkdir(dirname(wasmOut), { recursive: true });
    await writeFile(wasmOut, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    if (substreamsReal) {
      const r = await real.run("substreams", ["pack", "substreams.yaml", "-o", spkgPath], { cwd: pkgDir, timeoutMs: 120000 });
      if (r.code !== 0) throw new Error(`test setup: substreams pack failed: ${r.stderr}`);
      return;
    }
    if (bufReal) {
      // a FileDescriptorSet binpb is wire-compatible with sf.substreams.v1.Package (proto_files is field 1)
      const work = await makeContractWorkspace([{ name: "vaultflows.proto", source: protoSource }]);
      try {
        const r = await real.run("buf", ["build", ".", "--as-file-descriptor-set", "--exclude-source-info", "-o", spkgPath], { cwd: work, timeoutMs: 120000 });
        if (r.code !== 0) throw new Error(`test setup: buf build failed: ${r.stderr}`);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return;
    }
    await writeFile(spkgPath, "fake-spkg-bytes");
  };

  const info = await infoFixture();
  opts.infoOverride?.(info);
  const runs = opts.runs ?? { primary: await runFixture("primary.jsonl"), primary_rerun: await runFixture("primary.jsonl"), observation: await runFixture("observation.jsonl") };

  runner.fake
    .add({
      match: (c, a) => c === "substreams" && a[0] === "build",
      onCall: async () => { if (!opts.buildFails && !opts.buildProducesNothing) await produceSpkg(); },
      result: opts.buildFails ? { code: 1, stderr: "error[E0425]: cannot find value `x` in this scope" } : { code: 0, stdout: "Package built" },
    })
    .add({ match: (c, a) => c === "substreams" && a[0] === "info", result: { code: 0, stdout: JSON.stringify(info) } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "pack", onCall: async (_c, a) => { const o = a.indexOf("-o"); await mkdir(dirname(a[o + 1]!), { recursive: true }); await writeFile(a[o + 1]!, "fake-spkg-bytes"); } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "registry" && a[1] === "publish", result: { code: 0, stdout: "Published https://substreams.dev/packages/erc4626-flows/v0.1.0" } })
    .add({ match: (c, a) => c === "substreams" && a[0] === "--version", result: { code: 0, stdout: "substreams version 1.22.0 (Commit be35ad3)" } })
    .add({ match: (c, a) => c === "buf" && a[0] === "convert", result: { code: 0, stdout: opts.fakeBufConvert ?? "" } })
    .add({ match: (c, a) => c === "git" && a[0] === "rev-parse", result: { code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n" } })
    .add({ match: (c, a) => c === "git" && a[0] === "status", result: { code: 0, stdout: "" } })
    .add({ match: (c, a) => c === "git" && a[0] === "tag", result: { code: 0, stdout: "v0.1.0-run\n" } });
  for (const [name, content] of Object.entries(runs)) {
    runner.fake.add({
      match: (c, a, o) => c === "substreams" && a[0] === "run" && basename(o.stdoutFile ?? "") === `${name}.jsonl`,
      stdoutFileContent: content,
      result: opts.runFails?.includes(name) ? { code: 1, stderr: "rpc error: code = Unauthenticated desc = no authorization" } : { code: 0 },
    });
  }
  runner.fake
    .add({ match: (c, a) => c === "substreams" && a[0] === "run", stdoutFileContent: "", result: { code: 0 } })
    .add({ match: (_c, a) => a[0] === "--version", result: { code: 0, stdout: "fake 1.0.0" } });

  const ctx = await createCtx({
    root,
    runner,
    log: () => {},
    now: () => opts.now ?? new Date("2026-09-11T10:00:00Z"),
    sleep: async () => {},
    env: opts.env ?? { PATH: process.env.PATH, HOME: process.env.HOME },
    fetch: opts.fetch ?? offlineFetch,
  });
  return { root, pkgDir, spkgPath, ctx, runner, protoSource, substreamsReal, bufReal, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export { FakeRunner };
