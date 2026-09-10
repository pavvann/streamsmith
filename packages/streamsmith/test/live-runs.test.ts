// The gate's evaluators against REAL output of erc4626-flows v0.1.0 streamed from The Graph Market on 2026-09-10
// (runs/live/README.md records the two commands). No fixture hand-writing: these two files are exactly what the
// endpoint returned, copied into fixtures/live/ by `pnpm fixtures`.
//
// Two facts about the evidence, both deliberate:
//  - the observation file was produced from `map_share_value_observations` (4 blocks) instead of `map_events`, to
//    keep the free-tier block quota for the primary range; it is decoded with the module its envelope names.
//  - the primary file carries one `vaults` row for an unrelated chain-wide vault (0x98911f27…), which is what the
//    first-sight probe is supposed to do; rpc_success_ratio_gte excludes it because it is not a configured vault.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeRun, type ParsedRun } from "../src/gate/jsonl.ts";
import { evaluateAssertions, exitStatus, type AssertionInputs, type DescriptorEvidence } from "../src/gate/assertions.ts";
import { loadGateConfig, expandTemplate } from "../src/config/gate.ts";
import { loadStreamsmithConfig } from "../src/config/streamsmith.ts";
import { schemaFixture, infoFixture, pathExists, FIXTURES, REPO_ROOT } from "./helpers.ts";

const PRIMARY = "primary-51092254-51092454.jsonl";
const OBSERVATION = "observation-51092998-51093002.jsonl";

/** The canonical evidence lives in runs/live/ (tracked); fixtures/live/ is the copy `pnpm fixtures` keeps in sync. */
async function liveRun(name: string): Promise<string> {
  const tracked = join(REPO_ROOT, "runs", "live", name);
  return readFile((await pathExists(tracked)) ? tracked : join(FIXTURES, "live", name), "utf8");
}

const gate = await loadGateConfig(join(REPO_ROOT, "specs", "gate.yaml"));
const ss = await loadStreamsmithConfig(join(REPO_ROOT, "specs", "streamsmith.yaml"));
const schema = await schemaFixture();
const info = await infoFixture();
const rootType = "vaultflows.v1.Events";

const primaryText = await liveRun(PRIMARY);
const observationText = await liveRun(OBSERVATION);
const observationModule = (JSON.parse(observationText.split("\n").find((l) => l.trim())!) as Record<string, string>)["@module"]!;

const decode = (name: string, text: string, module: string): ParsedRun => decodeRun(name, text, { schema, rootType, module, rejectUnknownFields: true });
const runs: Record<string, ParsedRun> = {
  primary: decode("primary", primaryText, "map_events"),
  primary_rerun: decode("primary_rerun", primaryText, "map_events"),
  observation: decode("observation", observationText, observationModule),
};
const runTexts = { primary: primaryText, primary_rerun: primaryText, observation: observationText };

const descriptor: DescriptorEvidence = {
  contract: gate.contract.proto,
  protoPackage: "vaultflows.v1",
  specHash: gate.expectedSpecSha256!,
  specHashViaConvert: gate.expectedSpecSha256!,
  rendererMatch: true,
  expectedSpecSha256: gate.expectedSpecSha256!,
  spkgPath: "packages/erc4626-flows/erc4626-flows-v0.1.0.spkg",
  spkgHash: gate.expectedSpecSha256!,
};

const files: Record<string, string | undefined> = {};
for (const a of gate.assertions) for (const f of a.files ?? []) {
  const rel = expandTemplate(f, { "package.dir": gate.package.dir });
  const abs = join(REPO_ROOT, rel);
  files[rel] = (await pathExists(abs)) ? await readFile(abs, "utf8") : undefined;
}

const inputs: AssertionInputs = { gate, streamsmith: ss, schema, rootType, runs, runTexts, descriptor, spkgInfo: info, files, configuredVaults: gate.configuredVaults };
const results = evaluateAssertions(gate.assertions, inputs);
const byName = new Map(results.map((r) => [r.name, r]));
const detail = (name: string): string => byName.get(name)!.detail;

