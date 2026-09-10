// Case study in the substreams-skills examples format (facts (h)): title, header triple, Goal, Prompt,
// What the skill provided, Files, Reproduce, Notes.
import { join } from "node:path";
import type { Ctx } from "./util/ctx.ts";
import { paths } from "./util/ctx.ts";
import { exists, readJson, readText, writeText } from "./util/fsx.ts";
import type { GateReport } from "./gate/run.ts";
import type { PublishRecord } from "./publish.ts";
import type { DeployRecord } from "./deploy/types.ts";
import type { RunManifest } from "./manifest.ts";
import type { Receipt } from "./receipt.ts";

export interface CaseStudyInput {
  id: string;
  title: string;
  chain: string;
  skills: string[];
  model: string;
  result: string;
  goal: string;
  prompt?: string;
  provided: string[];
  files: Array<{ label: string; path: string }>;
  reproduce: string[];
  notes: string[];
}

export function renderCaseStudy(i: CaseStudyInput): string {
  const lines: string[] = [];
  lines.push(`# ${i.id} — ${i.title} (${i.chain})`, "");
  lines.push(`**Skill(s) exercised:** ${i.skills.map((s) => `\`${s}\``).join(", ")}`);
  lines.push(`**Model:** ${i.model}`);
  lines.push(`**Result:** ${i.result}`, "");
  lines.push("## Goal", "", i.goal.trim(), "");
  lines.push("## Prompt", "");
  if (i.prompt) lines.push(...i.prompt.trim().split("\n").map((l) => (l.startsWith(">") ? l : `> ${l}`)));
  else lines.push("Not reproduced here.");
  lines.push("", "## What the skill provided", "");
  for (const p of i.provided) lines.push(`- ${p}`);
  if (!i.provided.length) lines.push("- (none recorded)");
  lines.push("", "## Files", "");
  for (const f of i.files) lines.push(`- [\`${f.label}\`](${f.path})`);
  if (!i.files.length) lines.push("- (none)");
  lines.push("", "## Reproduce", "", "```bash", ...i.reproduce, "```", "");
  if (i.notes.length) {
    lines.push("## Notes", "");
    for (const n of i.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

export interface CaseStudyOptions {
  runId: string;
  name?: string;
  id?: string;
  title?: string;
  chain?: string;
  skills?: string[];
  model?: string;
  result?: string;
  goal?: string;
  receiptPath?: string;
  pkgDir?: string;
  outDir?: string;
  extraNotes?: string[];
}

async function maybeJson<T>(p: string): Promise<T | undefined> {
  return (await exists(p)) ? readJson<T>(p) : undefined;
}

export async function writeCaseStudy(ctx: Ctx, o: CaseStudyOptions): Promise<{ path: string; markdown: string }> {
  const gate = await maybeJson<GateReport>(paths.runs(ctx, o.runId, "gate.json"));
  const publish = await maybeJson<PublishRecord>(paths.runs(ctx, o.runId, "publish.json"));
  const deploy = await maybeJson<DeployRecord>(paths.runs(ctx, o.runId, "deploy.json"));
  const manifest = await maybeJson<RunManifest>(paths.runs(ctx, o.runId, "manifest.json"));
  const receipt = o.receiptPath ? await maybeJson<Receipt>(join(ctx.root, o.receiptPath)) : undefined;
  const promptPath = join(ctx.root, manifest?.promptPath ?? "specs/prompt.md");
  const prompt = (await exists(promptPath)) ? (await readText(promptPath)).split("\n").filter((l) => l.trim().startsWith(">")).join("\n") || (await readText(promptPath)) : undefined;
  const name = o.name ?? gate?.package.name ?? publish?.packageName ?? "erc4626-flows";
  const pkgDir = o.pkgDir ?? gate?.package.dir ?? `packages/${name}`;
  const passedCount = gate ? gate.assertions.filter((a) => a.passed).length : 0;
  const result = o.result ?? [
    gate ? (gate.build?.code === 0 ? "Build OK" : "Build FAILED") : "Build n/a",
    gate ? (gate.status === "run_failed" ? "Run FAILED" : "Run OK") : "Run n/a",
    gate ? `Gate ${gate.passed ? "PASS" : "FAIL"} (${passedCount}/${gate.assertions.length} assertions)` : "Gate n/a",
    publish ? (publish.dryRun ? "Publish dry-run" : `Published ${publish.packageVersion}`) : "Publish n/a",
    deploy ? `Deployed (${deploy.deploymentMode}${deploy.lagBlocks !== undefined ? `, lag ${deploy.lagBlocks} blocks` : ""})` : "Deploy n/a",
  ].join(" · ");
  const firstRun = gate ? Object.values(gate.runs)[0] : undefined;
  const runSpec = gate?.runs ? Object.entries(gate.runs)[0] : undefined;
  const reproduce = [
    `cd ${pkgDir}`,
    "substreams build",
    firstRun ? firstRun.command.replace(/^.*?substreams /, "substreams ") : `substreams run substreams.yaml ${gate?.package.outputModule ?? "map_events"} -e base-mainnet.streamingfast.io:443 -s <start> -t +200 -o jsonl`,
    ...(runSpec ? [`# gate range ${runSpec[1].range}: ${runSpec[1].lines} jsonl lines, rows ${JSON.stringify(runSpec[1].rows)}`] : []),
    `pnpm -C packages/streamsmith streamsmith gate --run-id ${o.runId} --reuse-runs`,
  ];
  const provided = [
    "`substreams-dev` / `substreams-ethereum`: manifest, module graph, ABI decoding and `eth_call` batching patterns used to write the package.",
    "`substreams-sql`: from-proto ClickHouse rules (single primary key, ORDER BY prefix, `clickhouse_table_options`) reflected in `specs/vaultflows.proto`.",
    "`substreams-testing`: fixed-range `substreams run -o jsonl` as the gate's evidence.",
    "Streamsmith: gate assertions, publish/deploy capture, Deployment Receipt binding package, parameters, contract and sink schema.",
  ];
  const files: CaseStudyInput["files"] = [
    { label: "substreams.yaml", path: `../${pkgDir}/substreams.yaml` },
    { label: "proto/vaultflows.proto", path: "../specs/vaultflows.proto" },
    { label: "src/lib.rs", path: `../${pkgDir}/src/lib.rs` },
    { label: "specs/gate.yaml", path: "../specs/gate.yaml" },
    { label: `runs/${o.runId}/gate.json`, path: `../runs/${o.runId}/gate.json` },
    ...(publish ? [{ label: `runs/${o.runId}/publish.json`, path: `../runs/${o.runId}/publish.json` }] : []),
    ...(deploy ? [{ label: `runs/${o.runId}/deploy.json`, path: `../runs/${o.runId}/deploy.json` }] : []),
    ...(manifest ? [{ label: `runs/${o.runId}/manifest.json`, path: `../runs/${o.runId}/manifest.json` }] : []),
    ...(o.receiptPath ? [{ label: o.receiptPath, path: `../${o.receiptPath}` }] : []),
  ];
  const notes: string[] = [];
  if (gate) for (const a of gate.assertions) notes.push(`Gate \`${a.name}\` (${a.kind}): ${a.passed ? "pass" : "FAIL"} — ${a.detail}`);
  if (receipt) notes.push(`Receipt binds packageHash \`${receipt.packageHash.slice(0, 16)}…\`, protoDescriptorHash \`${receipt.protoDescriptorHash.slice(0, 16)}…\`, parametersHash \`${receipt.parametersHash.slice(0, 16)}…\`, sinkSchemaHash \`${receipt.sinkSchemaHash.slice(0, 16)}…\`; deploymentMode ${receipt.deploymentMode}.`);
  if (manifest?.startingCommit) notes.push(`Run started at commit \`${manifest.startingCommit}\`${manifest.startingTags?.length ? ` (tags ${manifest.startingTags.join(", ")})` : ""}, prompt sha256 \`${manifest.promptHash}\`${manifest.endingCommit ? `, ended at \`${manifest.endingCommit}\`` : ""}.`);
  notes.push(...(o.extraNotes ?? []));
  const input: CaseStudyInput = {
    id: o.id ?? "S1.1",
    title: o.title ?? `${name}: ERC-4626 vault flows + share value observations to ClickHouse`,
    chain: o.chain ?? "Base",
    skills: o.skills ?? ["substreams-dev", "substreams-ethereum", "substreams-sql", "substreams-testing", "streamsmith"],
    model: o.model ?? ctx.env.STREAMSMITH_MODEL ?? "(record the model id here)",
    result,
    goal: o.goal ?? `Build, gate, publish and deploy \`${name}\` from the frozen public contract in \`specs/vaultflows.proto\` with the vault list and sampling interval in \`specs/streamsmith.yaml\`, autonomously, ending in a validated Deployment Receipt.`,
    provided,
    files,
    reproduce,
    notes,
  };
  if (prompt) input.prompt = prompt;
  const markdown = renderCaseStudy(input);
  const outDir = o.outDir ? join(ctx.root, o.outDir) : paths.caseStudies(ctx);
  const path = join(outDir, `${name}.md`);
  await writeText(path, markdown);
  return { path, markdown };
}
