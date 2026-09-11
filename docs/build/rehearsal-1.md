# Rehearsal 1 — forensic one-prompt run (A14)

Purpose: prove that, from the public contract + gate + Streamsmith alone, a single human
instruction plus the official Substreams skills produces a package that passes `specs/gate.yaml`.
This run is the rehearsal; the recorded run happens later. Facts only.

## Ground rules honoured
- Reference implementation `packages/erc4626-flows` in the repo was **never read** (see Audit below).
- Repo `/Users/pawan/Code/hacks/ethonline26` untouched except this file and `feedback/graph.md`.
- Work directory: `/Users/pawan/Code/hacks/streamsmith-rehearsal-1` (outside the repo).
- No registry publish (dry-run only). No ClickHouse Cloud writes.
- Every `substreams run` passed `--limit-processed-blocks 0` and only the gate's block ranges.

## Phase 0 — baseline evidence

Clean-start commit in the rehearsal directory (specs + streamsmith + mcpgen + workspace files only;
no Rust, no `packages/erc4626-flows`):

```
$ git status --porcelain
(empty — clean)
$ git rev-parse HEAD
009a7ab5d9933e4853bc380a5b2b586898289139
$ git tag
clean-start
$ date -u
Fri Sep 11 00:30:44 UTC 2026
```

110 files tracked. `.env` copied but gitignored (only `packages/streamsmith/.env.example` is tracked).

Toolchain observed on the machine:

| tool | version |
|---|---|
| substreams | 1.22.0 (commit be35ad3, 2026-08-24) |
| buf | 1.72.0 |
| rustc | 1.98.1 |
| cargo | 1.98.1 |
| node | v25.2.1 |
| pnpm | 10.26.1 |
| wasm32-unknown-unknown target | installed |

Free disk at start: **5.9 GiB** (the brief assumed ~9 GiB).

## The one instruction (verbatim, specs/prompt.md)

> Using the installed official Substreams skills and Streamsmith, build a reusable Base pipeline for
> ERC-4626 vault activity. Implement the public interface in `specs/vaultflows.proto`, using the vault
> addresses and sampling interval in `streamsmith.yaml`; include normalized deposit and withdrawal facts
> and fixed-interval `convertToAssets` observations. Do not modify the schema, tests, or gate
> requirements. Work autonomously until `gate.yaml` passes, then publish the package, deploy it to the
> configured ClickHouse sink, generate its typed MCP tools, and write a complete Deployment Receipt.
> If a requirement cannot be satisfied, stop with evidence rather than weakening or bypassing it.

## Phase 1 — reading the skills (00:31 → 00:45 UTC, ~14 min)

Read as the skills would load: `substreams-dev/SKILL.md`, `substreams-ethereum/SKILL.md`,
`substreams-sql/SKILL.md`, plus `substreams-dev/references/{manifest-spec,patterns,block-filtering}.md`
and `substreams-ethereum/references/rpc-and-tokens.md`. The imported package was inspected the way a
builder would — download the pinned URL, verify the sha256 from `streamsmith.yaml`, then
`substreams info` and `buf build <spkg>#format=binpb --as-file-descriptor-set` to learn
`erc4626.v1.Events` (it carries `transactions[].logs[]` with a `deposit`/`withdraw` oneof, a
`block_index`, and **no block identity** — hence a `sf.substreams.v1.Clock` input).

Design chosen from the skills (five modules, three stages, one sink output):

```
erc4626:map_events ─┐
sf.substreams.v1.Clock ─┴─> map_vault_sightings ─> store_first_seen (set_if_not_exists, string)
                                                       └─deltas─> map_vault_meta (the one eth_call probe)
                                                                      └─> store_vault_meta (set_if_not_exists, proto)
                                                                             └─get─> map_events  ← sink module
```

