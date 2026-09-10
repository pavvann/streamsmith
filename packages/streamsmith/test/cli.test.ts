import { describe, it, expect } from "vitest";
import { main } from "../src/cli.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("cli", () => {
  it("prints usage and exits 1 without a command", async () => {
    const write = process.stdout.write.bind(process.stdout);
    let captured = "";
    process.stdout.write = ((chunk: string | Uint8Array) => { captured += String(chunk); return true; }) as typeof process.stdout.write;
    try {
      expect(await main([])).toBe(1);
      expect(captured).toContain("streamsmith <command>");
      captured = "";
      expect(await main(["hash", "params", "--root", REPO_ROOT, "--json"])).toBe(0);
      const j = JSON.parse(captured);
      expect(j.parametersHash).toHaveLength(64);
      expect(j.parameters.chainId).toBe(8453);
    } finally {
      process.stdout.write = write;
    }
  });
  it("rejects unknown commands", async () => {
    const err = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(await main(["bogus", "--root", REPO_ROOT])).toBe(1);
    } finally {
      process.stderr.write = err;
    }
  });
});
