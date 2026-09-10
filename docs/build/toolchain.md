# Toolchain (A1) — status as of 2026-09-09

Machine: macOS (Darwin 25.5.0), arm64 (Apple Silicon). Everything below was executed on this machine unless marked **unverified**.

## Installed versions

| Tool | Version | Path | How installed |
|---|---|---|---|
| rustup | 1.29.0 (28d1352db 2026-03-05) | `~/.cargo/bin/rustup` | already present; had **no default toolchain** |
| rustc / cargo (stable) | rustc 1.98.1 (48a229cea 2026-09-01), cargo 1.98.1 | `~/.rustup/toolchains/stable-aarch64-apple-darwin` | `rustup default stable` |
| wasm target | `wasm32-unknown-unknown` (installed for stable) | — | `rustup target add wasm32-unknown-unknown` |
| substreams CLI | 1.22.0 (Commit be35ad3, 2026-08-24) | `/opt/homebrew/bin/substreams` | `brew install streamingfast/tap/substreams` |
| buf | 1.72.0 | `/opt/homebrew/bin/buf` | `brew install buf` |
| substreams-sink-sql | 4.13.1 (Commit c05b15e, 2026-02-26) | `~/.local/bin/substreams-sink-sql` | GitHub release tarball (sha256 verified against `checksums.txt`) |
| Docker | client 29.1.3, server (Docker Desktop) 28.1.1 | `/opt/homebrew/bin/docker` | already present; daemon was not running, started with `open -a Docker` |
| protoc | present | `/opt/homebrew/bin/protoc` | already present (not used) |

### Exact install commands (reproducible)

```bash
# Rust
rustup default stable
rustup target add wasm32-unknown-unknown

# substreams CLI + buf
brew tap streamingfast/tap
brew install streamingfast/tap/substreams
brew install buf

# substreams-sink-sql v4.13.1 (darwin arm64)
cd "$(mktemp -d)"
curl -sSL -o sink.tar.gz https://github.com/streamingfast/substreams-sink-sql/releases/download/v4.13.1/substreams-sink-sql_darwin_arm64.tar.gz
curl -sSL -o checksums.txt https://github.com/streamingfast/substreams-sink-sql/releases/download/v4.13.1/checksums.txt
grep darwin_arm64 checksums.txt   # a87e3a0dd0c27f7e1a5488c7bcbe4c57f336f1b131e942298802adb1b76d57b7
shasum -a 256 sink.tar.gz          # must match
tar -xzf sink.tar.gz
install -m 0755 substreams-sink-sql ~/.local/bin/substreams-sink-sql
substreams-sink-sql --version
```

## Pinax packages

Source: `vendor/substreams-evm` (git-ignored; `vendor/` added to `.gitignore`).
Cloned `--depth 1` from https://github.com/pinax-network/substreams-evm at commit
`970a665e15619de8ad7f686bd89412a1030d46dc` (2026-07-09, "feat(evm-transfers): surface ERC-3009 (x402) authorization events as db_out tables (#260)").

