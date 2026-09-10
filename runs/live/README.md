# Live run evidence (Sept 10, 2026)

Real output of `erc4626-flows` v0.1.0 (start block 51001200) streamed from The Graph Market
(`base-mainnet.streamingfast.io:443`, network `base`) with the local build.

| file | command | result |
|---|---|---|
| `observation-51092998-51093002.jsonl` | `substreams run … map_share_value_observations -s 51092998 -t 51093002 --limit-processed-blocks 0` | 1 line at block 51093000: both vaults, assets_per_share 1040743 / 1039913 (= `convertToAssets(1e18)` read directly at that block by A2b) |
| `primary-51092254-51092454.jsonl` | `substreams run … map_events -s 51092254 -t 51092454 --limit-processed-blocks 0` | 34 lines, 42 VaultFlow rows (Gauntlet 33 deposit + 7 withdraw, Steakhouse 1 + 1), 1 chain-wide VaultMeta first-sight; execution rates in [1.03991, 1.04074]; all `call_ok` |

Facts learned: the CLI refuses requests over 10,000 processed blocks unless `--limit-processed-blocks 0`;
store preparation from the original 6-week start block was 3.6M blocks (2 stages), which motivated
moving the start block to 51001200 (182,000 blocks, then cached).
