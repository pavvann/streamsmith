// Minimal proto3 parser for public-contract files such as specs/vaultflows.proto.
//
// Supported: `syntax`, `package`, `import`, file-level `option`, `enum` (with values), top-level `message`
// with scalar / enum / message-typed fields (`repeated`, `optional` modifiers), `reserved` statements,
// message-level `option (schema.table) = { ...text-format... };` and field options
// `[(schema.field) = { ...text-format... }]`, `//` and `/* */` comments (a field's trailing `//` comment is
// kept as its description).
//
// Not supported (documented limits, the generator refuses with a clear error): nested message/enum
// definitions, `oneof`, `map<K,V>`, `extend`, `service`, `group`, proto2 `required`, and multi-file
// resolution of imported types (imported types are treated as opaque message types, which the from-proto
// sink skips anyway unless they are google.protobuf.Timestamp).

export interface ProtoField {
  name: string;
  number: number;
  /** proto scalar name (string, uint64, ...), enum name, or message type name as written */
  type: string;
  repeated: boolean;
  optional: boolean;
  /** trailing `//` comment on the field line, if any */
  comment: string;
  /** parsed `(schema.field)` option, text-format as nested objects */
  fieldOption: TextValue | undefined;
}

export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  /** leading comment block right above the message */
  comment: string;
  /** parsed `(schema.table)` option */
  tableOption: TextValue | undefined;
  reservedNumbers: number[];
  reservedNames: string[];
}

export interface ProtoEnum {
  name: string;
  values: Array<{ name: string; number: number; comment: string }>;
}

export interface ProtoFile {
  syntax: string;
  pkg: string;
  imports: string[];
  messages: ProtoMessage[];
  enums: ProtoEnum[];
}

/** Text-format value: scalar (string | number | boolean | identifier), list, or nested message object. */
export type TextValue = string | number | boolean | TextValue[] | { [key: string]: TextValue };

export class ProtoParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`proto parse error (line ${line}): ${message}`);
    this.line = line;
  }
}

// ---- tokenizer ----

interface Token {
  kind: "ident" | "number" | "string" | "punct" | "comment";
  value: string;
  line: number;
  /** true when this comment token starts on the same line as the previous non-comment token */
  trailing?: boolean;
}

const PUNCT = new Set(["{", "}", "[", "]", "(", ")", "=", ";", ":", ",", "<", ">", "."]);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lastTokenLine = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const text = src.slice(i + 2, end === -1 ? n : end).trim();
      tokens.push({ kind: "comment", value: text, line, trailing: lastTokenLine === line });
      i = end === -1 ? n : end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) throw new ProtoParseError("unterminated block comment", line);
      const text = src.slice(i + 2, end);
      tokens.push({ kind: "comment", value: text.trim(), line, trailing: lastTokenLine === line });
      line += (text.match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") { out += src[j + 1] ?? ""; j += 2; continue; }
        if (src[j] === "\n") throw new ProtoParseError("newline in string literal", line);
        out += src[j];
        j++;
      }
      if (j >= n) throw new ProtoParseError("unterminated string literal", line);
      tokens.push({ kind: "string", value: out, line });
      lastTokenLine = line;
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX.eE+-]/.test(src[j]!)) j++;
      tokens.push({ kind: "number", value: src.slice(i, j), line });
      lastTokenLine = line;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: "ident", value: src.slice(i, j), line });
      lastTokenLine = line;
      i = j;
      continue;
    }
    if (PUNCT.has(c)) {
      tokens.push({ kind: "punct", value: c, line });
      lastTokenLine = line;
      i++;
      continue;
    }
    throw new ProtoParseError(`unexpected character ${JSON.stringify(c)}`, line);
  }
  return tokens;
}

// ---- parser ----

class Parser {
  private pos = 0;
  /** comments seen since the last consumed non-comment token, joined; used as leading comments */
  private pendingComments: string[] = [];
  private lastTrailing = "";
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peekRaw(offset = 0): Token | undefined { return this.tokens[this.pos + offset]; }

