import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqlBuildError, assertIdent, buildColumnsQuery, buildCountQuery, buildHeadQuery, buildToolQuery, buildWindowBoundsQuery } from "../runtime/sql.ts";
import type { Manifest } from "../runtime/types.ts";
import { GENERATED_DIR } from "./helpers.ts";

const manifest = JSON.parse(readFileSync(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest;
const dataTools = manifest.tools.filter((t) => t.kind !== "status");
const HOSTILE = ["'; DROP TABLE vault_flows; --", "0x050ce30b927da55177a4914ec73480238bad56f0' OR 1=1 --", "{vault:String}", "vault_flows"];

describe("SQL builder never interpolates user strings", () => {
  it("hostile vault values are rejected before any SQL exists, for every tool", () => {
    for (const t of dataTools) {
      if (!t.params.some((p) => p.kind === "vault")) continue;
      for (const h of HOSTILE) expect(() => buildToolQuery(t, { vault: h }), `${t.name} accepted ${h}`).toThrow(SqlBuildError);
    }
  });

  it("valid vault is bound as {vault:String}, the address never appears in the SQL text", () => {
    const vault = manifest.vaults[0]!;
    for (const t of dataTools) {
      if (!t.params.some((p) => p.kind === "vault")) continue;
      const q = buildToolQuery(t, { vault, windowHours: 24, limit: 10 });
      expect(q.sql).toContain("vault = {vault:String}");
      expect(q.sql).not.toContain(vault);
      expect(q.params.vault).toBe(vault);
      expect(q.sql).toMatch(/LIMIT \{limit:UInt32\}$/);
      expect(q.params.limit).toBe("10");
      // the only braces in the SQL are typed placeholders
      // the only braces in the SQL are typed placeholders for this tool's own parameters
      const allowed = new Set(["{windowHours:UInt32}", "{limit:UInt32}", ...t.params.filter((p) => p.chType).map((p) => `{${p.name}:${p.chType}}`)]);
      for (const m of q.sql.matchAll(/\{[^}]*\}/g)) expect(allowed, `${t.name}: ${m[0]}`).toContain(m[0]);
    }
  });

  it("uppercase vault input is normalized to the receipt's lowercase form", () => {
    const t = dataTools.find((x) => x.name === "vault_flows")!;
    const q = buildToolQuery(t, { vault: manifest.vaults[0]!.toUpperCase().replace("0X", "0x") });
    expect(q.params.vault).toBe(manifest.vaults[0]);
  });

  it("direction is bound in the representation the contract stores, and only the declared names are accepted", () => {
    const t = dataTools.find((x) => x.name === "vault_flows")!;
    const p = t.params.find((x) => x.name === "direction")!;
    // `direction` is a String column in the contract (no proto enums: from-proto 4.13.1 panics on one), so the
    // bound value is the name itself. If the column ever becomes an enum again, mcpgen resolves the number and
    // this assertion follows the manifest instead of a hard-coded 1/2.
    expect(p.chType).toBe("String");
    expect(p.values).toEqual(["deposit", "withdraw"]);
    for (const name of p.values!) {
      const q = buildToolQuery(t, { direction: name });
      expect(q.params.direction).toBe(String(p.valueMap![name]));
      expect(q.sql).toContain(`direction = {direction:${p.chType}}`);
      expect(q.sql, "the stored value must never be interpolated into the SQL text").not.toContain(String(p.valueMap![name]));
    }
    expect(() => buildToolQuery(t, { direction: "2" })).toThrow(SqlBuildError);
    expect(() => buildToolQuery(t, { direction: "1 OR 1=1" })).toThrow(SqlBuildError);
    expect(() => buildToolQuery(t, { direction: "deposit'" })).toThrow(SqlBuildError);
    expect(() => buildToolQuery(t, { direction: "DEPOSIT" })).toThrow(SqlBuildError);
  });

  it("integer arguments are bounded and the window is anchored to the newest observed row", () => {
    const t = dataTools.find((x) => x.name === "vault_flows")!;
    expect(() => buildToolQuery(t, { limit: 501 })).toThrow(/above maximum/);
    expect(() => buildToolQuery(t, { limit: 0 })).toThrow(/below minimum/);
    expect(() => buildToolQuery(t, { windowHours: 2161 })).toThrow(/above maximum/);
    expect(() => buildToolQuery(t, { windowHours: 1.5 })).toThrow(/integer/);
    expect(() => buildToolQuery(t, { limit: "10; DROP" })).toThrow(SqlBuildError);
    const q = buildToolQuery(t, {});
    expect(q.params).toEqual({ windowHours: "24", limit: "100" });
    expect(q.sql).toContain("block_timestamp >= (SELECT max(block_timestamp) FROM vault_flows WHERE _deleted_ = 0) - toUInt64({windowHours:UInt32}) * 3600");
    expect(q.sql).toContain("WHERE _deleted_ = 0");
    expect(q.sql).toContain("ORDER BY block_number DESC, log_index DESC");
  });

  it("wide numerics are selected through toString()", () => {
    const t = dataTools.find((x) => x.name === "vault_flows")!;
    const q = buildToolQuery(t, {});
    expect(q.sql).toContain("toString(assets_raw) AS assets_raw");
    expect(q.sql).toContain("toString(execution_rate) AS execution_rate");
    expect(q.sql).not.toContain("toString(block_number)");
  });

  it("view tools: plain view when no window, marker replaced by the window predicate when windowHours is given", () => {
    const g = dataTools.find((x) => x.name === "share_value_growth")!;
    const plain = buildToolQuery(g, {});
    expect(plain.sql).toContain("FROM share_value_growth");
    expect(plain.sql).not.toContain("/*@window*/");
    expect(plain.params).toEqual({ limit: "100" });
    const windowed = buildToolQuery(g, { windowHours: 48 });
    expect(windowed.sql).toContain("FROM (SELECT");
    expect(windowed.sql).toContain("AND call_ok = true AND block_timestamp >= (SELECT max(block_timestamp) FROM share_value_observations WHERE _deleted_ = 0 AND call_ok = true) - toUInt64({windowHours:UInt32}) * 3600");
    expect(windowed.sql).not.toContain("/*@window*/");
    expect(windowed.params.windowHours).toBe("48");
    const f = dataTools.find((x) => x.name === "vault_flows_24h")!;
    expect(f.params.map((p) => p.name)).toEqual(["vault", "limit"]);
    expect(buildToolQuery(f, {}).sql).not.toContain("_deleted_"); // the view filters it itself
  });

  it("is deterministic", () => {
    const t = dataTools.find((x) => x.name === "share_value_observations")!;
    expect(buildToolQuery(t, { vault: manifest.vaults[1], windowHours: 6, limit: 3 })).toEqual(buildToolQuery(t, { vault: manifest.vaults[1], windowHours: 6, limit: 3 }));
  });

  it("identifiers from the manifest are still validated", () => {
    expect(() => assertIdent("vault_flows; DROP TABLE x", "table")).toThrow(SqlBuildError);
    expect(() => buildCountQuery("share_transfers) --", true)).toThrow(SqlBuildError);
    expect(() => buildHeadQuery([{ table: "a b", hasBlockTimestamp: true }])).toThrow(SqlBuildError);
    const bad = { ...dataTools[0]!, orderBy: ["block_number DESC; DROP"] };
    expect(() => buildToolQuery(bad, {})).toThrow(/bad ORDER BY/);
    const badWindow = { ...dataTools[0]!, window: { column: "block_timestamp", table: "vault_flows", where: "1; DROP TABLE x", marker: false } };
    expect(() => buildToolQuery(badWindow, { windowHours: 1 })).toThrow(/where-predicate/);
    expect(() => buildWindowBoundsQuery(badWindow)).toThrow(/where-predicate/);
    expect(buildWindowBoundsQuery(dataTools.find((x) => x.name === "share_value_growth")!)!.sql).toBe(
      "SELECT toUInt64(min(block_timestamp)) AS window_start, toUInt64(max(block_timestamp)) AS window_end, count() AS n FROM share_value_observations WHERE _deleted_ = 0 AND call_ok = true",
    );
    const q = buildColumnsQuery("vaultflows", ["vault_flows", "vaults"]);
    expect(q.sql).toContain("database = {db:String}");
    expect(q.params).toEqual({ db: "vaultflows", tables: "['vault_flows','vaults']" });
    expect(() => buildColumnsQuery("db", ["x'"])).toThrow(SqlBuildError);
  });
});
