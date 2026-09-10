#!/usr/bin/env node
// Runs the TypeScript CLI with Node's built-in type stripping (Node >= 22.18 / 23.6).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write("mcpgen needs Node >= 22.18 (native TypeScript type stripping)\n");
  process.exit(1);
}
const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2));
