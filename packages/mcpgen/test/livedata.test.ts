// Cross-checks the generated contract against the REAL output of the package (runs/live/*.jsonl, recorded
// 2026-09-10 from base-mainnet.streamingfast.io:443 with the local build).
//
// `substreams run -o jsonl` prints protojson: field names are lowerCamelCase and default values are omitted.
// The ClickHouse from-proto sink instead creates one column per proto field under its snake_case proto name
// (docs/build/substreams-facts.md (d) 5). This file is the bridge between the two spellings: every key the live
// data actually carries must map onto a column the generator derived from specs/vaultflows.proto, and every
// column views.sql reads must exist in that same set. A rename in the proto that the views missed fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enumMap, parseProto, tablesFromProto, INJECTED_COLUMNS } from "../src/proto.ts";
import { parseViews, WINDOW_MARKER } from "../src/views.ts";
import type { Manifest } from "../runtime/types.ts";
import { GENERATED_DIR, LIVE_OBSERVATION_JSONL, LIVE_PRIMARY_JSONL, REPO_ROOT, SPEC_PROTO, VIEWS_SQL } from "./helpers.ts";

const protoFile = parseProto(readFileSync(SPEC_PROTO, "utf8"));
const tables = tablesFromProto(protoFile);
const columnsOf = (table: string): Set<string> =>
  new Set(tables.find((t) => t.table === table)!.columns.map((c) => c.name));
const manifest = JSON.parse(readFileSync(join(GENERATED_DIR, "manifest.json"), "utf8")) as Manifest;

/** protojson lowerCamelCase -> the proto field name the sink uses as a column name. */
export function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

interface LiveLine {
  "@module": string;
  "@block": number;
  "@type": string;
  "@data": Record<string, Array<Record<string, unknown>>>;
}

function readLive(path: string): LiveLine[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LiveLine);
}

const primary = readLive(LIVE_PRIMARY_JSONL);
const observation = readLive(LIVE_OBSERVATION_JSONL);
const live = [...primary, ...observation];

/**
 * Every repeated field of `Events` -> the table its message declares. Keyed by the snake_case proto field name;
 * live keys are protojson lowerCamelCase, so look them up through `snakeCase()`.
 */
const eventsFieldToTable = new Map<string, string>(
  protoFile.messages[0]!.fields.map((f) => {
    const msg = tables.find((t) => t.message === f.type);
    return [f.name, msg?.table ?? ""];
  }),
);
const tableOfLiveField = (protojsonKey: string): string | undefined => eventsFieldToTable.get(snakeCase(protojsonKey));

