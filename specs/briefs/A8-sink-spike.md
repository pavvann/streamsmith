# Brief A8 — First custom rows into ClickHouse via the self-managed sink (kill criterion).

This repository, branch main. Do NOT commit; do NOT git checkout/switch/stash; do NOT rebuild the package. You may write only under runs/live/, docs/build/, feedback/graph.md. packages/streamsmith and packages/mcpgen are being changed in parallel — never touch them. Facts only.

Inputs that exist: local spkg packages/erc4626-flows/erc4626-flows-v0.1.0.spkg (start block 51001200; output module map_events); token and DSN in the repo `.env` (`set -a; source .env; set +a`): SUBSTREAMS_API_TOKEN, CLICKHOUSE_DSN=clickhouse://sink:sinkpass@localhost:9000/vaultflows, CLICKHOUSE_URL=http://localhost:8123 (user sink / sinkpass; read-only user ro / ropass); local ClickHouse container `vaultflows-ch` is running (verify with `docker ps`; if not, `docker start vaultflows-ch`). Ready-to-run commands are in docs/build/toolchain.md ("Ready-to-run once token exists") and docs/build/clickhouse-local.md. substreams-sink-sql 4.13.1 is at ~/.local/bin. Views: packages/erc4626-flows/sql/views.sql.

Do:
1. `substreams-sink-sql from-proto` (ClickHouse, from-proto mode) with the spkg and `map_events` over range 51092254:51093002 (includes the 42 known flows and the observation at 51093000), endpoint base-mainnet.streamingfast.io:443, `--network base`, cursor file runs/live/clickhouse-cursor.txt, `--bytes-encoding 0xhex` if the flag exists. If the sink refuses on a processed-blocks guard, find the equivalent flag (`--help`) and record it. Time it.
2. Verify in ClickHouse (HTTP, user ro): list tables in `vaultflows`; `SELECT count() FROM vault_flows`, `FROM share_value_observations`, `FROM vaults`; the 42 flows and 2 observations must be present; show 2 sample rows each; show the cursor table content.
3. Apply packages/erc4626-flows/sql/views.sql (as sink user); if a statement fails, record the exact error and the column names actually present (`DESCRIBE TABLE`), do not edit views.sql (report the fix needed instead). Query `share_value_growth` and `vault_flows_24h`.
4. Restart-safety: run the same sink command a second time over the same range; confirm the cursor resumes and row counts do not double (report exact before/after counts; if they double, that is a finding, not something to fix).
5. Write docs/build/sink-spike.md: exact commands, timings, row counts, view outputs, errors, the deploymentMode this proves (`self-managed-sink`). Append friction to feedback/graph.md.
Report under 300 words with the numbers.
