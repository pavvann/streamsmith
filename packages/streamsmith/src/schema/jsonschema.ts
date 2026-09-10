// Small JSON Schema (2020-12 subset) validator: enough for specs/receipt.schema.json — type, const, enum,
// pattern, required, properties, additionalProperties, items, minimum, format=date-time. The schema file
// stays the single source of truth; nothing is mirrored by hand.
export interface SchemaError {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

export function validateAgainstSchema(value: unknown, schema: Schema, path = "$"): SchemaError[] {
  const errors: SchemaError[] = [];
  const push = (message: string) => errors.push({ path, message });

  if ("const" in schema && !deepEqual(value, schema.const)) push(`must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) push(`must be one of ${JSON.stringify(schema.enum)}`);

  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  if (types.length && !types.some((t) => matchesType(value, t))) {
    push(`expected type ${types.join("|")}, got ${describe(value)}`);
    return errors;
  }

  if (typeof value === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) push(`must match pattern ${schema.pattern}`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) push("must be an RFC 3339 date-time");
    if (typeof schema.minLength === "number" && value.length < schema.minLength) push(`must have length >= ${schema.minLength}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) push(`must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) push(`must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) push(`must have >= ${schema.minItems} items`);
    if (schema.items && typeof schema.items === "object") value.forEach((item, i) => errors.push(...validateAgainstSchema(item, schema.items as Schema, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in obj)) push(`missing required property "${key}"`);
    for (const [key, sub] of Object.entries(props)) if (key in obj) errors.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`));
    if (schema.additionalProperties === false) for (const key of Object.keys(obj)) if (!(key in props)) push(`unexpected property "${key}"`);
    else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(obj)) if (!(key in props)) errors.push(...validateAgainstSchema(obj[key], schema.additionalProperties as Schema, `${path}.${key}`));
    }
  }
  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "null": return value === null;
    default: return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