The `set_if_not_exists` delta is what makes "first sight" a *trigger*: a vault's key produces a
delta in exactly one block ever, so the metadata probe is paid once per address for the life of the
stream and the `vaults` table gets exactly one row per address. This is the skill's
map→store→map RPC cache pattern with one extra, RPC-free stage in front of it so the probe itself
is gated on first sight rather than re-run in every block a vault is active.

Internal plumbing types live in a **separate proto package** (`vaultflows.internal.v1`, in
`proto/internal.proto`) so that `proto/vaultflows.proto` stays byte-identical to the spec — the gate
takes "the single file whose package == vaultflows.v1", so a second file is harmless but a changed
one is fatal.

## Phase 2 — iteration log

Wall clock for the whole build phase is in the summary table at the end. "Iteration" = one
build/run attempt that ended in a failure I had to fix.

| # | Attempt | Failure | Fix |
|---|---|---|---|
| 1 | `substreams protogen substreams.yaml` | `parsing sink configuration: sink: "type" unspecified` | Deleted the `sink:` block. `substreams-sql/SKILL.md` says the from-proto service config is optional and that you may "either declare `sink: module:` or pass the module as a trailing positional argument" — but a `sink:` block with only `module:` does not parse. Only the *absent* block works. |
| 2 | `substreams protogen` | — | Clean. Generated `src/pb/{vaultflows.v1,vaultflows.internal.v1,erc4626.v1,schema}.rs` + `mod.rs`. |
| 3 | `cargo build --target wasm32-unknown-unknown --release` | 7 errors: `cannot find module or crate num_bigint` ×3 inside the **Abigen-generated** `src/abi/erc4626.rs`, and `BigInt: TryFrom<&str> is not satisfied` ×4 | Added `num-bigint = "0.4"` to `[dependencies]`, and swapped `BigInt::try_from(&str)` for `BigInt::from_str`. |
| 4 | `cargo build` | — | Clean (32 s cold). |
| 5 | `substreams build` | — | `erc4626-flows-v0.1.0.spkg` produced in 4 s. |
| 6 | `streamsmith hash descriptor` vs `hash spkg` | — | `ce7f7823…d5f9` on both sides **on the first try** — the byte-identical proto + `descriptorSets: buf.build/streamingfast/substreams` route reproduces the frozen hash exactly. |
| 7 | `streamsmith gate --skip-build` (first gate attempt) | — | **PASSED on the first attempt**: 16/16 fail-level assertions, and both `severity: warn` assertions (`log_index_matches_rpc`, `observation_matches_reference`) also passed. |
| 8 | `streamsmith gate` (clean, build + all three runs) | — | Green again: build 4.2 s, primary 9.1 s, primary_rerun 9.4 s, observation 34.8 s. |

**Total: 8 attempts, 3 of which were failures (#1, #3, and the `--reuse-runs` observation in the
rough-edge list below). Zero failed gate runs, zero failed assertions, no rework of the design.**

### Gate evidence (`runs/20260911T004645Z-9sjd/gate.json`)

```
status            passed   exitCode 0   16/16 fail-level, 2/2 warn-level
ranges            51092254:51092454, 51092254:51092454, 51092998:51093002
spkgSha256        213bd657536670bd1cf16954e6c63fda152ca9bcac837f7eec58a6cee161108f
protoDescriptor   ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9  (== frozen expectedSpecSha256)
map_events hash   508c375493a9ade69024341d52b0112e5b6cbec5
rows              vault_flows 42 · share_value_observations 0 (primary) / 2 (observation) · vaults 1 · share_transfers 0
determinism       primary == primary_rerun, sha256 58bea072ab63a669…, 34 lines each
rpc_success       48/48 configured-vault rows call_ok = 1.0000
tools             substreams 1.22.0 · buf 1.72.0 · rustc/cargo 1.98.1 · node v25.2.1 · pnpm 10.26.1
                  substreams-sink-sql 4.13.1
```

First `substreams run` reported `Blocks to process to prepare the stores in 2 stages: 182000
(0 already cached)` — exactly the "~91k blocks x 2 stages" the gate's own comment predicts — and the
whole cold run still finished in **~95 s** (55,554 processed blocks billed, 93 KiB egress). The rerun
found 182,000 blocks already cached and cost 766 processed blocks.

