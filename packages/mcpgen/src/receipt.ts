// Deployment Receipt v1 loading and validation. Two layers:
//  1. a JSON-Schema-subset validator run against specs/receipt.schema.json (the file next to the proto), so the
//     generator refuses receipts the spec would refuse (required, type, const, enum, pattern, items,
//     additionalProperties, minimum, format=date-time);
//  2. a zod schema that gives the generator typed access to the fields it needs.
import { z } from "zod";

export const receiptSchema = z.object({
  receiptVersion: z.literal(1),
  packageName: z.string().min(1),
  packageVersion: z.string().regex(/^v?\d+\.\d+\.\d+/),
  packageHash: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex, lowercase"),
  packageUrl: z.string().optional(),
  outputModule: z.string().min(1),
  outputModuleHash: z.string().min(1),
  moduleHashes: z.record(z.string(), z.string()).optional(),
  protoDescriptorHash: z.string().regex(/^[0-9a-f]{64}$/),
  parametersHash: z.string().regex(/^[0-9a-f]{64}$/),
  parameters: z.object({
    vaults: z.array(z.string().regex(/^0x[0-9a-f]{40}$/)).min(1),
    sampleIntervalBlocks: z.number().int().min(1),
    chainId: z.number().int(),
  }),
  sinkSchemaHash: z.string().regex(/^[0-9a-f]{64}$/),
  sink: z.object({
    kind: z.enum(["clickhouse", "postgres"]).optional(),
    mode: z.enum(["from-proto", "database-changes"]).optional(),
    database: z.string().optional(),
    hostFingerprint: z.string().optional(),
  }).optional(),
  mcpManifestHash: z.string().optional(),
  deploymentMode: z.enum(["graph-market-hosted", "self-managed-sink"]),
  deploymentId: z.string().optional(),
  chainId: z.number().int(),
  network: z.string(),
  endpoint: z.string().optional(),
  startBlock: z.number().int(),
  headBlock: z.number().int().optional(),
  lagBlocks: z.number().int().optional(),
  lagSeconds: z.number().int().optional(),
  gate: z.object({
    passed: z.boolean(),
    ranges: z.array(z.string().regex(/^\d+:\d+$/)),
    assertions: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string().optional() })),
    toolVersions: z.record(z.string(), z.unknown()).optional(),
  }),
  registryPublishedAt: z.string().optional(),
  deployedAt: z.string().optional(),
  createdAt: z.string(),
  runId: z.string().optional(),
});

export type Receipt = z.infer<typeof receiptSchema>;

/** parametersHash as defined by specs/receipt.schema.json: sha256(canonical JSON {vaults sorted lowercase, sampleIntervalBlocks, chainId}). */
export function receiptParametersCanonical(p: Receipt["parameters"]): { vaults: string[]; sampleIntervalBlocks: number; chainId: number } {
  return { vaults: [...p.vaults].map((v) => v.toLowerCase()).sort(), sampleIntervalBlocks: p.sampleIntervalBlocks, chainId: p.chainId };
}

// ---- JSON Schema subset validator ----

export interface SchemaError { path: string; message: string }

type JsonSchema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  minimum?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  $ref?: string;
};

/**
 * Validates `value` against a JSON Schema (draft 2020-12 subset: type, const, enum, pattern, format date-time,
 * minimum, required, properties, additionalProperties, items). Enough for receipt.schema.json; keywords the
 * validator does not know are ignored, which is stricter-than-nothing but not a full validator.
 */
export function validateJsonSchema(value: unknown, schema: JsonSchema, path = "$"): SchemaError[] {
  const errors: SchemaError[] = [];
  const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((t) => jsonTypeMatches(value, t))) {
    errors.push({ path, message: `expected type ${types.join("|")}, got ${jsonTypeOf(value)}` });
    return errors;
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `does not match pattern ${schema.pattern}` });
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push({ path, message: "not a date-time" });
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `below minimum ${schema.minimum}` });
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validateJsonSchema(item, schema.items!, `${path}[${i}]`)));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) if (!(req in obj)) errors.push({ path: `${path}.${req}`, message: "required property missing" });
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...validateJsonSchema(v, sub, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push({ path: `${path}.${k}`, message: "additional property not allowed" });
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...validateJsonSchema(v, schema.additionalProperties, `${path}.${k}`));
    }
  }
  return errors;
}

function jsonTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function jsonTypeMatches(v: unknown, t: string): boolean {
  const actual = jsonTypeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

export interface ReceiptLoadResult {
  receipt: Receipt;
  /** errors from the JSON Schema check (empty when no schema file was supplied or it passed) */
  schemaErrors: SchemaError[];
}

export function parseReceipt(json: unknown, jsonSchema?: JsonSchema): ReceiptLoadResult {
  const schemaErrors = jsonSchema ? validateJsonSchema(json, jsonSchema) : [];
  if (schemaErrors.length > 0) {
    throw new Error(`receipt does not satisfy receipt.schema.json:\n` + schemaErrors.map((e) => `  ${e.path}: ${e.message}`).join("\n"));
  }
  const parsed = receiptSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`receipt failed structural validation:\n` + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return { receipt: parsed.data, schemaErrors };
}
