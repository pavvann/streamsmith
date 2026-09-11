# graph developer feedback

Friction log kept from the first minute. Format: what we tried, what happened, what we expected, how long it cost.


## 2026-09-09 — A1 toolchain / Pinax build / ClickHouse

1. **`substreams build` hides the real cargo/rustup error.** Tried: `substreams build` in `vendor/substreams-evm/erc4626`. Got: `Error building binary: getting build command for binary default: validating cargo dependency: Rust/Cargo not found: exit status 1 — Install Rust from https://rustup.rs/`. Rust *was* installed (stable 1.98.1 on PATH); the actual failure was rustup auto-installing the repo-pinned 1.88 toolchain and dying (`could not read component file … manifest-clippy-preview … No such file or directory`). Expected: surface cargo's stderr instead of a generic "not found". Cost: ~6 min to find by running `cargo --version` in the dir by hand.
2. **Pinax repo pins Rust 1.88 via `rust-toolchain.toml`** (channel 1.88 + rustfmt + wasm target) with no mention in README. A fresh stable toolchain does not satisfy it; rustup silently downloads a second ~500 MB toolchain on first `cargo`. Workaround: `RUSTUP_TOOLCHAIN=stable substreams build`. Expected: README note ("uses 1.88; or set RUSTUP_TOOLCHAIN"). Cost: ~3 min (plus the failed download).
3. **The host ran out of space (238 MB free), breaking three steps at once**: Docker pull (`failed to register layer … input/output error`, then containerd `meta.db: input/output error`), rustup 1.88 install, and any Rust wasm build. Not a Graph issue, but the failure surfaced as three unrelated-looking errors. Cost: ~8 min diagnosing; erc4626/erc20 builds and ClickHouse bring-up blocked entirely. Freed 1.2 GB by removing the half-installed toolchain; still insufficient.
4. **Pinax `erc4626` is not on substreams.dev.** `substreams info erc4626@latest` → "package does not exist on the Substreams registry". `erc20-transfers` is there but at v0.2.0 while the repo ships v0.4.0. Expected: the package the prize text names ("Pinax erc4626") to be importable as `erc4626@v0.1.0`. Impact: we must import by local spkg path or self-hosted https URL. Cost: ~4 min probing URL shapes because the registry has no search/API (`/search`, `/api/*` 404; index page lists 24 packages).
5. **No registry search API.** Only way to check a package is `substreams info <name>@latest` or guessing `https://substreams.dev/packages/<name>/latest`. Expected: `substreams registry search` or a JSON endpoint. Cost: ~3 min.
6. **`substreams-sink-sql from-proto` ClickHouse requirements are only in the README, not in `--help`.** The proto must carry `option (schema.table) { clickhouse_table_options { order_by_fields } }` or the run fails with `clickhouse table options not set for table`. Pinax `erc4626.proto` has none, so the "sink Pinax straight to ClickHouse" path does not exist without our own proto. Cost: ~3 min reading README; would have been a runtime surprise otherwise.
7. **Doc drift inside `spkg/erc4626-v0.1.0.spkg`**: embedded doc says "ERC-4626 Flows", output `proto:erc4626.flows.v1.Events`; actual module output is `proto:erc4626.v1.Events` and source README says the same. Also manifest `network: mainnet` while README/Makefile say "defaults to Base". Cost: 1 min; noted so nobody imports the wrong type name.
8. **rustup shipped with no default toolchain** on this machine (`rustup could not choose a version of rustc to run`). Local, not Graph. Cost: 1 min (`rustup default stable`).
9. **Docker Desktop cold start** returned `500 Internal Server Error … /v1.52/info` for ~75 s before the daemon answered. Local. Cost: ~2 min waiting.

## 2026-09-10 — A5 erc4626-flows package, CI build

1. **`protobuf.excludePaths` does not exclude descriptor-set packages.** Manifest had `excludePaths: [sf/substreams, sf/ethereum, google]` plus `descriptorSets: [buf.build/streamingfast/substreams-sink-sql]`; `substreams protogen` still generated `schema.rs` (`sf/substreams/sink/sql/schema/v1/schema.proto`), `deprecated.substreams_sink_sql.v1.rs` and `sf.firehose.v2.rs` into `src/pb` and wired them into `mod.rs`. Expected: the exclude list to apply to everything passed to `buf generate --include-imports`. Workaround: do not `mod pb;` the generated `mod.rs`; `include!` only the two files the crate needs from `lib.rs`. Cost: ~5 min.
2. **Unpinned descriptor set warning.** `descriptorSets: - module: buf.build/streamingfast/substreams-sink-sql` prints "no version specified, resolves to latest … will always trigger regeneration". The skill docs show the unpinned form; a pinned commit ref example in the docs would save a lookup. Not fixed here (which ref to pin is not documented). Cost: 1 min.
3. **Imported spkg with `network: mainnet` used from a `network: base` manifest.** No warning at protogen time; whether `substreams run --network base` on the hosted runner is happy with an import whose own manifest says `mainnet` is still unverified.
4. **Public contract changed under the package while building** (A2 flattened `CallStatus` into `call_ok`/`call_error`, dropped `tx_hash` from ids, made numeric strings never-empty because the from-proto sink panics on `""` for a `convertTo` column). Good change, but the "sink panics on empty string for convertTo" rule is not in the sink README or the skill; it was found the hard way. Cost: ~10 min of rework, plus the CI byte-identical check now needs the spec committed on the same branch.

## 2026-09-10 — A2b contract review / gate spec

