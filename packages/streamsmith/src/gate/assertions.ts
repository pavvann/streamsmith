// Evaluators for every assertion in specs/gate.yaml, keyed by `kind` (defaults to the assertion name).
// Pure over already-collected evidence; each returns {name, severity, passed, detail}.
import type { AssertionSpec, GateConfig, GateRunSpec } from "../config/gate.ts";
import type { StreamsmithConfig } from "../config/streamsmith.ts";
import type { SubstreamsInfo } from "../proto/descriptor.ts";
import type { ContractSchema } from "./contract.ts";
import { type ParsedRun, type Row, str, num, bool, rowsOf } from "./jsonl.ts";
import { canonicalJson, sha256Hex } from "../util/hash.ts";

export interface AssertionResult {
  name: string;
  kind: string;
  severity: "fail" | "warn";
  passed: boolean;
  detail: string;
}

export interface DescriptorEvidence {
  contract: string;
  protoPackage: string;
  specHash?: string;
  specHashViaConvert?: string;
  rendererMatch?: boolean;
  expectedSpecSha256?: string;
  spkgPath?: string;
  spkgHash?: string;
  error?: string;
}

export interface AssertionInputs {
  gate: GateConfig;
  streamsmith?: StreamsmithConfig;
  schema?: ContractSchema;
  rootType: string;
  runs: Record<string, ParsedRun>;
  /** raw jsonl text per run (deterministic_rerun canonical form) */
  runTexts: Record<string, string>;
  descriptor?: DescriptorEvidence;
  spkgInfo?: SubstreamsInfo;
  spkgInfoError?: string;
  /** file contents for banned_words, keyed by the path as listed (after templating) */
  files: Record<string, string | undefined>;
  configuredVaults: string[];
}

type Outcome = { passed: boolean; detail: string };
type Evaluator = (spec: AssertionSpec, i: AssertionInputs) => Outcome;

export function evaluateAssertions(specs: AssertionSpec[], inputs: AssertionInputs): AssertionResult[] {
  return specs.map((spec) => {
    const base = { name: spec.name, kind: spec.kind, severity: spec.severity };
    const ev = EVALUATORS[spec.kind];
    if (!ev) return { ...base, passed: false, detail: `unsupported assertion kind "${spec.kind}" — Streamsmith refuses to skip it` };
    try {
      return { ...base, ...ev(spec, inputs) };
    } catch (err) {
      return { ...base, passed: false, detail: `evaluator error: ${(err as Error).message}` };
    }
  });
}

export function exitStatus(results: AssertionResult[]): { passed: boolean; failed: AssertionResult[]; warned: AssertionResult[] } {
  const failed = results.filter((r) => !r.passed && r.severity === "fail");
  const warned = results.filter((r) => !r.passed && r.severity === "warn");
  return { passed: failed.length === 0, failed, warned };
}

// ---- helpers ----
const ADDR = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const UINT = /^[0-9]+$/;
const DEC128 = /^[0-9]+(\.[0-9]{1,18})?$/;
const TWO_256 = 1n << 256n;

function firstRun(i: AssertionInputs): string {
  return Object.keys(i.gate.runs)[0]!;
}
function runOf(spec: AssertionSpec, i: AssertionInputs): { name: string; run: ParsedRun | undefined } {
  const name = spec.run ?? spec.runs?.[0] ?? firstRun(i);
  return { name, run: i.runs[name] };
}
function runsOf(spec: AssertionSpec, i: AssertionInputs): string[] {
  return spec.runs ?? (spec.run ? [spec.run] : Object.keys(i.gate.runs));
}
function lower(v: unknown): string {
  return String(v ?? "").toLowerCase();
}
/** exact decimal compare via BigInt scaled to 18 fractional digits */
export function decimalToScaled(s: string, scale = 18): bigint | undefined {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return undefined;
  const frac = (m[2] ?? "").padEnd(scale, "0");
  if (frac.length > scale) return undefined;
  return BigInt(m[1]!) * 10n ** BigInt(scale) + BigInt(frac);
}
function eqLoose(rowValue: unknown, expected: unknown): boolean {
  if (typeof expected === "boolean") return rowValue === expected;
  const a = String(rowValue ?? "");
  const b = String(expected ?? "");
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase() && /^0x/i.test(b)) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return BigInt(a) === BigInt(b);
  const da = decimalToScaled(a);
  const db = decimalToScaled(b);
  return da !== undefined && db !== undefined && da === db;
}
function matchRow(rows: Row[], keys: Record<string, unknown>): Row | undefined {
  return rows.find((r) => Object.entries(keys).every(([k, v]) => eqLoose(r[k], v)));
}
function summarizeList(items: string[], max = 5): string {
  return items.slice(0, max).join("; ") + (items.length > max ? `; +${items.length - max} more` : "");
}
function needRun(name: string, run: ParsedRun | undefined): Outcome | undefined {
  return run ? undefined : { passed: false, detail: `run "${name}" has no output` };
}