describe("specs/gate.yaml assertions over the real live runs", () => {
  it("the evidence is the real output, unmodified", () => {
    expect(runs.primary!.lines).toBe(34);
    expect(runs.primary!.badLines).toBe(0);
    expect(runs.primary!.tables.vault_flows).toHaveLength(42); // docs/build/vaults.md: 42 logs on the two vaults
    expect(runs.primary!.tables.share_value_observations).toHaveLength(0); // no multiple of 1800 in 51092254..51092453
    expect(runs.primary!.tables.vaults).toHaveLength(1);
    expect([runs.primary!.minBlock, runs.primary!.maxBlock]).toEqual([51092263, 51092449]);
    expect(runs.observation!.lines).toBe(1);
    expect(runs.observation!.tables.share_value_observations).toHaveLength(2);
    expect(runs.primary!.decodeErrors).toEqual([]);
    expect(runs.primary!.envelopeErrors).toEqual([]);
    expect(runs.observation!.decodeErrors).toEqual([]);
    expect(runs.observation!.envelopeErrors).toEqual([]);
    // direction is a plain string in the frozen contract (the from-proto sink panics on proto3 enums)
    expect(new Set(runs.primary!.tables.vault_flows!.map((r) => r.direction))).toEqual(new Set(["deposit", "withdraw"]));
  });

  it("the eight data assertions the brief names all pass on real data", () => {
    const required = ["rows_gt", "known_vault_present", "reference_flows_present", "execution_rate_sanity", "observation_present", "numeric_strings_valid", "ids_unique", "addresses_lowercase"];
    expect(required.filter((n) => !byName.get(n)!.passed).map((n) => `${n}: ${detail(n)}`)).toEqual([]);
    expect(detail("rows_gt")).toMatch(/vault_flows: 42 rows in primary \(need >= 1, hint 42\)/);
    expect(detail("known_vault_present")).toBe(`${gate.configuredVaults[0]}: 40/40 rows with meta_valid && call_ok; ${gate.configuredVaults[1]}: 2/2 rows with meta_valid && call_ok`);
    expect(detail("reference_flows_present")).toMatch(/4 reference rows present in 42 vault_flows rows; chain_id 8453 on every row/);
    expect(detail("execution_rate_sanity")).toMatch(/42 rows within \[1.0, 1.1\] across 2 vaults/);
    expect(detail("observation_present")).toMatch(/2 vaults observed exactly once at block 51093000 \(call_ok, interval 1800, hash\/timestamp match\)/);
    expect(detail("ids_unique")).toMatch(/88 ids unique and well-formed/); // (42 flows + 1 vault) x 2 runs + 2 observations
  });

  it("no fail-level assertion fails, and the two warn-level cross-checks agree with the recorded eth_call values", () => {
    const st = exitStatus(results);
    expect(st.failed.map((a) => `${a.name}: ${a.detail}`)).toEqual([]);
    expect(st.warned.map((a) => `${a.name}: ${a.detail}`)).toEqual([]);
    expect(st.passed).toBe(true);
    // 1.040743 / 1.039913 recorded from convertToAssets(1e18) at block 51093000; the rows carry 18 fractional
    // digits, so the comparison has to be decimal, not string
    expect(detail("observation_matches_reference")).toMatch(/4 values match the listed eth_call reference at block 51093000/);
    expect(detail("rpc_success_ratio_gte")).toMatch(/44\/44 configured-vault rows have call_ok = 1.0000 \(need >= 0.99\)/);
    expect(detail("log_index_matches_rpc")).toMatch(/4 listed log_index values match the rows/);
    expect(detail("deterministic_rerun")).toMatch(/\(34 lines\) == primary_rerun/);
    expect(detail("output_decodes_against_contract")).toMatch(/69 lines decode as vaultflows.v1.Events with unknown fields rejected/);
  });
});
