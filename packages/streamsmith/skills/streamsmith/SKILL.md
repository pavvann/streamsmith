---
name: streamsmith
description: Promote a Substreams package to a verified deployment. Use the official substreams-* skills to write the package, then run the Streamsmith CLI to gate it against specs/gate.yaml, publish it, deploy the ClickHouse sink, and emit a Deployment Receipt that binds package, parameters, schema and deployment together. Use when asked to gate, publish, deploy, receipt, or generate the MCP for the erc4626-flows package.
compatibility:
  platforms: [claude-code]
metadata:
  version: 0.1.0
---

# Streamsmith

Streamsmith does not write Substreams code. It **promotes** a package that already builds:
gate → publish → deploy → receipt → MCP.

## Division of labour

| Task | Use |
|---|---|
| Design modules, protos, params, Rust | official `substreams-dev` skill |
| Choose sink type / from-proto vs database-changes | official `substreams-sql` skill |
| Run a sink locally | official `substreams-sink-deploy-local` skill |
| Hosted sink on The Graph Market | official `substreams-hosted-sink`, `thegraph-market-api` skills |
| Prove the package is correct, then ship it with provenance | **this skill** |

## Hard rules

1. **Never modify `specs/*`.** `specs/vaultflows.proto` is the frozen public contract, `specs/gate.yaml` is the
   executable gate, `specs/receipt.schema.json` is the receipt shape. Changing the proto changes
   `descriptorHash.expectedSpecSha256` and the gate fails on purpose (`spec_unmodified`). If a spec must change, say so
   and stop — a human decides.
2. **Never hand-write DDL for the four base tables.** The from-proto sink creates them from the proto annotations.
   Only `packages/erc4626-flows/sql/views.sql` is hand-written, and every view filters `_deleted_ = 0`.
3. **Stop on failure with evidence.** Every command writes machine-readable output under `runs/<runId>/`
   (`gate.json`, `build.log`, `<run>.stderr.log`, `publish.json`, `deploy.json`, `mcp.json`). Quote the file and the
   failing assertion; never re-run with the check removed, and never edit a fixture to make an assertion pass.
4. **`substreams run` needs `--limit-processed-blocks 0`.** The CLI refuses any request over 10,000 processed blocks;
   the gate adds the flag unconditionally.
5. **Vocabulary.** `banned_words` fails the gate on the words listed in `specs/gate.yaml`. Say "execution rate",
   "share value", "observed window", "share migration".

## Commands

Run from the repo root. `--run-id` defaults to `runs/CURRENT`.

```bash
pnpm --filter @ethonline26/streamsmith streamsmith new-run          # mint runs/<id>/, write runs/CURRENT
pnpm --filter @ethonline26/streamsmith streamsmith gate             # specs/gate.yaml, exit 0/10/20/30
pnpm --filter @ethonline26/streamsmith streamsmith publish --dry-run
pnpm --filter @ethonline26/streamsmith streamsmith deploy hosted --spkg-url <url> --ch-server <host>
pnpm --filter @ethonline26/streamsmith streamsmith deploy self-managed --spkg <file>
pnpm --filter @ethonline26/streamsmith streamsmith deploy views      # applies packages/erc4626-flows/sql/views.sql
pnpm --filter @ethonline26/streamsmith streamsmith receipt --spkg <file> --schema-sql <file>
pnpm --filter @ethonline26/streamsmith streamsmith mcp               # delegates to @ethonline26/mcpgen
pnpm --filter @ethonline26/streamsmith streamsmith manifest start|finish
pnpm --filter @ethonline26/streamsmith streamsmith casestudy
```

`streamsmith --help` prints every flag. Add `--json` to any command for machine output.

## Order of operations

1. `new-run` — one run id ties gate, publish, deploy, receipt and case study together.
2. `gate` — build, then three runs (primary 51092254:51092454, an identical rerun, observation 51092998:51093002),
   then the 18 assertions in `specs/gate.yaml` (`optionalRuns.primary_production_mode` is a 19th check, disabled
   because it costs a third paid run). **Exit codes: 0 pass, 10 build failed, 20 a run failed, 30 a
   `severity: fail` assertion failed.** `severity: warn` assertions (`log_index_matches_rpc`,
   `observation_matches_reference`) are recorded and never change the exit code. Do not continue on a non-zero exit.
3. `publish` — `substreams registry publish`. `--dry-run` first; it records the exact command and the spkg sha256.
4. `deploy hosted` (preferred) or `deploy self-managed`. Hosted exits **40** when the ClickHouse password is not
   staged: a human must enter it on the Portal secret page, never in chat, then re-run with `--deployment-id`.
   After the sink has created the base tables, views are applied from `packages/erc4626-flows/sql/views.sql`.
5. `receipt` — writes `receipts/<pkg>-<version>-<runId>.json`, validated against `specs/receipt.schema.json`.
   It binds `packageHash` (sha256 of the exact .spkg bytes — artifact identity, **not** source identity),
   `outputModuleHash` (the reproducible identity, from `substreams info`), `protoDescriptorHash`, `parametersHash`,
   `sinkSchemaHash`, the deployment, and the gate result.
6. `mcp` — shells out to `pnpm --filter @ethonline26/mcpgen generate …` and writes `mcpManifestHash` back into the
   receipt. Streamsmith never generates MCP code itself.
7. `manifest finish` / `casestudy` — the AI-usage record for the submission.

## The fail-closed contract

The generated MCP server re-reads the receipt and the live deployment on every call. It refuses to answer when the
output module hash, descriptor hash, parameters hash or sink schema hash drifts from the receipt, when the gate did
not pass, or when the sink lag exceeds policy. A refusal names the mismatched field. Answers carry the receipt's
provenance (`runId`, ranges, head block, lag) — no answer without provenance.

## Environment

`.env.example` lists every variable. `SUBSTREAMS_API_TOKEN` (data-plane, from `substreams auth`) is not the same as
`PORTAL_TOKEN` (Portal API bearer). Without a token the gate's runs fail with `Unauthenticated` and exit 20.
`BASE_RPC_URL` only feeds the two warn-level cross-checks; when it is unreachable they are skipped with a note.

## When something fails

- exit 10 — read `runs/<id>/build.log`. Fix the Rust/manifest with the `substreams-dev` skill; never touch `specs/`.
- exit 20 — read `runs/<id>/<run>.stderr.log`. `Unauthenticated` means no token; a processed-block refusal means the
  `--limit-processed-blocks 0` flag was dropped.
- exit 30 — read `runs/<id>/gate.json`, find the assertion with `"passed": false` and `"severity": "fail"`, and quote
  its `detail`. `spec_unmodified` failing means `specs/vaultflows.proto` changed: revert it.
- exit 40 — hosted deploy is waiting for a human to stage the DB secret.
