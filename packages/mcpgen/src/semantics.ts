import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * A closed-set filter on one column. `values` are the names the MCP client sees; how each name is *stored* is
 * resolved from the contract, not declared here: a String column stores the name itself, an enum-backed Int32
 * column stores the proto enum's number (see resolveFilterValues in manifest.ts). That way the semantics file
 * survives a contract change of the column's representation.
 */
const filterSchema = z.object({
  column: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  values: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).min(1),
  description: z.string().optional(),
});

const tableSemanticsSchema = z.object({
  tool: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  description: z.string().optional(),
  filters: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), filterSchema).optional(),
  orderBy: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?$/i)).optional(),
  whenEmpty: z.object({ reason: z.string().min(1) }).optional(),
});

const viewSemanticsSchema = z.object({
  tool: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  description: z.string().optional(),
  orderBy: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?$/i)).optional(),
});

export const semanticsSchema = z.object({
  tables: z.record(z.string(), tableSemanticsSchema).default({}),
  views: z.record(z.string(), viewSemanticsSchema).default({}),
});

export type Semantics = z.infer<typeof semanticsSchema>;
export type TableSemantics = z.infer<typeof tableSemanticsSchema>;
export type ViewSemantics = z.infer<typeof viewSemanticsSchema>;

export function parseSemantics(yamlText: string): Semantics {
  const raw: unknown = parseYaml(yamlText) ?? {};
  const parsed = semanticsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("semantics yaml invalid:\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return parsed.data;
}
