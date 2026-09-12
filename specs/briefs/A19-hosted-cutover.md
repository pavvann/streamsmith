# A19 — Graph Market hosted deployment: cut-over

## Situation

A Graph Market hosted sink for `erc4626-flows` v0.1.0 is now running and healthy:

- deployment id `depnywi036749442f3c55e7` (organization id in `.env` as `PORTAL_ORG_ID`; deployment id in `.env` as `HOSTED_DEPLOYMENT_ID`)
- writes to ClickHouse Cloud database `vaultflows_hosted` (same host as `vaultflows`), user `default`, port 9440 secure
- state `DEPLOYMENT_STATE_DEPLOYED`, pod `STATE_CATCHING_UP` from start block 51001200; base tables created by the sink from the proto annotations
- the `ro` user already has `SELECT` on `vaultflows_hosted`; the `sink` user has no grants there, so DDL (views) must use the admin credentials from `.env` (`CH_CLOUD_ADMIN_USER` / `CH_CLOUD_ADMIN_PASSWORD` / `CH_CLOUD_URL`)

Root cause of the earlier failure, for the docs: a hosted deployment's start command is generated once, at first `Deploy`. The first deployment (`depdehi448c87998ebb763b`) was created with `execution_config.parameters` set to the raw module parameter string; the runtime split it as `-p <string>` and failed with `param for module "vaults[]": module not found`. `UpdateDeploymentConfig` restarts pods but does not regenerate the command, and `Deploy` on an existing id is rejected as already existing. The fix is a fresh deployment with no `parameters` field; the published spkg carries the manifest defaults. The old deployment is left for the operator to delete in the Graph Market UI; do not call any delete endpoint.

The self-managed sink (pid in `runs/live/cloud/sink.pid`, database `vaultflows`) keeps running as the fallback. Do not stop it.

## Goal

Make the hosted deployment the primary live pipeline behind the Deployment Receipt, the generated MCP server, and the Vaultpilot dashboard, with `deploymentMode: graph-market-hosted` visible in provenance. Keep the self-managed path documented as the fallback. Everything must stay honest: the receipt describes what is actually deployed and verified.

## Portal access

`.portal-token.json` (gitignored) holds `accessToken` (15-minute lifetime) and `refreshToken`. Refresh with `POST https://admin.streamingfast.io/sf.portalapi.v1.PortalApi/RefreshToken` body `{"refresh_token": ...}` and merge the response back into the file. The CLI reads `PORTAL_TOKEN`, `PORTAL_REFRESH_TOKEN`, `PORTAL_ORG_ID` from the environment; export them from the file before CLI calls. Never print a token, never write one into a tracked file. Read-only portal calls are `GetDeploymentState`, `Logs`, `GetDeploymentEvents`, `HasDeploymentSecret`. Do NOT call `Deploy`, `UpdateDeploymentConfig`, or `CreateDeployment`: any of them restarts or duplicates the running pod.

## Work, in order

1. **Views.** Apply `packages/erc4626-flows/sql/views.sql` to `vaultflows_hosted` with `streamsmith deploy views` (see `streamsmith --help`; pass the admin URL and `--database vaultflows_hosted`). Confirm `vault_flows_24h` and `share_value_growth` exist and return rows.

2. **Hosted deploy record without touching the pod.** Read `packages/streamsmith/src/deploy/hosted.ts` and `deploy/status`. If `deploy status --deployment-id … --database vaultflows_hosted` can write a `deploy.json` with `deploymentMode: graph-market-hosted` for an existing deployment without calling `Deploy`/`UpdateDeploymentConfig`, use it in a new run (`streamsmith new-run`). If no such path exists, add one: `deploy hosted --attach --deployment-id ID` that records an existing deployment (GetDeploymentState + ClickHouse head + chain head + row counts) into `runs/<id>/deploy.json` and never deploys. Unit-test it against the existing fake portal fixtures. Record the exact `spkg.url`, `network`, `execution_config` as deployed, and the ClickHouse host fingerprint (never the password).