describe("live run output (runs/live/*.jsonl) against the proto contract", () => {
  it("is the package and the modules the receipt describes, at or after the receipt's start block", () => {
    expect(live.length).toBeGreaterThan(0);
    for (const l of live) expect(l["@type"]).toBe(`${protoFile.pkg}.Events`);
    // Both recordings come from the package's single output module (manifest.package.outputModule); the second
    // window was re-recorded from map_events when the observation evidence was regenerated.
    for (const set of [primary, observation]) expect([...new Set(set.map((l) => l["@module"]))]).toEqual([manifest.package.outputModule]);
    expect(manifest.package.outputModule).toBe("map_events");
    // The receipt pins startBlock 51001200; the recorded windows sit above it. Nothing downstream may use this
    // number as a window bound: bounds come from min/max of the data (see the observedWindow assertions below).
    expect(manifest.package.startBlock).toBe(51_001_200);
    for (const l of live) expect(l["@block"]).toBeGreaterThanOrEqual(manifest.package.startBlock);
  });

  it("Events' repeated fields name exactly the sink tables (snake_case of the protojson key)", () => {
    const mapped = [...eventsFieldToTable.entries()].map(([field, table]) => [snakeCase(field), table]);
    expect(mapped).toEqual([
      ["vault_flows", "vault_flows"],
      ["share_value_observations", "share_value_observations"],
      ["vaults", "vaults"],
      ["share_transfers", "share_transfers"],
    ]);
    expect(Object.keys(manifest.expectedSchema.tables)).toEqual(mapped.map(([, t]) => t));
  });

  it("every key in every live row is a column the generator derived from the proto", () => {
    const seen = new Map<string, Set<string>>();
    let rows = 0;
    for (const l of live) {
      for (const [field, list] of Object.entries(l["@data"])) {
        const table = tableOfLiveField(field);
        expect(table, `Events has no field ${field}`).toBeTruthy();
        const cols = columnsOf(table!);
        const acc = seen.get(table!) ?? new Set<string>();
        for (const row of list) {
          rows++;
          for (const key of Object.keys(row)) {
            const column = snakeCase(key);
            expect(cols.has(column), `${table}: live key ${key} -> ${column} is not a column of the contract`).toBe(true);
            acc.add(column);
          }
        }
        seen.set(table!, acc);
      }
    }
    // 42 VaultFlow + 1 VaultMeta (primary window) + 4 VaultFlow + 2 ShareValueObservation (observation window)
    expect(rows).toBe(49);
    // What the live data exercised, and what protojson left out because it was a proto3 default value.
    const omitted = (table: string): string[] =>
      [...columnsOf(table)].filter((c) => !seen.get(table)!.has(c) && !INJECTED_COLUMNS.some((i) => i.name === c)).sort();
    expect(omitted("vault_flows")).toEqual(["call_error"]);
    expect(omitted("share_value_observations")).toEqual(["call_error"]);
    expect(omitted("vaults")).toEqual(["call_error", "in_configured_list"]);
    expect(seen.has("share_transfers")).toBe(false); // optional table, empty in v0.1.0
  });

  it("flow and observation rows carry only the receipt's vaults; the metadata probe is chain-wide", () => {
    const perTable = new Map<string, Set<string>>();
    for (const l of live) {
      for (const [field, list] of Object.entries(l["@data"])) {
        const table = tableOfLiveField(field)!;
        const acc = perTable.get(table) ?? new Set<string>();
        for (const row of list) {
          expect(Number(row.chainId)).toBe(manifest.package.chainId);
          if (typeof row.vault === "string") acc.add(row.vault);
          if (row.sampleIntervalBlocks !== undefined) expect(Number(row.sampleIntervalBlocks)).toBe(1800);
        }
        perTable.set(table, acc);
      }
    }
    // The tools that filter by vault expose exactly the receipt's list, and the data agrees.
    expect([...perTable.get("vault_flows")!].sort()).toEqual(manifest.vaults);
    expect([...perTable.get("share_value_observations")!].sort()).toEqual(manifest.vaults);
    // VaultMeta is a first-sight probe of every address that emitted a matching Deposit/Withdraw, so the
    // `vaults` table legitimately holds addresses outside the configured list; in_configured_list marks them
    // (protojson omits it when false, which is why it is absent from the live row above).
    const probed = [...perTable.get("vaults")!];
    expect(probed.length).toBeGreaterThan(0);
    expect(probed.some((v) => !manifest.vaults.includes(v))).toBe(true);
    for (const l of primary) for (const row of l["@data"].vaults ?? []) {
      if (!manifest.vaults.includes(String(row.vault))) expect(row.inConfiguredList ?? false).toBe(false);
    }
  });

  it("both flow directions occur in the live data and the generated filter binds the stored representation", () => {
    const filter = manifest.tools.find((t) => t.name === "vault_flows")!.params.find((p) => p.name === "direction")!;
    const seen = new Set<string>();
    for (const l of primary) for (const row of l["@data"].vaultFlows ?? []) seen.add(String(row.direction));
    // These lines were recorded before the contract dropped the FlowDirection enum (substreams-sink-sql 4.13.1
    // from-proto panics on a populated proto3 enum), so they still carry the protojson enum names. Normalize the
    // recorded spelling to the contract's value names; a re-recorded run prints "deposit"/"withdraw" directly.
    const normalized = [...seen].map((v) => v.replace(/^FLOW_DIRECTION_/, "").toLowerCase()).sort();
    expect(normalized).toEqual(["deposit", "withdraw"]);
    expect(filter.values).toEqual(normalized);
    // `direction` is a plain String column now, so the bound value is the name itself.
    expect(protoFile.enums).toEqual([]);
    expect(enumMap(protoFile)).toEqual({});
    expect(filter.chType).toBe("String");
    expect(filter.valueMap).toEqual({ deposit: "deposit", withdraw: "withdraw" });
    const directionColumn = tables.find((t) => t.table === "vault_flows")!.columns.find((c) => c.name === "direction")!;
    expect(directionColumn.type).toBe(filter.chType);
  });

  it("the numeric-string convention holds in the live data (never empty; flags say when a value is unusable)", () => {
    const decimal = /^\d+(\.\d{1,18})?$/;
    for (const l of primary) {
      for (const row of l["@data"].vaultFlows ?? []) {
        for (const k of ["assetsRaw", "sharesRaw", "assetsNormalized", "sharesNormalized", "executionRate"]) {
          expect(typeof row[k], `${k}`).toBe("string");
          expect(String(row[k]), `${k}=${String(row[k])}`).toMatch(decimal);
        }
        expect(row.callOk).toBe(true);
      }
    }
    for (const l of observation) {
      for (const row of l["@data"].shareValueObservations ?? []) {
        expect(String(row.assetsPerShareNormalized)).toMatch(decimal);
        expect(String(row.totalSupplyRaw)).toMatch(/^\d+$/);
        expect(row.callOk).toBe(true);
      }
    }
  });
});

