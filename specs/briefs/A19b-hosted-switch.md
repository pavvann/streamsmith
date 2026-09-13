# A19b — Switch the live MCP server and dashboard to the hosted deployment

## Situation
The Graph Market hosted deployment (`HOSTED_DEPLOYMENT_ID` in `.env`, database `vaultflows_hosted`) has caught up: lag under 100 blocks. The hosted run is `runs/20260912T103328Z-vipc` (also `runs/CURRENT`) with receipt `receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json` (`deploymentMode: graph-market-hosted`, no `mcpManifestHash` yet). The shipped MCP server in `packages/mcp-vaultflows` and the Vaultpilot dashboard still read the self-managed database `vaultflows`.

## Work
1. Regenerate `packages/mcp-vaultflows` from the hosted receipt with `streamsmith mcp`, then bind `mcpManifestHash` into the hosted receipt the same way run `20260910T234439Z-1fr9` did (read the CLI and that run's `mcp.json`/receipt to reproduce the order). The receipt must still validate against `specs/receipt.schema.json`.
2. Live probe over stdio against `vaultflows_hosted` as the `ro` user: `pipeline_status` (hosted mode, lag under 300), `share_value_growth`, `vault_flows_24h`, `vaults`, one refusal (`receipt_mismatch` on a tampered copy) and one forced staleness refusal. Overwrite `runs/live/cloud/mcp-live-probe-hosted.txt` with the transcript; no credentials or machine paths in it.
3. Vaultpilot: set the cloud source to the hosted pipeline persistently in `apps/vaultpilot/.env` (`CH_CLOUD_DATABASE=vaultflows_hosted` and the manifest/receipt paths the app reads; find the exact variable names in `apps/vaultpilot/src/env.ts`). Run `pnpm --filter @ethonline26/vaultpilot agent:once --source cloud` (dry run, never `--execute`). The snapshot must show the hosted mode and receipt hashes and a real decision (the wallet holds no position, so `hold` with that reason is expected; a staleness refusal is not).
4. Docs: `README.md` live numbers and sponsor evidence map, `docs/STATUS.md`, `docs/TASKS.md`, `docs/SUBMISSION.md` evidence list, `runs/live/README.md`: hosted is the live pipeline behind the MCP and the dashboard; self-managed is the fallback. Project facts only (see `specs/briefs/A18-repo-hygiene.md`). Banned words: yield, APY, share price, TVL, risk.
5. `pnpm -r test` green. Run `~/.claude/skills/git-guardrail/scan.sh` on the files you changed. Commit in small clean commits with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, then `git push origin main` (normal push, never force).

## Do not
Call any portal endpoint other than `GetDeploymentState`/`Logs`; stop the self-managed sink; run anything with `--execute`; change the proto, gate, `streamsmith.yaml`, or the Rust package; write credentials or `/Users/...` paths anywhere tracked.

## Report
MCP manifest hash and receipt hash; probe summary (fields + refusals); Vaultpilot decision and stamp; files changed and commit subjects; test result; push confirmation.
