// Regenerate the fixtures that are copies of real artifacts. Run after specs/vaultflows.proto changes, after a
// rebuild of packages/erc4626-flows/erc4626-flows-v0.1.0.spkg, or after a new live run lands in runs/live/.
//
//   pnpm --filter @ethonline26/streamsmith fixtures
//
// Read-only with respect to the rest of the repo: it never rebuilds anything (no cargo, no `substreams build`),
// it only compiles the contract with buf and reads the existing spkg with `substreams info`.
import { mkdir, writeFile, readFile, copyFile, readdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createCtx } from "../src/util/ctx.ts";
import { specDescriptor, substreamsInfo } from "../src/proto/descriptor.ts";
import { loadGateConfig } from "../src/config/gate.ts";
import { exists } from "../src/util/fsx.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const FIXTURES = join(PKG_ROOT, "fixtures");

const ctx = await createCtx({ root: REPO_ROOT });
const gate = await loadGateConfig(join(REPO_ROOT, "specs", "gate.yaml"));

// 1. FileDescriptorSet of the public contract (the schema every gate test decodes rows with).
const contract = join(REPO_ROOT, gate.contract.proto);
const spec = await specDescriptor(ctx, contract, gate.contract.protoPackage);
await writeFile(join(FIXTURES, "vaultflows.fds.json"), JSON.stringify(spec.fds));
console.log(`fixtures/vaultflows.fds.json <- ${gate.contract.proto} (normalized descriptor sha256 ${spec.hash})`);
if (gate.expectedSpecSha256 && gate.expectedSpecSha256 !== spec.hash) {
  console.error(`  MISMATCH: specs/gate.yaml descriptorHash.expectedSpecSha256 is ${gate.expectedSpecSha256}`);
  process.exitCode = 1;
}

// 2. `substreams info --json` of the real local spkg, minus the two huge free-text blobs.
const spkg = join(REPO_ROOT, "packages", "erc4626-flows", "erc4626-flows-v0.1.0.spkg");
if (await exists(spkg)) {
  const info = (await substreamsInfo(ctx, spkg, { expandNetworks: true })) as Record<string, unknown>;
  delete info.documentation;
  delete info.proto_source_code;
  for (const m of (info.modules ?? []) as Array<Record<string, unknown>>) delete m.documentation;
  await writeFile(join(FIXTURES, "substreams-info.json"), JSON.stringify(info, null, 2) + "\n");
  const modules = (info.modules ?? []) as Array<{ name: string; hash?: string }>;
  console.log(`fixtures/substreams-info.json <- substreams info ${basename(spkg)} (${modules.length} modules; map_events ${modules.find((m) => m.name === "map_events")?.hash})`);
} else {
  console.log(`fixtures/substreams-info.json: skipped, ${basename(spkg)} is not built locally`);
}

// 3. The real live jsonl runs, copied verbatim so the package's tests are self-contained.
const liveSrc = join(REPO_ROOT, "runs", "live");
const liveDst = join(FIXTURES, "live");
if (await exists(liveSrc)) {
  await mkdir(liveDst, { recursive: true });
  for (const f of (await readdir(liveSrc)).filter((n) => n.endsWith(".jsonl"))) {
    await copyFile(join(liveSrc, f), join(liveDst, f));
    const lines = (await readFile(join(liveDst, f), "utf8")).split("\n").filter((l) => l.trim()).length;
    console.log(`fixtures/live/${f} <- runs/live/${f} (${lines} lines)`);
  }
}