The one `vaults` row inside the primary range is a chain-wide first sight, not a configured vault:
`0x98911f27…95543b` ("Yield Wrapped Aave Base EURC", 6/6 decimals, compliant). It is correctly
excluded from `rpc_success_ratio_gte`'s denominator, which stayed at the configured-vault rows only.

### Was the reference implementation read?

No. `packages/erc4626-flows` in the repo was never opened, listed, grepped or diffed, and neither
were the two files under `packages/streamsmith/fixtures/` that are derived from it
(`fixtures/substreams.yaml`, `fixtures/live/*.jsonl`) — those were copied into the rehearsal tree by
`rsync` for the test suite but never read. Everything in the rehearsal package came from
`specs/`, the five skills, `substreams info`/`buf build` on the imported spkg, and the compiler.

## Phase 3 — promote (publish / deploy / receipt / MCP / manifest)

### publish (dry run, as required)

```
$ streamsmith publish --dry-run
publish: dry-run; would run: substreams registry publish erc4626-flows-v0.1.0.spkg --yes
publish: dry-run; expected URL https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0
publish: erc4626-flows v0.1.0 sha256=3df31a70d2b15e6b8a2514a6018d439160ac752ac8591cd0949427f834239388 (809220 bytes)
```
2.5 s. Nothing was sent to the registry — `erc4626-flows v0.1.0` already exists there from the real
build and a rehearsal publish would have burned the namespace.

Note the two different sha256 values that both legitimately describe "the package": the gate records
`spkgSha256 213bd657…108f` for the spkg it built, and `publish --dry-run` reports `3df31a70…9388` for
the spkg it would upload. **`.spkg` bytes are not reproducible** (the packer embeds timestamps/ordering
that change between `substreams build` invocations); this is exactly why the receipt carries the
*module hash* `508c3754…bec5` as the reproducible identity and treats `packageHash` as "the exact bytes
that were published".

### deploy — SKIPPED, with evidence

The brief allows a local-Docker deploy or a skip with a stated reason. **Skipped.** The reason is
environmental, not a defect of the package or of Streamsmith:

1. The Docker **API daemon never came up**. `docker version` hangs to timeout (`rc=124`, server
   version empty) for 9+ minutes after `open -ga "Docker Desktop"`; `com.docker.backend` and
   `com.docker.virtualization` are running and answering IPC, but `dockerd.log` has not been written
   since 00:27 and its tail is hundreds of
   `Error writing log message … input/output error` lines from the previous session.
2. The `vaultflows-ch` **container is still alive** (ports 9000 and 8123 answer;
   `SELECT version()` → `26.8.2.7`; `SELECT count() FROM vaultflows.vault_flows` → 171), but its
   **filesystem is read-only**:
   ```
   CREATE DATABASE IF NOT EXISTS vaultflows_rehearsal
   -> Code: 458. DB::ErrnoException: Cannot unlink file
      /var/lib/clickhouse/metadata/vaultflows_rehearsal.sql.tmp: errno: 30,
      strerror: Read-only file system. (CANNOT_UNLINK)
   ```
   So no DDL and no INSERT is possible. Root cause is the host disk: **5.4 GiB free, 98% full**, which
   filled the Docker VM's virtual disk (this is the same failure A1 logged on 2026-09-09).
3. ClickHouse **Cloud was not touched**, per the brief. It is in fact owned by a live sink right now —
   `substreams-sink-sql from-proto clickhouse://…ap-south-1.aws.clickhouse.cloud:9440/vaultflows`
   has been running since 05:13 local.

I deliberately did **not** drop the four tables in the local `vaultflows` database (the brief's
"drop the four tables first"): with no possibility of a successful deploy afterwards, dropping would
only have destroyed A7/A8's local evidence. My first move was to try an isolated
`vaultflows_rehearsal` database instead, which is what surfaced the read-only error above.

