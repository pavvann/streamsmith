# Recording protocol and shot list (Sept 12)

Ground truth: the blind rehearsal (docs/build/rehearsal-1.md) built the package from the prompt alone in ~24 min productive time, gate 18/18 on the first gate attempt. Recording follows the same protocol with a human at the keyboard and the screen captured. Rules: 1080p, real microphone, no TTS, no speed-up (cuts are allowed), no music-only segments. Final video 3:00–3:30 (hard limits 2:00–4:00).

## A. Before pressing record (30 min, Pawan + Claude)
- [ ] Wallet funded (~50 USDC on Base at 0xcdC8B69799bCb135C04A1052b918787125571fDC); gas sponsorship App-pays on Base confirmed.
- [ ] `pnpm demo:deposit --amount 25 --execute` run ONCE beforehand into the vault with the LOWER observed growth, so a real rotation is possible on camera. Save tx hash.
- [ ] Fresh directory: `/Users/pawan/Code/hacks/streamsmith-recording` built exactly as the rehearsal (specs/, packages/streamsmith, packages/mcpgen, workspace files, .env; NO packages/erc4626-flows). `git init`, commit, tag `clean-start`.
- [ ] Package version for the recording: bump specs/streamsmith.yaml + manifest version to **v0.1.1** in the fresh dir (v0.1.0 is already published; registry refuses duplicates).
- [ ] Cloud target for the recorded deploy: database **vaultflows_rec** (create + grants as for vaultflows; keeps the live `vaultflows` sink untouched). Use `--clickhouse-sink-info-folder` under the run dir.
- [ ] Terminal recorder: `asciinema rec runs/rec/terminal.cast` alongside the screen capture. Clock visible.
- [ ] Docker not needed. Disk ≥ 5 GB free.

## B. Uncut capture (≈45–60 min raw; backup evidence)
1. On screen: `git status --porcelain`, `git rev-parse HEAD`, `git tag --points-at HEAD`, `date -u`.
2. Open Claude Code in the fresh dir with the Substreams skills + Streamsmith plugin installed. Paste specs/prompt.md verbatim. No follow-up messages. The agent works until `streamsmith gate` passes, then publish (v0.1.1), deploy self-managed to vaultflows_rec (`--stop-block` = head at start + ~2,000 so it finishes in minutes), receipt (`--schema-from-spkg`), mcp, manifest finish.
3. If the agent stops with evidence instead of passing: that IS the recording (honest failure), do not intervene. Re-run from the tag only if the failure is environmental (network, quota) and say so on camera.
4. Immediately after: `sha256sum` the uncut screen recording; `streamsmith manifest finish --recording <file>`; copy runs/rec + receipt into the repo under runs/recorded/.

## C. Edited video beats (target 3:30)
| t | beat | source clip |
|---|---|---|
| 0:00–0:18 | Thesis (README §top, one diagram) + the clean tag on screen | B1 |
| 0:18–0:58 | The single prompt pasted; agent writes manifest/proto/Rust; cargo/build errors it fixes itself; gate turns green. Overlay: "One human prompt. Uncut run linked." | B2 cuts |
| 0:58–1:28 | publish → substreams.dev page; receipt JSON (hashes, gate 18/18); deploy status showing head/lag; rows landing | B2 |
| 1:28–1:58 | Claude asks the MCP: "Compare observed-window share-value growth for the two approved Base vaults and show recent net flows." Typed answer with provenance. Then force stale (MAX_LAG_BLOCKS=1) → refusal | live |
| 1:58–2:53 | Vaultpilot: policy shown; `demo:denied` (404/denied); `demo:rotate --execute` on the live signal → Privy withdraw + deposit; Basescan links; position updates; 10% wrapper fee disclosed | live |
| 2:53–3:30 | Architecture centered on the receipt; public package, repo, uncut recording hash; close: "Streamsmith makes AI-generated Substreams reproducible and safe enough for agents to use." | slide |

The frame to remember (hold 3 s): GATE PASSED · outputModuleHash · head/lag · rotate decision · Base tx hash. Caption: **One prompt. Live pipeline. Money moved.**

## D. Fallbacks
- Rotation differential below threshold at recording time → the honest result is "hold"; show it, then show `demo:deposit --execute` as the real GA flow (deposit + withdraw both count for Privy).
- Registry publish refused → show `publish --dry-run` + the existing v0.1.0 page; say so.
- Cloud unreachable → deploy to local ClickHouse, receipt records self-managed-sink; say so.
