# Submission checklist — ETHOnline 2026 (deadline Sun Sept 13, 12:00 EDT = 21:30 IST)

Source of rules: docs/PRIZES.md (scraped Sept 4). Mark each line only with evidence.

## ETHGlobal form
- [ ] Project title: **Streamsmith**. Tagline: "One prompt. A verified Substreams pipeline, live and agent-ready."
- [ ] Description (short + long): thesis paragraph from README §top; state Start Fresh; state AI usage per AI-USAGE.md.
- [ ] Repo: https://github.com/pavvann/streamsmith (public; history from Sept 9; no force-push after submit).
- [ ] Demo video: 2:00–4:00, ≥720p (we record 1080p), human voice, no TTS, no music-only, no speed-up, not phone-recorded. Test-upload the night before.
- [ ] Partner prizes: exactly **The Graph** and **Privy** (2 of 3 slots). Within Graph tick both: Best Use of Composable/Standardized Graph Products; Best AI Tooling or AI Use Case (From Scratch). Within Privy tick both: Best B2B financial product; Best financial flow. Do NOT tick any Continuity pool.
- [ ] Per-partner "how we used it" text + feedback: paste README §Sponsor evidence and link feedback/graph.md, feedback/privy.md.
- [ ] Live links: substreams.dev/packages/erc4626-flows/v0.1.0; receipt file; MCP install snippet (README); Vaultpilot UI (if deployed) or screenshots.

## Hard gates (fail = disqualified from that track)
- [x] Graph: live data from a Graph provider (base-mainnet.streamingfast.io; runs/live, receipt). Not mocked.
- [x] Graph: composition/standard: imports Pinax erc4626 spkg; published reusable package; ERC-4626 is the named example.
- [ ] Graph AI tooling: one-prompt → deployed pipeline recording (runs/<id>/manifest.json + uncut recording hash + transcript). **Pending A14 rehearsal + recorded run.**
- [x] Graph: open source w/ README + SKILL.md (packages/streamsmith/skills/streamsmith/SKILL.md).
- [x] Privy core + ≥1 wallet (business wallet q4zcqb7leopoj7hocdtqhbfe).
- [x] Privy ≥1 control: policy gghm9iorl3flfaybrqmlvisf + additional signer (docs/build/privy-spike.md).
- [ ] Privy ≥1 functional GA flow: real Earn deposit + withdraw on Base mainnet. **Pending wallet funding.**
- [ ] Privy B2B workflow demonstrated end to end (denied → allowed → executed). Denied part done live.
- [x] Commit history meaningful (60+ commits over Sept 9–11).
- [x] AI attribution: AI-USAGE.md; specs/ has prompts + briefs.
- [ ] Video shows: clean tag → one prompt → gate green → publish → deploy → receipt → MCP answer → refusal → Privy denied/allowed → tx hashes.

## Nice-to-have (only if time)
- [ ] Hosted Graph Market deployment live alongside self-managed (receipt already records deploymentMode honestly).
- [ ] Vaultpilot UI deployed (Vercel) with read-only cloud creds.
- [ ] Case study in skills-repo format committed (streamsmith casestudy).
