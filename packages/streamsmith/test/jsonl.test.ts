import { describe, it, expect } from "vitest";
import { parseJsonl, camelToSnake, callStatus, str, num } from "../src/gate/jsonl.ts";
import { fixture } from "./helpers.ts";

describe("jsonl parsing", () => {
  it("converts protojson camelCase to proto snake_case", () => {
    expect(camelToSnake("blockNumber")).toBe("block_number");
    expect(camelToSnake("assetsPerShareRaw")).toBe("assets_per_share_raw");
    expect(camelToSnake("callOk")).toBe("call_ok");
    expect(camelToSnake("already_snake")).toBe("already_snake");
    expect(camelToSnake("@block")).toBe("@block");
  });

  it("parses the envelope and groups rows by table", async () => {
    const run = parseJsonl(await fixture("primary.jsonl"));
    expect(run.lines).toBe(3);
    expect(run.badLines).toBe(0);
    expect(run.tables.vault_flows).toHaveLength(2);
    expect(run.tables.share_value_observations).toHaveLength(2);
    expect(run.tables.vaults).toHaveLength(2);
    expect(run.tables.share_transfers).toHaveLength(0);
    expect(run.minBlock).toBe(51092263);
    expect(run.maxBlock).toBe(51093100);
    expect(run.modules).toEqual(["map_events"]);
    const flow = run.tables.vault_flows[0]!;
    expect(str(flow, "vault")).toBe("0x050ce30b927da55177a4914ec73480238bad56f0");
    expect(num(flow, "block_number")).toBe(51092263);
    expect(callStatus(flow)).toEqual({ ok: true, error: "" });
  });

  it("accepts snake_case rows and legacy nested call_status; tolerates junk lines", () => {
    const text = [
      '{"@module":"m","@block":5,"@type":"t","@data":{"vault_flows":[{"id":"x","vault":"0xAB","call_status":{"ok":false,"error":"boom"}}]}}',
      "not json",
      '{"vaults":[{"id":"raw","vault":"0xcd","call_error":"asset: reverted"}]}',
    ].join("\n");
    const run = parseJsonl(text);
    expect(run.badLines).toBe(1);
    expect(run.tables.vault_flows).toHaveLength(1);
    expect(callStatus(run.tables.vault_flows[0]!)).toEqual({ ok: false, error: "boom" });
    expect(run.tables.vaults).toHaveLength(1);
    expect(callStatus(run.tables.vaults[0]!)).toEqual({ ok: false, error: "asset: reverted" });
  });
});
