#!/usr/bin/env node
// Thin launcher: runs src/cli.ts through tsx so the plugin works from a checkout without a build step.
//
// tsx must be resolved from THIS package, not from the cwd: the CLI is meant to be run from the repo root
// (`--root` defaults to the cwd) and tsx lives in packages/streamsmith/node_modules, so a bare `--import tsx`
// fails with ERR_MODULE_NOT_FOUND as soon as the cwd is anywhere else.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");

let tsx;
try {
  tsx = import.meta.resolve("tsx"); // honours the package's "import" condition; Node >= 20.6
} catch {
  tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
}

const r = spawnSync(process.execPath, ["--import", tsx, cli, ...process.argv.slice(2)], { stdio: "inherit", cwd: process.cwd(), env: process.env });
if (r.error) {
  process.stderr.write(`streamsmith: cannot start node: ${r.error.message}\n`);
  process.exit(1);
}
process.exit(r.status ?? 1);