// ---- evaluators ----
const spec_unmodified: Evaluator = (spec, i) => {
  const d = i.descriptor;
  if (!d) return { passed: false, detail: "descriptor evidence missing" };
  if (d.error) return { passed: false, detail: `descriptor error: ${d.error}` };
  if (d.rendererMatch === false) return { passed: false, detail: `renderer mismatch: buf build json ${d.specHash} vs buf convert ${d.specHashViaConvert}` };
  const expected = (spec.raw.expected as string | undefined)?.toLowerCase() ?? d.expectedSpecSha256;
  if (!expected) return { passed: false, detail: "gate.yaml has no descriptorHash.expectedSpecSha256" };
  const passed = d.specHash === expected;
  return { passed, detail: `${passed ? "match" : "MISMATCH"}: ${d.contract} normalized descriptor sha256 ${d.specHash} vs expected ${expected}${d.rendererMatch ? " (renderer self-check ok)" : d.rendererMatch === undefined ? " (renderer self-check unavailable)" : ""}` };
};

const descriptor_hash_match: Evaluator = (_spec, i) => {
  const d = i.descriptor;
  if (!d) return { passed: false, detail: "descriptor evidence missing" };
  if (d.error) return { passed: false, detail: `descriptor error: ${d.error}` };
  if (d.rendererMatch === false) return { passed: false, detail: "renderer mismatch" };
  if (!d.spkgHash) return { passed: false, detail: `no spkg-side hash (${d.spkgPath ?? "spkg missing"})` };
  const passed = d.spkgHash === d.specHash;
  return { passed, detail: `${passed ? "match" : "MISMATCH"}: spkg ${d.spkgPath} = ${d.spkgHash}; ${d.contract} = ${d.specHash}` };
};

const params_match: Evaluator = (_spec, i) => {
  if (!i.spkgInfo) return { passed: false, detail: `substreams info unavailable: ${i.spkgInfoError ?? "no spkg"}` };
  const info = i.spkgInfo;
  const problems: string[] = [];
  const wantNetwork = i.gate.network ?? i.streamsmith?.network ?? "base";
  if (info.network !== wantNetwork) problems.push(`Package.network "${info.network}" != "${wantNetwork}"`);
  const wantParams = i.streamsmith?.params?.value;
  let paramModules = 0;
  for (const m of info.modules ?? []) {
    for (const inp of m.inputs ?? []) {
      if (inp.type !== "params") continue;
      paramModules++;
      if (wantParams === undefined) problems.push(`module ${m.name} has params but streamsmith.yaml has no params.value`);
      else if (inp.name !== wantParams) problems.push(`module ${m.name} params "${inp.name}" != streamsmith.yaml params.value`);
    }
  }
  const netParams = info.networks?.[wantNetwork]?.params ?? {};
  for (const [mod, val] of Object.entries(netParams)) if (wantParams !== undefined && val !== wantParams) problems.push(`networks.${wantNetwork}.params.${mod} differs from streamsmith.yaml params.value`);
  const outMod = i.gate.package.outputModule ?? i.streamsmith?.outputModule ?? "map_events";
  const mod = info.modules?.find((m) => m.name === outMod);
  const wantStart = i.streamsmith?.startBlock;
  if (!mod) problems.push(`module ${outMod} not found in package`);
  else if (wantStart !== undefined && Number(mod.initial_block) !== wantStart) problems.push(`initialBlock of ${outMod} is ${mod.initial_block}, streamsmith.yaml startBlock is ${wantStart}`);
  return { passed: problems.length === 0, detail: problems.length ? problems.join("; ") : `network ${info.network}; ${paramModules} params input(s) equal streamsmith.yaml params.value; ${outMod} initialBlock ${mod?.initial_block}` };
};