// ---- views.sql read against the same contract ----

const views = parseViews(readFileSync(VIEWS_SQL, "utf8"));
const SQL_WORDS = new Set([
  "with", "select", "from", "where", "group", "by", "as", "and", "or", "not", "null", "create", "replace", "view",
  "true", "false", "on", "order", "limit", "asc", "desc", "distinct", "union", "all", "is", "in", "join", "left",
  "inner", "case", "when", "then", "else", "end", "over", "partition", "having", "using", "if", "exists",
]);

/** Identifiers a view body reads from its base tables: everything that is not an alias, a keyword or a function call. */
function baseColumnsRead(body: string): { tables: string[]; columns: string[] } {
  // Drop the window marker and every string literal first: 'deposit' is a value, not an identifier.
  const sql = body.replace(WINDOW_MARKER, " ").replace(/'[^']*'/g, "''");
  const aliases = new Set<string>();
  for (const m of sql.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) aliases.add(m[1]!);
  const tablesRead = new Set<string>();
  for (const m of sql.matchAll(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) tablesRead.add(m[1]!);
  const columns = new Set<string>();
  for (const m of sql.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g)) {
    const [, ident, call] = m;
    if (call) continue; // function name
    if (!ident || aliases.has(ident) || tablesRead.has(ident) || SQL_WORDS.has(ident.toLowerCase())) continue;
    columns.add(ident);
  }
  return { tables: [...tablesRead].sort(), columns: [...columns].sort() };
}

