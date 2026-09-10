import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { PKG_ROOT, REPO_ROOT } from "./helpers.ts";

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

  /**
   * Importing `main` is not enough: the shipped entry point is `bin/streamsmith.js`, which loads src/cli.ts
   * through tsx in a child process. A single `await import(...)` inside cli.ts made tsx's dynamic-import pass
   * throw "Parse error" and the whole CLI unrunnable while every in-process test still passed. So spawn it.
   */
  it("bin/streamsmith.js actually launches and prints usage", () => {
    const r = spawnSync(process.execPath, [join(PKG_ROOT, "bin", "streamsmith.js"), "--help"], { encoding: "utf8", cwd: REPO_ROOT, timeout: 60000 });
    expect(r.stderr, `bin/streamsmith.js failed: ${r.stderr}`).not.toMatch(/Parse error|Transform failed|Cannot find/);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("streamsmith <command> [options]");
    expect(r.stdout).toContain("mcp ");
  }, 60000);

  it("runs a real subcommand end to end in a child process", () => {
    const r = spawnSync(process.execPath, [join(PKG_ROOT, "bin", "streamsmith.js"), "hash", "params", "--root", REPO_ROOT, "--json"], { encoding: "utf8", cwd: REPO_ROOT, timeout: 60000 });
    expect(r.status, r.stderr).toBe(0);
    const j = JSON.parse(r.stdout) as { parametersHash: string; parameters: { vaults: string[] } };
    expect(j.parametersHash).toHaveLength(64);
    expect(j.parameters.vaults).toEqual(["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
  }, 60000);
});