const rows_gt: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const table = spec.table ?? "vault_flows";
  const count = rowsOf(run, table).length;
  const min = spec.min !== undefined ? Number(spec.min) : 1;
  const per = Object.entries(run!.tables).map(([t, r]) => `${t}=${r.length}`).join(" ");
  return { passed: count >= min, detail: `${table}: ${count} rows in ${name} (need >= ${min}${spec.raw.expectedHint !== undefined ? `, hint ${spec.raw.expectedHint}` : ""}); ${per}; ${run!.lines} lines, blocks ${run!.minBlock ?? "-"}..${run!.maxBlock ?? "-"}` };
};

const known_vault_present: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const table = spec.table ?? "vault_flows";
  const vaults = spec.vaults ?? i.configuredVaults;
  if (!vaults.length) return { passed: false, detail: "no vault list to check" };
  const rows = rowsOf(run, table);
  const parts: string[] = [];
  let ok = 0;
  for (const v of vaults) {
    const mine = rows.filter((r) => lower(r.vault) === v);
    const good = mine.filter((r) => bool(r, "meta_valid") && bool(r, "call_ok"));
    if (good.length) ok++;
    parts.push(`${v}: ${good.length}/${mine.length} rows with meta_valid && call_ok`);
  }
  return { passed: ok === vaults.length, detail: parts.join("; ") };
};

const reference_rows: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const table = spec.table ?? "vault_flows";
  const rows = rowsOf(run, table);
  const problems: string[] = [];
  for (const ref of spec.rows ?? []) {
    const { log_index, ...keys } = ref;
    const hit = spec.kind === "log_index_matches_rpc" ? matchRow(rows, { block_number: keys.block_number, tx_hash: keys.tx_hash }) : matchRow(rows, ref);
    if (!hit) {
      problems.push(`no ${table} row matching ${canonicalJson(spec.kind === "log_index_matches_rpc" ? { block_number: keys.block_number, tx_hash: keys.tx_hash } : ref)}`);
      continue;
    }
    if (spec.kind === "log_index_matches_rpc" && log_index !== undefined && !eqLoose(hit.log_index, log_index)) problems.push(`block ${keys.block_number} tx ${String(keys.tx_hash).slice(0, 12)}…: log_index ${str(hit, "log_index")} != ${log_index}`);
  }
  const chainId = i.streamsmith?.chainId ?? 8453;
  const badChain = rows.filter((r) => num(r, "chain_id") !== chainId).length;
  if (spec.kind === "reference_flows_present" && badChain) problems.push(`${badChain} rows with chain_id != ${chainId}`);
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${(spec.rows ?? []).length} reference rows present in ${rows.length} ${table} rows` };
};

const execution_rate_sanity: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const rows = rowsOf(run, spec.table ?? "vault_flows");
  const vaults = spec.vaults ?? i.configuredVaults;
  const min = decimalToScaled(String(spec.range?.min ?? spec.min ?? "0"));
  const max = decimalToScaled(String(spec.range?.max ?? spec.max ?? "1000000"));
  if (min === undefined || max === undefined) return { passed: false, detail: "range min/max are not decimal strings" };
  const problems: string[] = [];
  const perVault = new Map<string, number>();
  for (const r of rows) {
    const v = lower(r.vault);
    if (!vaults.includes(v) || !bool(r, "meta_valid") || str(r, "shares_raw") === "0") continue;
    perVault.set(v, (perVault.get(v) ?? 0) + 1);
    const rate = decimalToScaled(str(r, "execution_rate"));
    if (rate === undefined) problems.push(`${str(r, "id")}: execution_rate "${str(r, "execution_rate")}" is not a decimal string`);
    else if (rate < min || rate > max) problems.push(`${str(r, "id")}: execution_rate ${str(r, "execution_rate")} outside [${spec.range?.min}, ${spec.range?.max}]`);
  }
  for (const v of vaults) if (!perVault.get(v)) problems.push(`no eligible row (meta_valid && shares_raw != "0") for ${v} — vacuous`);
  const checked = [...perVault.values()].reduce((a, b) => a + b, 0);
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${checked} rows within [${spec.range?.min}, ${spec.range?.max}] across ${perVault.size} vaults` };
};