### receipt and MCP — BLOCKED by the skipped deploy

```
$ streamsmith receipt --spkg packages/erc4626-flows/erc4626-flows-v0.1.0.spkg
streamsmith: schema.sql not found (runs/20260911T004645Z-9sjd/schema.sql);
             run `streamsmith schema-dump` or pass --schema-sql / --schema-hash
```

`sinkSchemaHash` is a **required** field of `specs/receipt.schema.json` ("sha256 of the generated
schema.sql / DDL applied to the sink") and its only sources are `--schema-sql` (from
`streamsmith schema-dump`, which queries a live database) or a hand-supplied `--schema-hash`. With no
database there is no honest value, so no receipt was written — and `streamsmith mcp` requires a
receipt, so MCP generation is blocked behind it too. **This is the single most important finding for
the recorded run: see rough edge R1 below.** `sql/views.sql` was authored (two views,
`vault_flows_24h` and `share_value_growth`, both filtering `_deleted_ = 0`) but is **unverified** —
it has never been executed against a database.

### manifest start / finish

```
runs/20260911T004645Z-9sjd/manifest.json
  startingCommit 009a7ab5… (tag clean-start)   promptHash 30cd5095…
  endingCommit   4e0faef3…  endingTreeClean true
  gateStatus passed   gateJsonHash 9a7ba69b…   publishJsonHash 7f3f9fe3…
  receiptHash (none)
```

## Diff vs `clean-start`

`34 files changed, 4263 insertions(+)`; inside the package, `20 files, 3535 insertions(+)`.

**Hand-written** (everything else is generated or copied):

| lines | file |
|---|---|
| 522 | `src/lib.rs` — five handlers, params parser, decimal formatter, probe |
| 89 | `substreams.yaml` |
| 49 | `README.md` |
| 40 | `sql/views.sql` (unverified) |
| 27 | `Cargo.toml` |
| 21 | `proto/internal.proto` |
| 9 | `build.rs` · 9 `abi/erc4626.json` · 2 `src/abi/mod.rs` · 3 `.gitignore` |
| 179 | `proto/vaultflows.proto` — **byte-identical `cp` of `specs/vaultflows.proto`**, never edited |

Generated and committed: `src/pb/*.rs` (1183 lines, `substreams protogen`), `Cargo.lock` (1390),
`buf.gen.yaml` (12). Generated and gitignored: `src/abi/erc4626.rs` (Abigen), `target/`, `*.spkg`.

## Wall clock

| Phase | Window (UTC) | Duration |
|---|---|---|
| Baseline (copy, `pnpm install`, git init/commit/tag) | 00:26 → 00:31 | 5 min |
| Read the skills + inspect the imported spkg | 00:31 → 00:40 | 9 min |
| Author the package (proto, ABI, manifest, 522 lines of Rust) + 2 compile failures | 00:40 → 00:43:50 | 4 min (3 build cycles, 41 s of machine time) |
| First `streamsmith gate` (cold stores, 182k blocks prepared) | 00:43:50 → 00:46:09 | 2 min 19 s |
| Clean full gate (build + 3 runs, warm stores) | 00:46:45 → 00:47:47 | 1 min 2 s |
| publish dry-run | 00:47:55 → 00:47:58 | 3 s |
| Docker recovery attempts + deploy triage | 00:48 → 01:00 | 12 min (all of it lost to the environment) |
| **Total** | **00:26 → 01:02** | **~36 min**, of which ~12 min was Docker |

Excluding the Docker dead end: **~24 minutes from empty directory to green gate + publish dry-run.**

## What would make the RECORDED run smoother

Ordered by how much they would cost on camera.

