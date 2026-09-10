import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WINDOW_MARKER, parseViews } from "../src/views.ts";
import { VIEWS_SQL } from "./helpers.ts";

describe("views.sql annotations", () => {
  const views = parseViews(readFileSync(VIEWS_SQL, "utf8"));

  it("declares the two views from specs/streamsmith.yaml sink.views", () => {
    expect(views.map((v) => v.name)).toEqual(["vault_flows_24h", "share_value_growth"]);
  });

  it("types every output column", () => {
    const f = views[0]!;
    expect(f.columns.map((c) => c.name)).toEqual([
      "vault", "window_end_timestamp", "window_start_timestamp", "deposit_count", "withdraw_count",
      "assets_in_normalized", "assets_out_normalized", "net_assets_normalized", "flows_without_metadata",
    ]);
    expect(f.columns.find((c) => c.name === "assets_in_normalized")!.type).toBe("Decimal(38, 18)");
    const g = views[1]!;
    expect(g.columns.map((c) => c.name)).toEqual([
      "vault", "first_block_number", "first_block_timestamp", "first_assets_per_share_normalized", "last_block_number", "last_block_timestamp",
      "last_assets_per_share_normalized", "growth", "observed_hours", "observation_count",
    ]);
    expect(g.columns.find((c) => c.name === "growth")!.type).toBe("Nullable(Float64)");
  });

  it("every base-table read filters _deleted_ = 0 and growth only uses call_ok rows", () => {
    for (const v of views) expect(v.ddl).toMatch(/_deleted_ = 0/);
    expect(views[1]!.body).toMatch(/call_ok = true/);
    expect(views[1]!.body).toMatch(/argMin\(assets_per_share_normalized, block_number\)/);
  });

  it("only share_value_growth carries a window marker, and the DDL keeps it as a comment", () => {
    expect(views[0]!.window).toBeUndefined();
    expect(views[0]!.body).not.toContain(WINDOW_MARKER);
    expect(views[1]!.window).toEqual({ column: "block_timestamp", table: "share_value_observations", where: "_deleted_ = 0 AND call_ok = true" });
    expect(views[1]!.body).toContain(WINDOW_MARKER);
    expect(views[1]!.ddl.startsWith("CREATE OR REPLACE VIEW share_value_growth AS")).toBe(true);
  });

  it("rejects a marker without annotation and an annotation without marker", () => {
    expect(() => parseViews(`-- @view v\n-- @column a String x\nCREATE VIEW v AS SELECT 1 AS a WHERE 1 /*@window*/;`)).toThrow(/no @window annotation/);
    expect(() => parseViews(`-- @view v\n-- @column a String x\n-- @window column=a table=t where=1\nCREATE VIEW v AS SELECT 1 AS a;`)).toThrow(/no \/\*@window\*\/ marker/);
    expect(() => parseViews(`-- @view v\n-- @column a String x\n-- @window column=a table=t where=1; DROP TABLE t\nCREATE VIEW v AS SELECT 1 AS a WHERE 1 /*@window*/;`)).toThrow(/must not contain/);
    expect(() => parseViews(`CREATE VIEW v AS SELECT 1 AS a;`)).toThrow(/no -- @view annotation/);
  });
});
