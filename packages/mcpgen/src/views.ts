// Parser for the annotated views.sql (packages/erc4626-flows/sql/views.sql). The SQL itself is passed through
// untouched; the `-- @...` annotations give the generator view names, columns/types and the optional window marker.
//
// Limits: one `CREATE [OR REPLACE] VIEW <name> AS <body>;` per statement, statements separated by `;` outside of
// string literals; annotations must directly precede their statement; no parameterized views.

export interface ViewColumn {
  name: string;
  type: string;
  comment: string;
}

export interface ViewSpec {
  name: string;
  description: string;
  columns: ViewColumn[];
  /** SELECT body (text after `AS`), with the /*@window*\/ marker still in place when declared */
  body: string;
  /** full DDL statement without the trailing `;` */
  ddl: string;
  window: { column: string; table: string; where: string } | undefined;
}

export const WINDOW_MARKER = "/*@window*/";

export function parseViews(src: string): ViewSpec[] {
  const statements = splitStatements(src);
  const views: ViewSpec[] = [];
  for (const stmt of statements) {
    const annotations: Record<string, string[]> = {};
    const codeLines: string[] = [];
    for (const rawLine of stmt.split("\n")) {
      const line = rawLine.trimEnd();
      const m = /^\s*--\s*@(\w+)\s*(.*)$/.exec(line);
      if (m) {
        (annotations[m[1]!] ??= []).push(m[2]!.trim());
        continue;
      }
      if (/^\s*--/.test(line) || line.trim() === "") {
        if (codeLines.length > 0) codeLines.push(line); // keep comments inside the body
        continue;
      }
      codeLines.push(line);
    }
    const ddl = codeLines.join("\n").trim();
    if (!ddl) continue;
    const head = /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+/is.exec(ddl);
    if (!head) throw new Error(`views.sql: statement is not a CREATE VIEW: ${ddl.slice(0, 60)}...`);
    const name = head[1]!;
    const declared = annotations.view?.[0];
    if (declared !== undefined && declared !== name) throw new Error(`views.sql: @view ${declared} does not match CREATE VIEW ${name}`);
    if (declared === undefined) throw new Error(`views.sql: CREATE VIEW ${name} has no -- @view annotation`);
    const columns: ViewColumn[] = (annotations.column ?? []).map((c) => {
      const cm = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z0-9_]+(?:\([^)]*\))?)\s*(.*)$/.exec(c);
      if (!cm) throw new Error(`views.sql: bad @column annotation on ${name}: ${JSON.stringify(c)}`);
      return { name: cm[1]!, type: cm[2]!, comment: cm[3]!.trim() };
    });
    if (columns.length === 0) throw new Error(`views.sql: view ${name} declares no @column annotations`);
    const body = ddl.slice(head[0].length).trim();
    let window: ViewSpec["window"];
    const w = annotations.window?.[0];
    if (w !== undefined) {
      const cm = /^column=([A-Za-z_][A-Za-z0-9_]*)\s+table=([A-Za-z_][A-Za-z0-9_]*)\s+where=(.+)$/.exec(w);
      if (!cm) throw new Error(`views.sql: bad @window annotation on ${name}: ${JSON.stringify(w)} (expected column=<col> table=<table> where=<predicate>)`);
      if (!body.includes(WINDOW_MARKER)) throw new Error(`views.sql: view ${name} declares @window but its body has no ${WINDOW_MARKER} marker`);
      const where = cm[3]!.trim();
      if (/[;{}]/.test(where)) throw new Error(`views.sql: @window where-predicate on ${name} must not contain ';', '{' or '}'`);
      window = { column: cm[1]!, table: cm[2]!, where };
    } else if (body.includes(WINDOW_MARKER)) {
      throw new Error(`views.sql: view ${name} has a ${WINDOW_MARKER} marker but no @window annotation`);
    }
    views.push({ name, description: annotations.description?.[0] ?? `Rows of view ${name}.`, columns, body, ddl, window });
  }
  return views;
}

/** Splits on `;` outside single/double-quoted strings and outside comments. */
function splitStatements(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < src.length) { cur += src[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      const end = src.indexOf("\n", i);
      const seg = src.slice(i, end === -1 ? src.length : end);
      cur += seg;
      i += seg.length;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const seg = src.slice(i, end === -1 ? src.length : end + 2);
      cur += seg;
      i += seg.length;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; i++; continue; }
    if (c === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
