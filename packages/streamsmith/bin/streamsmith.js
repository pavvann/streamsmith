#!/usr/bin/env node
// Thin launcher: runs src/cli.ts through tsx so the plugin works from a checkout without a build step.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");
const r = spawnSync(process.execPath, ["--import", "tsx", cli, ...process.argv.slice(2)], { stdio: "inherit", cwd: process.cwd(), env: process.env });
process.exit(r.status ?? 1);
