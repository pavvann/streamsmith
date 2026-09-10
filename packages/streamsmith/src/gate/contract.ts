// Contract schema derived from buf's FileDescriptorSet JSON: decodes protojson rows (`@data`) into proto-named objects,
// rejecting unknown fields and filling proto3 defaults, and exposes the sink column kinds (uint256 / decimal128) declared
// through (schema.field) convertTo annotations.
import type { FdsJson } from "../proto/descriptor.ts";

export type ScalarKind = "string" | "bool" | "int" | "uint64" | "enum" | "message" | "bytes" | "double";

export interface FieldSchema {
  name: string;
  jsonName: string;
  number: number;
  repeated: boolean;
  kind: ScalarKind;
  /** fully-qualified type name for enum/message */
  typeName?: string;
  convertTo?: "uint256" | "int256" | "decimal128" | "decimal256" | "int128" | "uint128" | "other";
  primaryKey?: boolean;
}

export interface MessageSchema {
  fqn: string;
  fields: FieldSchema[];
  byName: Map<string, FieldSchema>;
  table?: string;
}

export interface EnumSchema {
  fqn: string;
  names: Map<number, string>;
  numbers: Map<string, number>;
}

export class DecodeError extends Error {
  constructor(message: string, public path: string) {
    super(`${path}: ${message}`);
  }
}

type J = Record<string, unknown>;

const INT_TYPES = new Set(["TYPE_INT32", "TYPE_UINT32", "TYPE_SINT32", "TYPE_FIXED32", "TYPE_SFIXED32"]);
const INT64_TYPES = new Set(["TYPE_INT64", "TYPE_UINT64", "TYPE_SINT64", "TYPE_FIXED64", "TYPE_SFIXED64"]);

export class ContractSchema {
  readonly messages = new Map<string, MessageSchema>();
  readonly enums = new Map<string, EnumSchema>();
  readonly package: string;

  constructor(fds: FdsJson, pkg: string) {
    this.package = pkg;
    for (const file of fds.file ?? []) {
      const prefix = file.package ? `.${file.package}` : "";
      for (const m of (file.messageType ?? []) as J[]) this.addMessage(prefix, m);
      for (const e of (file.enumType ?? []) as J[]) this.addEnum(prefix, e);
    }
  }

  private addEnum(prefix: string, e: J): void {
    const fqn = `${prefix}.${String(e.name)}`;
    const names = new Map<number, string>();
    const numbers = new Map<string, number>();
    for (const v of (e.value ?? []) as J[]) {
      const n = Number(v.number ?? 0);
      names.set(n, String(v.name));
      numbers.set(String(v.name), n);
    }
    this.enums.set(fqn, { fqn, names, numbers });
  }

  private addMessage(prefix: string, m: J): void {
    const fqn = `${prefix}.${String(m.name)}`;
    const fields: FieldSchema[] = [];
    for (const f of (m.field ?? []) as J[]) {
      const type = String(f.type ?? "TYPE_STRING");
      const kind: ScalarKind = type === "TYPE_STRING" ? "string" : type === "TYPE_BOOL" ? "bool" : type === "TYPE_ENUM" ? "enum" : type === "TYPE_MESSAGE" ? "message" : type === "TYPE_BYTES" ? "bytes" : INT64_TYPES.has(type) ? "uint64" : INT_TYPES.has(type) ? "int" : "double";
      const name = String(f.name);
      const fs: FieldSchema = { name, jsonName: String(f.jsonName ?? lowerCamel(name)), number: Number(f.number), repeated: f.label === "LABEL_REPEATED", kind };
      if (f.typeName !== undefined) fs.typeName = String(f.typeName);
      const opts = (f.options ?? {}) as J;
      const sf = (opts["[schema.field]"] ?? {}) as J;
      if (sf.primaryKey === true || sf.primary_key === true) fs.primaryKey = true;
      const conv = (sf.convertTo ?? sf.convert_to) as J | undefined;
      if (conv) {
        const key = Object.keys(conv)[0];
        fs.convertTo = key === "uint256" || key === "int256" || key === "decimal128" || key === "decimal256" || key === "int128" || key === "uint128" ? key : "other";
      }
      fields.push(fs);
    }
    const ms: MessageSchema = { fqn, fields, byName: new Map(fields.map((f) => [f.name, f])) };
    const tbl = ((m.options ?? {}) as J)["[schema.table]"] as J | undefined;
    if (tbl?.name !== undefined) ms.table = String(tbl.name);
    this.messages.set(fqn, ms);
    for (const nested of (m.nestedType ?? []) as J[]) this.addMessage(fqn, nested);
    for (const e of (m.enumType ?? []) as J[]) this.addEnum(fqn, e);
  }

