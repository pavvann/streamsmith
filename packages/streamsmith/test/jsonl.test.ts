import { describe, it, expect, beforeAll } from "vitest";
import { decodeRun, parseEnvelopes, camelToSnake, callStatus, foldLegacyCallStatus, str, num, TABLES } from "../src/gate/jsonl.ts";
import type { ContractSchema } from "../src/gate/contract.ts";
import { runFixture, schemaFixture } from "./helpers.ts";

let schema: ContractSchema;
beforeAll(async () => {
  schema = await schemaFixture();
});
const opts = () => ({ schema, rootType: "vaultflows.v1.Events", module: "map_events" });

describe("jsonl parsing against the current specs/vaultflows.proto", () => {
  it("camelToSnake mirrors protojson lowerCamel names", () => {
    expect(camelToSnake("blockNumber")).toBe("block_number");
    expect(camelToSnake("assetsPerShareRaw")).toBe("assets_per_share_raw");
    expect(camelToSnake("callOk")).toBe("call_ok");
    expect(camelToSnake("fromOwner")).toBe("from_owner");
    expect(camelToSnake("already_snake")).toBe("already_snake");
    expect(camelToSnake("@block")).toBe("@block");
    expect(TABLES).toEqual(["vault_flows", "share_value_observations", "vaults", "share_transfers"]);
  });

  it("parses the ModuleWrap envelope and counts non-JSON lines", async () => {
    const { envelopes, lines, badLines } = parseEnvelopes(await runFixture("unparseable.jsonl"));
    expect(lines).toBe(3);
    expect(badLines).toBe(2);
    expect(envelopes[0]).toMatchObject({ module: "map_events", block: 51092263, type: "vaultflows.v1.Events" });
  });

  it("decodes rows with the contract descriptor: proto names, defaults filled, ids per the contract", async () => {
    const run = decodeRun("primary", await runFixture("primary.jsonl"), opts());
    expect(run.loose).toBe(false);
    expect(run.lines).toBe(5);
    expect(run.badLines).toBe(0);
    expect(run.decodeErrors).toEqual([]);
    expect(run.envelopeErrors).toEqual([]);
    expect(Object.keys(run.tables)).toEqual([...TABLES]);
    expect(run.tables.vault_flows).toHaveLength(5);
    expect(run.tables.share_transfers).toHaveLength(0);
    expect(run.minBlock).toBe(51092263);
    expect(run.maxBlock).toBe(51092449);
    const flow = run.tables.vault_flows![0]!;
    expect(str(flow, "id")).toBe("8453-51092263-406");
    expect(num(flow, "block_number")).toBe(51092263);
    expect(num(flow, "log_index")).toBe(406);
    expect(flow.direction).toBe("FLOW_DIRECTION_DEPOSIT");
    expect(flow.vault).toBe("0x050ce30b927da55177a4914ec73480238bad56f0");
    expect(flow.__block).toBe(51092263);
    expect(callStatus(flow)).toEqual({ ok: true, error: "" }); // call_error omitted in protojson -> ""
    expect(flow.call_error).toBe("");
    const obs = decodeRun("observation", await runFixture("observation.jsonl"), opts()).tables.share_value_observations!;
    expect(obs.map((r) => str(r, "id"))).toEqual(["8453-51093000-0x050ce30b927da55177a4914ec73480238bad56f0", "8453-51093000-0xbeef0e0834849acc03f0089f01f4f1eeb06873c9"]);
    expect(obs[0]!.sample_interval_blocks).toBe(1800);
    const vaults = decodeRun("v", await runFixture("vaults-only.jsonl"), opts()).tables.vaults!;
    expect(vaults).toHaveLength(3);
    expect(callStatus(vaults[2]!)).toEqual({ ok: false, error: "asset: reverted" });
    expect(vaults[2]!.asset).toBe(""); // omitted string -> "" (allowed only when call_ok is false)
    expect(vaults[2]!.compliant).toBe(false); // omitted bool -> false
  });

  it("rejects unknown fields, wrong envelopes and repeated proto/JSON names", () => {
    const text = [
      '{"@module":"other","@block":1,"@type":"vaultflows.v1.Events","@data":{"vaultFlows":[]}}',
      '{"@block":2,"@data":{"vaultFlows":[]}}',
      '{"@module":"map_events","@block":3,"@type":"vaultflows.v1.Events","@data":{"vaultFlows":[{"id":"x","extra":1}]}}',
      '{"@module":"map_events","@block":4,"@type":"vaultflows.v1.Events","@data":{"vaultFlows":[{"id":"x","blockNumber":"4","block_number":"4"}]}}',
      '{"@module":"map_events","@block":5,"@type":"vaultflows.v1.Events","@data":{"vaultFlows":[{"id":"x","direction":"SIDEWAYS"}]}}',
      '{"@module":"map_events","@block":6,"@type":"vaultflows.v1.Events","@data":"nope"}',
    ].join("\n");
    const run = decodeRun("x", text, opts());
    expect(run.envelopeErrors).toEqual(['line 1: @module "other" != "map_events"', "line 2: missing @module/@type envelope"]);
    expect(run.decodeErrors).toEqual([
      'line 3 (block 3): $.vaultFlows[0]: unknown field "extra" in .vaultflows.v1.VaultFlow',
      'line 4 (block 4): $.vaultFlows[0]: field "block_number" given twice (proto and JSON name)',
      'line 5 (block 5): $.vaultFlows[0].direction: unknown enum value "SIDEWAYS" for .vaultflows.v1.FlowDirection',
      "line 6 (block 6): @data is not an object",
    ]);
    // snake_case rows (protojson accepts proto names too) decode fine
    const snake = decodeRun("s", '{"@module":"map_events","@block":7,"@type":"vaultflows.v1.Events","@data":{"vault_flows":[{"id":"8453-7-1","chain_id":8453,"call_ok":true}]}}', opts());
    expect(snake.decodeErrors).toEqual([]);
    expect(snake.tables.vault_flows![0]).toMatchObject({ id: "8453-7-1", chain_id: 8453, call_ok: true, meta_valid: false, assets_raw: "" });
  });

  it("tolerates the legacy nested call_status object but reports it (reserved in the contract)", async () => {
    const run = decodeRun("legacy", await runFixture("legacy-call-status.jsonl"), opts());
    expect(run.tables.vault_flows).toHaveLength(1);
    expect(callStatus(run.tables.vault_flows![0]!)).toEqual({ ok: false, error: "boom" });
    expect(run.decodeErrors).toEqual(["line 1 (block 51092263): 1 row(s) carried the legacy nested call_status object (reserved in the contract); folded into call_ok/call_error"]);
    const row: Record<string, unknown> = { id: "x", call_status: { ok: true, error: "" } };
    expect(foldLegacyCallStatus(row)).toBe(true);
    expect(row).toEqual({ id: "x", callOk: true, callError: "" });
    expect(foldLegacyCallStatus({ id: "y" })).toBe(false);
  });

  it("parses loosely without a descriptor and says so", async () => {
    const run = decodeRun("loose", await runFixture("primary.jsonl"), { rootType: "vaultflows.v1.Events", module: "map_events" });
    expect(run.loose).toBe(true);
    expect(run.tables.vault_flows).toHaveLength(5);
    expect(run.tables.vault_flows![0]).toMatchObject({ block_number: "51092263", call_ok: true, execution_rate: "1.040741742113947472" });
    expect(run.decodeErrors[0]).toMatch(/contract descriptor unavailable: rows parsed loosely/);
  });
});
