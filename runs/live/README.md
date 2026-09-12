# Live run evidence (Sept 10, 2026)

Real output of `erc4626-flows` v0.1.0 (start block 51001200) streamed from The Graph Market
(`base-mainnet.streamingfast.io:443`, network `base`) with the local build.

**Regenerated 2026-09-10 by A9** after `VaultFlow.direction` changed from the proto3 enum `FlowDirection`
to `string direction = 12` (field number kept) because `substreams-sink-sql` 4.13.1 `from-proto` panics on a
populated enum field (`docs/build/sink-spike.md`). spkg used: `packages/erc4626-flows/erc4626-flows-v0.1.0.spkg`,
`map_events` module hash `8e4892cfaf2785fe3ff76ba7c7691c8bd8db811a`, normalized descriptor hash
`ce7f782321f4efef1adb472073977f1c0c051db6cc07402adb4cea586d04d5f9`.

| file | command | result |
|---|---|---|
| `observation-51092998-51093002.jsonl` | `substreams run … map_events -s 51092998 -t 51093002 --limit-processed-blocks 0` (gate observation run; regenerated with map_events on Sept 10 22:10 IST) | exit 0, 4 s. 1 line at block 51093000: both vaults, assets_per_share 1040743 / 1039913 (= `convertToAssets(1e18)` read directly at that block by A2b). Byte-identical to the pre-change recording (`ShareValueObservation` has no enum field). |
| `primary-51092254-51092454.jsonl` | `substreams run … map_events -s 51092254 -t 51092454 --limit-processed-blocks 0` | exit 0, 138 s (82,646 processed blocks, 200 received). 34 lines, 42 VaultFlow rows (Gauntlet `0x050c…56f0` 33 `deposit` + 7 `withdraw`, Steakhouse `0xbeef…73c9` 1 + 1), 1 chain-wide VaultMeta first-sight; execution rates in [1.039911979329258999, 1.040742235620567645]; every row `callOk` and `metaValid`. |

`raw/` holds the unedited stdout/stderr/exit of the primary run.

Verified against the pre-change recording: after rewriting `"direction":"FLOW_DIRECTION_DEPOSIT"` →
`"direction":"deposit"` and `…_WITHDRAW` → `"withdraw"`, the two primary files are line-for-line identical
(34/34 lines, same ids, amounts, log indexes and rates) — the enum→string change touched nothing else.
Reference rows still match `specs/gate.yaml` `reference_flows_present` and `log_index_matches_rpc`:
51092263 `deposit` logIndex 406, 51092316 `withdraw` 163, 51092402 `deposit` 521, 51092449 `withdraw` 836.

Facts learned: the CLI refuses requests over 10,000 processed blocks unless `--limit-processed-blocks 0`;
store preparation from the original 6-week start block was 3.6M blocks (2 stages), which motivated
moving the start block to 51001200 (182,000 blocks, then cached). The `map_events` module hash changed with
the contract, so the first run after the change paid store preparation again (82,646 blocks, 138 s).

## Hosted deployment (Sept 12, 2026)

A second, hosted pipeline for the same package runs on The Graph Market
(deployment `depnywi036749442f3c55e7`, Portal API HostedService), writing to a separate ClickHouse
Cloud database `vaultflows_hosted` on the same service. The self-managed sink in this directory
keeps running into `vaultflows` and stays the documented fallback; neither writes to the other's
database.

The hosted deployment's evidence lives in `runs/20260912T103328Z-vipc/` (see its README): views,
a read-only deploy record, the schema hash, the gate report and the receipt
`receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json` (`deploymentMode: graph-market-hosted`).

`cloud/mcp-live-probe-hosted.txt` is an MCP probe against the hosted database with a server
generated from that receipt. It shows `deploymentMode: graph-market-hosted` with the receipt
matching the manifest and the live column set matching the receipt's schema hash, and it shows the
data tools refusing with `stale_data` while the hosted sink is still catching up from its start
block. The committed `packages/mcp-vaultflows` and the Vaultpilot dashboard therefore still read
`vaultflows`; the switch to `vaultflows_hosted` is an environment change
(`CLICKHOUSE_DATABASE` / `CH_CLOUD_DATABASE`, `MCP_MANIFEST_PATH`, `MCP_RECEIPT_PATH`) once lag
falls below 300 blocks.
