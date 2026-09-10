import { describe, it, expect, beforeAll } from "vitest";
import { parseJsonl, type ParsedRun } from "../src/gate/jsonl.ts";
import { evaluateAssertion, type AssertionInputs } from "../src/gate/assertions.ts";
import { fixture } from "./helpers.ts";

const VAULTS = ["0x050ce30b927da55177a4914ec73480238bad56f0", "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"];
let good: ParsedRun, rerun: ParsedRun, diverged: ParsedRun, bad: ParsedRun, empty: ParsedRun;
beforeAll(async () => {
  good = parseJsonl(await fixture("primary.jsonl"));
  rerun = parseJsonl(await fixture("rerun.jsonl"));
  diverged = parseJsonl(await fixture("rerun-diverged.jsonl"));
  bad = parseJsonl(await fixture("bad.jsonl"));
  empty = parseJsonl("");
});
const inputs = (runs: Record<string, ParsedRun>, extra: Partial<AssertionInputs> = {}): AssertionInputs => ({ runs, defaultRun: Object.keys(runs)[0]!, configuredVaults: VAULTS, sampleIntervalBlocks: 1800, ...extra });

describe("assertion evaluators", () => {
  it("rows_gt", () => {
    expect(evaluateAssertion({ kind: "rows_gt", name: "r", table: "vault_flows", value: 0 }, inputs({ p: good })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "rows_gt", name: "r", table: "vault_flows", value: 2 }, inputs({ p: good })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "rows_gt", name: "r", value: 0 }, inputs({ p: empty })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "rows_gt", name: "r", value: 0 }, inputs({ p: good })).detail).toMatch(/vault_flows=2/);
  });
  it("known_vault_present", () => {
    expect(evaluateAssertion({ kind: "known_vault_present", name: "k" }, inputs({ p: good })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "known_vault_present", name: "k", requireAll: true }, inputs({ p: good })).passed).toBe(true);
    const r = evaluateAssertion({ kind: "known_vault_present", name: "k" }, inputs({ p: bad }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/0\/2 configured vaults/);
    expect(evaluateAssertion({ kind: "known_vault_present", name: "k", vault: "0x9999999999999999999999999999999999999999" }, inputs({ p: bad })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "known_vault_present", name: "k" }, inputs({ p: good }, { configuredVaults: [] })).passed).toBe(false);
  });
  it("observation_present", () => {
    expect(evaluateAssertion({ kind: "observation_present", name: "o" }, inputs({ p: good })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "observation_present", name: "o", vault: VAULTS[1]!, minCount: 1 }, inputs({ p: good })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "observation_present", name: "o", minCount: 3 }, inputs({ p: good })).passed).toBe(false);
    const offGrid = evaluateAssertion({ kind: "observation_present", name: "o" }, inputs({ p: bad }));
    expect(offGrid.passed).toBe(false);
    expect(offGrid.detail).toMatch(/not on the 1800-block grid/);
    expect(evaluateAssertion({ kind: "observation_present", name: "o" }, inputs({ p: empty })).passed).toBe(false);
  });
  it("execution_rate_sanity", () => {
    expect(evaluateAssertion({ kind: "execution_rate_sanity", name: "e", min: 0.5, max: 2 }, inputs({ p: good })).passed).toBe(true);
    const r = evaluateAssertion({ kind: "execution_rate_sanity", name: "e", min: 0.5, max: 2 }, inputs({ p: bad }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/execution_rate 5.0 outside/);
    expect(r.detail).toMatch(/!= assets_normalized\/shares_normalized/);
    expect(evaluateAssertion({ kind: "execution_rate_sanity", name: "e" }, inputs({ p: empty })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "execution_rate_sanity", name: "e", allowEmpty: true }, inputs({ p: empty })).passed).toBe(true);
  });
  it("rpc_success_ratio_gte", () => {
    const ok = evaluateAssertion({ kind: "rpc_success_ratio_gte", name: "rpc", value: 0.99 }, inputs({ p: good }));
    expect(ok.passed).toBe(true);
    expect(ok.detail).toMatch(/6\/6 call units ok/);
    const fail = evaluateAssertion({ kind: "rpc_success_ratio_gte", name: "rpc", value: 0.99 }, inputs({ p: bad }));
    expect(fail.passed).toBe(false);
    expect(fail.detail).toMatch(/asset: reverted/);
    expect(evaluateAssertion({ kind: "rpc_success_ratio_gte", name: "rpc", value: 0.5 }, inputs({ p: empty })).passed).toBe(false);
  });
  it("deterministic_rerun", () => {
    expect(evaluateAssertion({ kind: "deterministic_rerun", name: "d", runs: ["a", "b"] }, inputs({ a: good, b: rerun })).passed).toBe(true);
    const r = evaluateAssertion({ kind: "deterministic_rerun", name: "d", runs: ["a", "b"] }, inputs({ a: good, b: diverged }));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/vault_flows: row #\d+ differs/);
    expect(evaluateAssertion({ kind: "deterministic_rerun", name: "d", runs: ["a", "b"] }, inputs({ a: empty, b: empty })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "deterministic_rerun", name: "d", runs: ["a", "missing"] }, inputs({ a: good })).passed).toBe(false);
  });
  it("descriptor_hash_match", () => {
    const ev = { contract: "specs/vaultflows.proto", expectedHash: "aa", actualHash: "aa", actualSource: "x.spkg" };
    expect(evaluateAssertion({ kind: "descriptor_hash_match", name: "h" }, inputs({ p: good }, { descriptor: ev })).passed).toBe(true);
    expect(evaluateAssertion({ kind: "descriptor_hash_match", name: "h" }, inputs({ p: good }, { descriptor: { ...ev, actualHash: "bb" } })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "descriptor_hash_match", name: "h", expectedHash: "cc" }, inputs({ p: good }, { descriptor: ev })).detail).toMatch(/public contract changed/);
    expect(evaluateAssertion({ kind: "descriptor_hash_match", name: "h" }, inputs({ p: good })).passed).toBe(false);
    expect(evaluateAssertion({ kind: "descriptor_hash_match", name: "h" }, inputs({ p: good }, { descriptor: { ...ev, error: "buf missing" } })).detail).toMatch(/buf missing/);
  });
  it("reports a missing run instead of throwing", () => {
    expect(evaluateAssertion({ kind: "rows_gt", name: "r", run: "nope" }, inputs({ p: good })).detail).toMatch(/has no output/);
  });
});
