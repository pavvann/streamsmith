# Submission checklist — ETHOnline 2026 (deadline Sun Sept 13, 12:00 EDT = 21:30 IST)

Source of rules: docs/PRIZES.md (scraped Sept 4). Mark each line only with evidence.

## ETHGlobal form
- [ ] Project title: **Streamsmith**. Tagline: "One prompt. A verified Substreams pipeline, live and agent-ready."
- [ ] Description (short + long): thesis paragraph from README §top; state Start Fresh; state AI usage per AI-USAGE.md.
- [ ] Repo: https://github.com/pavvann/streamsmith (public; history from Sept 9; no force-push after submit).
- [ ] Demo video: 2:00–4:00, ≥720p (we record 1080p), human voice, no TTS, no music-only, no speed-up, not phone-recorded. Test-upload the night before.
- [ ] Partner prizes: exactly **The Graph** and **Privy** (2 of 3 slots). Within Graph tick both: Best Use of Composable/Standardized Graph Products; Best AI Tooling or AI Use Case (From Scratch). Within Privy tick both: Best B2B financial product; Best financial flow. Do NOT tick any Continuity pool.
- [ ] Per-partner "how we used it" text + feedback: paste README §Sponsor evidence and link feedback/graph.md, feedback/privy.md.
- [ ] Live links: substreams.dev/packages/erc4626-flows/v0.1.0 (the live pipeline) and .../v0.1.1 (the recorded one-prompt run); receipt files; MCP install snippet (README); Vaultpilot UI (if deployed) or screenshots.

## Hard gates (fail = disqualified from that track)
- [x] Graph: live data from a Graph provider. Two live deployments of the published package. The hosted one on The Graph Market (`depnywi036749442f3c55e7` → `vaultflows_hosted`, receipt receipts/erc4626-flows-v0.1.0-20260912T103328Z-vipc.json, `deploymentMode: graph-market-hosted`, `mcpManifestHash` bound to the shipped MCP) is the pipeline behind the tools and the dashboard: caught up on Sept 13 at a 10-block lag, evidence in runs/20260912T103328Z-vipc/ and runs/live/cloud/mcp-live-probe-hosted.txt (real answers plus the receipt_mismatch and stale_data refusals). Self-managed on base-mainnet.streamingfast.io is the fallback (runs/live, receipt receipts/erc4626-flows-v0.1.0-20260910T234439Z-1fr9.json). Not mocked.
- [x] Graph: composition/standard: imports Pinax erc4626 spkg; published reusable package; ERC-4626 is the named example.
- [x] Graph AI tooling: one-prompt → deployed pipeline. Run `20260913T114823Z-nyom`, sealed in runs/recorded/20260913T114823Z-nyom/ (README with every number and its source). From a 112-file baseline tagged `clean-start` that had no `packages/erc4626-flows`, one message and nothing else produced the package, gate **18/18 passed, exit 0** (one `substreams build`, no retries), publish of `erc4626-flows` **v0.1.1** (https://substreams.dev/packages/erc4626-flows/v0.1.1, module hash `22c9d75e…`, independent of the reference package's `8e4892cf…`), a self-managed sink into `vaultflows_rec`, the generated MCP server, and receipt receipts/erc4626-flows-v0.1.1-20260913T114823Z-nyom.json — 4 min 51 s from run manifest to receipt. The evidence is the run directory, the receipt and the full diff against `clean-start`; no recording hash is claimed.
- [x] Graph: open source w/ README + SKILL.md (packages/streamsmith/skills/streamsmith/SKILL.md).
- [x] Privy core + ≥1 wallet (business wallet q4zcqb7leopoj7hocdtqhbfe).
- [x] Privy ≥1 control: policy gghm9iorl3flfaybrqmlvisf + additional signer (docs/build/privy-spike.md).
- [ ] Privy ≥1 functional GA flow: real Earn deposit + withdraw on Base mainnet. **Pending wallet funding.**
- [ ] Privy B2B workflow demonstrated end to end (denied → allowed → executed). Denied part done live.
- [x] Commit history meaningful (60+ commits over Sept 9–11).
- [x] AI attribution: AI-USAGE.md; specs/ has prompts + briefs.
- [ ] Video shows: clean tag → one prompt → gate green → publish → deploy → receipt → MCP answer → refusal → Privy denied/allowed → tx hashes.

## Nice-to-have (only if time)
- [x] Hosted Graph Market deployment live alongside self-managed, each with its own receipt and its own database (`vaultflows_hosted` / `vaultflows`). Done Sept 13: the generated MCP is regenerated from the hosted receipt and both it and the Vaultpilot dashboard read `vaultflows_hosted`; the self-managed sink is the fallback.
- [ ] Vaultpilot UI deployed (Vercel) with read-only cloud creds.
- [ ] Case study in skills-repo format committed (streamsmith casestudy).
