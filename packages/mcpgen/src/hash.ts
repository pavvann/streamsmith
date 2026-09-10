import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical JSON: keys sorted lexicographically at every level, arrays kept in order, no whitespace,
 * `undefined` members dropped. Same algorithm as packages/streamsmith/src/util/hash.ts so that hashes
 * computed on either side of the receipt agree byte for byte.
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
