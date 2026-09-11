// Offline ClickHouse DDL renderer — the from-proto sink's `CREATE TABLE` derived from the package's own proto
// descriptors instead of from a live database.
//
// Why this exists: `sinkSchemaHash` used to be obtainable only by dumping a live database (`schema-dump`), so any
// database problem took out the receipt and, behind it, the MCP (docs/build/rehearsal-1.md R1). The from-proto sink
// derives its DDL from the annotated proto and nothing else (docs/build/substreams-facts.md (d) 2-6), so the same
// DDL can be rendered from the spkg with no network at all.
//
// What is rendered is the DDL **as the server reports it back** (`SHOW CREATE TABLE`), not the `CREATE TABLE IF NOT
// EXISTS …` string the sink sends — because `schema-dump`, and therefore every `sinkSchemaHash` written so far,
// hashes the server's rendering. The two differ only in ways the server fixes deterministically:
//
//   sink sends (runs/live/sink-a9-run1.err)   server reports (runs/<id>/schema.sql)
//   ---------------------------------------   ------------------------------------------------
//   VARCHAR                                    String
//   timestamp                                  DateTime
//   bool / Bool                                Bool
//   Decimal128(18)                             Decimal(38, 18)
//   ReplacingMergeTree(_version_, _deleted_)   SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}',
//                                              '{replica}', _version_, _deleted_)   ← ClickHouse **Cloud** only
//   (nothing)                                  index_granularity = 8192             ← server default, always echoed
//   CREATE TABLE IF NOT EXISTS, unquoted        CREATE TABLE, `backticked` column names, one per line
//
// The engine substitution is the one server-dependent part, so it is a flavor: `clickhouse-cloud` (default, the
// deployment this repo targets, verified byte-for-byte against the committed cloud dump in
// test/schema-render.test.ts) and `clickhouse-oss` (a self-hosted server keeps `ReplacingMergeTree`). Everything
// else — column order, types, keys, partitioning — is a pure function of the descriptor.
import type { Ctx } from "../util/ctx.ts";
import { spkgDescriptor, type FdsJson } from "../proto/descriptor.ts";
import { normalizeSql } from "../receipt.ts";
import { sha256Hex } from "../util/hash.ts";

export type SchemaFlavor = "clickhouse-cloud" | "clickhouse-oss";

export const SCHEMA_FLAVORS: Record<string, SchemaFlavor> = {
  cloud: "clickhouse-cloud",
  "clickhouse-cloud": "clickhouse-cloud",
  oss: "clickhouse-oss",
  "clickhouse-oss": "clickhouse-oss",
};

export interface RenderSchemaOptions {
  /** database the sink writes into; it prefixes every table name, so it is part of the hash */
  database: string;
  flavor?: SchemaFlavor;
}

export interface RenderedSchema {
  sql: string;
  /** sha256 of normalizeSql(sql) — the same function `schema-dump` / `hash sql` apply */
  hash: string;
  tables: string[];
  database: string;
  flavor: SchemaFlavor;
}

/** Columns the sink injects ahead of every proto field (facts (d) 5); `_version_`/`_deleted_` are ClickHouse-only. */
export const INJECTED_COLUMNS: Array<[string, string]> = [
  ["_block_number_", "UInt64"],
  ["_block_timestamp_", "DateTime"],
  ["_version_", "Int64"],
  ["_deleted_", "Bool"],
];

const SCALAR_TYPES: Record<string, string> = {
  TYPE_STRING: "String",
  TYPE_BOOL: "Bool",
  TYPE_INT32: "Int32",
  TYPE_SINT32: "Int32",
  TYPE_SFIXED32: "Int32",
  TYPE_INT64: "Int64",
  TYPE_SINT64: "Int64",
  TYPE_SFIXED64: "Int64",
  TYPE_UINT32: "UInt32",
  TYPE_FIXED32: "UInt32",
  TYPE_UINT64: "UInt64",
  TYPE_FIXED64: "UInt64",
  TYPE_DOUBLE: "Float64",
  TYPE_FLOAT: "Float32",
};