3. **Schema hash.** `streamsmith schema-render --spkg … --database vaultflows_hosted` must equal `streamsmith schema-dump --database vaultflows_hosted` against the live database. If they differ, stop and report the diff; do not adjust either side.

4. **Gate evidence for the run.** The module hash is unchanged (`8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`), so the gate ranges are unchanged. Run `streamsmith gate --reuse-runs --skip-build` in the new run directory so it carries its own `gate.json`; if `--reuse-runs` cannot find the evidence, run the gate fully. Record in the run's README what was reused.

5. **Receipt.** `streamsmith receipt --schema-from-spkg --deploy-json runs/<id>/deploy.json`. It must validate against `specs/receipt.schema.json` with `deploymentMode: graph-market-hosted`. Save under `receipts/`. Do not delete or edit the existing self-managed receipt; it remains valid for the fallback.

6. **MCP.** Regenerate `packages/mcp-vaultflows` from the new receipt with `streamsmith mcp`. Its runtime must read `vaultflows_hosted` through the `ro` user (the read-only profile rejects query settings; the existing retry-without-settings logic must keep working). Verify live over stdio: `pipeline_status` reports `deploymentMode: graph-market-hosted`; `share_value_growth` and `vault_flows_24h` return rows with provenance; the refusal chain still fires (`receipt_mismatch` on a tampered copy of the receipt; `stale_data` if lag > 300). Save the probe transcript to `runs/live/cloud/mcp-live-probe-hosted.txt` with no credentials or absolute paths in it. Tests green.

7. **Vaultpilot.** Point the cloud source at `vaultflows_hosted` (env, not code, unless code hard-codes the database). Run `pnpm --filter @ethonline26/vaultpilot agent:once --source cloud` (dry run; it moves no money) and confirm the dashboard's pipeline stamp shows the hosted mode and the receipt hashes. If the sink has not caught up (lag > 300), the decision service must refuse on staleness; that is correct behaviour, record it, and leave the dashboard on `vaultflows` until step 9.

8. **Docs and evidence.** Update `README.md` (live numbers, sponsor evidence map: hosted deployment id and mode, limitations), `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `docs/TASKS.md`, `docs/SUBMISSION.md` evidence list, `docs/build/sink-spike.md` §7 (root cause and fix above), `runs/live/README.md`. Write project facts only: no names, percentages of anything but data, model names, machine paths, or session notes (see `specs/briefs/A18-repo-hygiene.md`). Banned vocabulary anywhere in the repo: yield, APY, share price, TVL, risk. Use "share-value growth" and "observed window".

9. **Catch-up gate.** Steps 6 and 7's live verification need lag < 300 blocks. Measure the hosted catch-up rate (`max(number)` in `vaultflows_hosted._blocks_` at two points five minutes apart, against the chain head from `https://mainnet.base.org`). If lag is still > 300 once everything else is done, report the rate and the estimated time to catch up, leave the MCP and dashboard on `vaultflows`, and stop. A follow-up brief will finish the switch.

## Do not

- Do not push. Commit in small commits with clean messages ending in the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do not stop the self-managed sink or edit anything under `runs/live/cloud/` other than adding the new probe file.
- Do not put credentials, tokens, or `/Users/...` paths in any tracked file or in the report.
- Do not run any Vaultpilot command with `--execute`.
- Do not change the proto, the gate, `streamsmith.yaml`, or the package.
- Use pnpm only.

## Report

1. Views applied (row counts from both views).
2. How the hosted deploy record was produced (existing command or new `--attach` path, with test count).
3. Schema hash: render vs dump, equal or not.
4. Receipt path, `deploymentMode`, and the hashes it binds.
5. MCP live probe summary: provenance fields, refusal checks that fired.
6. Vaultpilot: source database in use and what the pipeline stamp shows.
7. Catch-up: head block, lag, measured rate, ETA if not caught up.
8. Files changed, commits made (subjects), `pnpm -r test` result, `git status`.
9. One line confirming nothing was pushed and no deploy/update/create portal call was made.
