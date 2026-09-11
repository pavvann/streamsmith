# Streamsmith

Building a blockchain data feed usually means writing indexer code, testing it, operating a database, and then teaching every application how to trust the result. Streamsmith turns one plain-language request into a tested Substreams pipeline, deploys it against live chain data, and creates a receipt connecting the exact code, configuration, database schema and MCP tools; those tools refuse to answer when the data is stale or mismatched. We demonstrate it by tracking tokenized savings vaults and letting a policy-controlled Privy business wallet move real USDC using the resulting live data. One prompt becomes a verifiable data service an agent can safely use.

## What is live right now

The published Substreams package `erc4626-flows` v0.1.0 (output module `map_events`, module hash
`8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`) is on the substreams.dev registry and streamed live from
`base-mainnet.streamingfast.io:443` into a ClickHouse Cloud database through a self-managed
`substreams-sink-sql` sink (`deploymentMode: self-managed-sink` in the
[Deployment Receipt](receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json)). At the last recorded
probe the sink head was block 51,148,236 against a chain head of 51,148,464 — 228 blocks / ~456 s
behind — and the generated `mcp-vaultflows` server's `share_value_growth` tool reported both
configured Base vaults growing in observed-window share value by about **0.037%** over the same
79-hour, 43-observation window (blocks 51,004,800 → 51,147,000), with `pipeline_status` confirming
the receipt matched the live schema (`runs/live/cloud/mcp-live-probe.txt`). The gate that produced
this receipt passed all 18 assertions on this same live data, including an RPC cross-check against
`eth_getTransactionReceipt`/`convertToAssets` at the cited blocks.

## Architecture

```mermaid
flowchart TD
    PROMPT["Human prompt<br/>docs/PROJECT.md §5"] --> SKILLS["Official Substreams skills<br/>generate the Rust/WASM code"]
    SKILLS --> CONTRACT["specs/vaultflows.proto<br/>public contract, frozen"]
    CHAINSRC["Base mainnet, chain 8453<br/>Pinax erc4626 Deposit/Withdraw"] --> PKG["erc4626-flows package<br/>map_events"]
    CONTRACT --> PKG

    subgraph PIPE["Streamsmith promotion pipeline"]
        direction TB
        GATE["gate<br/>specs/gate.yaml, 18 assertions"]
        PUBLISH["publish<br/>substreams.dev registry"]
        DEPLOY["deploy<br/>self-managed-sink live;<br/>graph-market-hosted pending"]
        RECEIPT["receipt<br/>receipts/erc4626-flows-*.json"]
        MCPGEN["mcp<br/>packages/mcpgen"]
        GATE --> PUBLISH --> DEPLOY --> RECEIPT --> MCPGEN
    end

    PKG --> GATE
    DEPLOY --> CH["ClickHouse Cloud<br/>vault_flows / share_value_observations / vaults"]
    CH --> MCP["mcp-vaultflows<br/>fail-closed MCP server"]
    MCPGEN --> MCP
    RECEIPT -.->|"5 hashes + lag,<br/>re-checked every 60s"| MCP

    MCP --> DECISION["Vaultpilot decision service<br/>src/decision.ts"]
    DECISION --> PRIVY["Privy business wallet<br/>policy + agent signer"]
    PRIVY --> BASETX["Base mainnet<br/>earn_deposit / earn_withdraw"]

    MCP -.-> REFUSE["Refusal reasons<br/>receipt_mismatch, schema_mismatch,<br/>chain_mismatch, stale_data, check_unavailable"]
```

Full write-up, one page: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Diagram source, kept
byte-identical to the block above: [docs/diagram.mmd](docs/diagram.mmd).

## Run it

Install once at the repo root: `pnpm install` (pnpm 10.26.1, Node >= 22.18; see
`package.json`/`pnpm-workspace.yaml`).

### `erc4626-flows` — the Substreams package ([README](packages/erc4626-flows/README.md))

```bash
cargo test
substreams build
substreams info erc4626-flows-v0.1.0.spkg
substreams run -e base-mainnet.streamingfast.io:443 erc4626-flows-v0.1.0.spkg map_events \
  --network base -s 51092254 -t +200 -o jsonl --limit-processed-blocks 0
```

### `streamsmith` — the promotion pipeline CLI ([README](packages/streamsmith/README.md))