function fromDefinition(def: string | undefined, key: string): string | undefined {
  if (!def) return undefined;
  const m = new RegExp(`${key}\\s*==\\s*"?([0-9a-zA-Zx]+)"?`).exec(def);
  return m?.[1];
}

const observation_present: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const table = spec.table ?? "share_value_observations";
  const rows = rowsOf(run, table);
  const vaults = spec.vaults ?? i.configuredVaults;
  const block = spec.block;
  const interval = Number(spec.raw.sample_interval_blocks ?? spec.raw.intervalBlocks ?? fromDefinition(spec.definition, "sample_interval_blocks") ?? i.streamsmith?.sampleIntervalBlocks ?? 1800);
  const chainId = Number(spec.raw.chain_id ?? fromDefinition(spec.definition, "chain_id") ?? i.streamsmith?.chainId ?? 8453);
  const blockHash = (spec.raw.block_hash as string | undefined) ?? fromDefinition(spec.definition, "block_hash");
  const blockTs = spec.raw.block_timestamp !== undefined ? Number(spec.raw.block_timestamp) : fromDefinition(spec.definition, "block_timestamp") ? Number(fromDefinition(spec.definition, "block_timestamp")) : undefined;
  const problems: string[] = [];
  if (block === undefined) problems.push("assertion has no `block`");
  for (const v of vaults) {
    const mine = rows.filter((r) => lower(r.vault) === v && (block === undefined || num(r, "block_number") === block));
    if (mine.length !== 1) { problems.push(`${v}: ${mine.length} rows at block ${block} (want exactly 1)`); continue; }
    const r = mine[0]!;
    const bad: string[] = [];
    if (!bool(r, "call_ok")) bad.push(`call_ok=false (${str(r, "call_error")})`);
    if (num(r, "sample_interval_blocks") !== interval) bad.push(`sample_interval_blocks=${str(r, "sample_interval_blocks")}`);
    if (num(r, "chain_id") !== chainId) bad.push(`chain_id=${str(r, "chain_id")}`);
    if (blockHash && lower(r.block_hash) !== blockHash.toLowerCase()) bad.push(`block_hash=${str(r, "block_hash")}`);
    if (blockTs !== undefined && num(r, "block_timestamp") !== blockTs) bad.push(`block_timestamp=${str(r, "block_timestamp")}`);
    for (const k of ["assets_per_share_raw", "total_assets_raw", "total_supply_raw"]) {
      const s = str(r, k);
      if (!UINT.test(s) || BigInt(s) <= 0n) bad.push(`${k}="${s}" not an integer > 0`);
    }
    const wantId = `${chainId}-${block}-${v}`;
    if (str(r, "id") !== wantId) bad.push(`id "${str(r, "id")}" != "${wantId}"`);
    if (bad.length) problems.push(`${v}: ${bad.join(", ")}`);
  }
  // grid: every observation row in every run sits on a multiple of the interval inside its run range; runs whose
  // range contains no multiple must have zero observation rows (gate.yaml: primary contains zero observation rows).
  for (const [rn, spec2] of Object.entries(i.gate.runs)) {
    const pr = i.runs[rn];
    if (!pr) continue;
    const obs = rowsOf(pr, table);
    const off = obs.filter((r) => { const b = num(r, "block_number"); return b === undefined || b % interval !== 0 || b < spec2.startBlock || b >= spec2.stopBlock; });
    if (off.length) problems.push(`${rn}: ${off.length} observation rows off the ${interval}-block grid or outside ${spec2.startBlock}:${spec2.stopBlock} (e.g. block ${str(off[0]!, "block_number")})`);
    const firstMultiple = Math.ceil(spec2.startBlock / interval) * interval;
    if (firstMultiple >= spec2.stopBlock && obs.length) problems.push(`${rn}: ${obs.length} observation rows but no multiple of ${interval} in ${spec2.startBlock}:${spec2.stopBlock}`);
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${vaults.length} vaults observed exactly once at block ${block} (call_ok, interval ${interval}, hash/timestamp match); grid clean across ${Object.keys(i.runs).length} runs` };
};

const observation_matches_reference: Evaluator = (spec, i) => {
  const { name, run } = runOf(spec, i);
  const missing = needRun(name, run);
  if (missing) return missing;
  const rows = rowsOf(run, spec.table ?? "share_value_observations");
  const problems: string[] = [];
  let checked = 0;
  for (const [vault, exp] of Object.entries(spec.expected ?? {})) {
    const r = rows.find((x) => lower(x.vault) === vault.toLowerCase() && (spec.block === undefined || num(x, "block_number") === spec.block));
    if (!r) { problems.push(`${vault}: no row at block ${spec.block}`); continue; }
    for (const [k, v] of Object.entries((exp ?? {}) as Record<string, unknown>)) {
      checked++;
      if (!eqLoose(r[k], v)) problems.push(`${vault}: ${k} ${str(r, k)} != ${String(v)}`);
    }
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${checked} values match the eth_call reference at block ${spec.block}` };
};

