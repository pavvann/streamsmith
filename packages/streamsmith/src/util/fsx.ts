import { mkdir, readFile, writeFile, access, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { constants } from "node:fs";

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // bare JSON.parse errors ("Unexpected end of JSON input") don't name the offending file, which turns a
    // truncated/corrupt cache file (e.g. deploy.json from a crashed writer) into a confusing crash — name it.
    throw new Error(`invalid JSON in ${path}${text === "" ? " (empty file)" : ""}: ${(err as Error).message}`);
  }
}

/**
 * Best-effort JSON read for cache/record files a caller can recompute from a live source: returns the parsed
 * value, or `{}` when the file is absent, or `{ error }` (the file's content dropped) when it exists but is not
 * valid JSON — a corrupt `deploy.json` should degrade `deploy status` to "recompute from ClickHouse + RPC",
 * not crash the whole command with a raw JSON.parse error.
 */
export async function readJsonLenient<T = unknown>(path: string): Promise<{ value?: T; error?: string }> {
  if (!(await exists(path))) return {};
  try {
    return { value: await readJson<T>(path) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/**
 * Repo root: `--root`, then STREAMSMITH_ROOT, then walk up from cwd looking for specs/streamsmith.yaml
 * (falls back to pnpm-workspace.yaml / .git).
 */
export async function findRepoRoot(start: string = process.cwd(), explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  if (process.env.STREAMSMITH_ROOT) return resolve(process.env.STREAMSMITH_ROOT);
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (await exists(join(dir, "specs", "streamsmith.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if ((await exists(join(dir, "pnpm-workspace.yaml"))) || (await exists(join(dir, ".git")))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function newRunId(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${iso}-${rand}`;
}
