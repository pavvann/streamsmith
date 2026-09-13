# Submission copy — paste-ready

## Project name
Streamsmith

## Tagline (one line)
One prompt. A verified Substreams pipeline, live and agent-ready.

## Short description (≤ 280 chars)
A Claude Code plugin that turns one sentence into a Substreams pipeline, proves it against a gate of real-block checks, publishes and deploys it on The Graph, and emits a Deployment Receipt that a fail-closed MCP server verifies before any agent acts on the data.

## Full description
AI can write a Substreams pipeline in minutes, but nobody should trust one it wrote: the code can be subtly wrong and nothing tells you. Streamsmith makes that trust checkable.

A human writes the contract: a protobuf schema (what the data must look like), a config (chain, addresses, sampling interval) and a gate file (checks against real blocks whose correct answers are already known). Then one prompt. The official StreamingFast Substreams skills teach the agent how to write the Rust; the Streamsmith plugin teaches it how to prove the result is right and get it live. The promotion pipeline is: gate → publish to the Substreams registry → deploy (Graph Market hosted sink or a self-managed sink into ClickHouse) → Deployment Receipt → generated MCP server. Nothing is published until every gate assertion passes, and the gate verifies the contract files were not modified by the agent.

The Deployment Receipt binds the package hash, output module hash, parameter hash, proto descriptor hash and sink schema hash to the gate evidence and the deployment. The MCP server generated from it re-checks those hashes and the chain head every minute and refuses to answer (receipt_mismatch, schema_mismatch, chain_mismatch, stale_data) instead of guessing.

Worked example: `erc4626-flows`, a reusable ERC-4626 vault-activity package for Base (deposits, withdrawals and fixed-interval convertToAssets observations for Gauntlet USDC Prime and Steakhouse Prime USDC), composed on the Pinax erc4626 package, published to substreams.dev, running as a Graph Market hosted deployment into ClickHouse Cloud with a live receipt.

Payoff: Vaultpilot, a B2B treasury agent for a Privy business wallet. The owner sets a policy (two approved vaults, per-action cap, deposit and withdraw only); the agent holds an additional signer key that can do nothing else. It reads the MCP, decides whether to rotate USDC between the vaults on observed-window share-value growth, refuses on stale or mismatched data, and is denied by Privy at the policy layer when it tries anything outside the policy.

Recorded proof: from a 112-file clean-start commit holding only the contract and tooling, one human message produced the package, a green gate (18/18), a registry publish (v0.1.1), a ClickHouse deployment, a receipt and an MCP server in about 40 minutes, with no further human input. The run folder, the receipt and every generated line of code are in the repo under runs/recorded/.

Start Fresh. Built with Claude Code from human-written specs, gates and briefs (see AI-USAGE.md).

## How it's made
- Rust Substreams package (`packages/erc4626-flows`): map/store modules over the Pinax erc4626 and erc20 packages plus eth_call sampling of convertToAssets; proto contract in `specs/vaultflows.proto`; published with `substreams publish`.
- Streamsmith CLI + Claude Code plugin (`packages/streamsmith`, TypeScript): `gate` (executable assertions from `specs/gate.yaml` against pinned Base block ranges, exit codes), `publish`, `deploy hosted|self-managed|views|status|--attach`, `schema-render` (offline DDL byte-identical to the live sink), `receipt` (JSON-schema-validated Deployment Receipt), `mcp`, `manifest`; SKILL.md carries the build traps the agent needs.
- mcpgen (`packages/mcpgen`): generates a typed stdio MCP server from the proto descriptors and the receipt, with a fail-closed refusal chain and provenance on every response; `packages/mcp-vaultflows` is the generated server for the worked example.
- Sinks: Graph Market hosted deployment (primary) and `substreams-sink-sql from-proto` (fallback), both into ClickHouse Cloud with a read-only user for consumers.
- Vaultpilot (`apps/vaultpilot`, TypeScript + Next.js): Privy server wallet owned by the treasurer key, agent as additional signer with an override policy (earn_deposit/earn_withdraw on two vault ids under a cap), decision service with staleness refusal, cooldown, outflow guardrail and app-side daily cap; dashboard shows every fact behind each decision and the pipeline stamp with the receipt hashes.
- 313 tests across the workspace; GitHub Actions builds the Substreams package.

## The Graph — how we used it
Substreams end to end. The official StreamingFast Substreams skills generate the Rust; the package composes the Pinax erc4626 package and adds convertToAssets sampling; published to substreams.dev (v0.1.0 live, v0.1.1 from the recorded one-prompt run); deployed as a Graph Market hosted sink into ClickHouse Cloud (deployment `depnywi036749442f3c55e7`) with a Deployment Receipt; a generated MCP server exposes the tables to agents with provenance and refuses on stale or mismatched data. Featured challenge done for the record: Substreams skills → one prompt → deployed pipeline, sealed in runs/recorded/20260913T114823Z-nyom/. Feedback: feedback/graph.md.

## Privy — how we used it
Server wallet owned by the treasurer's authorization key; an agent key registered as a 1-of-1 key quorum and attached as an additional signer with an override policy allowing only earn_deposit and earn_withdraw on two approved vault ids under a per-action cap; live policy denial demonstrated (unapproved vault → denied before any transaction); Earn vault details and positions read through the API; the agent decides on verified data and refuses on staleness; the owner can revoke the agent with one call. Real deposits were blocked at submission time by the app's Earn vaults returning `invalid_state` for every deposit and withdraw regardless of signer or amount (raised with the Privy team); the wallet is funded and the flow runs the moment the vaults accept deposits. Feedback: feedback/privy.md.

## Links
- Repo: https://github.com/pavvann/streamsmith
- Live pipeline (registry): https://substreams.dev/packages/erc4626-flows/v0.1.0
- Recorded one-prompt run package: https://substreams.dev/packages/erc4626-flows/v0.1.1
- Run evidence: https://github.com/pavvann/streamsmith/tree/main/runs/recorded/20260913T114823Z-nyom
- Receipts: https://github.com/pavvann/streamsmith/tree/main/receipts
- Demo video: (paste URL)

## Partner prize picks
The Graph: Best Use of Composable or Standardized Graph Products; Best AI Tooling or AI Use Case (From Scratch).
Privy: both Start Fresh tracks (B2B financial product; Best financial flow).