  /** Skips comments, collecting them; returns the next significant token without consuming it. */
  peek(): Token | undefined {
    while (this.peekRaw()?.kind === "comment") {
      const t = this.peekRaw()!;
      if (t.trailing) this.lastTrailing = t.value; else this.pendingComments.push(t.value);
      this.pos++;
    }
    return this.peekRaw();
  }

  next(): Token {
    const t = this.peek();
    if (!t) throw new ProtoParseError("unexpected end of file", this.tokens.at(-1)?.line ?? 0);
    this.pos++;
    return t;
  }

  takeLeadingComment(): string {
    const c = this.pendingComments.join("\n").trim();
    this.pendingComments = [];
    return c;
  }

  /** Trailing comment on the current line after the last consumed token (consumed lazily by peek()). */
  takeTrailingComment(): string {
    const line = this.tokens[this.pos - 1]?.line;
    const t = this.peekRaw();
    if (t && t.kind === "comment" && t.trailing && t.line === line) {
      this.pos++;
      return t.value;
    }
    return "";
  }

  expect(kind: Token["kind"], value?: string): Token {
    const t = this.next();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new ProtoParseError(`expected ${value ?? kind}, got ${JSON.stringify(t.value)}`, t.line);
    }
    return t;
  }

  accept(kind: Token["kind"], value?: string): Token | undefined {
    const t = this.peek();
    if (t && t.kind === kind && (value === undefined || t.value === value)) { this.pos++; return t; }
    return undefined;
  }

  parseFile(): ProtoFile {
    const file: ProtoFile = { syntax: "", pkg: "", imports: [], messages: [], enums: [] };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.kind !== "ident") throw new ProtoParseError(`unexpected token ${JSON.stringify(t.value)}`, t.line);
      switch (t.value) {
        case "syntax": {
          this.next(); this.expect("punct", "="); file.syntax = this.expect("string").value; this.expect("punct", ";");
          this.takeLeadingComment();
          break;
        }
        case "package": {
          this.next(); file.pkg = this.parseDottedName(); this.expect("punct", ";");
          this.takeLeadingComment();
          break;
        }
        case "import": {
          this.next();
          if (this.accept("ident", "public") || this.accept("ident", "weak")) { /* modifiers ignored */ }
          file.imports.push(this.expect("string").value); this.expect("punct", ";");
          this.takeLeadingComment();
          break;
        }
        case "option": {
          this.next(); this.parseOptionStatement(); this.takeLeadingComment();
          break;
        }
        case "enum": file.enums.push(this.parseEnum()); break;
        case "message": file.messages.push(this.parseMessage()); break;
        case "service": case "extend":
          throw new ProtoParseError(`'${t.value}' is not supported by mcpgen's proto parser`, t.line);
        default:
          throw new ProtoParseError(`unexpected identifier ${JSON.stringify(t.value)} at file level`, t.line);
      }
    }
    return file;
  }

  private parseDottedName(): string {
    let name = this.expect("ident").value;
    while (this.accept("punct", ".")) name += "." + this.expect("ident").value;
    return name;
  }

  /** `option NAME = VALUE;` or `option (ext.name) = VALUE;`; returns [name, value] */
  private parseOptionStatement(): [string, TextValue] {
    const [name, value] = this.parseOptionBody();
    this.expect("punct", ";");
    return [name, value];
  }

  private parseOptionBody(): [string, TextValue] {
    let name: string;
    if (this.accept("punct", "(")) {
      name = this.parseDottedName();
      this.expect("punct", ")");
      while (this.accept("punct", ".")) name += "." + this.expect("ident").value;
    } else {
      name = this.parseDottedName();
    }
    this.expect("punct", "=");
    const value = this.parseTextValue();
    return [name, value];
  }

  /** Parses a text-format value: scalar, `{ ... }` message, or `[ ... ]` list. */
  private parseTextValue(): TextValue {
    const t = this.peek();
    if (!t) throw new ProtoParseError("unexpected end of file in option value", 0);
    if (t.kind === "punct" && t.value === "{") return this.parseTextMessage();
    if (t.kind === "punct" && t.value === "[") {
      this.next();
      const items: TextValue[] = [];
      if (!this.accept("punct", "]")) {
        for (;;) {
          items.push(this.parseTextValue());
          if (this.accept("punct", "]")) break;
          this.expect("punct", ",");
        }
      }
      return items;
    }
    const tok = this.next();
    if (tok.kind === "string") return tok.value;
    if (tok.kind === "number") return Number(tok.value);
    if (tok.kind === "ident") {
      if (tok.value === "true") return true;
      if (tok.value === "false") return false;
      return tok.value; // enum identifier such as toYYYYMM
    }
    throw new ProtoParseError(`unexpected token ${JSON.stringify(tok.value)} in option value`, tok.line);
  }

  private parseTextMessage(): { [key: string]: TextValue } {
    this.expect("punct", "{");
    const obj: { [key: string]: TextValue } = {};
    for (;;) {
      if (this.accept("punct", "}")) return obj;
      const key = this.expect("ident").value;
      let value: TextValue;
      if (this.accept("punct", ":")) {
        value = this.parseTextValue();
      } else {
        // text-format allows `field { ... }` without a colon for message-typed fields (e.g. `uint256{}`)
        value = this.parseTextMessage();
      }
      // repeated field written as several entries -> accumulate
      if (key in obj) {
        const prev = obj[key]!;
        obj[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
      } else obj[key] = value;
      this.accept("punct", ",") || this.accept("punct", ";");
    }
  }

  private parseEnum(): ProtoEnum {
    const leading = this.takeLeadingComment();
    void leading;
    this.expect("ident", "enum");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const values: ProtoEnum["values"] = [];
    for (;;) {
      if (this.accept("punct", "}")) break;
      const t = this.peek();
      if (t?.kind === "ident" && t.value === "option") { this.next(); this.parseOptionStatement(); continue; }
      if (t?.kind === "ident" && t.value === "reserved") { this.next(); this.skipToSemicolon(); continue; }
      const vname = this.expect("ident").value;
      this.expect("punct", "=");
      const num = Number(this.expect("number").value);
      if (this.accept("punct", "[")) { this.skipBracketed("]"); }
      this.expect("punct", ";");
      const comment = this.takeTrailingComment();
      this.takeLeadingComment();
      values.push({ name: vname, number: num, comment });
    }
    this.accept("punct", ";");
    return { name, values };
  }

  private parseMessage(): ProtoMessage {
    const comment = this.takeLeadingComment();
    const start = this.expect("ident", "message");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const msg: ProtoMessage = { name, fields: [], comment, tableOption: undefined, reservedNumbers: [], reservedNames: [] };
    for (;;) {
      if (this.accept("punct", "}")) break;
      const t = this.peek();
      if (!t) throw new ProtoParseError(`unterminated message ${name}`, start.line);
      if (t.kind !== "ident") throw new ProtoParseError(`unexpected token ${JSON.stringify(t.value)} in message ${name}`, t.line);
      switch (t.value) {
        case "option": {
          this.next();
          const [oname, value] = this.parseOptionStatement();
          if (oname === "schema.table") msg.tableOption = value;
          this.takeLeadingComment();
          break;
        }
        case "reserved": {
          this.next();
          this.parseReserved(msg);
          this.takeLeadingComment();
          break;
        }
        case "message": case "enum": case "oneof": case "map": case "extend": case "extensions": case "group":
          throw new ProtoParseError(`'${t.value}' inside message ${name} is not supported by mcpgen's proto parser`, t.line);
        default:
          msg.fields.push(this.parseField());
      }
    }
    this.accept("punct", ";");
    return msg;
  }

  private parseReserved(msg: ProtoMessage): void {
    for (;;) {
      const t = this.next();
      if (t.kind === "number") {
        const from = Number(t.value);
        if (this.accept("ident", "to")) {
          const toTok = this.next();
          const to = toTok.kind === "ident" && toTok.value === "max" ? from : Number(toTok.value);
          for (let k = from; k <= to; k++) msg.reservedNumbers.push(k);
        } else msg.reservedNumbers.push(from);
      } else if (t.kind === "string") msg.reservedNames.push(t.value);
      else if (t.kind === "ident") msg.reservedNames.push(t.value); // editions-style bare names
      else throw new ProtoParseError("bad reserved statement", t.line);
      if (this.accept("punct", ";")) return;
      this.expect("punct", ",");
    }
  }

  private parseField(): ProtoField {
    let repeated = false;
    let optional = false;
    let t = this.next();
    if (t.kind === "ident" && t.value === "repeated") { repeated = true; t = this.next(); }
    else if (t.kind === "ident" && t.value === "optional") { optional = true; t = this.next(); }
    else if (t.kind === "ident" && t.value === "required") throw new ProtoParseError("proto2 'required' is not supported", t.line);
    if (t.kind !== "ident") throw new ProtoParseError(`expected field type, got ${JSON.stringify(t.value)}`, t.line);
    let type = t.value;
    while (this.accept("punct", ".")) type += "." + this.expect("ident").value;
    const name = this.expect("ident").value;
    this.expect("punct", "=");
    const number = Number(this.expect("number").value);
    let fieldOption: TextValue | undefined;
    if (this.accept("punct", "[")) {
      for (;;) {
        const [oname, value] = this.parseOptionBody();
        if (oname === "schema.field") fieldOption = value;
        if (this.accept("punct", "]")) break;
        this.expect("punct", ",");
      }
    }
    this.expect("punct", ";");
    const comment = this.takeTrailingComment();
    this.takeLeadingComment(); // discard leading comments of the field (kept simple)
    return { name, number, type, repeated, optional, comment, fieldOption };
  }

  private skipToSemicolon(): void {
    while (this.peek() && !(this.peek()!.kind === "punct" && this.peek()!.value === ";")) this.next();
    this.expect("punct", ";");
  }

  private skipBracketed(close: string): void {
    let depth = 1;
    while (depth > 0) {
      const t = this.next();
      if (t.kind === "punct" && (t.value === "[" || t.value === "{" || t.value === "(")) depth++;
      if (t.kind === "punct" && (t.value === "]" || t.value === "}" || t.value === ")")) depth--;
    }
    void close;
  }
}

