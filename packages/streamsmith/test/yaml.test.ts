// Regression test for the bug that made every address/hash assertion in the gate fail silently.
//
// specs/gate.yaml writes addresses, tx hashes and block hashes as UNQUOTED plain scalars. The `yaml` package's
// default (YAML 1.2 core) schema has HEX and OCT formats on the `int` tag, so `0x050ce30b…` resolved to a NUMBER
// (2.88e46 — already lossy past 2^53) and `lower(row.vault) === "0x050c…"` could never be true. The loader now
// drops those two tags (src/util/yaml.ts); specs/gate.yaml is never rewritten to add quotes.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { parseSpecYaml, dropHexAndOctIntTags } from "../src/util/yaml.ts";
import { loadGateConfig } from "../src/config/gate.ts";
import { loadStreamsmithConfig } from "../src/config/streamsmith.ts";
import { REPO_ROOT } from "./helpers.ts";

// Every string below is copied from docs/build/vaults.md and asserted to still be in that file.
const GAUNTLET = "0x050ce30b927da55177a4914ec73480238bad56f0";
const STEAKHOUSE = "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9";
const REFERENCE_TXS = [
  "0x0fe8b63d99cbe6eac9baab1967e9011d7de8a52fa6d5d210b15b4aa4c80a12b4", // 51092263 Gauntlet Deposit
  "0xf3188ffdb3d650e0f0a876391700726684bbb25ff54f802aea1dd87af514973b", // 51092316 Steakhouse Withdraw
  "0x640557be0ab1dae20ea52973bdee493f7851919e2bdd745412bd8160876fd751", // 51092402 Steakhouse Deposit
  "0x4388fe4a9820e592dc85a9e140722c6c23ad28826f50a81399ed07c9a22d06c0", // 51092449 Gauntlet Withdraw
];

const gatePath = join(REPO_ROOT, "specs", "gate.yaml");
const gateText = await readFile(gatePath, "utf8");
const vaultsDoc = await readFile(join(REPO_ROOT, "docs", "build", "vaults.md"), "utf8");

describe("spec YAML loading keeps 0x scalars as strings", () => {
  it("the reference values are the ones docs/build/vaults.md records", () => {
    for (const s of [GAUNTLET, STEAKHOUSE, ...REFERENCE_TXS]) expect(vaultsDoc, `${s} is not in docs/build/vaults.md`).toContain(s);
  });

  it("the default yaml schema is what breaks them (the bug this guards)", () => {
    const raw = YAML.parse(gateText) as { configuredVaults: unknown[] };
    expect(typeof raw.configuredVaults[0]).toBe("number");
    expect(dropHexAndOctIntTags([{ tag: "tag:yaml.org,2002:int", format: "HEX", resolve: () => 0 }, "int", "bool"])).toEqual(["int", "bool"]);
  });

  it("loadGateConfig gives the exact lowercase strings for vaults, tx hashes and block hashes", async () => {
    const gate = await loadGateConfig(gatePath);
    expect(gate.configuredVaults).toEqual([GAUNTLET, STEAKHOUSE]);
    for (const v of gate.configuredVaults) expect(typeof v).toBe("string");

    const refs = gate.assertions.find((a) => a.name === "reference_flows_present")!.rows!;
    expect(refs.map((r) => r.tx_hash)).toEqual(REFERENCE_TXS);
    expect(refs.map((r) => r.vault)).toEqual([GAUNTLET, STEAKHOUSE, STEAKHOUSE, GAUNTLET]);
    for (const r of refs) {
      expect(r.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.vault).toMatch(/^0x[0-9a-f]{40}$/);
      expect(typeof r.block_number).toBe("number"); // plain decimal integers still resolve as numbers
    }

    // known_vault_present / execution_rate_sanity vault lists, and the observation block hash in the definition
    for (const name of ["known_vault_present", "execution_rate_sanity", "observation_present", "rpc_success_ratio_gte"]) {
      const a = gate.assertions.find((x) => x.name === name)!;
      if (a.vaults) expect(a.vaults).toEqual([GAUNTLET, STEAKHOUSE]);
    }
    const obs = gate.assertions.find((a) => a.name === "observation_present")!;
    expect(obs.definition).toMatch(/block_hash == 0x9c6e8b7f6f72707960744b44d390bad2ecdc7a96b16420338b6ce10777dc29bb/);
    const omr = gate.assertions.find((a) => a.name === "observation_matches_reference")!;
    expect(Object.keys(omr.expected!)).toEqual([GAUNTLET, STEAKHOUSE]);

    const li = gate.assertions.find((a) => a.name === "log_index_matches_rpc")!.rows!;
    expect(li.map((r) => r.tx_hash)).toEqual(REFERENCE_TXS);
    expect(li.map((r) => r.log_index)).toEqual([406, 163, 521, 836]);
  });

  it("loadStreamsmithConfig keeps the vault list and the urlencoded params byte for byte", async () => {
    const ss = await loadStreamsmithConfig(join(REPO_ROOT, "specs", "streamsmith.yaml"));
    expect(ss.vaults.map((v) => v.address)).toEqual([GAUNTLET, STEAKHOUSE]);
    expect(ss.params?.value).toBe(`vaults[]=${GAUNTLET}&vaults[]=${STEAKHOUSE}&interval=1800&chain_id=8453`);
    expect(ss.startBlock).toBe(51001200);
  });

  it("parseSpecYaml leaves 0x/0o scalars alone and still parses numbers, bools and quoted strings", () => {
    const doc = parseSpecYaml<Record<string, unknown>>(
      ["addr: 0x050ce30b927da55177a4914ec73480238bad56f0", "short: 0xff", "octal: 0o17", "dec: 51092254", "neg: -3", "flag: true", "quoted: \"0x01\"", "float: 1.5"].join("\n"),
    );
    expect(doc).toEqual({
      addr: GAUNTLET,
      short: "0xff",
      octal: "0o17",
      dec: 51092254,
      neg: -3,
      flag: true,
      quoted: "0x01",
      float: 1.5,
    });
  });
});