const rpc_success_ratio_gte: Evaluator = (spec, i) => {
  const runs = runsOf(spec, i);
  const tables = spec.tables ?? (spec.table ? [spec.table] : ["vault_flows", "share_value_observations", "vaults"]);
  const min = Number(spec.min ?? 0.99);
  let total = 0;
  let ok = 0;
  const errors = new Map<string, number>();
  for (const rn of runs) {
    const run = i.runs[rn];
    if (!run) return { passed: false, detail: `run "${rn}" has no output` };
    for (const t of tables) for (const r of rowsOf(run, t)) {
      if (!i.configuredVaults.includes(lower(r.vault))) continue;
      total++;
      if (bool(r, "call_ok")) ok++;
      else { const e = str(r, "call_error") || "(no call_error)"; errors.set(e, (errors.get(e) ?? 0) + 1); }
    }
  }
  if (total === 0) return { passed: false, detail: `no rows for configured vaults in ${tables.join(",")} over ${runs.join(",")}` };
  const ratio = ok / total;
  const errText = [...errors.entries()].slice(0, 5).map(([e, n]) => `${e} x${n}`).join(", ");
  return { passed: ratio >= min, detail: `${ok}/${total} configured-vault rows have call_ok = ${ratio.toFixed(4)} (need >= ${min})${errText ? `; failures: ${errText}` : ""}` };
};