describe("views.sql reads only real tables and columns", () => {
  it("every FROM names a table declared by an option (schema.table) in the proto", () => {
    const declared = new Set(tables.map((t) => t.table));
    for (const v of views) {
      const { tables: read } = baseColumnsRead(v.body);
      expect(read.length, `${v.name} reads no base table`).toBeGreaterThan(0);
      for (const t of read) expect(declared.has(t), `${v.name} reads unknown table ${t}`).toBe(true);
    }
    expect(views.map((v) => baseColumnsRead(v.body).tables)).toEqual([["vault_flows"], ["share_value_observations"]]);
    // and the window annotation's table is one of them
    expect(views[1]!.window!.table).toBe("share_value_observations");
  });

  it("every base-table column a view reads exists in the proto contract (or is an injected sink column)", () => {
    for (const v of views) {
      const { tables: read, columns } = baseColumnsRead(v.body);
      const allowed = new Set<string>();
      for (const t of read) for (const c of columnsOf(t)) allowed.add(c);
      for (const c of columns) expect(allowed.has(c), `${v.name}: column ${c} is not in ${read.join("/")}`).toBe(true);
    }
    expect(baseColumnsRead(views[0]!.body).columns).toEqual(["_deleted_", "assets_normalized", "block_timestamp", "direction", "meta_valid", "vault"]);
    expect(baseColumnsRead(views[1]!.body).columns).toEqual(["_deleted_", "assets_per_share_normalized", "block_number", "block_timestamp", "call_ok", "vault"]);
  });

  it("the columns the live data actually populates cover everything the views read", () => {
    const populated = new Map<string, Set<string>>();
    for (const l of live) {
      for (const [field, list] of Object.entries(l["@data"])) {
        const table = tableOfLiveField(field)!;
        const acc = populated.get(table) ?? new Set<string>();
        for (const row of list) for (const k of Object.keys(row)) acc.add(snakeCase(k));
        populated.set(table, acc);
      }
    }
    for (const v of views) {
      const { tables: read, columns } = baseColumnsRead(v.body);
      for (const c of columns) {
        if (INJECTED_COLUMNS.some((i) => i.name === c)) continue; // written by the sink, absent from protojson
        const ok = read.some((t) => populated.get(t)?.has(c));
        expect(ok, `${v.name} reads ${c}, which the live run never populated in ${read.join("/")}`).toBe(true);
      }
    }
  });

  it("every literal a view compares a base column to matches that column's ClickHouse type", () => {
    // The failure this guards against is silent: `direction = 1` against a String column, or `direction =
    // 'deposit'` against an Int32 one, parses fine and matches no rows. Types come from the proto.
    const checked: string[] = [];
    for (const v of views) {
      const { tables: read } = baseColumnsRead(v.body);
      const typeOf = (name: string): string | undefined =>
        read.map((t) => tables.find((x) => x.table === t)!.columns.find((c) => c.name === name)?.type).find(Boolean);
      for (const m of v.body.matchAll(/\b([a-z_][a-z0-9_]*)\s*=\s*('[^']*'|-?\d+(?:\.\d+)?|true|false)/g)) {
        const [, column, literal] = m as unknown as [string, string, string];
        const type = typeOf(column);
        if (!type) continue; // an alias or an output column, not a base-table column
        const quoted = literal.startsWith("'");
        const boolean = literal === "true" || literal === "false";
        if (type === "String") {
          expect(quoted, `${v.name}: ${column} is String but is compared to ${literal}`).toBe(true);
        } else if (type === "Bool") {
          expect(boolean, `${v.name}: ${column} is Bool but is compared to ${literal}`).toBe(true);
        } else {
          expect(quoted, `${v.name}: ${column} is ${type} but is compared to the string ${literal}`).toBe(false);
        }
        checked.push(`${v.name}:${column}=${literal}`);
      }
    }
    // the direction comparisons and the _deleted_/call_ok/meta_valid flags are all covered
    expect(checked).toContain("vault_flows_24h:direction='deposit'");
    expect(checked).toContain("vault_flows_24h:direction='withdraw'");
    expect(checked).toContain("share_value_growth:call_ok=true");
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });

  it("each view is a single statement, because ClickHouse over HTTP rejects a multi-statement body", () => {
    // "Multi-statements are not allowed" (code 62): whoever applies views.sql must send one request per view,
    // which is exactly what parseViews hands back.
    expect(views.length).toBe(2);
    for (const v of views) {
      expect(v.ddl).not.toContain(";");
      expect(v.ddl.match(/\bCREATE\b/gi)!.length).toBe(1);
    }
    expect(readFileSync(VIEWS_SQL, "utf8")).toContain("Multi-statements are not allowed");
  });

  it("windows are anchored on the data: no view or tool mentions the configured start block", () => {
    const start = String(manifest.package.startBlock);
    for (const v of views) expect(v.ddl).not.toContain(start);
    for (const v of views) if (v.window) expect(v.body).toContain(WINDOW_MARKER);
    // the marker is replaced by max(<column>) over live rows, never by a constant
    expect(views[1]!.window!.where).toBe("_deleted_ = 0 AND call_ok = true");
    expect(readFileSync(join(GENERATED_DIR, "src", "tools.generated.ts"), "utf8")).not.toContain(start);
    for (const t of manifest.tools) {
      if (!t.window) continue;
      expect(t.window.column).toBe("block_timestamp");
      expect(columnsOf(t.window.table).has("block_timestamp")).toBe(true);
    }
  });
});

describe("live sink evidence", () => {
  it("the sink's own schema-hash file matches what the sink logged (its 64-bit hash, not receipt.sinkSchemaHash)", () => {
    const file = readFileSync(join(REPO_ROOT, "packages", "mcpgen", "fixtures", "vaultflows_schema_hash.txt"), "utf8").trim();
    expect(file).toMatch(/^[0-9a-f]{16}$/);
    const logged = readFileSync(join(REPO_ROOT, "runs", "live", "sink-run1b.err"), "utf8");
    expect(logged).toContain(`"schema_hash":"${file}"`);
    // receipt.sinkSchemaHash is a sha256 of the applied DDL and is a different value by construction.
    expect(manifest.receipt.sinkSchemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.receipt.sinkSchemaHash).not.toContain(file);
  });
});