interface TableOption {
  name?: string;
  clickhouseTableOptions?: {
    orderByFields?: Array<{ name?: string }>;
    partitionFields?: Array<{ name?: string; function?: string }>;
  };
}
interface FieldOption {
  primaryKey?: boolean;
  convertTo?: Record<string, { scale?: number }>;
}
interface FieldJson {
  name?: string;
  type?: string;
  label?: string;
  typeName?: string;
  options?: Record<string, unknown>;
}
interface MessageJson {
  name?: string;
  field?: FieldJson[];
  options?: Record<string, unknown>;
}

const tableOption = (m: MessageJson): TableOption | undefined => m.options?.["[schema.table]"] as TableOption | undefined;
const fieldOption = (f: FieldJson): FieldOption | undefined => f.options?.["[schema.field]"] as FieldOption | undefined;

/** Wide-numeric mapping of `(schema.field).convertTo` (facts (d) 6), as ClickHouse renders it back. */
export function convertToType(convertTo: Record<string, { scale?: number }>): string {
  const [kind, opts] = Object.entries(convertTo)[0] ?? [];
  switch (kind) {
    case "uint256": return "UInt256";
    case "int256": return "Int256";
    case "uint128": return "UInt128";
    case "int128": return "Int128";
    // Decimal128(S) is Decimal(38, S) and Decimal256(S) is Decimal(76, S); SHOW CREATE reports the second form
    case "decimal128": return `Decimal(38, ${opts?.scale ?? 0})`;
    case "decimal256": return `Decimal(76, ${opts?.scale ?? 0})`;
    default: throw new Error(`unsupported (schema.field).convertTo option "${kind ?? "(none)"}"`);
  }
}

function columnType(table: string, f: FieldJson): string | undefined {
  const convertTo = fieldOption(f)?.convertTo;
  if (convertTo) return convertToType(convertTo);
  if (f.label === "LABEL_REPEATED") throw new Error(`${table}.${f.name}: repeated fields are not supported by the from-proto sink`);
  if (f.type === "TYPE_ENUM") throw new Error(`${table}.${f.name}: enum fields are not supported (substreams-sink-sql 4.13.1 panics on a populated proto3 enum); use a string column`);
  if (f.type === "TYPE_BYTES") throw new Error(`${table}.${f.name}: bytes fields have no verified ClickHouse mapping; emit a hex string instead`);
  if (f.type === "TYPE_MESSAGE") {
    if (f.typeName === ".google.protobuf.Timestamp") return "DateTime";
    return undefined; // dropped by the sink (specs/vaultflows.proto "Conventions": message-typed fields are dropped)
  }
  const t = SCALAR_TYPES[f.type ?? ""];
  if (!t) throw new Error(`${table}.${f.name}: unsupported proto type ${f.type ?? "(none)"}`);
  return t;
}

/** `(a)` collapses to `a` in SHOW CREATE output; a multi-column key keeps its tuple. */
function keyExpr(parts: string[]): string {
  return parts.length === 1 ? parts[0]! : `(${parts.join(", ")})`;
}

function engineClause(flavor: SchemaFlavor): string {
  return flavor === "clickhouse-cloud"
    ? "ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version_, _deleted_)"
    : "ENGINE = ReplacingMergeTree(_version_, _deleted_)";
}

/**
 * Table order. The sink walks the output module's message in field order, so when the file contains exactly one
 * message that is not itself a table and whose fields are all repeated table messages (the sink module's output
 * type, `Events` here), that field order wins; otherwise declaration order does.
 */
