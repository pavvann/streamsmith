// mcpgen CLI.
//   mcpgen generate --receipt <receipt.json> --proto <contract.proto> --views <views.sql> --out <dir>
//                   [--semantics <yaml>] [--receipt-schema <receipt.schema.json>] [--name <npm package name>]
// The last stdout line is exactly {"manifest": "<absolute path>"}; everything else goes to stderr.
import { readFile, access } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { emitPackage } from "./emit.ts";
import { buildManifest } from "./manifest.ts";
import { enumMap, parseProto, tablesFromProto } from "./proto.ts";
import { parseReceipt } from "./receipt.ts";
import { parseSemantics } from "./semantics.ts";
import { parseViews } from "./views.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEMANTICS = resolve(HERE, "..", "semantics", "default.yaml");
const SDK_RANGE = "^1.30.0";
const ZOD_RANGE = "^4.5.0";

const USAGE = `usage:
  mcpgen generate --receipt <receipt.json> --proto <contract.proto> --views <views.sql> --out <dir>
                  [--semantics <yaml>] [--receipt-schema <receipt.schema.json>] [--name <package name>]

Emits a runnable, fail-closed MCP server package into --out and prints {"manifest": "<absolute path>"} as the last
stdout line. Defaults: --semantics ${DEFAULT_SEMANTICS}; --receipt-schema <dir of --proto>/receipt.schema.json when
present; --name @ethonline26/<basename of --out>.`;

export interface GenerateOptions {
  receipt: string;
  proto: string;
  views: string;
  out: string;
  semantics?: string;
  receiptSchema?: string;
  name?: string;
  log?: (m: string) => void;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function generate(o: GenerateOptions): Promise<{ manifestPath: string; files: string[] }> {
  const log = o.log ?? (() => {});
  const receiptPath = resolve(o.receipt);
  const protoPath = resolve(o.proto);
  const viewsPath = resolve(o.views);
  const semanticsPath = resolve(o.semantics ?? DEFAULT_SEMANTICS);
  const outDir = resolve(o.out);

  const receiptText = await readFile(receiptPath, "utf8");
  const protoText = await readFile(protoPath, "utf8");
  const viewsText = await readFile(viewsPath, "utf8");
  const semanticsText = await readFile(semanticsPath, "utf8");

  let schemaPath = o.receiptSchema ? resolve(o.receiptSchema) : join(dirname(protoPath), "receipt.schema.json");
  let jsonSchema: Record<string, unknown> | undefined;
  if (await exists(schemaPath)) {
    jsonSchema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, unknown>;
    log(`receipt schema: ${schemaPath}`);
  } else {
    if (o.receiptSchema) throw new Error(`receipt schema not found: ${schemaPath}`);
    log(`receipt schema: none found next to the proto; structural validation only`);
    schemaPath = "";
  }

  const { receipt } = parseReceipt(JSON.parse(receiptText), jsonSchema);
  log(`receipt: ${receipt.packageName} ${receipt.packageVersion} (${receipt.deploymentMode}); ${receipt.parameters.vaults.length} vault(s)`);

  const protoFile = parseProto(protoText);
  const tables = tablesFromProto(protoFile);
  if (tables.length === 0) throw new Error(`no message with option (schema.table) found in ${protoPath}`);
  log(`proto: package ${protoFile.pkg}; tables ${tables.map((t) => t.table).join(", ")}`);

  const views = parseViews(viewsText);
  log(`views: ${views.map((v) => v.name).join(", ") || "(none)"}`);

  const semantics = parseSemantics(semanticsText);
  log(`semantics: ${semanticsPath}`);

  const manifest = buildManifest({
    tables, views, receipt, receiptJsonText: receiptText, semantics, enums: enumMap(protoFile),
    files: {
      proto: { name: basename(protoPath), text: protoText, pkg: protoFile.pkg },
      views: { name: basename(viewsPath), text: viewsText },
      semantics: { name: basename(semanticsPath), text: semanticsText },
    },
  });
  const packageName = o.name ?? `@ethonline26/${basename(outDir)}`;
  const res = await emitPackage({ outDir, packageName, manifest, receiptJsonText: receiptText, sdkVersionRange: SDK_RANGE, zodVersionRange: ZOD_RANGE });
  log(`tools: ${manifest.tools.map((t) => t.name).join(", ")}`);
  log(`wrote ${res.files.length} files to ${outDir}`);
  return res;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== "generate") {
    process.stderr.write(USAGE + "\n");
    return cmd === "--help" || cmd === "-h" ? 0 : 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      receipt: { type: "string" },
      proto: { type: "string" },
      views: { type: "string" },
      out: { type: "string" },
      semantics: { type: "string" },
      "receipt-schema": { type: "string" },
      name: { type: "string" },
    },
    strict: true,
  });
  const missing = ["receipt", "proto", "views", "out"].filter((k) => !values[k as keyof typeof values]);
  if (missing.length) {
    process.stderr.write(`missing --${missing.join(", --")}\n\n${USAGE}\n`);
    return 2;
  }
  try {
    const opts: GenerateOptions = {
      receipt: values.receipt!, proto: values.proto!, views: values.views!, out: values.out!,
      log: (m) => process.stderr.write(`mcpgen: ${m}\n`),
    };
    if (values.semantics) opts.semantics = values.semantics;
    if (values["receipt-schema"]) opts.receiptSchema = values["receipt-schema"];
    if (values.name) opts.name = values.name;
    const res = await generate(opts);
    process.stdout.write(JSON.stringify({ manifest: res.manifestPath }) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`mcpgen: error: ${(e as Error).message}\n`);
    return 1;
  }
}