export function parseProto(src: string): ProtoFile {
  return new Parser(tokenize(src)).parseFile();
}

// ---- from-proto sink mapping (ClickHouse) ----

export interface ColumnSpec {
  name: string;
  /** ClickHouse type as `system.columns.type` renders it; "*" = accept any type (injected columns) */
  type: string;
  protoType: string;
  primaryKey: boolean;
  injected: boolean;
  comment: string;
}

export interface TableSpec {
  /** ClickHouse table name from `option (schema.table) = { name: ... }` */
  table: string;
  message: string;
  comment: string;
  columns: ColumnSpec[];
  orderBy: string[];
}

/**
 * Columns the ClickHouse from-proto sink adds to every table (substreams-facts.md (d) 5,
 * vendor/substreams-skills/.../clickhouse-patterns.md). Their exact types are not verified against a live
 * system.columns, so they participate in the schema check by name only (type "*").
 */
export const INJECTED_COLUMNS: ReadonlyArray<{ name: string; type: string }> = [
  { name: "_block_number_", type: "*" },
  { name: "_block_timestamp_", type: "*" },
  { name: "_version_", type: "*" },
  { name: "_deleted_", type: "*" },
];

const SCALAR_TYPES: Record<string, string> = {
  string: "String",
  bytes: "String",
  bool: "Bool",
  int32: "Int32",
  sint32: "Int32",
  sfixed32: "Int32",
  uint32: "UInt32",
  fixed32: "UInt32",
  int64: "Int64",
  sint64: "Int64",
  sfixed64: "Int64",
  uint64: "UInt64",
  fixed64: "UInt64",
  double: "Float64",
  float: "Float32",
};

