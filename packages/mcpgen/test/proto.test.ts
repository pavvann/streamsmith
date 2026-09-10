import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INJECTED_COLUMNS, ProtoParseError, enumMap, parseProto, tablesFromProto } from "../src/proto.ts";
import { SPEC_PROTO } from "./helpers.ts";

const src = readFileSync(SPEC_PROTO, "utf8");

describe("proto parser on specs/vaultflows.proto", () => {
  const file = parseProto(src);
  const tables = tablesFromProto(file);

  it("reads package, import and messages", () => {
    expect(file.syntax).toBe("proto3");
    expect(file.pkg).toBe("vaultflows.v1");
    expect(file.imports).toEqual(["sf/substreams/sink/sql/schema/v1/schema.proto"]);
    expect(file.messages.map((m) => m.name)).toEqual(["Events", "VaultFlow", "ShareValueObservation", "VaultMeta", "ShareTransfer"]);
  });

  it("only messages with option (schema.table) become tables, named exactly as the option says", () => {
    expect(tables.map((t) => t.table)).toEqual(["vault_flows", "share_value_observations", "vaults", "share_transfers"]);
    expect(tables.map((t) => t.message)).toEqual(["VaultFlow", "ShareValueObservation", "VaultMeta", "ShareTransfer"]);
  });

  it("vault_flows has the 22 retained proto fields plus the 4 injected columns, in order", () => {
    const vf = tables.find((t) => t.table === "vault_flows")!;
    const protoCols = vf.columns.filter((c) => !c.injected).map((c) => c.name);
    expect(protoCols).toEqual([
      "id", "chain_id", "block_number", "block_hash", "block_timestamp", "tx_hash", "log_index", "vault", "caller", "owner", "receiver",
      "direction", "assets_raw", "shares_raw", "assets_normalized", "shares_normalized", "asset_decimals", "share_decimals", "execution_rate",
      "meta_valid", "call_ok", "call_error",
    ]);
    expect(vf.columns.filter((c) => c.injected).map((c) => c.name)).toEqual(INJECTED_COLUMNS.map((c) => c.name));
    expect(vf.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(["id"]);
    expect(vf.orderBy).toEqual(["id", "vault", "block_number"]);
  });

  it("maps types like the from-proto sink (contract-notes.md section 1)", () => {
    const vf = tables.find((t) => t.table === "vault_flows")!;
    const type = (n: string) => vf.columns.find((c) => c.name === n)!.type;
    expect(type("id")).toBe("String");
    expect(type("chain_id")).toBe("UInt32");
    expect(type("block_number")).toBe("UInt64");
    expect(type("direction")).toBe("String"); // plain string 'deposit'/'withdraw': the contract has no enum fields
    expect(type("assets_raw")).toBe("UInt256");
    expect(type("assets_normalized")).toBe("Decimal(38, 18)");
    expect(type("meta_valid")).toBe("Bool");
    expect(type("_deleted_")).toBe("*");
  });

  it("keeps reserved numbers/names and trailing comments", () => {
    const vf = file.messages.find((m) => m.name === "VaultFlow")!;
    expect(vf.reservedNumbers).toEqual([21]);
    expect(vf.reservedNames).toEqual(["call_status"]);
    expect(vf.fields.find((f) => f.name === "block_timestamp")!.comment).toBe("unix seconds");
    expect(vf.fields.find((f) => f.name === "call_ok")!.number).toBe(22);
  });

  it("the contract declares no enum (from-proto 4.13.1 panics on a populated proto3 enum)", () => {
    expect(file.enums).toEqual([]);
    expect(enumMap(file)).toEqual({});
    for (const t of tables) for (const c of t.columns) expect(c.type, `${t.table}.${c.name}`).not.toBe("Int32");
  });

  it("parses the Events container's repeated fields", () => {
    const events = file.messages[0]!;
    expect(events.tableOption).toBeUndefined();
    expect(events.fields.every((f) => f.repeated)).toBe(true);
    expect(events.fields.map((f) => f.type)).toEqual(["VaultFlow", "ShareValueObservation", "VaultMeta", "ShareTransfer"]);
  });

  it("nested text-format options are parsed structurally", () => {
    const svo = file.messages.find((m) => m.name === "ShareValueObservation")!;
    const opt = svo.tableOption as Record<string, unknown>;
    expect(opt.name).toBe("share_value_observations");
    const ch = opt.clickhouse_table_options as Record<string, unknown>;
    expect(ch.partition_fields).toEqual([{ name: "_block_timestamp_", function: "toYYYYMM" }]);
    const f = svo.fields.find((x) => x.name === "assets_per_share_normalized")!;
    expect(f.fieldOption).toEqual({ convertTo: { decimal128: { scale: 18 } } });
  });
});

describe("proto parser: enums are still supported for other contracts", () => {
  it("reads enum values and maps an enum field to Int32", () => {
    const f = parseProto(`syntax = "proto3"; package t; import "sf/substreams/sink/sql/schema/v1/schema.proto";
      enum Side { SIDE_UNSPECIFIED = 0; SIDE_BUY = 1; SIDE_SELL = 2; }
      message T { option (schema.table) = { name: "t" }; string id = 1 [(schema.field) = { primary_key: true }]; Side side = 2; }`);
    expect(enumMap(f).Side).toEqual({ SIDE_UNSPECIFIED: 0, SIDE_BUY: 1, SIDE_SELL: 2 });
    const [t] = tablesFromProto(f);
    expect(t!.columns.find((c) => c.name === "side")).toMatchObject({ type: "Int32", protoType: "Side" });
  });
});

describe("proto parser limits", () => {
  it("skips message-typed fields that are not Timestamp (the sink drops them)", () => {
    const f = parseProto(`syntax = "proto3"; package t; import "sf/substreams/sink/sql/schema/v1/schema.proto";
      message Inner { string a = 1; }
      message T { option (schema.table) = { name: "t" }; string id = 1 [(schema.field) = { primary_key: true }]; Inner inner = 2; }`);
    const [t] = tablesFromProto(f);
    expect(t!.columns.filter((c) => !c.injected).map((c) => c.name)).toEqual(["id"]);
  });

  it("refuses oneof, map and nested messages with a clear error", () => {
    expect(() => parseProto(`syntax = "proto3"; message T { oneof x { string a = 1; } }`)).toThrow(ProtoParseError);
    expect(() => parseProto(`syntax = "proto3"; message T { map<string, string> m = 1; }`)).toThrow(/not supported/);
    expect(() => parseProto(`syntax = "proto3"; message T { message N { string a = 1; } }`)).toThrow(/not supported/);
  });

  it("requires exactly one primary key per table", () => {
    const f = parseProto(`syntax = "proto3"; message T { option (schema.table) = { name: "t" }; string id = 1; }`);
    expect(() => tablesFromProto(f)).toThrow(/exactly one primary_key/);
  });
});