const numeric_strings_valid: Evaluator = (spec, i) => {
  if (!i.schema) return { passed: false, detail: "contract schema unavailable" };
  const problems: string[] = [];
  let checked = 0;
  for (const rn of runsOf(spec, i)) {
    const run = i.runs[rn];
    if (!run) return { passed: false, detail: `run "${rn}" has no output` };
    for (const t of i.schema.tables(i.rootType)) {
      for (const r of rowsOf(run, t.table)) for (const f of t.message.fields) {
        if (!f.convertTo) continue;
        checked++;
        const s = r[f.name];
        const text = typeof s === "string" ? s : "";
        if (f.convertTo === "uint256" || f.convertTo === "uint128") {
          if (!UINT.test(text)) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f.name}="${text}" not ^[0-9]+$`);
          else if (BigInt(text) >= TWO_256) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f.name} >= 2^256`);
        } else if (f.convertTo === "decimal128" || f.convertTo === "decimal256") {
          if (!DEC128.test(text)) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f.name}="${text}" not ^[0-9]+(\\.[0-9]{1,18})?$`);
          else if (text.split(".")[0]!.length > 20) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f.name} has more than 20 integer digits`);
        } else if (text === "") problems.push(`${rn}/${t.table} ${str(r, "id")}.${f.name} is empty`);
      }
    }
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${checked} convertTo column values valid across ${runsOf(spec, i).join(",")}` };
};

const ids_unique: Evaluator = (spec, i) => {
  const problems: string[] = [];
  const chainId = i.streamsmith?.chainId ?? 8453;
  let checked = 0;
  for (const rn of runsOf(spec, i)) {
    const run = i.runs[rn];
    if (!run) return { passed: false, detail: `run "${rn}" has no output` };
    for (const [table, rows] of Object.entries(run.tables)) {
      const seen = new Map<string, number>();
      for (const r of rows) {
        checked++;
        const id = str(r, "id");
        seen.set(id, (seen.get(id) ?? 0) + 1);
        const cid = num(r, "chain_id");
        if (cid !== chainId) problems.push(`${rn}/${table} ${id}: chain_id ${cid}`);
        let want: string | undefined;
        if (table === "vault_flows" || table === "share_transfers") want = `${cid}-${str(r, "block_number")}-${str(r, "log_index")}`;
        else if (table === "share_value_observations") want = `${cid}-${str(r, "block_number")}-${lower(r.vault)}`;
        else if (table === "vaults") want = `${cid}-${lower(r.vault)}`;
        if (want !== undefined && id !== want) problems.push(`${rn}/${table}: id "${id}" != "${want}"`);
      }
      for (const [id, n] of seen) if (n > 1) problems.push(`${rn}/${table}: id "${id}" appears ${n} times`);
    }
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${checked} ids unique and well-formed` };
};

const ADDRESS_FIELDS = ["vault", "caller", "owner", "receiver", "asset", "from_owner", "to_owner"];
const HASH_FIELDS = ["block_hash", "tx_hash"];
const addresses_lowercase: Evaluator = (spec, i) => {
  if (!i.schema) return { passed: false, detail: "contract schema unavailable" };
  const problems: string[] = [];
  let checked = 0;
  for (const rn of runsOf(spec, i)) {
    const run = i.runs[rn];
    if (!run) return { passed: false, detail: `run "${rn}" has no output` };
    for (const t of i.schema.tables(i.rootType)) for (const r of rowsOf(run, t.table)) {
      for (const f of ADDRESS_FIELDS) {
        if (!t.message.byName.has(f)) continue;
        checked++;
        const v = str(r, f);
        if (f === "asset" && v === "" && !bool(r, "call_ok")) continue;
        if (!ADDR.test(v)) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f}="${v}"`);
      }
      for (const f of HASH_FIELDS) {
        if (!t.message.byName.has(f)) continue;
        checked++;
        if (!HASH32.test(str(r, f))) problems.push(`${rn}/${t.table} ${str(r, "id")}.${f}="${str(r, f)}"`);
      }
    }
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${checked} address/hash values lowercase 0x hex` };
};

export function canonicalRunHash(text: string): { hash: string; lines: number } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => canonicalJson(JSON.parse(l))).sort();
  return { hash: sha256Hex(lines.join("\n")), lines: lines.length };
}

const deterministic_rerun: Evaluator = (spec, i) => {
  const names = spec.runs ?? Object.keys(i.gate.runs).slice(0, 2);
  if (names.length < 2) return { passed: false, detail: "needs two runs" };
  const [a, b] = names as [string, string];
  if (i.runTexts[a] === undefined || i.runTexts[b] === undefined) return { passed: false, detail: `missing output for ${i.runTexts[a] === undefined ? a : b}` };
  let ca, cb;
  try {
    ca = canonicalRunHash(i.runTexts[a]!);
    cb = canonicalRunHash(i.runTexts[b]!);
  } catch (err) {
    return { passed: false, detail: `unparseable line: ${(err as Error).message}` };
  }
  if (ca.lines === 0 || cb.lines === 0) return { passed: false, detail: `empty output (${a}: ${ca.lines} lines, ${b}: ${cb.lines} lines)` };
  const passed = ca.hash === cb.hash && ca.lines === cb.lines;
  return { passed, detail: `${a} sha256 ${ca.hash.slice(0, 16)}… (${ca.lines} lines) ${passed ? "==" : "!="} ${b} sha256 ${cb.hash.slice(0, 16)}… (${cb.lines} lines)` };
};

