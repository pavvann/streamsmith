# Brief A6b — Finish mcpgen and the generated MCP (continuation of A6). Sonnet.

Repo /Users/pawan/Code/hacks/ethonline26, branch main. Do NOT commit; do NOT git checkout/switch/stash; do NOT run cargo/docker/`substreams build`. pnpm only. You own packages/mcpgen, packages/mcp-vaultflows, packages/erc4626-flows/sql/views.sql only; another agent is editing packages/streamsmith — never touch it. Read specs/briefs/A6-mcpgen.md first; all deliverables there still apply.

Current state (verified): packages/mcpgen `pnpm test` = 57 pass / 1 fail; `pnpm typecheck` FAILS with TS1294 in test/helpers.ts line 70 (syntax not allowed under `erasableSyntaxOnly`: likely an enum, namespace, or constructor parameter property — replace with erasable syntax). packages/mcp-vaultflows exists (generated). packages/erc4626-flows/sql/views.sql exists.

Hard facts to honor:
1. specs/receipt.schema.json now REQUIRES `outputModuleHash` (string) and allows `moduleHashes` (object). Update fixtures/receipt.example.json and regenerate packages/mcp-vaultflows so receipt.json/manifest.json validate; include `outputModuleHash` in every response's provenance.
2. Start block is 51001200 (fixtures said 49276800). Observed window must always be computed from actual min/max observation blocks in the data, never from configuration.
3. Real data shapes to validate views.sql against: runs/live/primary-51092254-51092454.jsonl and runs/live/observation-51092998-51093002.jsonl (protojson: camelCase; the sink's from-proto tables use snake_case proto field names). Column names in views.sql must be exactly the snake_case proto field names from specs/vaultflows.proto; table names exactly the `schema.table` option values. Verify by reading the proto; do not guess. Injected columns per docs/build/substreams-facts.md (d).
4. Fail-closed checks must be real code paths with tests: schema mismatch → `{refused:true, reason:"schema_mismatch", expected, actual}`; lag > MAX_LAG_BLOCKS (default 300) → `stale_data`; provenance `{packageHash, outputModuleHash, parametersHash, deploymentMode, deploymentId, headBlock, lagBlocks, observedWindow}` on every success.
5. Generator CLI contract: `generate --receipt <path> --proto <path> --views <path> --out <dir>`; last stdout line exactly `{"manifest": "<absolute path>"}`.
Finish with `pnpm typecheck && pnpm test` green in packages/mcpgen and `pnpm typecheck` green in packages/mcp-vaultflows. Append friction to feedback/graph.md. Report under 350 words: tool list with param schemas, exact refusal behaviors, what is mocked.
