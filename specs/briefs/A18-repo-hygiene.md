# Brief A18 — Public repository hygiene pass

This repository is public. It must read as a project: design, code, evidence, limitations. It must not read
as a work log. Remove process narration from every tracked file and from the commit history, keep every
technical fact, and stop before anything is pushed.

## What to remove (from docs, briefs, evidence, and commit messages)

1. Narration of private conversation: third-person reports of what the owner said, approved or asked for;
   quoted instructions; chat-style asides.
2. Work-budget and quota bookkeeping: tool-usage percentages, spend ceilings, "stopped at N%", session
   wind-down notes.
3. Tooling assignments: which model ran which task, model-selection rules, coordination notes between the
   project level and individual workstreams, "agent report" framing.
4. Machine identity: absolute home-directory paths, hostnames, session scratchpad paths, local directory
   names outside the repo.
5. Session bookkeeping: resume pointers, context-window handoff notes, "read this first when you come back".
6. Host incidents unrelated to the project: free-space housekeeping, cache purges, tool interruptions, and
   inventories of what is on the machine outside the repo.
7. Secrets of any kind: passwords, tokens, wallet authorization keys, DSNs with real credentials, app secrets.

## What to keep

- Every technical fact, number, hash, block range, command, and design rationale — including the constraints
  that shaped the architecture (for example: too little free space for a local Rust build, which is why the
  package was built in CI). Keep the constraint and its numbers; drop the housekeeping around it.
- The honest AI-usage disclosure in `AI-USAGE.md`: the project was built with Claude Code and sub-agents
  working from human-written specifications, gates, and briefs; the human made the decisions. Say it once,
  plainly. Do not enumerate models or budgets.
- `Co-Authored-By` trailers on commits.
- Limitations and open items, rewritten as project facts ("Pending operator step: fund the treasury wallet")
  rather than narration ("blocked on <name>").
- The repository owner's handle is public; the name itself is not a secret. Third-person narration of the
  owner's instructions is what must go. Where a human role is needed, write "operator" or, in Vaultpilot's
  domain, "the treasurer".

## Preserve continuity before deleting

Before removing operational content from `docs/STATUS.md` and `docs/TASKS.md`, copy it verbatim into
`.notes/STATUS-internal.md`. Create `.notes/` and add it to `.gitignore` first. Include the whole resume
section and any standing-rules list.

## Inventory

Build a case-insensitive pattern list from the categories above — the owner's name, quota phrasings, model
names, session and scratchpad path prefixes, absolute home paths, handoff phrasings — and start from
`git grep -l -iE "<patterns>" -- . ':!pnpm-lock.yaml'`. Widen it as you read. Read each hit in full before
editing; the pattern list is a starting point, not the definition of the problem. Expect hits in
`AI-USAGE.md`, `docs/STATUS.md`, `docs/TASKS.md`, `docs/RECORDING.md`, `docs/build/*.md`,
`docs/research/*.md`, `feedback/*.md`, `specs/briefs/*.md`, and the JSON under `runs/`.

Watch for terms that match a pattern for an innocent reason — a protocol's own spending caps, a time budget
in a research note, a "gate orchestrator" in source. Reword only where a match would otherwise survive the
final check; never delete a technical fact to satisfy a regex.

## Evidence files under `runs/` and `receipts/`

Absolute paths inside JSON evidence must go, but some evidence files are hash-bound: before editing any file
under `runs/` or `receipts/`, compute its sha256 and `git grep` the hash (full and first 8 characters). If
the hash is referenced anywhere, do not edit that file; list it in the report as hash-bound with the
offending path, so it can be regenerated from a clean directory later. Never change numbers, hashes, or
block ranges in evidence.

## Commit-history rewrite

1. Back up first: a `backup/pre-hygiene` branch at `main`, and `git bundle create <scratchpad>/pre-hygiene.bundle --all`.
2. Install `git-filter-repo` (`brew install git-filter-repo`, or `pipx install git-filter-repo`). If neither
   works, use `git filter-branch --msg-filter ... --tag-name-filter cat -- --all`.
3. Rewrite every commit message that matches the removal list to a neutral technical message describing the
   change. Inspect `git show --stat <sha>` for each so the new message is accurate. Leave already-clean
   messages byte-identical. Keep `Co-Authored-By` trailers.
4. Offending messages to expect: session-handoff commits, work-in-progress commits that record why work
   stopped, commits announcing a tooling rule, and commits that fold host housekeeping into a docs change.
   Replace each with what the diff actually contains.
5. `git filter-repo` removes the `origin` remote as a safety measure; re-add it afterwards. Confirm the
   `contract-v1` tag was rewritten and still points at a commit with the same tree as before.
6. After the rewrite, find stale commit references in tracked docs (short SHAs such as the old `contract-v1`
   target and any "clean at <sha>" lines) and update them. Commit as
   `docs: refresh commit references after history rewrite`.

## Final checks

- `git grep` with the full pattern list returns nothing in tracked files.
- Run the repository scanner at `git-guardrail/scan.sh` (read its `SKILL.md` for usage) against the working
  tree and against `git log --format=%B`. Iterate until clean.
- `pnpm -r test` still passes (docs-only edits should not affect it; confirm anyway).
- `git status` clean.

## Do not

- Do not push or force-push. The rewrite stays local until the operator confirms.
- Do not delete evidence, change numbers, or weaken any statement about limitations.
- Do not remove the AI-usage disclosure; sharpen it.
- Do not touch anything under `.notes/`, `.env`, or other gitignored files beyond creating
  `.notes/STATUS-internal.md`.

## Report

1. Old → new message for every rewritten commit.
2. Files edited, one line each on what was removed.
3. Secrets scan result, with exact file and line if anything was found (redact the value).
4. Hash-bound evidence files skipped, with the offending content described.
5. Backup branch name and bundle path.
6. New SHAs for `main` HEAD and `contract-v1`, and confirmation that their trees match the pre-rewrite trees.
7. Test result and `git status`.
8. One line confirming nothing was pushed.