const output_decodes_against_contract: Evaluator = (spec, i) => {
  const problems: string[] = [];
  let lines = 0;
  for (const rn of runsOf(spec, i)) {
    const run = i.runs[rn];
    if (!run) return { passed: false, detail: `run "${rn}" has no output` };
    lines += run.lines;
    problems.push(...run.envelopeErrors.map((e) => `${rn}: ${e}`), ...run.decodeErrors.map((e) => `${rn}: ${e}`));
    if (run.badLines) problems.push(`${rn}: ${run.badLines} lines are not JSON`);
  }
  return { passed: problems.length === 0, detail: problems.length ? summarizeList(problems) : `${lines} lines decode as ${i.rootType} with unknown fields rejected` };
};

const banned_words: Evaluator = (spec, i) => {
  const patterns = (spec.patterns ?? []).map((p) => new RegExp(p, "i"));
  const hits: string[] = [];
  let scanned = 0;
  for (const [file, text] of Object.entries(i.files)) {
    if (text === undefined) continue;
    scanned++;
    text.split("\n").forEach((line, idx) => {
      for (const re of patterns) if (re.test(line)) hits.push(`${file}:${idx + 1}: ${line.trim().slice(0, 80)} (${re.source})`);
    });
  }
  return { passed: hits.length === 0, detail: hits.length ? summarizeList(hits) : `${patterns.length} patterns, 0 matches in ${scanned} files` };
};

const spkg_metadata: Evaluator = (_spec, i) => {
  if (!i.spkgInfo) return { passed: false, detail: `substreams info unavailable: ${i.spkgInfoError ?? "no spkg"}` };
  const info = i.spkgInfo;
  const p = i.gate.package;
  const problems: string[] = [];
  const wantName = p.name ?? i.streamsmith?.packageName;
  const wantVersion = p.version ?? i.streamsmith?.version;
  const wantNet = i.gate.network ?? i.streamsmith?.network;
  const wantMod = p.outputModule ?? i.streamsmith?.outputModule ?? "map_events";
  const wantType = p.outputType ?? i.streamsmith?.outputType;
  if (wantName && info.name !== wantName) problems.push(`name "${info.name}" != "${wantName}"`);
  if (wantVersion && info.version !== wantVersion) problems.push(`version "${info.version}" != "${wantVersion}"`);
  if (wantNet && info.network !== wantNet) problems.push(`network "${info.network}" != "${wantNet}"`);
  const mod = info.modules?.find((m) => m.name === wantMod);
  if (!mod) problems.push(`module ${wantMod} missing`);
  else if (wantType && mod.output_type !== wantType) problems.push(`${wantMod} output "${mod.output_type}" != "${wantType}"`);
  return { passed: problems.length === 0, detail: problems.length ? problems.join("; ") : `${info.name} ${info.version} on ${info.network}; ${wantMod} -> ${mod?.output_type} (module hash ${mod?.hash ?? "?"})` };
};

export const EVALUATORS: Record<string, Evaluator> = {
  spec_unmodified,
  descriptor_hash_match,
  params_match,
  rows_gt,
  known_vault_present,
  reference_flows_present: reference_rows,
  log_index_matches_rpc: reference_rows,
  execution_rate_sanity,
  observation_present,
  observation_matches_reference,
  rpc_success_ratio_gte,
  numeric_strings_valid,
  ids_unique,
  addresses_lowercase,
  deterministic_rerun,
  output_decodes_against_contract,
  banned_words,
  spkg_metadata,
};

export type { Row, GateRunSpec };