  message(fqn: string): MessageSchema {
    const m = this.messages.get(fqn.startsWith(".") ? fqn : `.${fqn}`);
    if (!m) throw new Error(`contract has no message ${fqn}`);
    return m;
  }

  /** Repeated message fields of the root message → table name (from (schema.table) or the field name). */
  tables(rootFqn: string): Array<{ field: FieldSchema; table: string; message: MessageSchema }> {
    const root = this.message(rootFqn);
    const out: Array<{ field: FieldSchema; table: string; message: MessageSchema }> = [];
    for (const f of root.fields) {
      if (!f.repeated || f.kind !== "message" || !f.typeName) continue;
      const message = this.message(f.typeName);
      out.push({ field: f, table: message.table ?? f.name, message });
    }
    return out;
  }

  /** Decode a protojson object into a proto-named record with defaults filled. */
  decode(fqn: string, value: unknown, opts: { rejectUnknownFields?: boolean } = {}, path = "$"): Record<string, unknown> {
    const m = this.message(fqn);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DecodeError(`expected object for ${m.fqn}`, path);
    const src = value as J;
    const byJson = new Map<string, FieldSchema>();
    for (const f of m.fields) {
      byJson.set(f.jsonName, f);
      byJson.set(f.name, f);
    }
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(src)) {
      const f = byJson.get(k);
      if (!f) {
        if (opts.rejectUnknownFields !== false) throw new DecodeError(`unknown field "${k}" in ${m.fqn}`, path);
        continue;
      }
      if (seen.has(f.name)) throw new DecodeError(`field "${f.name}" given twice (proto and JSON name)`, path);
      seen.add(f.name);
      if (v === null) continue;
      out[f.name] = f.repeated
        ? (Array.isArray(v) ? v.map((item, i) => this.decodeScalar(f, item, opts, `${path}.${k}[${i}]`)) : (() => { throw new DecodeError(`expected array for repeated field "${k}"`, path); })())
        : this.decodeScalar(f, v, opts, `${path}.${k}`);
    }
    for (const f of m.fields) if (!(f.name in out)) out[f.name] = f.repeated ? [] : this.defaultFor(f);
    return out;
  }

  private defaultFor(f: FieldSchema): unknown {
    switch (f.kind) {
      case "string": case "bytes": return "";
      case "bool": return false;
      case "int": case "uint64": case "double": return 0;
      case "enum": return this.enums.get(f.typeName ?? "")?.names.get(0) ?? 0;
      case "message": return undefined;
    }
  }

  private decodeScalar(f: FieldSchema, v: unknown, opts: { rejectUnknownFields?: boolean }, path: string): unknown {
    switch (f.kind) {
      case "string": case "bytes":
        if (typeof v !== "string") throw new DecodeError(`expected string, got ${typeof v}`, path);
        return v;
      case "bool":
        if (typeof v !== "boolean") throw new DecodeError(`expected bool, got ${typeof v}`, path);
        return v;
      case "int": case "uint64": {
        if (typeof v === "number" && Number.isInteger(v)) return v;
        if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
        throw new DecodeError(`expected integer, got ${JSON.stringify(v)}`, path);
      }
      case "double":
        if (typeof v === "number") return v;
        if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
        throw new DecodeError(`expected number`, path);
      case "enum": {
        const e = this.enums.get(f.typeName ?? "");
        if (!e) throw new DecodeError(`unknown enum ${f.typeName}`, path);
        if (typeof v === "string") {
          if (!e.numbers.has(v)) throw new DecodeError(`unknown enum value "${v}" for ${e.fqn}`, path);
          return v;
        }
        if (typeof v === "number") return e.names.get(v) ?? v;
        throw new DecodeError(`expected enum name`, path);
      }
      case "message":
        return this.decode(f.typeName!, v, opts, path);
    }
  }
}

export function lowerCamel(snake: string): string {
  return snake.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}
