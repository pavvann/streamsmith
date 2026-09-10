import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { decodeRun, type ParsedRun } from "../src/gate/jsonl.ts";
import { evaluateAssertions, exitStatus, type AssertionInputs, type DescriptorEvidence } from "../src/gate/assertions.ts";
import { loadGateConfig, type GateConfig, type AssertionSpec } from "../src/config/gate.ts";
import { loadStreamsmithConfig, type StreamsmithConfig } from "../src/config/streamsmith.ts";
import type { ContractSchema } from "../src/gate/contract.ts";
import type { RpcEvidence } from "../src/gate/rpc.ts";
import { runFixture, schemaFixture, infoFixture, REPO_ROOT } from "./helpers.ts";
import type { SubstreamsInfo } from "../src/proto/descriptor.ts";

let SPEC: string; // specs/gate.yaml descriptorHash.expectedSpecSha256 — read, never hardcoded
const G = "0x050ce30b927da55177a4914ec73480238bad56f0";
const STK = "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9";

let gate: GateConfig, ss: StreamsmithConfig, schema: ContractSchema, info: SubstreamsInfo;
const texts: Record<string, string> = {};
const runs: Record<string, ParsedRun> = {};
beforeAll(async () => {
  gate = await loadGateConfig(join(REPO_ROOT, "specs", "gate.yaml"));
  SPEC = gate.expectedSpecSha256!;
  ss = await loadStreamsmithConfig(join(REPO_ROOT, "specs", "streamsmith.yaml"));
  schema = await schemaFixture();
  info = await infoFixture();
  for (const f of ["primary", "observation", "bad-primary", "bad-observation", "diverged-rerun", "legacy-call-status", "vaults-only"]) {
    texts[f] = await runFixture(`${f}.jsonl`);
    runs[f] = decodeRun(f, texts[f]!, { schema, rootType: "vaultflows.v1.Events", module: "map_events" });
  }
});

const descriptorOk = (): DescriptorEvidence => ({ contract: "specs/vaultflows.proto", protoPackage: "vaultflows.v1", specHash: SPEC, specHashViaConvert: SPEC, rendererMatch: true, expectedSpecSha256: SPEC, spkgPath: "x.spkg", spkgHash: SPEC });
const files = { "specs/vaultflows.proto": "clean", "specs/streamsmith.yaml": "clean", "specs/gate.yaml": "clean", "docs/build/contract-notes.md": "clean", "packages/erc4626-flows/substreams.yaml": "clean", "packages/erc4626-flows/README.md": undefined };

function inputs(map: Record<string, string>, extra: Partial<AssertionInputs> = {}): AssertionInputs {
  const r: Record<string, ParsedRun> = {};
  const t: Record<string, string> = {};
  for (const [runName, fixtureName] of Object.entries(map)) {
    r[runName] = runs[fixtureName]!;
    t[runName] = texts[fixtureName]!;
  }
  return { gate, streamsmith: ss, schema, rootType: "vaultflows.v1.Events", runs: r, runTexts: t, descriptor: descriptorOk(), spkgInfo: info, files, configuredVaults: gate.configuredVaults, ...extra };
}
const GOOD = { primary: "primary", primary_rerun: "primary", observation: "observation" };
const BAD = { primary: "bad-primary", primary_rerun: "bad-primary", observation: "bad-observation" };
const spec = (name: string): AssertionSpec => gate.assertions.find((a) => a.name === name)!;
const one = (name: string, i: AssertionInputs) => evaluateAssertions([spec(name)], i)[0]!;

