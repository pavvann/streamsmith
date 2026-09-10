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
  return JSON.parse(await readFile(path, "utf8")) as T;
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
