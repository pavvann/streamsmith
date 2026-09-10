// YAML loading for the spec files (specs/gate.yaml, specs/streamsmith.yaml).
//
// The `yaml` package's default schema is the YAML 1.2 core schema, whose `int` tag has HEX and OCT formats:
// an unquoted plain scalar matching /^0x[0-9a-fA-F]+$/ resolves to a NUMBER. specs/gate.yaml writes addresses,
// tx hashes and block hashes unquoted, so with the default options
//   vault: 0x050ce30b927da55177a4914ec73480238bad56f0
// silently became 2.8811...e+46 (a double, already past 2^53), and every address/hash comparison in the gate
// compared a number with a string and failed. Same for 0o-prefixed scalars.
//
// Fix: drop the HEX and OCT `int` tags from the schema, so those scalars fall through to `str` and stay the exact
// source text. Plain decimal integers (block numbers, chain ids, min/max) still resolve as numbers. The spec files
// are never rewritten to add quotes — the loader is what has to be right.
import YAML, { type ParseOptions, type SchemaOptions, type Tags, type ToJSOptions } from "yaml";
import { readText } from "./fsx.ts";

/** Removes the core-schema `int` tags whose `format` is HEX / OCT (yaml/dist/schema/core/int.js: intHex, intOct). */
export function dropHexAndOctIntTags(tags: Tags): Tags {
  return tags.filter((t) => typeof t === "string" || (t.format !== "HEX" && t.format !== "OCT"));
}

export const SPEC_YAML_OPTIONS: ParseOptions & SchemaOptions & ToJSOptions = { customTags: dropHexAndOctIntTags };

/** Parse a spec YAML file's text, keeping `0x…` / `0o…` plain scalars as strings. */
export function parseSpecYaml<T = unknown>(text: string): T {
  return YAML.parse(text, SPEC_YAML_OPTIONS) as T;
}

export async function loadSpecYaml<T = unknown>(path: string): Promise<T> {
  return parseSpecYaml<T>(await readText(path));
}