```bash
pnpm install
pnpm --filter @ethonline26/streamsmith streamsmith --help
pnpm --filter @ethonline26/streamsmith typecheck
pnpm --filter @ethonline26/streamsmith test
pnpm --filter @ethonline26/streamsmith fixtures
```

### `mcpgen` — generates the fail-closed MCP server ([README](packages/mcpgen/README.md))

```bash
pnpm --filter @ethonline26/mcpgen generate
```

### `mcp-vaultflows` — the generated MCP server ([README](packages/mcp-vaultflows/README.md))

```bash
pnpm install
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=ro CLICKHOUSE_PASSWORD=ropass CLICKHOUSE_DATABASE=vaultflows
export BASE_RPC_URL=https://mainnet.base.org
node bin/server.js
```

### `vaultpilot` — the treasury app ([README](apps/vaultpilot/README.md))

```bash
pnpm typecheck
pnpm test

pnpm agent:once
pnpm agent:once --source fixture --offline
pnpm web:dev
```

## Sponsor evidence

Qualification bullets are quoted from `docs/PRIZES.md`; every row cites the exact file or artifact
that satisfies it. Where a bullet is not yet satisfied, that is stated instead of a claim.

### The Graph

**Composable / Standardized Graph products ($5K)**

| Bullet | Evidence |
|---|---|
| "Must compose 2+ Graph products OR build meaningfully on a standardized schema" | Imports Pinax's `erc4626` Substreams package and layers a documented, versioned ERC-4626 output contract on top of it: [`specs/vaultflows.proto`](specs/vaultflows.proto); module graph in [`packages/erc4626-flows/README.md`](packages/erc4626-flows/README.md#modules) (`erc4626:map_events` → `map_flows`/`map_share_value_observations` → `map_events`). |
| "Live data only (Subgraph Studio / The Graph Market). Mocked/local/static = DQ" | [Deployment Receipt](receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json) (`endpoint: base-mainnet.streamingfast.io:443`, `headBlock 51148236`, `lagBlocks 228`) and a live query result in [`runs/live/cloud/mcp-live-probe.txt`](runs/live/cloud/mcp-live-probe.txt). |
| "Show what became easier because of the shared schema" | [`packages/erc4626-flows/README.md`](packages/erc4626-flows/README.md#compose-it) "Compose it": any package can `import` the module unmodified or `use:` a submodule directly, params overridable with `-p`. |
| "Public repo + 2–4 min video" | Repo is public. **Video not recorded yet — left out; see Limitations.** |

**AI Tooling / AI Use Case, From Scratch ($5K)**

| Bullet | Evidence |
|---|---|
| "Featured challenge: Substreams SKILLs → one prompt → deployed Substreams pipeline" | Code generation via the official skills is disclosed in [AI-USAGE.md](AI-USAGE.md); the protocol is specified in `docs/PROJECT.md` §5; the resulting pipeline is deployed and live (receipt above). **The single uninterrupted, timestamped one-prompt-to-receipt recording the protocol describes has not been captured yet** (`docs/TASKS.md` task T7.3 is unchecked) — left as a partial claim; see Limitations. |
| "Graph must be load-bearing; live data via Studio API key or Graph Market" | Same receipt and live probe as above. |
| "Meaningful work with the data: reasoning, decisions, automation, or NL interface" | [`apps/vaultpilot/src/decision.ts`](apps/vaultpilot/src/decision.ts) turns two vaults' observations into a rotate/hold decision with a stated reason; [`packages/mcp-vaultflows/README.md`](packages/mcp-vaultflows/README.md) exposes semantic tools (`vault_flows`, `share_value_growth`, ...), not a raw-SQL passthrough. |
| "Tooling submissions must be reusable infra, not a single end-user app" | [`packages/streamsmith/README.md`](packages/streamsmith/README.md) (promotion pipeline, works on any gated Substreams package) and [`packages/mcpgen/README.md`](packages/mcpgen/README.md) (generates a fail-closed MCP server from any proto contract + receipt, not just this one). |
| "Open source with README/SKILL.md; public repo + video" | Package READMEs linked above; `skills/streamsmith/` referenced in [`packages/streamsmith/README.md`](packages/streamsmith/README.md#layout). Video: see Limitations. |

### Privy

**Best B2B financial product ($2.5K)**

| Bullet | Evidence |
|---|---|
| "Privy core; ≥1 Privy wallet" | Business wallet `0xcdC8B69799bCb135C04A1052b918787125571fDC` in [`docs/build/privy-spike.md`](docs/build/privy-spike.md). |
| "Business use case; ≥1 functional B2B workflow (treasury op)" | The observed-window-growth rotation rule: [`apps/vaultpilot/README.md`](apps/vaultpilot/README.md#the-rule-docsprojectmd-43). |
| "≥1 Privy control (policies, signers, key quorums, or intents)" | Policy builder [`apps/vaultpilot/src/policy.ts`](apps/vaultpilot/src/policy.ts); live policy `gghm9iorl3flfaybrqmlvisf` and agent signer `yfd2jb9phfeufhh2aibpjw3s` attached as `additional_signers[0]` in [`docs/build/privy-spike.md`](docs/build/privy-spike.md). |
| "Working demo + source" | Source under `apps/vaultpilot/src/`. The one beat executed for real (not dry run) so far is the denied, unapproved-vault call: `docs/build/privy-spike.md` — "Denial: unapproved vault \| HTTP 404 `Vault not found`". The allowed/executed beat has not run for real yet — see Limitations. |
| "Explain how Privy enables it" | [`apps/vaultpilot/README.md`](apps/vaultpilot/README.md) in full. |

**Best financial flow ($2.5K)**

| Bullet | Evidence |
|---|---|
| "Privy core; ≥1 wallet" | Same wallet as above. |
| "≥1 functional flow using a generally available feature (self-service Earn vaults)" | Both Earn vaults are configured and reachable with real position reads (`docs/build/privy-spike.md`, "Positions"). **No real Earn deposit/withdraw transaction has executed yet** — left out of a "done" claim; see Limitations. |

## Limitations

- **Self-managed sink vs. hosted status.** The pipeline live today runs on a self-managed
  `substreams-sink-sql` sink into ClickHouse Cloud (`deploymentMode: self-managed-sink` in the
  receipt). A hosted deployment on The Graph Market (`depdehi448c87998ebb763b`) was attempted; it
  crash-looped on a parameters-format error that has since been diagnosed and fixed in
  `runs/live/cloud/redeploy-hosted.sh`, but the corrected redeploy has not been run yet.
- **10% wrapper fee.** Both Privy Earn vaults are fee wrappers around the underlying Morpho vaults,
  and each wrapper keeps 10% of generated returns. The pipeline observes the underlying vault, so
  every growth figure shown is *before* that fee — disclosed in
  [`apps/vaultpilot/README.md`](apps/vaultpilot/README.md#fee-disclosure) and
  [`docs/build/vaults.md`](docs/build/vaults.md).
- **Observed-window semantics.** All growth numbers are "observed-window share-value growth,
  blocks X–Y", from sampled `convertToAssets` calls only, never interpolated between samples, and
  never a statement about anything beyond the streamed range
  (`packages/erc4626-flows/README.md#caveats-read-before-quoting-numbers`).
- **No rotation executed yet.** Every decision-service run recorded so far is a dry run against a
  hand-built fixture (`docs/TASKS.md` T4.8 is only partially done); the one real Privy call executed
  is the denied-vault demo. No real Base deposit, withdrawal or rotation transaction exists in the
  repo yet.
- **`packageHash` is not reproducible.** An `.spkg` embeds its proto files in a nondeterministic
  order and its wasm is host-dependent, so an identical rebuild produces a different `packageHash`.
  `outputModuleHash` is the reproducible identity the fail-closed check relies on — see
  [`packages/streamsmith/README.md#what-the-receipt-binds`](packages/streamsmith/README.md#what-the-receipt-binds).
- **Demo video** for either sponsor track does not exist in the repo yet, so it is left out of the
  evidence tables above rather than claimed.

## More

- [AI-USAGE.md](AI-USAGE.md) — what was AI-generated and how, including the hand-built reference
  implementation used to design the schema and gate.
- [feedback/](feedback/) — friction logs kept from the first minute on both The Graph and Privy
  integrations.
- [docs/research/codex-discussion.md](docs/research/codex-discussion.md) — the design discussion
  with OpenAI Codex that produced this v2 plan.