**R1 — Give `streamsmith receipt` an offline `sinkSchemaHash`.** This is the one that can kill the
recorded run. Today the chain is deploy → `schema-dump` → `schema.sql` → `sinkSchemaHash` → receipt →
MCP, so *any* database problem (a full disk, a cold container, a network hiccup) takes out the two most
demo-able artifacts — the Deployment Receipt and the typed MCP tools — even though the package itself
is fully gated and green. The ClickHouse DDL is **deterministic from the spkg**: the from-proto sink
derives it from the annotated proto and nothing else. Streamsmith should be able to render that DDL
locally (it already parses the descriptor for the hash assertions) and hash it, then verify it against
the live database once the deploy succeeds. Failing that, at minimum have `deploy self-managed`
preflight the DSN and say "ClickHouse is read-only / unreachable" *before* the operator finds out two
commands later.

**R2 — Pre-flight the environment before the camera rolls.** A checklist the operator runs first:
free disk > 20 GiB (this machine was at 98% and it cost 12 of 36 minutes), `docker version` returns a
**server** version, `curl localhost:8123 'SELECT 1'`, `SUBSTREAMS_API_TOKEN` set, and the four local
tables dropped. Note that ports answering is **not** proof of health — this container accepted
connections and served `SELECT` the whole time its filesystem was read-only.

**R3 — Four one-line additions to the official skills** would have removed every compile failure and
every lookup in this rehearsal (full detail in `feedback/graph.md` under A14):
1. `--limit-processed-blocks 0` — appears **nowhere** in the skills, yet substreams v1.22.0 refuses
   any run whose store preparation exceeds 10,000 blocks, which is every store-bearing package.
   The gate runner supplies it here; a builder following only the skills is stuck on their first run.
2. `num-bigint = "0.4"` is required as a direct dependency on the Abigen path whenever an ABI function
   takes a `uint256` **argument** — the skill documents the identical rule for `ethabi` but not this.
3. `BigInt::from_str` (`use std::str::FromStr`) — there is no `From<&str>`/`TryFrom<&str>`, and every
   skill tells you to move `uint256` around as decimal strings.
4. `- source: sf.substreams.v1.Clock` in the Source Inputs table — the only cheap way to get block
   identity when your data arrives from an imported module. (And: `Clock.id` has no `0x` prefix.)

**R4 — Fix the `sink:` line in `substreams-sql/SKILL.md`.** It currently says you may "declare
`sink: module:`"; a `sink:` block with only `module:` fails at *manifest parse* with
`sink: "type" unspecified`, and it fails on `substreams protogen` — the very first command a builder
runs. This was iteration #1 of this rehearsal.

**R5 — Decide the `vaults`-table story out loud.** The contract says VaultMeta covers "every address
that emitted a matching Deposit/Withdraw", which means probing every ERC-4626 vault on Base. That is
fine *only* because the probe is gated on a `set_if_not_exists` delta; the skill's documented cache
pattern (probe every block the contract is active, dedup in-block) would have issued tens of thousands
of redundant `eth_call` batches over the 91k-block backfill. If the recorded run is narrated, this is
the most interesting design decision in the package and it is worth showing.

**R6 — Say up front that `.spkg` bytes are not reproducible.** The gate's `spkgSha256` (`213bd657…`)
and `publish --dry-run`'s sha256 (`3df31a70…`) legitimately differ for the same source. Anyone
watching will read that as a bug. The module hash `508c3754…bec5` is the reproducible identity and the
receipt already treats it that way.

**R7 — Small Streamsmith papercut:** `gate --reuse-runs` silently implies `--skip-build`
(`gate.json` gets `build: { skipped: true }`) while the help lists them as separate flags. Either
document it or split them, so a "re-check the assertions" run doesn't quietly produce a build-less
gate report.

## Verdict

From a directory containing only the frozen contract, the gate, Streamsmith and the official skills,
one instruction produced a Substreams package that **passed all 16 fail-level and both warn-level gate
assertions on the first gate attempt**, in ~24 minutes, with two trivial compile failures along the
way and **no redesign**. The descriptor hash matched the frozen value on the first build. The blocked
half of the run — deploy, receipt, MCP — was blocked entirely by a full disk on the host, and R1 is
the change that would stop that from being fatal next time.
