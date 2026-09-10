import { ProcessRunner, type Runner } from "./exec.ts";
import { findRepoRoot } from "./fsx.ts";
import { join } from "node:path";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Everything with a side effect is reachable only through the context, so tests can substitute it. */
export interface Ctx {
  root: string;
  runner: Runner;
  fetch: FetchLike;
  now: () => Date;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  /** Sleep hook (poll loops); tests set this to a no-op. */
  sleep: (ms: number) => Promise<void>;
}

export interface CtxOverrides {
  root?: string;
  runner?: Runner;
  fetch?: FetchLike;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function createCtx(over: CtxOverrides = {}): Promise<Ctx> {
  const root = over.root ?? (await findRepoRoot(process.cwd()));
  return {
    root,
    runner: over.runner ?? new ProcessRunner(),
    fetch: over.fetch ?? ((input, init) => fetch(input, init)),
    now: over.now ?? (() => new Date()),
    env: over.env ?? process.env,
    log: over.log ?? ((line) => process.stderr.write(line + "\n")),
    sleep: over.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}

export const paths = {
  specs: (ctx: Ctx, ...p: string[]) => join(ctx.root, "specs", ...p),
  runs: (ctx: Ctx, runId: string, ...p: string[]) => join(ctx.root, "runs", runId, ...p),
  receipts: (ctx: Ctx, ...p: string[]) => join(ctx.root, "receipts", ...p),
  caseStudies: (ctx: Ctx, ...p: string[]) => join(ctx.root, "case-studies", ...p),
};