describe("every assertion in specs/gate.yaml has an evaluator", () => {
  it("all 18 pass on fixtures built from the file's own reference rows", () => {
    const results = evaluateAssertions(gate.assertions, inputs(GOOD));
    expect(results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.detail}`)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(gate.assertions.map((a) => a.name));
    expect(results.filter((r) => r.severity === "warn")).toHaveLength(2);
    expect(exitStatus(results)).toMatchObject({ passed: true, failed: [], warned: [] });
  });

  it("refuses unknown kinds instead of skipping them", () => {
    const r = evaluateAssertions([{ name: "x", kind: "bogus", severity: "fail", raw: {} }], inputs(GOOD))[0]!;
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/unsupported assertion kind "bogus"/);
  });

  it("spec_unmodified / descriptor_hash_match compare the normalized hashes and honour the renderer self-check", () => {
    expect(one("spec_unmodified", inputs(GOOD)).detail).toMatch(new RegExp(`^match: specs/vaultflows.proto normalized descriptor sha256 ${SPEC} vs expected ${SPEC} \\(renderer self-check ok\\)$`));
    expect(one("spec_unmodified", inputs(GOOD, { descriptor: { ...descriptorOk(), specHash: "ab" } }))).toMatchObject({ passed: false });
    expect(one("descriptor_hash_match", inputs(GOOD, { descriptor: { ...descriptorOk(), spkgHash: "ab" } })).detail).toMatch(/MISMATCH/);
    expect(one("descriptor_hash_match", inputs(GOOD, { descriptor: { ...descriptorOk(), spkgHash: undefined } })).detail).toMatch(/no spkg-side hash/);
    expect(one("descriptor_hash_match", inputs(GOOD, { descriptor: { ...descriptorOk(), rendererMatch: false } })).detail).toBe("renderer mismatch");
    expect(one("spec_unmodified", inputs(GOOD, { descriptor: { ...descriptorOk(), error: "buf: not found" } })).detail).toMatch(/buf: not found/);
    expect(one("spec_unmodified", inputs(GOOD, { descriptor: undefined })).passed).toBe(false);
  });

  it("params_match and spkg_metadata read `substreams info --json` (real shape captured in fixtures/substreams-info.json)", () => {
    expect(one("params_match", inputs(GOOD)).detail).toMatch(/network base; 3 params input\(s\) equal streamsmith.yaml params.value; map_events initialBlock 51001200/);
    const wrongNet = structuredClone(info); wrongNet.network = "mainnet";
    expect(one("params_match", inputs(GOOD, { spkgInfo: wrongNet })).detail).toMatch(/Package.network "mainnet" != "base"/);
    const wrongParams = structuredClone(info); wrongParams.modules!.find((m) => m.name === "map_flows")!.inputs![0]!.name = "vaults[]=0x1";
    expect(one("params_match", inputs(GOOD, { spkgInfo: wrongParams })).detail).toMatch(/module map_flows params .* != streamsmith.yaml params.value/);
    const wrongStart = structuredClone(info); wrongStart.modules!.find((m) => m.name === "map_events")!.initial_block = 1;
    expect(one("params_match", inputs(GOOD, { spkgInfo: wrongStart })).detail).toMatch(/initialBlock of map_events is 1/);
    const netParams = structuredClone(info); netParams.networks = { base: { params: { map_flows: "other" } } };
    expect(one("params_match", inputs(GOOD, { spkgInfo: netParams })).detail).toMatch(/networks.base.params.map_flows differs/);
    expect(one("params_match", inputs(GOOD, { spkgInfo: undefined, spkgInfoError: "spkg not found" })).detail).toMatch(/spkg not found/);
    expect(one("spkg_metadata", inputs(GOOD)).detail).toBe(`erc4626-flows v0.1.0 on base; map_events -> proto:vaultflows.v1.Events (module hash ${info.modules!.find((m) => m.name === "map_events")!.hash})`);
    const wrongVersion = structuredClone(info); wrongVersion.version = "v0.2.0";
    expect(one("spkg_metadata", inputs(GOOD, { spkgInfo: wrongVersion })).detail).toMatch(/version "v0.2.0" != "v0.1.0"/);
  });

  it("row assertions on the primary run", () => {
    expect(one("rows_gt", inputs(GOOD)).detail).toMatch(/vault_flows: 5 rows in primary \(need >= 1, hint 42\)/);
    expect(one("rows_gt", inputs({ ...GOOD, primary: "observation" })).passed).toBe(false);
    expect(one("known_vault_present", inputs(GOOD)).passed).toBe(true);
    const kv = one("known_vault_present", inputs(BAD));
    expect(kv.passed).toBe(false);
    expect(kv.detail).toMatch(new RegExp(`${STK}: 0/3 rows with meta_valid && call_ok`));
    expect(one("reference_flows_present", inputs(GOOD)).detail).toMatch(/4 reference rows present in 5 vault_flows rows; chain_id 8453/);
    const rf = one("reference_flows_present", inputs(BAD));
    expect(rf.passed).toBe(false);
    expect(rf.detail).toMatch(/no vault_flows row matching .*51092449/);
    expect(one("execution_rate_sanity", inputs(GOOD)).detail).toMatch(/5 rows within \[1.0, 1.1\] across 2 vaults/);
    const er = one("execution_rate_sanity", inputs(BAD));
    expect(er.passed).toBe(false);
    expect(er.detail).toMatch(/8453-51092263-406: execution_rate 5.0 outside \[1.0, 1.1\]/);
    // vacuous per vault fails
    expect(one("execution_rate_sanity", inputs({ ...GOOD, primary: "vaults-only" })).detail).toMatch(/no eligible row .* vacuous/);
    expect(one("rows_gt", inputs({ observation: "observation" })).detail).toMatch(/run "primary" has no output/);
  });

  it("observation assertions", () => {
    expect(one("observation_present", inputs(GOOD)).detail).toMatch(/2 vaults observed exactly once at block 51093000 \(call_ok, interval 1800, hash\/timestamp match\); grid clean across 3 runs/);
    const op = one("observation_present", inputs(BAD));
    expect(op.passed).toBe(false);
    expect(op.detail).toMatch(/0 rows at block 51093000 \(want exactly 1\)/);
    expect(op.detail).toMatch(/observation: 1 observation rows off the 1800-block grid/);
    // an observation row inside the primary range fails the "primary has zero observation rows" clause
    expect(one("observation_present", inputs({ ...GOOD, primary: "observation" })).detail).toMatch(/primary: 2 observation rows but no multiple of 1800 in 51092254:51092454/);
    expect(one("observation_matches_reference", inputs(GOOD)).detail).toMatch(/4 values match the listed eth_call reference at block 51093000/);
    expect(one("observation_matches_reference", inputs(BAD)).detail).toMatch(new RegExp(`${G}: no row at block 51093000`));
  });

  it("rpc_success_ratio_gte counts only configured vaults", () => {
    expect(one("rpc_success_ratio_gte", inputs(GOOD)).detail).toMatch(/7\/7 configured-vault rows have call_ok = 1.0000 \(need >= 0.99\)/);
    const r = one("rpc_success_ratio_gte", inputs(BAD));
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/failures: convertToAssets: reverted x2/);
    // the non-configured 0x9999… VaultMeta failure is excluded on purpose
    expect(one("rpc_success_ratio_gte", inputs({ primary: "vaults-only", observation: "observation" })).detail).toMatch(/4\/4 configured-vault rows/);
  });

  it("numeric_strings_valid, ids_unique, addresses_lowercase across all runs", () => {
    expect(one("numeric_strings_valid", inputs(GOOD)).detail).toMatch(/\d+ convertTo column values valid across primary,primary_rerun,observation/);
    const ns = one("numeric_strings_valid", inputs(BAD));
    expect(ns.passed).toBe(false);
    expect(ns.detail).toMatch(/8453-51092402-521.assets_normalized="" not \^\[0-9\]\+\(\\.\[0-9\]\{1,18\}\)\?\$/);
    expect(one("ids_unique", inputs(GOOD)).passed).toBe(true);
    expect(one("ids_unique", inputs({ primary: "vaults-only", primary_rerun: "vaults-only", observation: "observation" })).passed).toBe(true);
    const iu = one("ids_unique", inputs(BAD));
    expect(iu.passed).toBe(false);
    expect(iu.detail).toMatch(/id "8453-51092402-521" != "8453-51092402-522"/);
    expect(iu.detail).toMatch(/id "8453-51092402-521" appears 2 times/);
    expect(one("addresses_lowercase", inputs(GOOD)).passed).toBe(true);
    const al = one("addresses_lowercase", inputs(BAD));
    expect(al.passed).toBe(false);
    expect(al.detail).toMatch(/8453-51092316-163.owner="0x0+B0B"/);
    // asset "" is allowed only on failed probes
    expect(one("addresses_lowercase", inputs({ primary: "vaults-only", primary_rerun: "vaults-only", observation: "observation" })).passed).toBe(true);
    expect(one("numeric_strings_valid", inputs(GOOD, { schema: undefined })).detail).toMatch(/contract schema unavailable/);
  });

  it("deterministic_rerun hashes the canonical form of both outputs", () => {
    const ok = one("deterministic_rerun", inputs(GOOD));
    expect(ok.passed).toBe(true);
    expect(ok.detail).toMatch(/primary sha256 [0-9a-f]{16}… \(5 lines\) == primary_rerun sha256/);
    const bad = one("deterministic_rerun", inputs({ ...GOOD, primary_rerun: "diverged-rerun" }));
    expect(bad.passed).toBe(false);
    expect(bad.detail).toMatch(/!=/);
    expect(one("deterministic_rerun", inputs({ primary: "primary" })).detail).toMatch(/missing output for primary_rerun/);
  });

  it("output_decodes_against_contract rejects unknown fields and flags the legacy call_status object", () => {
    expect(one("output_decodes_against_contract", inputs(GOOD)).detail).toMatch(/11 lines decode as vaultflows.v1.Events with unknown fields rejected/);
    const bad = one("output_decodes_against_contract", inputs(BAD));
    expect(bad.passed).toBe(false);
    expect(bad.detail).toMatch(/unknown field "unknownTable" in .vaultflows.v1.Events/);
    const legacy = one("output_decodes_against_contract", inputs({ ...GOOD, primary: "legacy-call-status" }));
    expect(legacy.passed).toBe(false);
    expect(legacy.detail).toMatch(/legacy nested call_status object/);
  });

  it("banned_words scans the listed files case-insensitively and tolerates a missing README", () => {
    expect(one("banned_words", inputs(GOOD)).detail).toBe("5 patterns, 0 matches in 5 files");
    const hit = one("banned_words", inputs(GOOD, { files: { ...files, "packages/erc4626-flows/README.md": "Great Yield and APY here\nshare price\nnothing to report\nrisky business" } }));
    expect(hit.passed).toBe(false);
    expect(hit.detail).toMatch(/README.md:1: Great Yield and APY here \(y\[i\]eld\)/);
    expect(hit.detail).toMatch(/README.md:2: share price/);
    // line 3 matches no pattern and must not be reported
    expect(hit.detail).toMatch(/README.md:4: risky business/);
    expect(hit.detail).not.toMatch(/README.md:3/);
  });

  it("log_index_matches_rpc and observation_matches_reference use live RPC evidence when present", () => {
    const rpc: RpcEvidence = {
      url: "https://rpc.test", reachable: true, chainId: 8453,
      receipts: {
        "0x0fe8b63d99cbe6eac9baab1967e9011d7de8a52fa6d5d210b15b4aa4c80a12b4": { blockNumber: 51092263, logs: [{ address: G, logIndex: 406 }] },
        "0xf3188ffdb3d650e0f0a876391700726684bbb25ff54f802aea1dd87af514973b": { blockNumber: 51092316, logs: [{ address: STK, logIndex: 163 }] },
        "0x640557be0ab1dae20ea52973bdee493f7851919e2bdd745412bd8160876fd751": { error: "HTTP 429" },
        "0x4388fe4a9820e592dc85a9e140722c6c23ad28826f50a81399ed07c9a22d06c0": { blockNumber: 51092449, logs: [{ address: "0x0000000000000000000000000000000000000abc", logIndex: 836 }] },
      },
      convertToAssets: { [`${G}@51093000`]: { raw: "1040743" }, [`${STK}@51093000`]: { error: "missing trie node" } },
    };
    const li = one("log_index_matches_rpc", inputs(GOOD, { rpc }));
    expect(li.passed).toBe(false);
    expect(li.detail).toMatch(/RPC log 836 of tx 0x4388fe4a98… was emitted by 0x0000000000000000000000000000000000000abc, row vault is 0x050ce30b/);
    const good = { ...rpc, receipts: { ...rpc.receipts, "0x4388fe4a9820e592dc85a9e140722c6c23ad28826f50a81399ed07c9a22d06c0": { blockNumber: 51092449, logs: [{ address: G, logIndex: 836 }] } } };
    const li2 = one("log_index_matches_rpc", inputs(GOOD, { rpc: good }));
    expect(li2.passed).toBe(true);
    expect(li2.detail).toMatch(/3 confirmed against eth_getTransactionReceipt \(https:\/\/rpc.test\); tx 0x640557be0a…: receipt error HTTP 429/);
    const offline = one("log_index_matches_rpc", inputs(GOOD, { rpc: { url: "u", reachable: false, error: "RPC u unreachable: boom", receipts: {}, convertToAssets: {} } }));
    expect(offline.passed).toBe(true);
    expect(offline.detail).toMatch(/live RPC check skipped \(RPC u unreachable: boom\)/);
    const om = one("observation_matches_reference", inputs(GOOD, { rpc }));
    expect(om.passed).toBe(true);
    expect(om.detail).toMatch(/1 vault\(s\) confirmed by live eth_call/);
    expect(om.detail).toMatch(/live eth_call unavailable \(missing trie node\)/);
    const drift = { ...rpc, convertToAssets: { [`${G}@51093000`]: { raw: "1040750" } } };
    expect(one("observation_matches_reference", inputs(GOOD, { rpc: drift })).detail).toMatch(/assets_per_share_raw 1040743 != live eth_call convertToAssets 1040750 at block 51093000/);
  });

  it("warn-level failures never flip exitStatus", () => {
    const results = evaluateAssertions(gate.assertions, inputs(GOOD, { rpc: { url: "u", reachable: true, receipts: {}, convertToAssets: { [`${G}@51093000`]: { raw: "1" }, [`${STK}@51093000`]: { raw: "1" } } } }));
    const st = exitStatus(results);
    expect(st.passed).toBe(true);
    expect(st.warned.map((w) => w.name)).toEqual(["observation_matches_reference"]);
  });
});