10. **The SQL skill points at a retired BSR module.** `substreams-sql/SKILL.md` (v1.6.0) says `descriptorSets: - module: buf.build/streamingfast/substreams-sink-sql  # resolves schema.proto + deps`. Tried: `buf dep update` with that dep. Got: a `buf.lock` with no entries and `imported file does not exist` for `sf/substreams/sink/sql/schema/v1/schema.proto`; `buf ls-files buf.build/streamingfast/substreams-sink-sql` returns a single `deprecated/substreams_sink_sql/v1/moved.proto` ("The SQL sink definitions live in buf.build/streamingfast/substreams"). Expected: the skill (and the manifest snippet) to name `buf.build/streamingfast/substreams`, and `buf dep update` to warn that a dep contributed zero files. Cost: ~10 min. Whether `substreams build` still resolves the retired name is unverified (we could not build: disk).
11. **from-proto silently drops message-typed fields.** Our contract had `CallStatus call_status` in three tables. Nothing in the skill or `docs/references/sql/proto-annotations.md` says what happens to a nested message that is not a `child_of` table; the answer is in `sink/sql/db_proto/sql/schema/table.go` (`if !isTimestamp && !isInline { continue }`): the column just does not exist, no warning. Expected: a build/`setup` error or a doc line ("nested messages are ignored unless `inline: true` or `child_of`"). Cost: ~20 min of Go reading; would have been a silent data loss in production.
12. **Empty string in a `convertTo` column panics the sink.** `click_house/decimal.go` / `integer.go` reject `""` and `accumulator_inserter.go` `panic(...)`s, unless the proto field is `optional`. The upstream troubleshooting line is only "verify that string fields marked for numeric conversion contain valid numeric values". Expected: the skill to state the rule (`""` is fatal; use `optional` or a sentinel) since proto3 strings default to `""`. Cost: ~10 min; forced a contract change (`"0"` + flag).
13. **`Column.inline` is undocumented.** `schema.proto` has had `bool inline = 6` since at least v1.20.2 and it produces ClickHouse `Nested(...)` columns, but neither the skill nor `proto-annotations.md` mention it. Cost: 5 min to work out from `column.go`/`dialect.go`.
14. **`-t` exclusivity is only in `--help`.** The skills use `-t +N` everywhere without saying the stop block is exclusive (`substreams run --help`: "Stop block to end stream at, exclusively"). Matters for gate ranges that must contain a specific block. Cost: 3 min.
15. **jsonl envelope undocumented.** `substreams-testing` says "project-specific strip of envelopes" but never shows the shape; it is `{"@module","@block","@type","@data"}` (+ `@partial_index`, `@is_last_partial`) in `protodecode/decoder.go` `ModuleWrap`. Expected: one line in the testing skill. Cost: ~8 min (had to find the file via the GitHub tree API).
16. **Positive: an `.spkg` is a valid buf image.** `buf build pkg.spkg#format=binpb --as-file-descriptor-set -o -#format=json` works, and the normalized descriptor hash from the spkg equals the one from the source proto (tested on Pinax `erc4626-v0.1.0.spkg`). Only documented as a comment in `sf/substreams/v1/package.proto` ("so this file can be used _directly_ as a buf `Image`"). Worth a line in the skills; it makes contract-drift checks a one-liner.
17. **`buf lint` STANDARD vs a spec-file layout.** `PACKAGE_DIRECTORY_MATCH` fails for `specs/vaultflows.proto` (package `vaultflows.v1`); harmless, excepted in the gate's lint config. 1 min.
18. **Store backfill cost for fixed-range gate runs.** With module `initialBlock` = production start (49,276,800) and a gate range at 51,092,254, every cold `substreams run` backfills ~1.8M blocks of stores server-side before emitting. The testing skill's "pin `initialBlock` near the test window" conflicts with shipping one package for both gate and production. Expected: a documented way to run a fixed range with stores starting empty for tests (or a note that the server caches store snapshots so only the first run pays). Not measured (no build).
5. **Build-in-CI worked first time; the round trip is the cost.** With the host disk at ~1.5 GB free, the whole Rust/wasm toolchain lived in GitHub Actions: rust 1.88 + wasm32 install, `substreams build` (46 s compile), pack, info, artifact — 1m39s cold. What the host still needed locally was only `substreams protogen` (buf codegen, no cargo) to see the generated Rust types before writing handlers. `rustfmt` had to round-trip through CI as a patch artifact (351-line diff, formatting only). A `substreams build --dry-run`/`check` that validates the manifest + protos without cargo would have caught manifest mistakes without a push. Cost: ~2 min per CI cycle, 3 cycles.

## 2026-09-10 — A7 local build / CI artifact comparison / ClickHouse