function orderedTableMessages(messages: MessageJson[], pkg: string): MessageJson[] {
  const tables = messages.filter((m) => tableOption(m));
  const byFullName = new Map(tables.map((m) => [`.${pkg}.${m.name}`, m]));
  const roots = messages.filter(
    (m) => !tableOption(m) && (m.field?.length ?? 0) > 0 && m.field!.every((f) => f.label === "LABEL_REPEATED" && f.type === "TYPE_MESSAGE" && byFullName.has(f.typeName ?? "")),
  );
  if (roots.length !== 1) return tables;
  const ordered = roots[0]!.field!.map((f) => byFullName.get(f.typeName!)!);
  // any table message the root does not reference still belongs in the schema, after the ones it does
  return [...ordered, ...tables.filter((m) => !ordered.includes(m))];
}

/** Pure renderer: buf's FileDescriptorSet JSON in, the sink's ClickHouse DDL out. */
export function renderSchemaSql(fds: FdsJson, pkg: string, opts: RenderSchemaOptions): RenderedSchema {
  const files = (fds.file ?? []).filter((f) => f.package === pkg);
  if (files.length !== 1) throw new Error(`expected exactly one file for package ${pkg}, found ${files.length}`);
  const messages = (files[0]!.messageType ?? []) as MessageJson[];
  const flavor = opts.flavor ?? "clickhouse-cloud";
  const db = opts.database;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(db)) throw new Error(`unsafe database name: ${db}`);
  const tableMessages = orderedTableMessages(messages, pkg);
  if (!tableMessages.length) throw new Error(`no message in package ${pkg} carries option (schema.table); the from-proto sink would create no tables`);

  const tables: string[] = [];
  const blocks: string[] = [];
  for (const m of tableMessages) {
    const t = tableOption(m)!;
    const name = t.name;
    if (!name) throw new Error(`message ${m.name}: (schema.table).name is required`);
    const fields = m.field ?? [];

    const columns = [...INJECTED_COLUMNS];
    for (const f of fields) {
      const type = columnType(name, f);
      if (type !== undefined) columns.push([f.name ?? "", type]);
    }

    const pks = fields.filter((f) => fieldOption(f)?.primaryKey).map((f) => f.name ?? "");
    if (pks.length !== 1) throw new Error(`table ${name}: from-proto supports exactly one primary_key field, found ${pks.length}${pks.length ? ` (${pks.join(", ")})` : ""}`);
    const order = (t.clickhouseTableOptions?.orderByFields ?? []).map((f) => f.name ?? "");
    if (!order.length) throw new Error(`table ${name}: clickhouse_table_options.order_by_fields is required (>= 1 field)`);
    if (order[0] !== pks[0]) throw new Error(`table ${name}: order_by_fields[0] must be the primary key (${pks[0]}), got ${order[0]}`);
    // facts (d) 5: PARTITION BY toYYYYMM(_block_timestamp_) is auto-prepended when none is declared
    const partition = (t.clickhouseTableOptions?.partitionFields ?? []).map((f) => (f.function ? `${f.function}(${f.name})` : `${f.name}`));
    if (!partition.length) partition.push("toYYYYMM(_block_timestamp_)");

    tables.push(name);
    blocks.push(
      [
        `-- ${db}.${name}`,
        `CREATE TABLE ${db}.${name}`,
        "(",
        columns.map(([c, ty]) => `    \`${c}\` ${ty}`).join(",\n"),
        ")",
        engineClause(flavor),
        `PARTITION BY ${keyExpr(partition)}`,
        `PRIMARY KEY ${keyExpr(pks)}`,
        `ORDER BY ${keyExpr(order)}`,
        "SETTINGS allow_experimental_replacing_merge_with_cleanup = 1, index_granularity = 8192;",
      ].join("\n"),
    );
  }
  const sql = normalizeSql(blocks.join("\n\n"));
  return { sql, hash: sha256Hex(sql), tables, database: db, flavor };
}

/** Same thing, reading the descriptors straight out of an .spkg (needs `buf`, no network, no database). */
export async function renderSchemaFromSpkg(ctx: Ctx, spkgPath: string, pkg: string, opts: RenderSchemaOptions): Promise<RenderedSchema> {
  const d = await spkgDescriptor(ctx, spkgPath, pkg);
  return renderSchemaSql(d.fds, pkg, opts);
}
