import type { Ctx } from "./ctx.ts";

/** Best-effort `--version` capture for the tool set that shaped a run. Missing tools are recorded as "missing". */
export async function collectToolVersions(ctx: Ctx, extra: Array<[string, string[]]> = []): Promise<Record<string, string>> {
  const probes: Array<[string, string, string[]]> = [
    ["substreams", "substreams", ["--version"]],
    ["buf", "buf", ["--version"]],
    ["substreams-sink-sql", "substreams-sink-sql", ["--version"]],
    ["cargo", "cargo", ["--version"]],
    ["rustc", "rustc", ["--version"]],
    ["node", process.execPath, ["--version"]],
    ["pnpm", "pnpm", ["--version"]],
    ...extra.map(([name, args]): [string, string, string[]] => [name, name, args]),
  ];
  const out: Record<string, string> = {};
  for (const [name, cmd, args] of probes) {
    const r = await ctx.runner.run(cmd, args, { timeoutMs: 15000 });
    const text = (r.stdout || r.stderr).trim().split("\n")[0] ?? "";
    out[name] = r.code === 0 && text ? text : "missing";
  }
  return out;
}

export async function gitRevParse(ctx: Ctx, ref = "HEAD"): Promise<string | undefined> {
  const r = await ctx.runner.run("git", ["rev-parse", ref], { cwd: ctx.root, timeoutMs: 10000 });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export async function gitStatusPorcelain(ctx: Ctx): Promise<string | undefined> {
  const r = await ctx.runner.run("git", ["status", "--porcelain"], { cwd: ctx.root, timeoutMs: 10000 });
  return r.code === 0 ? r.stdout : undefined;
}

export async function gitTagsAtHead(ctx: Ctx): Promise<string[]> {
  const r = await ctx.runner.run("git", ["tag", "--points-at", "HEAD"], { cwd: ctx.root, timeoutMs: 10000 });
  return r.code === 0 ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}
