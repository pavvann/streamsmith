# Brief A12 — Fix `streamsmith deploy status` failing with "Unexpected end of JSON input" against ClickHouse Cloud. Sonnet.

Repo /Users/pawan/Code/hacks/ethonline26, branch main. Do NOT commit; do NOT git checkout/switch/stash; pnpm only; you own packages/streamsmith/** only. Keep `pnpm typecheck && pnpm test` green (88 tests now).

Repro (real, safe, read-only; creds in the repo .env — `set -a; source .env; set +a`):
```
export CLICKHOUSE_URL="$CH_CLOUD_URL" CLICKHOUSE_USER=sink CLICKHOUSE_PASSWORD="$CH_CLOUD_SINK_PASSWORD" CLICKHOUSE_DATABASE=vaultflows
pnpm -s --filter @ethonline26/streamsmith streamsmith deploy status --root "$PWD" --rpc-url https://mainnet.base.org --json
# -> streamsmith: Unexpected end of JSON input   (exit 1)
# without --json: streamsmith: Unexpected token 's', "streamsmit"... is not valid JSON
```
Facts verified by the orchestrator: sending the same three queries by curl as user `sink` with `FORMAT JSON` returns valid JSON (max(number)=51099194 from `vaultflows._blocks_ WHERE deleted = 0`; count() of vault_flows 13430; system.tables list). The cloud `ro` user has a readonly PROFILE and rejects any `readonly=1`/`max_execution_time` settings with ClickHouse code 164; user `sink` accepts them. The URL is https on port 8443. `.env` also has CH_CLOUD_RO_USER/CH_CLOUD_RO_PASSWORD if you want to test the ro path.
Find the actual cause (add a `--verbose` that logs each request URL/body/status/first 200 bytes of response; likely candidates: a query issued without FORMAT and parsed as JSON; an error body (text) parsed as JSON; the "Unexpected token 's'" case suggests our own stderr/stdout text being fed to JSON.parse, i.e. a pipe/ordering bug in the status command when not --json). Fix it, add a regression test with a mocked fetch that returns (a) a text error body, (b) an empty body, (c) valid FORMAT JSON, and make `deploy status` print a clear error naming the query and HTTP status instead of a JSON parse error. Then run the real repro once and paste the actual JSON output in your report (it must contain deploymentMode self-managed-sink, headBlock, chainHead, lagBlocks, rowCounts). Append friction to feedback/graph.md. Report under 200 words.