Repo conventions:
- Cargo **workspace** at repo root; every package's wasm lands in `vendor/substreams-evm/target/wasm32-unknown-unknown/release/<crate>.wasm`.
- `rust-toolchain.toml` pins `channel = "1.88"`, targets `wasm32-unknown-unknown`, component `rustfmt`. rustup will try to download 1.88 on first `cargo` invocation in the tree.
- Each package dir has a `Makefile`: `make build` = `cargo build --target wasm32-unknown-unknown --release`; `make pack` = `substreams pack -o ../spkg/{spkgDefaultName}` (pre-built `.spkg` files are committed under `vendor/substreams-evm/spkg/`).
- `substreams.yaml` `network:` is `mainnet` for 46 of 50 manifests (incl. erc4626 and all erc20/*); Makefile `ENDPOINT` defaults vary per package (erc4626 → Base, erc20/* → Arbitrum One).
- `START_BLOCK` in Makefiles is a per-package dev default for `make gui/prod` only; `STOP_BLOCK ?= +1000`; `PARALLEL_JOBS ?= 500` (sent as header `X-Substreams-Parallel-Workers`). Module `initialBlock` is 0 everywhere (nothing in the manifests).
- Endpoints seen in Makefiles: `base.substreams.pinax.network:443`, `eth.substreams.pinax.network:443`, `arbone.substreams.pinax.network:443`, `polygon.…`, `avalanche.…`, `tronevm.…`.

### erc4626 (`vendor/substreams-evm/erc4626/`)

| Item | Value |
|---|---|
| Manifest | `vendor/substreams-evm/erc4626/substreams.yaml` — `package.name: erc4626`, `version: v0.1.0`, `network: mainnet` |
| Module | `map_events`, kind `map`, input `source: sf.ethereum.type.v2.Block`, output `proto:erc4626.v1.Events`, initialBlock 0 |
| Proto | `vendor/substreams-evm/proto/v1/erc4626.proto` (package `erc4626.v1`; importPath `../proto`). Generated Rust: `vendor/substreams-evm/proto/src/pb/erc4626.v1.rs` |
| Source | `vendor/substreams-evm/erc4626/src/lib.rs` (61 lines). Decodes `Deposit(sender, owner, assets, shares)` and `Withdraw(sender, receiver, owner, assets, shares)` via `substreams_abis::standard::erc4626::events`, matched by topic0 across **all** addresses. Uses `logs_with_calls()` when call traces exist (EXTENDED blocks), falls back to receipt logs. Emits only transactions with ≥1 matching log. |
| Proto shape | `Events{ repeated Transaction }` → `Transaction{hash, from, to, nonce, gas_price, gas_limit, gas_used, value, repeated Log}` → `Log{address(vault), ordinal, topics, data, optional Call, block_index, oneof{Deposit, Withdraw}}`; amounts are `string` uint256; addresses `bytes`. **No block number/timestamp fields in the proto** (comes from the Substreams clock). |
| Wasm (manifest) | `../target/wasm32-unknown-unknown/release/erc4626.wasm`, type `wasm/rust-v1` |
| Pre-built spkg | `vendor/substreams-evm/spkg/erc4626-v0.1.0.spkg` — `substreams info` OK: module `map_events`, hash `9d3e4a81797e43b37f46443144913096d3a3080c`, output `proto:erc4626.v1.Events`, Network `mainnet`. Note: its embedded doc says "ERC-4626 Flows" / `proto:erc4626.flows.v1.Events` while the actual module output type is `proto:erc4626.v1.Events` (doc drift inside the spkg). Whether this spkg's wasm equals current `lib.rs` is **unverified**. |
| Makefile defaults | `ENDPOINT ?= base.substreams.pinax.network:443`, `START_BLOCK ?= 20000000`, `STOP_BLOCK ?= +1000` |
| Our build | **FAILED** — see "Build results" |

### erc20 (`vendor/substreams-evm/erc20/`) — four sub-packages

| Package | Manifest name / version | Module(s) | Inputs → Output | Proto | Pre-built spkg |
|---|---|---|---|---|---|
| `erc20/transfers` | `erc20_transfers` v0.4.0 | `map_events` (map) | `sf.ethereum.type.v2.Block` → `proto:erc20.transfers.v1.Events` | `proto/v1/erc20-transfers.proto` (Transfer{from,to,amount}, Approval{owner,spender,value}) | `spkg/erc20-transfers-v0.4.0.spkg` (hash `a7d9509b291ca2813bdd41de0addcb9b104b55da`) |
| `erc20/tokens` | `erc20_tokens` v0.4.0 | `map_events` (map) | Block → `proto:erc20.tokens.v1.Events` | `proto/v1/erc20-tokens.proto` | `spkg/erc20-tokens-v0.4.0.spkg` |
| `erc20/balances` | `erc20_balances` v0.3.4 | `map_balance_changes` (map): `erc20_transfers:map_events` + `erc20_tokens:map_events` → `proto:evm.balances.v1.BalanceChanges`; `map_events` (map): `params: string` + `map_balance_changes` → `proto:evm.balances.v1.Events` | imports `../../spkg/erc20-transfers-v0.3.3.spkg`, `../../spkg/erc20-tokens-v0.3.3.spkg` | `proto/v1/balances.proto` | `spkg/erc20-balances-v0.3.4.spkg`; `params: map_events: 100` (RPC batch chunk) |
| `erc20/supply` | `erc20_supply` v0.3.4 | `map_events` (map): `params: string` + `erc20_balances:map_events` → `proto:erc20.supply.v1.Events` | imports `../../spkg/erc20-balances-v0.3.4.spkg` | `proto/v1/erc20-supply.proto` | `spkg/erc20-supply-v0.3.4.spkg`; `params: map_events: 100` |

Wasm binaries: `../../target/wasm32-unknown-unknown/release/erc20_<pkg>.wasm`; `transfers` and `tokens` use type `wasm/rust-v1+wasm-bindgen-shims`, `balances`/`supply` use `wasm/rust-v1`. All `network: mainnet`. Makefile defaults for all four: `ENDPOINT ?= arbone.substreams.pinax.network:443`, `START_BLOCK ?= 266257`. `balances`/`supply` do RPC calls (batched, chunk 100).
Our build of erc20/*: **NOT ATTEMPTED** (same disk blocker as erc4626).

### substreams.dev registry (checked 2026-09-09)

- **`erc4626` is NOT published.** `substreams info erc4626@latest` → `Error: read manifest "erc4626@latest": package does not exist on the Substreams registry`. `https://substreams.dev/packages/erc4626` → 308 → `/packages/erc4626/latest` → 404. Packages index page (`https://substreams.dev/packages`, 24 package links) contains no "4626". So the only erc4626 artifacts are the git repo's `spkg/erc4626-v0.1.0.spkg` and a local build.
- `erc20-transfers` **is** published (Pinax, links to github.com/pinax-network/substreams-evm): `https://substreams.dev/packages/erc20-transfers/v0.2.0`; latest on registry = **v0.2.0** (module hash `7f461e7dc26a6c859a0bdb00368f8b5eab75736d`), i.e. the registry lags the repo (v0.4.0). Download URL pattern: `https://spkg.io/v1/packages/erc20-transfers/v0.2.0` → 302 → `/v1/files/erc20-transfers-v0.2.0.spkg`. CLI resolves it as `substreams info erc20-transfers@latest`.
- No public search API found (`/search`, `/api/search`, `/api/packages/<name>` all 404). Reliable check = `substreams info <name>@latest`.

## Build results

### erc4626 — `substreams build` in `vendor/substreams-evm/erc4626/` → **FAIL**

Attempt 1 (exact output):
```
⚠️  No protobuf exclude paths configured
📋 Generated buf.gen.yaml using neoeinstein-prost v0.4.0 and neoeinstein-prost-crate v0.4.1
📦 Generating protobuf code (buf generate <erc4626.tmp.spkg#format=bin> --include-imports)
🎯 Protobuf generation complete
🦀 Rust binary detected
Error: ❌ Error building binary: getting build command for binary default: validating cargo dependency: Rust/Cargo not found: exit status 1
Install Rust from https://rustup.rs/
```
The protobuf step (buf) succeeded; the cargo step failed. Root cause (from running `cargo --version` inside the dir):
```
info: syncing channel updates for 1.88-aarch64-apple-darwin
info: latest update on 2025-06-26 for version 1.88.0 (6b00bc388 2025-06-23)
info: rolling back changes
error: could not read component file: '/Users/pawan/.rustup/toolchains/1.88-aarch64-apple-darwin/lib/rustlib/manifest-clippy-preview-aarch64-apple-darwin': No such file or directory (os error 2)
```
rustup auto-installs the pinned 1.88 toolchain and the install broke mid-unpack. The machine's Data volume had **~238 MB free** at that moment (see Blockers), which is the most likely cause (unverified beyond the correlation). The half-installed `1.88-aarch64-apple-darwin` toolchain (83 MB) was removed with `rustup toolchain uninstall 1.88-aarch64-apple-darwin`.

`RUSTUP_TOOLCHAIN=stable cargo --version` → `cargo 1.98.1` works, so the pin can be bypassed without downloading 1.88.

Attempt 2: **deliberately not run.** A release wasm build of this workspace needs several GB in `vendor/substreams-evm/target/` (lto enabled); with <1.5 GB free it would fail with ENOSPC and could destabilise the host. Rerun once disk is freed:
```bash
cd vendor/substreams-evm/erc4626
RUSTUP_TOOLCHAIN=stable substreams build        # or: rustup toolchain install 1.88 --target wasm32-unknown-unknown && substreams build
ls -la erc4626-v0.1.0.spkg                       # substreams build writes the spkg into the package dir
# Makefile route (writes to ../spkg/): make pack
```
Fallback that needs no build: use the committed `vendor/substreams-evm/spkg/erc4626-v0.1.0.spkg` (verified loadable with `substreams info`).

### erc20/* — **NOT ATTEMPTED** (same blocker). Commands when unblocked:
```bash
cd vendor/substreams-evm/erc20/transfers && RUSTUP_TOOLCHAIN=stable substreams build
cd vendor/substreams-evm/erc20/tokens    && RUSTUP_TOOLCHAIN=stable substreams build
cd vendor/substreams-evm/erc20/balances  && RUSTUP_TOOLCHAIN=stable substreams build   # imports prebuilt transfers/tokens spkgs
cd vendor/substreams-evm/erc20/supply    && RUSTUP_TOOLCHAIN=stable substreams build   # imports prebuilt balances spkg
```
Pre-built fallbacks: `spkg/erc20-transfers-v0.4.0.spkg`, `spkg/erc20-tokens-v0.4.0.spkg`, `spkg/erc20-balances-v0.3.4.spkg`, `spkg/erc20-supply-v0.3.4.spkg`.

## Ready-to-run once token exists

`SUBSTREAMS_API_TOKEN` was **not set** (checked `printenv` and repo `.env`, which does not exist), so no network runs were attempted.

Getting a token: `substreams auth` (opens a browser to The Graph Market, exchanges the API key for a JWT, writes `.substreams.env`; `substreams auth --paste` to enter a JWT/API key by hand). Then `source .substreams.env` or `export SUBSTREAMS_API_TOKEN=<jwt>`. The sink reads `SUBSTREAMS_API_TOKEN` (or `SUBSTREAMS_API_KEY`, see `--api-token-envvar` / `--api-key-envvar`).

Base endpoints: `base-mainnet.streamingfast.io:443` (StreamingFast) or `base.substreams.pinax.network:443` (Pinax; Pinax Makefile default). The erc4626 manifest says `network: mainnet`, so pass `--network base` when relevant (only affects per-network params/initialBlocks; erc4626 has none) and always pass `-e` explicitly.

### 1. Stream Pinax erc4626 `map_events` from Base (200 blocks, JSON lines)
```bash
export SUBSTREAMS_API_TOKEN=<jwt>
substreams run -e base-mainnet.streamingfast.io:443 \
  vendor/substreams-evm/spkg/erc4626-v0.1.0.spkg map_events \
  --network base -s <START_BLOCK> -t +200 -o jsonl
# Same, from the manifest after a successful build:
substreams run -e base-mainnet.streamingfast.io:443 vendor/substreams-evm/erc4626/substreams.yaml map_events --network base -s <START_BLOCK> -t +200 -o jsonl
# Interactive: substreams gui -e base-mainnet.streamingfast.io:443 vendor/substreams-evm/spkg/erc4626-v0.1.0.spkg map_events --network base -s <START_BLOCK> -t +200
```
`<START_BLOCK>`: A2 to supply a Base range with known vault activity. Negative values are resolved relative to head by the server (e.g. `-s -1000 -t +200`).

### 2. ClickHouse sink, from-proto ("Relational Mappings") mode — one command, no `setup`
```bash
export CLICKHOUSE_DSN=clickhouse://sink:sinkpass@localhost:9000/vaultflows   # native TCP port; HTTP 8123 is rejected by the sink
substreams-sink-sql from-proto "$CLICKHOUSE_DSN" <spkg-or-manifest> <output_module> \
  -e base-mainnet.streamingfast.io:443 --network base \
  -s <START_BLOCK> -t <STOP_BLOCK> \
  --bytes-encoding 0xhex \
  --clickhouse-cursor-file-path runs/clickhouse-cursor.txt
```
Facts from `substreams-sink-sql from-proto --help` and the v4.13.1 README:
- `from-proto <dsn> <manifest> [output-module]` creates tables from the module's protobuf and streams; there is no separate `setup` for this mode. The ClickHouse cursor is kept in a **file** (`--clickhouse-cursor-file-path`, default `cursor.txt`), plus `--clickhouse-sink-info-folder`.
- **Requirement:** the output message types must carry `option (schema.table) = { name: "...", clickhouse_table_options: { order_by_fields: [ { name: "..." } ] } }` and field options like `[(schema.field) = { primary_key: true }]`; without them ClickHouse fails with `clickhouse table options not set for table "<name>"`. Optional: `partition_fields` (default `toYYYYMM(_block_timestamp_)`), `replacing_fields` (engine is ReplacingMergeTree with a default `_version`), `index_fields`.
- Pinax `erc4626.proto` has **no** such annotations, so `from-proto` directly against `erc4626-v0.1.0.spkg` is expected to fail (unverified). The `erc4626-flows` output proto (`specs/vaultflows.proto`) must include them.
- Annotation definitions: `proto/sf/substreams/sink/sql/schema/v1/schema.proto` in https://github.com/streamingfast/substreams-sink-sql (tag v4.13.1) — import it as `sf/substreams/sink/sql/schema/v1/schema.proto` in `specs/vaultflows.proto`. (Pinax vendors `spkg/substreams-sink-sql-protodefs-v1.0.7.spkg`, but that package holds only the sink *config* protos, no modules.)
- Our package lives at `packages/erc4626-flows/` (so `<spkg-or-manifest>` above = `packages/erc4626-flows/substreams.yaml` or its built `.spkg`).
- `--bytes-encoding` (raw|hex|0xhex|base64|base58): non-raw stores bytes as String — use `0xhex` for addresses/hashes.

### 3. ClickHouse sink, Database-Changes mode (`db_out` module emitting `sf.substreams.sink.database.v1.DatabaseChanges`, manifest has a `sink:` block with `config.schema`)
```bash
substreams-sink-sql setup "$CLICKHOUSE_DSN" <manifest-or-spkg>
substreams-sink-sql run   "$CLICKHOUSE_DSN" <manifest-or-spkg> <START_BLOCK>:<STOP_BLOCK> \
  -e base-mainnet.streamingfast.io:443 --network base \
  --undo-buffer-size 12        # optional: skip DB-side reorg handling by lagging 12 blocks; 0 = reorg handling in DB
```
`setup` creates the schema from `sink.config.schema` plus system tables `cursors` and `substreams_history` (`--cursors-table`, `--history-table`, `--system-tables-only`, `--on-module-hash-mismatch error|warn|ignore`). Manifest `sink:` block shape (README):
```yaml
sink:
  module: db_out
  type: sf.substreams.sink.sql.v1.Service
  config:
    schema: "./schema.sql"
```

## Blockers (facts)

1. **Host disk full.** `df -h /System/Volumes/Data` → `228Gi size, 186Gi used, 228Mi avail, 100%` at 22:45; `diskutil` → Container Free Space 238.5 MB. After removing the broken 1.88 toolchain and Docker's abandoned layer: **1.2 GiB free**. Still insufficient for a Rust workspace release build or the ClickHouse image. Home dir usage (read-only `du`): `~/Library` 41G (Application Support 17G, Developer 10G, Caches 5.0G, Containers 3.9G), `~/Code` 18G, `~/.cache` 3.8G, `~/.vscode` 2.3G, `~/Music` 2.2G, `~/.claude` 2.1G, `~/.cursor` 1.8G, `~/.rustup` 1.6G, `~/.gradle` 1.2G, `~/.npm-global` 1.0G. `Docker.raw` is sparse (64 GB apparent, 2.0 GB actual). Nothing outside the repo was deleted (per brief), except my own half-installed rust 1.88 toolchain.
2. **ClickHouse container not running.** `docker run … clickhouse/clickhouse-server:latest` → `docker: failed to register layer: write /usr/bin/clickhouse: input/output error`; retry `docker pull` → `Error response from daemon: error creating temporary lease: write /var/lib/desktop-containerd/daemon/io.containerd.metadata.v1.bolt/meta.db: input/output error`. Both are the Docker Desktop VM hitting the full host disk. Commands and DSNs are written in `docs/build/clickhouse-local.md`, **unverified**.
3. **No `SUBSTREAMS_API_TOKEN`** anywhere → no `substreams run` performed (per brief).
4. **erc4626 not on substreams.dev** → cannot `imports: erc4626: erc4626@v0.1.0`; import by local path/spkg (`vendor/substreams-evm/spkg/erc4626-v0.1.0.spkg`) or by an `https://…spkg` URL we host ourselves.

## Local build (Sept 10) — sub-agent A7

Everything in this section was executed on this machine on 2026-09-10 (macOS arm64), repo at `c142d93` (main). `packages/erc4626-flows/` and `specs/vaultflows.proto` are byte-identical to CI commit `18ab2eb` (`git diff --quiet 18ab2eb HEAD -- packages/erc4626-flows specs/vaultflows.proto`).

### Toolchain

| Step | Result |
|---|---|
| `rustup toolchain install 1.88 --profile minimal --target wasm32-unknown-unknown` | 16 s; `1.88-aarch64-apple-darwin installed - rustc 1.88.0 (6b00bc388 2025-06-23)`. rustup also self-updated 1.29.0 → 1.29.1. |
| `cargo --version` in `packages/erc4626-flows/` | `cargo 1.88.0 (873a06493 2025-05-10)`, `rustc 1.88.0`; `rustup show active-toolchain` → `1.88-aarch64-apple-darwin (overridden by …/packages/erc4626-flows/rust-toolchain.toml)`. On this first invocation rustup downloaded the `rustfmt` component by itself (`rust-toolchain.toml` lists `components = ["rustfmt"]`; `--profile minimal` had not installed it). |
| substreams CLI | 1.22.0 (Commit be35ad3) — same as CI |
| Docker | client 29.1.3 / server 28.1.1, ClickHouse container up (see `clickhouse-local.md`) |

### Timings (cold caches; `packages/erc4626-flows/`)

| Command | Exit | Wall clock | Notes |
|---|---|---|---|
| `cargo test --all-targets -- --nocapture` | 0 | **32 s** (compile 31.65 s incl. crate downloads) | `13 passed; 0 failed` (all in `pure::tests`). CI: 3 s with rust-cache hit. |
| `substreams build` | 0 | **35 s** (cargo release 32.61 s + protogen) | log: protogen → `🦀 Rust binary detected` → `Finished release` → `📦 Package created successfully at erc4626-flows-v0.1.0.spkg`. CI: 3 s (cache hit). |
| `substreams pack -o erc4626-flows-v0.1.0.spkg` | 0 | **< 1 s** | |
| `substreams build` again, no source change | 0 | 1 s | `⚡ Protobuf generation skipped (no changes detected)`, cargo `Finished … in 0.27s` |

### Exact output paths (for the Streamsmith gate)

- spkg: `packages/erc4626-flows/erc4626-flows-v0.1.0.spkg` (absolute: `/Users/pawan/Code/hacks/ethonline26/packages/erc4626-flows/erc4626-flows-v0.1.0.spkg`), 938,767 bytes. `substreams build` and `substreams pack -o erc4626-flows-v0.1.0.spkg` write the same path (default name `<package.name>-<version>.spkg`, in the cwd).
- wasm: `packages/erc4626-flows/target/wasm32-unknown-unknown/release/erc4626_flows.wasm`, 423,852 bytes, sha256 `5553c06b1d6b5b8b2b8901ad70e5d6727d5e1b80647d7661b43132c2470f7819`.
- Both match `specs/gate.yaml` → `build.expectedOutputs`. Exit code of `substreams build` is 0 on success (three runs).
- Side effects of a build that are **not** gitignored: `packages/erc4626-flows/Cargo.lock` (untracked, created by cargo). Ignored: `*.spkg`, `target/`, regenerated `src/pb/{mod.rs,schema.rs,sf.codegen.conversation.v1.rs,sf.firehose.v2.rs,.last_generated_hash}`. The tracked `src/pb/vaultflows.v1.rs` / `erc4626.v1.rs` were regenerated identically (`git status` clean for them).

### Module hashes (`substreams info erc4626-flows-v0.1.0.spkg`, local build)

| Module | Kind | Local hash (Sept 10, macOS arm64) | CI hash (run 34396041869, ubuntu x86_64) |
|---|---|---|---|
| `store_vault_seen` | store | `e1cecb1771fdbd745ba42c7f194627c24085ac55` | `327de72c06fda841ed43617c77fc6894bd7564b5` |
| `map_vault_probe` | map | `1f7fff8f578f901af673856698b121a1c67eef15` | `5a91a62db335eb94b041c346c518f80bf887a32f` |
| `store_vault_meta` | store | `61405fbb8338c9503a888d018e2038fbeb6bb8bb` | `7f2debe118c1357fec57422d79ab0d27c618f3bc` |
| `map_flows` | map | `af697e133efa2c7565b0bf853399f4153bdbced2` | `ecdf64769934c1bb1f66a28dbba3bc211661c06d` |
| `map_share_value_observations` | map | `7e21449aecfc80a4adcad59842929b6f409dd3af` | `718300ded878c06b529a2089ca9e8b57b969de05` |
| `map_events` (sink module) | map | `1f9e1dff75f677a6493655ab5e9126384b045459` | `f71e6edcb5a276beafded9205c6a90ff3b2e7744` |
| `erc4626:map_events` (Pinax import) | map | `9d3e4a81797e43b37f46443144913096d3a3080c` | same |

All modules `Initial block: 49276800` (import: 0), `Network: base`. Apart from the hashes, `diff` of the two `substreams info` outputs is empty.

### sha256 comparison: local spkg vs CI artifact

- CI artifact `erc4626-flows-v0.1.0-spkg` (run 34396041869, job 102615888265, branch `feat/erc4626-flows`, head `18ab2eb`), downloaded with `gh run download 34396041869 -n erc4626-flows-v0.1.0-spkg -D <scratchpad>/ci-spkg`: 936,635 bytes, sha256 `5fe24ea1e90bad9d4c32cc4a867fbf68412acc173935076c8461d11346835b87`.
- Local (build#1 + pack#1): 938,767 bytes, sha256 `54fdb30d6dd3cc76906044e049bade1910126ece9e4104301e3b0393e14a48ff`. **Hashes do not match.**

Why (measured by decoding both `sf.substreams.v1.Package` messages with a protobuf wire parser, `<scratchpad>/spkg_inspect.py`):

1. **Our wasm differs.** CI `erc4626_flows.wasm` 421,720 bytes (sha256 `e9c0576a…`), local 423,852 bytes (`5553c06b…`), +2,132 bytes — exactly the spkg size difference. Same rustc/cargo (1.88.0 6b00bc388 / 873a06493), same dependency versions (the 15 crates whose panic-location paths are embedded are identical, e.g. `anyhow-1.0.104`, `bytes-1.12.1`; CI ran with a rust-cache hit so its log has no crate list). The embedded absolute paths differ (`/home/runner/.cargo/registry/…` ×62 vs `/Users/pawan/.cargo/registry/…` ×62, same prefix length, so paths alone do not explain the 2,132 bytes). The rest is host-dependent codegen (Linux x86_64 vs macOS arm64 host compiling for wasm32, lto=true); the exact cause was not isolated. No `--remap-path-prefix` is configured. Because the module hash covers the wasm bytes, **all six of our module hashes differ between CI and local**; the imported Pinax binary (365,414 bytes, `d1e0efe4…`) and its hash are identical in both.
2. **The 24 embedded proto files are the same bytes in a different order** (e.g. CI: `… v1/erc4626.proto, sf/substreams/v1/deltas.proto, sf/firehose/v2/firehose.proto …`; local: `… v1/erc4626.proto, sf/substreams/sink/sql/services/v1/services.proto, sf/firehose/v2/firehose.proto …`). This ordering is not stable even locally: three consecutive local builds of unchanged source (wasm sha256 identical each time) produced three different spkg sha256s — build#2 `7862156175654a13df682d5a7d27a89c72ad40465ef77e0abb822149f7e1b27c`, pack#2 `c887f8b12318649ef4f8307ad7583ac9790fa2d684cbbc8e1b90046bada4978e`, build#3 `cf530fb80151a8b01e340e77f13d77a982ce457286fd6faa1a53b02d9a7c128a` — while `substreams info` module hashes stayed identical across all of them. Package/module meta (fields 7, 8) and `network` are byte-identical.

Consequence for `specs/gate.yaml` `build.record.spkgSha256 → receipt.packageHash`: the spkg sha256 changes on every `substreams build`/`pack` of identical source, so it identifies one build artifact, not the source. The stable identity of the build is the `map_events` module hash (`1f9e1dff…` for this machine's builds), and a rerun on another OS will not reproduce even that.

### Live run

`/Users/pawan/Code/hacks/ethonline26/.env` does not exist, `SUBSTREAMS_API_TOKEN` is not in the environment, and there is no `.substreams.env` in the repo or `$HOME` → **no token; `substreams run` of the primary range (51092254–51092454) was not attempted.**

### Disk after this session

`df -h /System/Volumes/Data` → 9.6 GiB free (was 12 GiB). New: `packages/erc4626-flows/target/` 896 MB, ClickHouse image 839 MB, rust 1.88 toolchain (+ ~1.5 GB of cargo registry/deps in `~/.cargo`). CI spkg copy and analysis files live in the session scratchpad (`ci-spkg/erc4626-flows-v0.1.0.spkg`, `local-1.spkg`, `build-2.spkg`, `pack-2.spkg`, `build-3.spkg`, `ci-info.txt`, `local-info.txt`, `ci-job.log`, `spkg_inspect.py`).
