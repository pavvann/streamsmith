# Local ClickHouse for the sink (A1)

**Status 2026-09-09: container NOT running.** The image pull failed twice because the host disk is full (see `docs/build/toolchain.md` → Blockers):

```
docker run … clickhouse/clickhouse-server:latest
  → docker: failed to register layer: write /usr/bin/clickhouse: input/output error
docker pull clickhouse/clickhouse-server:latest
  → Error response from daemon: error creating temporary lease: write /var/lib/desktop-containerd/daemon/io.containerd.metadata.v1.bolt/meta.db: input/output error
```

Everything below is the exact procedure to run once ≥ ~3 GB is free. Nothing here has been verified against a live container yet; the two `SELECT 1` checks at the end are the acceptance test.

## 1. Start (Docker Desktop must be running: `open -a Docker`, then wait for `docker info` to succeed)

```bash
docker run -d --name vaultflows-ch \
  -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_DB=vaultflows \
  -e CLICKHOUSE_USER=sink \
  -e CLICKHOUSE_PASSWORD=sinkpass \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  clickhouse/clickhouse-server:latest

# wait until HTTP answers (prints 1)
until [ "$(curl -s --max-time 2 -u sink:sinkpass 'http://localhost:8123/?query=SELECT%201')" = "1" ]; do sleep 2; done; echo ready
```

Ports: **8123 = HTTP** (curl, backend/MCP queries), **9000 = native TCP** (the only protocol `substreams-sink-sql` accepts).
`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` lets the `sink` user run `CREATE USER` / `GRANT`, which step 2 needs.

## 2. Read-only user `ro` / `ropass` (SELECT on `vaultflows` only)

```bash
docker exec vaultflows-ch clickhouse-client --user sink --password sinkpass --multiquery -q "
CREATE USER IF NOT EXISTS ro IDENTIFIED WITH sha256_password BY 'ropass';
GRANT SELECT ON vaultflows.* TO ro;
SHOW GRANTS FOR ro;"
```

## 3. Verify `SELECT 1` — HTTP and native

```bash
# HTTP (8123), writer user
curl -s -u sink:sinkpass 'http://localhost:8123/?query=SELECT%201'                         # expect: 1
# HTTP, read-only user
curl -s -u ro:ropass   'http://localhost:8123/?query=SELECT%201'                           # expect: 1
curl -s -u ro:ropass   'http://localhost:8123/?database=vaultflows&query=SELECT%20currentDatabase()'   # expect: vaultflows

# Native (9000) via the client inside the container
docker exec vaultflows-ch clickhouse-client --user sink --password sinkpass --database vaultflows -q 'SELECT 1'   # expect: 1
docker exec vaultflows-ch clickhouse-client --user ro   --password ropass   --database vaultflows -q 'SELECT 1'   # expect: 1

# Negative check: ro must NOT be able to write (expect "Not enough privileges" / code 497)
curl -s -u ro:ropass 'http://localhost:8123/' --data-binary 'CREATE TABLE vaultflows.ro_should_fail (a UInt8) ENGINE = Memory'
```

## 4. DSN strings

| Use | DSN |
|---|---|
| `substreams-sink-sql` (writer, native TCP) | `clickhouse://sink:sinkpass@localhost:9000/vaultflows` |
| Read-only, native TCP (clients that speak native) | `clickhouse://ro:ropass@localhost:9000/vaultflows` |
| Read-only, HTTP (backend / MCP / curl) | `http://ro:ropass@localhost:8123/?database=vaultflows` |
| Writer, HTTP (ad-hoc admin) | `http://sink:sinkpass@localhost:8123/?database=vaultflows` |

Sink DSN rules (from the substreams-sink-sql v4.13.1 README): format `clickhouse://<user>:<password>@<host>:<port>/<dbname>[?<options>]`; **only native TCP** (9000, or 9440 secure) — an HTTP port (8123/8443) is rejected with an error; for ClickHouse Cloud add `?secure=true` and use port 9440.

Matching entries live in `/.env.example` (`CLICKHOUSE_*`, `CLICKHOUSE_DSN`, `CLICKHOUSE_RO_HTTP_URL`).

## 5. Sink commands against this container

See `docs/build/toolchain.md` → "Ready-to-run once token exists" (from-proto one-shot vs. `setup` + `run` for a `db_out` manifest).

## 6. Lifecycle

```bash
docker stop vaultflows-ch && docker start vaultflows-ch     # pause / resume (data kept in the container's writable layer)
docker rm -f vaultflows-ch                                   # wipe everything and start over from step 1
docker logs -f vaultflows-ch                                 # server log
docker exec -it vaultflows-ch clickhouse-client --user sink --password sinkpass --database vaultflows   # interactive shell
```

No host volume is mounted (data disappears with `docker rm`). If persistence is wanted, add `-v vaultflows-ch-data:/var/lib/clickhouse` to the `docker run`.
