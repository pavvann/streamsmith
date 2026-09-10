#!/usr/bin/env node
// Runs the TypeScript server directly with Node's built-in type stripping (Node >= 22.18 / 23.6).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write("this server needs Node >= 22.18 (native TypeScript type stripping)\n");
  process.exit(1);
}
await import("../src/server.ts");