function asObject(v: TextValue | undefined): { [key: string]: TextValue } | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

/** Maps a proto field to the ClickHouse column type the from-proto sink creates, or undefined when the sink skips it. */
export function clickhouseType(field: ProtoField, enums: ReadonlySet<string>): string | undefined {
  let base: string | undefined;
  const convertTo = asObject(asObject(field.fieldOption)?.convertTo);
  if (field.type === "string" && convertTo) {
    const kind = Object.keys(convertTo)[0];
    const arg = asObject(convertTo[kind ?? ""]);
    switch (kind) {
      case "uint256": base = "UInt256"; break;
      case "int256": base = "Int256"; break;
      case "uint128": base = "UInt128"; break;
      case "int128": base = "Int128"; break;
      case "decimal128": base = `Decimal(38, ${Number(arg?.scale ?? 0)})`; break;
      case "decimal256": base = `Decimal(76, ${Number(arg?.scale ?? 0)})`; break;
      default: throw new Error(`unknown convertTo kind ${kind} on field ${field.name}`);
    }
  } else if (field.type in SCALAR_TYPES) base = SCALAR_TYPES[field.type];
  else if (enums.has(field.type)) base = "Int32";
  else if (field.type === "google.protobuf.Timestamp") base = "DateTime";
  else return undefined; // message-typed field: skipped by the sink (contract-notes.md section 1)
  return field.repeated ? `Array(${base})` : base;
}

