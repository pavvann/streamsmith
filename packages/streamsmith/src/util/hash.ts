import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  return sha256Hex(await readFile(path));
}

/**
 * Canonical JSON: object keys sorted lexicographically at every level, no whitespace, arrays kept in
 * order. Numbers are emitted with JSON.stringify semantics (no -0, no NaN). Used for every hash that
 * is computed over structured data (parametersHash, manifest hashes, receipt hash).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256Canonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