19. **`.spkg` bytes are not reproducible: proto file order changes on every build.** Tried: `substreams build` three times on unchanged source (wasm sha256 identical each time, module hashes identical each time). Got: three different spkg sha256s; decoding the `Package` message shows the 24 embedded `FileDescriptorProto`s are the same bytes in a different order each run (Go map iteration, presumably). Expected: deterministic ordering (sort by file name) so `sha256(spkg)` can serve as a package identity; today only `substreams info` module hashes are stable. Impact: our gate's `receipt.packageHash` (sha256 of the spkg) will never match across two builds. Cost: ~25 min including writing a wire-format parser to prove it.
20. **Same source + same rustc 1.88.0 + same crate versions, different wasm on Linux x86_64 (CI) vs macOS arm64 (local).** 421,720 vs 423,852 bytes; all six module hashes differ, so a package built locally is a different package to the server from the one built in CI. Embedded panic paths (`/home/runner/...` vs the local `$HOME/...`) are only part of it. Expected: a note in the dev skill that module hashes are host-dependent unless the build is containerized (or a `substreams build` option that builds in a pinned Docker image, as the skill's "reproducible build" story). Cost: ~15 min analysis.
21. **`substreams build` leaves an untracked `Cargo.lock`** in the package dir (not gitignored by the repo, not committed by the template). Minor, but it shows up as `??` for every agent working in the tree. 1 min.
22. **`--profile minimal` vs `rust-toolchain.toml` components.** `rustup toolchain install 1.88 --profile minimal --target wasm32-unknown-unknown` succeeds in 16 s, then the first `cargo --version` inside the package dir silently downloads `rustfmt` because the toml lists it. Harmless, just unexpected network on a "version check". 1 min.
23. **Positive: `substreams build` is fast once cached.** Cold: 35 s on an M-series Mac (cargo 32.6 s); warm no-op rebuild: 1 s with `⚡ Protobuf generation skipped (no changes detected)`. `cargo test` cold 32 s, 13 tests. Local iteration is viable; the Sept 9 blocker was purely disk.
24. **Positive: `docs/build/clickhouse-local.md` worked verbatim.** `docker run` (pulls `clickhouse/clickhouse-server:latest`, 26.8.2.7), `CREATE USER ro` + `GRANT`, HTTP 8123 and native 9000 `SELECT 1`, negative `CREATE TABLE` → code 497. Ready 6 s after start. Not a Graph issue; recorded so nobody re-verifies.

## 2026-09-10 — A6 mcpgen / MCP over the from-proto sink

19. **Injected column types are not documented as ClickHouse types.** `clickhouse-patterns.md` shows the generated DDL with `_block_timestamp_ timestamp` and `_deleted_ bool` (Postgres spellings), and `proto-annotations.md` only lists the four names. A read-only consumer that wants to verify the live schema against the contract (our MCP's `schema_mismatch` check reads `system.columns`) cannot know whether to expect `DateTime`, `DateTime64(3)`, `Bool` or `UInt8`. Workaround: compare injected columns by name only, contract columns by name and type. Expected: one table in the skill with the exact ClickHouse type of each injected column. Cost: ~10 min deciding, plus a weaker check.
20. **`Decimal128(18)` in the annotation is `Decimal(38, 18)` in `system.columns`.** Obvious once seen, but the type-mapping table in `proto-annotations.md` stops at "Decimal128(scale)"; a consumer diffing schemas needs the rendered spelling. Cost: 3 min.
21. **No documented read-only surface for the sink.** The sink docs cover the writer DSN (native TCP only) and nothing about how agents or apps should read: HTTP port, `readonly=1` vs `readonly=2` interplay with per-request settings (`max_execution_time`, `output_format_json_quote_64bit_integers`), query parameters (`{name:Type}` / `param_name`) as the injection-safe path. All of that is ClickHouse knowledge, but the skill's "MCP / agent access" story would be one paragraph. Cost: ~15 min cross-checking ClickHouse docs; `readonly=1` + settings in the same request is left as a documented switch (`CLICKHOUSE_READONLY=2`) because it could not be verified against a live server (disk).
22. **Receipt schema changed under the generator** (`outputModuleHash` became required while A6 was writing the validator; reason given in the schema: spkg bytes are not reproducible across builds). Good change and it landed in the manifest/provenance within minutes, but it is the second time today a spec moved mid-build; a `specs/CHANGELOG` line per change would save every downstream agent a diff. Cost: 5 min.
23. **Positive: `system.columns` + a normalized column-set hash is enough for a real fail-closed check** without any sink cooperation: 4 tables, 78 columns, one query, and the refusal payload can show the exact diff. Worth a line in the SQL skill as the recommended "did my schema drift" probe for consumers (the sink itself only detects drift on the writer side and then streams against the old table).
24. **Views over from-proto tables need `_deleted_ = 0` in every branch, including scalar subqueries** (`WITH (SELECT max(block_timestamp) FROM vault_flows WHERE _deleted_ = 0) AS window_end`). The skill says "always filter `_deleted_ = 0`" but the examples only show it in the outer WHERE; a tombstone with a newer `block_timestamp` would otherwise move the window end. Cost: 2 min, caught in review.

## 2026-09-10 — A8 sink spike, first live rows into ClickHouse

1. **`substreams-sink-sql` 4.13.1 `from-proto` panics on a populated proto3 `enum` field.** Running `from-proto` against `packages/erc4626-flows/erc4626-flows-v0.1.0.spkg` `map_events` over 51092254:51093002 crashes on the first block with a `VaultFlow` row: `panic: interface conversion: interface {} is protoreflect.EnumNumber, not int32` in `db_proto/sql/click_house/accumulator_inserter.go:224`. `VaultFlow.direction` is `FlowDirection` (proto3 enum), DDL column `direction Int32`. 100% reproducible (2/2 identical runs, identical stack). Isolated by running `map_share_value_observations` (same spkg, no enum field) at the same endpoint/DSN: exit 0, 2/2 correct rows. So the crash is specific to inserting a message with a non-zero-valued(?) enum field via from-proto, not the DSN, schema, or package build. Expected: the sink to either support enum fields (cast `protoreflect.EnumNumber` to `int32`) or document that enum-typed fields are unsupported by from-proto (`docs/references/sql/proto-annotations.md` says nothing about enums). Impact: blocks `vault_flows` (and `vaults`, sharing the crashed `map_events` module) from ever landing via from-proto with the current contract; no workaround exists inside this brief's constraints (fix needs a sink patch or a contract change from `enum` to `int`, both out of scope — no rebuild allowed). Cost: ~15 min to isolate; this is the brief's kill criterion outcome for the full contract.
2. **"Cursor table" doesn't exist in from-proto mode.** The brief/mental model (carried over from the `setup`+`run` db_out mode, which has a `cursors` table) doesn't hold for `from-proto`: resumption state lives entirely in the local file (`--clickhouse-cursor-file-path`); ClickHouse only gets a `_blocks_` table (`number, hash, timestamp, version, deleted`) which is a processed-block log, not a resumption source. Confirmed restart-safety still works correctly via the file (`fetched cursor {"block": "#<n>"}` → `restarting_at` → `resolved_start_block: <n+1>`, no row duplication across 2 runs). Cost: 5 min to find `_blocks_` and read its actual column names (`number`, not `block_number`).
3. **ClickHouse HTTP interface (8123) refuses multi-statement bodies.** `curl --data-binary @views.sql` (2 `CREATE OR REPLACE VIEW` statements) → `Code: 62 ... Multi-statements are not allowed`. Not a views.sql problem — worked immediately via `docker exec -i vaultflows-ch clickhouse-client ... --multiquery < views.sql` (native client). `docs/build/clickhouse-local.md` only documents single-statement `curl` calls; worth a line noting HTTP is single-statement-only and multi-statement DDL needs the native client or one `curl` per statement. Cost: 2 min.
4. **Positive: views degrade cleanly on an empty base table.** `vault_flows_24h` (built on the crashed, empty `vault_flows`) returned 0 rows with no error — `max(block_timestamp)` over 0 rows is NULL, the WHERE's NULL comparison filters everything, no crash. Confirms the view SQL itself is fine independent of the sink bug.

## 2026-09-10 — A6b mcpgen finish

25. **Nothing tells a consumer whether an annotated `string` column stores its own value or an enum number — and the wrong guess is silent.** `VaultFlow.direction` went from `enum FlowDirection` (ClickHouse `Int32`, values 1/2) to `string direction` (values `'deposit'`/`'withdraw'`) mid-build, because from-proto 4.13.1 panics on a populated proto3 enum (A8 item 1). Every SQL literal and every generated tool parameter had to flip representation. Both wrong forms — `direction = 1` against a `String` column and `direction = 'deposit'` against an `Int32` one — parse, run and return **zero rows** with no error from ClickHouse or the sink. Fix here: mcpgen's semantics overlay declares only the accepted *names* and `resolveFilterValues` reads the representation off the proto (String -> bind the name; enum-backed Int32 -> bind the enum number; anything else is a generation error), plus a test that checks every literal in `views.sql` against its column's ClickHouse type. Expected from the tooling: `proto-annotations.md` to state how each proto kind lands in ClickHouse (it stops before enums entirely) and, ideally, the sink to reject a query-time type mismatch instead of returning an empty set. Cost: ~35 min of rework across views.sql, the semantics schema, the manifest builder and 5 test files.
26. **Contract-drift feedback only exists on the writer side, so consumers must build their own.** The sink detects a proto change and then streams against the old table (facts (d) 9), and there is no read-only way to ask it "what schema are you writing?" — the schema hash it computes lives in a local `<database>_schema_hash.txt` under `--sink-info-folder`, on the sink host, in a 16-hex format that is not the sha256 of any artifact a receipt can carry. A consumer therefore has to reconstruct the expectation from the proto and diff it against `system.columns` itself (78 columns, 4 tables, one query). Expected: the sink to expose its schema hash and column set over the DSN (a `_schema_` table, or the `_blocks_` table's neighbour), so a fail-closed reader can compare identities instead of re-deriving them. Cost: designing and testing the column-set hash, ~40 min; also means the receipt's `sinkSchemaHash` and the sink's own hash are two different numbers that look like the same thing.
27. **protojson (`substreams run -o jsonl`) and the sink's column names differ by case convention, and only one of them appears in any document.** Live output is `assetsPerShareNormalized`; the ClickHouse column is `assets_per_share_normalized`; the recorded jsonl also *omits* proto3 default values, so `call_error` and `in_configured_list` are simply absent from rows where they are empty/false. Anyone writing views or dashboards from a recorded run will guess camelCase columns and get `NO_SUCH_COLUMN_IN_TABLE`. Expected: one line in the testing/SQL skills ("jsonl is protojson: lowerCamelCase, defaults omitted; sink columns are the snake_case proto field names"). Cost: 10 min; now pinned by `packages/mcpgen/test/livedata.test.ts`, which maps every live key onto a contract column.
28. **`erasableSyntaxOnly` (TS 5.8+) is the tax for running TypeScript with Node's native type stripping.** Node >= 22.18 runs `.ts` directly, which removes the whole build step from the generator and the generated MCP server — but constructor parameter properties, `enum` and `namespace` all become TS1294, and the failure surfaces only in `tsc --noEmit`, not at runtime. Worth knowing before choosing "no build step" for a hackathon deliverable that downstream consumers typecheck. Cost: 10 min (a test helper class had to be rewritten with explicit field assignments).
29. **Positive: a receipt plus a proto is enough to generate a *refusing* MCP, and the refusal payload is the demo.** 7 tools, 5 refusal reasons, provenance (incl. `outputModuleHash`) on every answer, and the whole thing is 73 tests against a fake ClickHouse/RPC with no live database needed. The one thing that made it possible is that `outputModuleHash` is stable across rebuilds while `packageHash` is not (A7 item 19) — the identity the fail-closed check leans on had to be the module hash, and the receipt schema gained it mid-build. A `specs/CHANGELOG` line per spec change (asked for in A6 item 22) would have saved a second diff today.

## 2026-09-10 — A9 enum→string contract change, rebuild, flow rows in ClickHouse

1. **The enum fix is a public-contract change, and nothing warns you before you ship the proto.** A8's finding
   (`from-proto` panics on a populated proto3 enum, entry above) can only be fixed on our side by removing the
   enum. Tried: `enum FlowDirection` → `string direction = 12`. Got: works immediately — `direction String` in
   ClickHouse, 171 flow rows landed. Expected: `substreams-sink-sql`'s proto-annotation docs to state which
   proto types are supported by from-proto (they list the `convertTo` types and say nothing about enums), or the
   sink to fail at table-creation time rather than mid-stream on the first non-zero enum value. Cost of the
   change itself: ~15 min (proto, descriptor hash, bindings, handlers, tests, rebuild, re-run) — cheap, but it
   was only cheap because the panic had already been isolated. Ship-blocking for anyone who models a category
   column as an enum, which is the obvious modelling choice.
2. **`from-proto` does not commit the tail of a bounded range in one pass.** Tried: the same bounded command
   (`-s 51092254 -t 51093002`) four times against a fresh database. Got: run 1 exit 0, "reached your stop
   block #51093000", but only committed through block 51092994 (167 rows); run 2 committed 51092998 (169); run 3
   committed 51093000 (171 rows + the 2 observation rows that live in that block); run 4 was a no-op. Not data
   loss — the cursor file only advances to what was committed, so reruns are gapless and duplicate-free — but a
   single run of a bounded range silently leaves its last data blocks out, and the exit code and the "reached
   your stop block" log say nothing about it. Expected: a final flush before termination, or a log line naming
   the last committed block (the stats block prints `block_count` but not what was flushed). Impact: any
   fixed-range backfill or test that asserts counts after one run can be short by a few blocks; ours was short
   by exactly the block whose rows the gate asserts. Workaround: rerun until counts stop changing, or set the
   stop block past the last block you care about. Not in `--help` or the v4.13.1 README. Cost: ~12 min to work
   out that the missing observation rows were a flush boundary and not another bug in the contract.
3. **Module hash changes → the first run after a contract change pays store preparation again.** Renaming one
   field's type changed all six module hashes, so the server re-prepared the stores for the range: 138 s and
   82,646 processed blocks for a 200-block window (the identical run before the change was cached). Expected:
   nothing different, the caching is per module hash by design — but it is worth a line in the dev skill that a
   proto-only change invalidates every downstream module's cache, because it makes "just tweak the proto" cost
   a couple of minutes of paid backfill per range.
4. **Positive: `.spkg` as a buf image made the contract check trivial after the change.** `buf build
   erc4626-flows-v0.1.0.spkg#format=binpb --as-file-descriptor-set -o -#format=json` piped into the gate's
   20-line Python reference gave the same normalized descriptor hash as the source proto
   (`ce7f7823…`), so "did the built package drift from the public contract" stayed a one-liner across the change.

## 2026-09-10 — A4c Streamsmith finish: YAML hex, tsx, unqualified DDL

1. **The `yaml` npm package silently turns every unquoted `0x…` address and tx hash into a float, and nothing in
   the failure looks like a parser problem.** `specs/gate.yaml` records vault addresses, tx hashes and block
   hashes the way every other tool in this stack writes them — unquoted, lowercase, `0x`-prefixed. The YAML 1.2
   core schema has HEX and OCT formats on the `int` tag, so `yaml@2.9.0` resolves
   `0x050ce30b927da55177a4914ec73480238bad56f0` to `2.8811…e+46` (a double: already lossy past 2^53, and
   irreversible — the original text is gone). Every address comparison in the gate then compared a string with a
   number and failed, and the reported failures were data-shaped ("no vault_flows row matching …", "0/42 rows with
   meta_valid"), which sent two earlier passes hunting in the evaluators and the fixtures. Tried: nothing in the
   `yaml` README, the `ParseOptions` docs or the error output mentions this; there is no warning, no strict mode,
   and `intAsBigInt: true` makes it a BigInt instead of a string — still not the address. Fix:
   `YAML.parse(text, { customTags: (tags) => tags.filter((t) => t.format !== "HEX" && t.format !== "OCT") })`,
   in one loader used by both spec files (`packages/streamsmith/src/util/yaml.ts`), never by quoting the frozen
   spec file. Expected: `yaml` to document that the core schema eats hex scalars, or to offer a
   `keepHexAsString`/`schema: "core-no-hex"` option, since "YAML file full of 0x hex" is the norm for anything
   touching an EVM chain. Cost: ~2 h across three agents before the root cause was named; 15 min to fix and pin
   with a regression test (`test/yaml.test.ts`) that asserts the loaded values equal the exact strings in
   `docs/build/vaults.md`. Anyone writing a config loader for chain data hits this.
2. **`tsx@4.23.13` cannot parse a file containing a dynamic `import()`, and the error names the wrong line.** One
   `const { readdir } = await import("node:fs/promises");` inside `src/cli.ts` made every invocation of the CLI die
   with `Error: Parse error /…/src/cli.ts:2:113` from inside tsx's own dynamic-import rewriting pass (line 2 is a
   comment; the position is meaningless). The whole CLI was unrunnable, while 65 in-process tests that import
   `main()` directly and vitest (esbuild, not tsx) all passed — so nothing caught it. Fix: use a static import.
   Expected: a parse error that points at the construct it choked on. Lesson worth generalising: **if you ship a
   CLI, one test must spawn the real entry point in a child process** — importing the module is not the same code
   path as running the binary. Added `test/cli.test.ts` cases that spawn `bin/streamsmith.js`. Cost: ~20 min.
3. **`--import tsx` in a launcher resolves against the cwd, not the launcher.** `bin/streamsmith.js` spawned
   `node --import tsx src/cli.ts`; run from the repo root (which is where a workspace CLI is meant to run, and
   where `--root` defaults) Node looked for `tsx` in the root's `node_modules` and exited with
   `ERR_MODULE_NOT_FOUND`. pnpm's strict, per-package `node_modules` makes this the default outcome, not an edge
   case. Fix: `import.meta.resolve("tsx")` (with a `createRequire` fallback) so the loader is resolved relative to
   the launcher. Expected: the tsx docs' `--import tsx` recipe to mention it only works when the cwd can resolve
   the package. Cost: 10 min.
4. **ClickHouse view DDL needs the session database in the request, and getting it wrong creates the views in the
   wrong place instead of failing.** `packages/erc4626-flows/sql/views.sql` uses unqualified table names (correct:
   the database is deployment configuration, not part of the contract). Streamsmith was POSTing each `CREATE OR
   REPLACE VIEW` without `?database=`, so ClickHouse resolved `vault_flows` against `default` while the tables were
   in `vaultflows` — here it happened to error (`Unknown table expression identifier 'default.vault_flows'`), but
   with a `default` database that also holds tables it would have silently created two views over the wrong data.
   Note the asymmetry: the pre-flight `system.tables` check embeds the database in the SQL and therefore passed,
   which makes the mismatch look like a views.sql bug. Fix: pass `database` on the query URL for every applied
   statement; regression test asserts the URL. After the fix both views built over the real sunk rows on the first
   try. Cost: 15 min.
5. **Positive: `substreams info --json` is the right primitive for a receipt, and the whole gate runs offline from
   recorded jsonl.** `--reuse-runs --offline` over the two tracked live runs (`runs/live/`) re-evaluates all 18
   assertions of `specs/gate.yaml` in ~2 s with no endpoint, no token and no database — 42 flow rows, 2
   observations, exit 0 — and `substreams info` supplies both `outputModuleHash` and the full `moduleHashes` map
   for the receipt with a single read-only call on the `.spkg`. That combination (recorded run + read-only package
   introspection) is what made a real end-to-end verification possible on a machine with 1.5 GB of disk and no
   ability to rebuild. Worth copying: keep every paid run's raw jsonl in the repo, and make the gate able to
   evaluate it without re-running.

## 2026-09-11 — A11 six ops-gap fixes to the CLI

1. **`fixtures/live/observation-51092998-51093002.jsonl` and the root `runs/live/` copy of the same name have
   diverged, and it predates this session.** `test/live-runs.test.ts` (3 of its assertions) fails out of the box:
   `runs/observation.lines` is 2, not the hardcoded 1; `ids_unique` reports 92 vs the test's 88; `rpc_success_ratio_gte`
   reports 48/48 vs 44/44. `git log -p -- runs/live/observation-51092998-51093002.jsonl` shows the file was
   overwritten in commit `59985da` (the same commit whose message claims "75 tests… green") — its 1-line
   `map_share_value_observations` content (still what `packages/streamsmith/fixtures/live/` mirrors, and what the
   test file's own header comment describes) was replaced with 2 lines of `map_events` output for a different
   block range, with neither the fixture mirror nor the test's hardcoded counts updated to match. Confirmed via
   `git diff --stat` that nothing in this session touched those paths — this is baked into history, not something
   the live sink did during this run. Left untouched: `runs/live/` is outside `packages/streamsmith/**` (this
   brief's scope), and I don't know which side (1-line vs 2-line) is the intended evidence. `pnpm test` here is
   85/88 green; the 3 failures are exactly these, pre-existing, and independent of the six fixes below. Cost: ~15
   min to confirm via `git log -p` that it wasn't something in this session. Expected: whoever runs `pnpm fixtures`
   after hand-editing `runs/live/*` reconciles the mirror and the test counts in the same commit.
2. **Two of the six brief items were already implemented before this session.** `receipt --deploy-json <file>`
   (reads a `deploy status --json`-shaped `DeployRecord` and forwards `deploymentMode`/`headBlock`/`lagBlocks` into
   the receipt) and `outputModuleHash`/`moduleHashes` population from `substreams info <spkg> --json` were both
   already wired up in `cli.ts`'s `receipt` case, resolved against `--root` via the same `abs()` helper item 2
   wanted for `--views`. Only added a regression test (`test/receipt.test.ts`, self-managed-sink shape) since none
   existed; no code change was needed. Worth a beat before treating a brief item as unimplemented: grep first.
3. **`_blocks_`'s own columns are unprefixed** (`number`, `hash`, `timestamp`, `version`, `deleted` — confirmed
   against live `system.columns`), unlike the injected `_block_number_`/`_block_timestamp_`/`_version_`/`_deleted_`
   on every data table. `chMaxBlock`'s existing per-table query assumes the injected names uniformly, so a
   deploy-status computed with no `deploy.json` (item 3) had to be a second code path
   (`chBlocksHead`/`chRowCounts` in `src/deploy/clickhouse.ts`) rather than reusing `chMaxBlock` with `_blocks_`
   appended to its table list — that would have silently queried the wrong column name and errored. `apps/vaultpilot`
   (a separate workstream, same DB) independently landed on the identical `max(number) FROM _blocks_ WHERE deleted
   = 0` query, which is a good cross-check that this is right. Cost: ~10 min re-deriving it from
   `docs/build/sink-spike.md` §3 before finding the vaultpilot confirmation.

## 2026-09-11 — A13 ClickHouse Cloud read-only PROFILE vs per-query settings

1. **A ClickHouse user whose *profile* is read-only may not set ANY query setting, including `readonly` itself.**
   ClickHouse Cloud's `ro` user answers every request the generated MCP sent with
   `HTTP 500 Code: 164 ... Cannot modify 'max_execution_time' setting in readonly mode`, so all three guardian
   checks failed at once and the server reported `check_unavailable` — a fail-closed refusal caused entirely by the
   client asking for a guarantee the server had already granted more strongly. The documented escape hatch in the
   runtime (`CLICKHOUSE_READONLY=2`) cannot help: sending `readonly=2` is itself a settings change and gets the same
   164. The only workable shape is the one `apps/vaultpilot/src/data.ts` had already found: catch 164-in-readonly-mode
   once, retry the identical request with *no* settings, cache that mode for the process, and keep the bound that
   actually matters client-side (`AbortSignal.timeout`) so dropping `max_execution_time` loses nothing. Two
   independent code paths in this repo hit the identical wall a day apart; worth treating "readonly profile ⇒ send no
   settings" as a standing rule for anything that talks to a managed ClickHouse, and worth surfacing the negotiated
   mode in provenance (`provenance.clickhouse.settingsMode`, `pipeline_status.clickhouse`) so a reader can tell which
   of the two read-only guarantees is in force rather than assuming.
2. **The retry has to be matched on the response body, not the status.** ClickHouse returns HTTP 500 for ordinary
   failures too (memory limits, bad SQL), and a transport error carries no status at all. Matching `Code: 164` *and*
   `readonly mode` *and* "this was an HTTP response" keeps the retry to the one case that is safe; a status-only rule
   would have silently re-sent queries after unrelated server errors. Covered by mocked-fetch tests
   (`packages/mcpgen/test/clickhouse.test.ts`) rather than by the live endpoint, since the failure is a one-line
   difference in the URL's query string and re-running it against the cloud proves nothing a fake cannot.
3. **Carrying a new field into the generated server means touching `runtime/types.ts`, which is copied verbatim and
   must not import from the generator.** Adding `clickhouse` to `Provenance` required the shape (`ClickHouseAccess`)
   to live in `types.ts` and `clickhouse.ts` to import it from there, plus an *optional* `access?()` on the
   `ClickHouseClient` interface so every existing test fake stays valid. Cheap once seen; would have been an
   afternoon of fake-updating if the method had been made required.
4. **The `runs/live/observation-*.jsonl` divergence A11 reported also breaks `packages/mcpgen`.** Two assertions in
   `test/livedata.test.ts` were stale against the evidence checked in by `59985da` (module `map_share_value_observations`
   → `map_events`, 45 rows → 49: 42 VaultFlow + 1 VaultMeta + 4 VaultFlow + 2 ShareValueObservation). Updated on the
   mcpgen side to match the file that is actually on disk, and the module assertion now reads
   `manifest.package.outputModule` instead of a literal so the next regeneration cannot drift the same way.
   `packages/streamsmith/fixtures/live/` still mirrors the old 1-line file — that reconciliation is still owed by
   whoever owns `runs/live/`.
5. **Live verification is green on every check except lag, which is the honest answer.** Against the cloud DB as `ro`:
   receipt matches the manifest, the real `system.columns` column-set hash equals the contract's
   (`8c06996d…`), chain id 8453 matches — and the sink head (51127129) is 21042 blocks behind Base's head
   (51148171), so the verdict is `stale_data` and `share_value_growth` refuses. The fixture receipt's
   `deploymentId: "fixture-local-clickhouse"` is not checked against anything live, so no `receipt_mismatch` fires; a
   demo of a *successful* data tool needs the backfill to be inside 300 blocks (~10 min of Base), not a code change.

## 2026-09-11 — A12 `deploy status` JSON-parse crash root cause

1. **The reported "Unexpected end of JSON input" / "Unexpected token 's'" had nothing to do with ClickHouse
   response parsing.** The brief's "likely candidates" (a query issued without FORMAT, an error body parsed as
   JSON) were reasonable guesses but wrong — `chQuery` only ever calls `res.text()`, never `res.json()`, so no
   ClickHouse response was ever fed to `JSON.parse`. The real crash site was an **unguarded `readJson` on
   `runs/<runId>/deploy.json`** at three separate call sites (`cli.ts`'s `deploy status` mode-detection peek,
   `selfManagedStatus`, `hostedStatus`) — a 0-byte `deploy.json` (left over from an earlier crashed/interrupted
   run — the exact file was still on disk in this repo) turned a routine status check into a bare native
   `JSON.parse("")` throw with no file path, no run id, and no recovery path, even though the command is
   explicitly designed to work with **no** `deploy.json` at all when `--clickhouse-url` is given. Lesson: when a
   brief's guessed root cause doesn't match the actual call graph (grep for the exact failing API — here
   `.json()`/`JSON.parse` — across the whole path, not just the module named in the guess), say so and keep
   tracing; don't force a fix onto the wrong function just because a test shape was pre-specified for it.
2. **A second, independent bug was hiding behind the first and only showed up once the crash was fixed.**
   `selfManagedStatus`'s database resolution (`o.database ?? record.sink?.database ?? ...config.database ?? "default"`)
   never consulted `CLICKHOUSE_DATABASE`/`CLICKHOUSE_DB`, even though `clickhouseDatabase()` exists specifically to
   read those and every other command uses it. The brief's exact repro (env var set, no `--database` flag) silently
   queried the `default` database on ClickHouse Cloud and returned all-null rows/head with exit 0 — a *quiet*
   failure that would have shipped invisibly next to the loud one. Only surfaced by actually running the real
   repro end-to-end after the first fix instead of trusting a green test suite; the mocked-fetch regression tests
   alone would not have caught it since none of the existing fixtures set `CLICKHOUSE_DATABASE` without also
   passing an explicit database.
3. **Fixing a corrupt cache file is worth doing at the "record" layer, not just the top-level command.** Made
   `readJson` name the file in its error, added `readJsonLenient` (fsx.ts) that returns `{ error }` instead of
   throwing, and applied it at all three read sites so a corrupt `deploy.json` degrades exactly like a missing one
   (recompute from ClickHouse + RPC) rather than being special-cased once at the CLI boundary — `selfManagedStatus`
   also writes the healed record back on success, so the next run repairs itself.

## 2026-09-11 — A14 forensic one-prompt rehearsal: building erc4626-flows from the skills alone

Setting: a fresh directory holding only `specs/` + Streamsmith + mcpgen, one human instruction
(`specs/prompt.md`), and the official skills at `vendor/substreams-skills`. The reference package was
never read. The gate passed on the **first** gate attempt, after **two** compile-level failures. These
are the friction points, in the order they cost time.

1. **`--limit-processed-blocks` is in none of the skills, and without it the first run of any
   store-bearing package fails.** `substreams` v1.22.0 refuses a request whose store preparation would
   exceed 10,000 processed blocks unless you pass `--limit-processed-blocks 0`. Our package's first run
   reported `Blocks to process to prepare the stores in 2 stages: 182000`, i.e. any realistic
   `initialBlock` + a store trips the guard immediately. `grep -rn "limit-processed-blocks"` over the
   whole skills tree returns **zero hits** — not in `substreams-dev/SKILL.md`, not in
   `references/manifest-spec.md`, not in `substreams-testing`. Here the Streamsmith gate runner supplies
   the flag itself, so it cost us nothing; a builder following only the skills would hit an opaque
   refusal on their very first `substreams run` and have no documented way out. **Highest-value fix in
   this list:** one line in `substreams-dev` under "Debugging" or `initialBlock`.

2. **Abigen's generated code needs `num-bigint` as *your* direct dependency, exactly like `ethabi` —
   and only the `ethabi` half is documented.** `substreams-ethereum/SKILL.md` explains at length why
   `ethabi = "17"` must be a direct dep ("Abigen writes bare `ethabi::ParamType` paths into the file it
   generates in **your** crate"). The identical thing is true of `num_bigint` the moment any ABI
   function takes a `uint256` **argument** — ours was `convertToAssets(uint256)`, and the generated
   `src/abi/erc4626.rs` emitted `num_bigint::Sign::Plus` / `NoSign` / `Minus`. Three
   `cannot find module or crate num_bigint` errors, pointing into generated code the skill tells you not
   to hand-edit. `references/rpc-and-tokens.md` mentions `num-bigint = "0.4"` but only in the opposite
   context ("if you drop to `num_bigint` directly … staying on `substreams::scalar::BigInt` needs no
   extra dependency"), which reads as "you will not need this". Cost: ~4 min. Fix: add `num-bigint = "0.4"`
   to the Cargo.toml block with the same "required on the Abigen path" note, conditioned on uint256 args.

3. **No skill shows how to parse a decimal string back into a `BigInt`.** Every skill insists that
   `uint256` be emitted as a decimal `string` — and upstream packages do exactly that (Pinax
   `erc4626.v1.Deposit.assets` is a `string`). The obvious `BigInt::try_from("123")` does **not** compile:
   `substreams::scalar::BigInt` implements `From<i32/i64/isize/u32/u64/usize/num_bigint::BigInt>` and
   nothing for `&str`, so the route is `use std::str::FromStr; BigInt::from_str(s)`. Four compile errors.
   Cost: ~3 min. Fix: one line in `rpc-and-tokens.md` "Amount math" next to `to_decimal`.

4. **`sink:` with only `module:` does not parse, contradicting `substreams-sql/SKILL.md`.** The skill
   says (from-proto section, "Run"): *"the sink still has to resolve a module, so either declare
   `sink: module:` or pass the module as a trailing positional argument."* Doing the first gives
   `Error: reading manifest "substreams.yaml": unable to get package: unable to convert manifest to
   package: parsing sink configuration: sink: "type" unspecified` — from `substreams protogen`, before
   any sink is involved. The only working from-proto shapes are *no `sink:` block at all* (then pass the
   module positionally) or a complete `module` + `type` + `config` block. Cost: ~2 min, and it is the
   first thing a builder hits because `protogen` is step 1.

5. **`sf.substreams.v1.Clock` is effectively undocumented as a source input.** Any package that
   consumes an **imported** map module needs block identity from somewhere: imported outputs generally
   carry no block number/hash/timestamp (Pinax `erc4626.v1.Events` has `transactions[].logs[]` and
   nothing else). The answer is `- source: sf.substreams.v1.Clock`, but `substreams-dev`'s "Input Types"
   and `references/manifest-spec.md` "Source Inputs" only ever show `sf.ethereum.type.v2.Block`. The
   string appears exactly twice in the whole skills tree: once in `substreams-bitcoin/SKILL.md` and once
   inside a `map_clocks` CLI example. Falling back to `sf.ethereum.type.v2.Block` "just for the block
   number" would stream the entire block into WASM for nothing. Fix: add Clock to the Source Inputs
   table with the one-line reason (cheap block identity when your data comes from an imported module),
   and note that `Clock.id` is the block hash **without** an `0x` prefix.

6. **Parameter encoding is undocumented beyond JSON.** `references/patterns.md` "Parameterized Modules"
   shows only `serde_json::from_str(&params)`. The convention actually used by the hosted runner and by
   our contract is urlencoded / serde_qs (`vaults[]=0x…&vaults[]=0x…&interval=1800&chain_id=8453`), and
   `grep -rn "serde_qs\|urlencoded"` over the skills returns **zero hits**. We hand-parsed it. Fix: one
   sub-section noting the two conventions and that the hosted `ExecutionConfig.parameters` is a single
   string per module.

7. **The skill's canonical RPC cache still re-pays the call on every active block — a `set_if_not_exists`
   *delta* turns it into once-ever.** `references/rpc-and-tokens.md` "The cache-store pattern" has
   `map_pool_tokens` issue the `RpcBatch` in every block the contract appears (dedup is in-block only);
   the store only saves the *consumer*. Over a 91k-block backfill against every ERC-4626 vault on Base
   that is tens of thousands of redundant batches. Putting one RPC-free module in front
   (`map_sightings` → `store_first_seen` as `set_if_not_exists`) and reading that store in `mode: deltas`
   makes the probe fire in exactly the one block a contract is first seen, ever — the delta *is* the
   first-sight trigger, and it doubles as "emit one metadata row per contract" for the sink. Worth a
   named pattern in the skill; it is strictly better than the documented one whenever the metadata is
   immutable. (Cost us nothing — we designed it this way — but only because the contract's
   "first-sight … written when the probe first runs" wording forced the question.)

8. **`protobuf.excludePaths` still does not exclude descriptor-set packages** (A5 item 1, reconfirmed on
   substreams 1.22.0 / buf 1.72.0 with `descriptorSets: [buf.build/streamingfast/substreams]`):
   `substreams protogen` wrote `src/pb/schema.rs`, `src/pb/sf.firehose.v2.rs` and
   `src/pb/sf.codegen.conversation.v1.rs` and wired all three into `mod.rs` despite
   `excludePaths: [sf/substreams, google]`. Harmless (30 dead-code warnings) but still wrong.

9. **Unpinned `descriptorSets` warning, still with no documented ref to pin** (A5 item 2, reconfirmed):
   `buf.build/streamingfast/substreams (no version specified, resolves to latest) … will always trigger
   regeneration`. Note the retired-module problem from A2b item 10 is real and the gate's advice is
   correct: `buf.build/streamingfast/substreams` resolves, `…/substreams-sink-sql` is the retired one the
   SQL skill still names.

10. **Streamsmith, not Graph: `gate --reuse-runs` silently implies `--skip-build`.** `run.ts` guards the
    build with `if (!opts.reuseRuns && !opts.skipBuild)`, so `--reuse-runs` alone writes
    `build: { skipped: true, durationMs: 0 }` into `gate.json` while the help text lists the two flags as
    independent. Anyone reusing runs to re-check assertions gets a receipt-grade artifact with no build
    evidence in it. Either document it or split the flags.

11. **Nice surprise, worth keeping:** the normalized descriptor hash matched the frozen
    `expectedSpecSha256` (`ce7f7823…d5f9`) on the **first** build, with nothing but a byte-identical
    `proto/vaultflows.proto` and `descriptorSets: [buf.build/streamingfast/substreams]`. Internal
    plumbing types were put in a second file with package `vaultflows.internal.v1`, which the gate's
    "exactly one file whose package == vaultflows.v1" rule tolerates cleanly. The hash pipeline is doing
    exactly what it claims.