/** Tables = messages with `option (schema.table)`; column = every field the sink keeps, in field order. */
export function tablesFromProto(file: ProtoFile): TableSpec[] {
  const enums = new Set(file.enums.map((e) => e.name));
  const tables: TableSpec[] = [];
  for (const msg of file.messages) {
    const opt = asObject(msg.tableOption);
    if (!opt) continue;
    const table = opt.name;
    if (typeof table !== "string" || !/^[a-z_][a-z0-9_]*$/.test(table)) {
      throw new Error(`message ${msg.name}: schema.table name must be a lowercase identifier, got ${JSON.stringify(table)}`);
    }
    const columns: ColumnSpec[] = [];
    let pkCount = 0;
    for (const f of msg.fields) {
      const type = clickhouseType(f, enums);
      if (type === undefined) continue;
      const primaryKey = asObject(f.fieldOption)?.primary_key === true;
      if (primaryKey) pkCount++;
      columns.push({ name: f.name, type, protoType: f.type, primaryKey, injected: false, comment: f.comment });
    }
    if (pkCount !== 1) throw new Error(`table ${table}: expected exactly one primary_key field, found ${pkCount}`);
    for (const inj of INJECTED_COLUMNS) {
      if (columns.some((c) => c.name === inj.name)) throw new Error(`table ${table}: field ${inj.name} collides with an injected sink column`);
      columns.push({ name: inj.name, type: inj.type, protoType: "", primaryKey: false, injected: true, comment: "injected by the sink" });
    }
    const chOpts = asObject(opt.clickhouse_table_options);
    const ob = chOpts?.order_by_fields;
    const orderBy = Array.isArray(ob)
      ? ob.map((e) => String(asObject(e)?.name ?? "")).filter(Boolean)
      : [];
    tables.push({ table, message: msg.name, comment: msg.comment, columns, orderBy });
  }
  return tables;
}

/** Enum values by enum name -> { VALUE_NAME: number }. */
export function enumMap(file: ProtoFile): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const e of file.enums) {
    out[e.name] = Object.fromEntries(e.values.map((v) => [v.name, v.number]));
  }
  return out;
}
