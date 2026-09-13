# A20 — Stage the one-prompt recording

## Goal
Prepare everything for the recorded one-prompt run described in `docs/RECORDING.md` §A–B, so the operator only has to open Claude Code, paste `specs/prompt.md`, and record. Do not modify this repository; the staging lives outside it.

## Work
1. Create a sibling `streamsmith-recording` directory outside this repository, exactly as the rehearsal directory was built (read `docs/build/rehearsal-1.md` and `specs/briefs/A14-one-prompt-rehearsal.md`): `specs/`, `packages/streamsmith`, `packages/mcpgen`, workspace files, `.env` copied (gitignored). No `packages/erc4626-flows`, no `runs/`, no `receipts/`, no `docs/`. `pnpm install`. `git init`, one commit, tag `clean-start`.
2. In the fresh directory only, set the package version to `v0.1.1` wherever `streamsmith publish` reads it (find out from the CLI; v0.1.0 is already on the registry and duplicates are refused).
3. ClickHouse Cloud: create database `vaultflows_rec` with the same grants `vaultflows` has for the `sink` and `ro` users (mirror `system.grants`; admin credentials from `.env`). Point the fresh directory's `.env` so that the CLI's default self-managed deploy and views target `vaultflows_rec` (check how `deploy self-managed` and `deploy views` resolve DSN/database from env and `streamsmith.yaml`, and how the plugin `SKILL.md` tells the agent to invoke them). A default invocation must never touch `vaultflows` or `vaultflows_hosted`.
4. Copy the official skills into the fresh directory as `vendor/substreams-skills` (from this repo's gitignored `vendor/substreams-skills`, same commit) and gitignore it there. Validate both plugin directories with `claude plugin validate`. Do not launch `claude` itself.
5. Install `asciinema` (Homebrew). Confirm `substreams` auth and registry login work from the fresh directory with a read-only call. Confirm disk free ≥ 5 GB. Optionally warm the cargo registry cache with a scratch build outside both directories so the recorded build is not slowed by downloads.
6. Write `RECORDING-CHECKLIST.md` in the fresh directory: the exact launch command (`claude --model opus --plugin-dir vendor/substreams-skills --plugin-dir packages/streamsmith`), the on-camera preflight commands from `docs/RECORDING.md` §B1, the recorder commands, the prompt file path, and the post-run seal commands (`shasum -a 256` of the capture, `streamsmith manifest finish --recording <file>`, copying `runs/` and the receipt into this repo under `runs/recorded/`).

## Do not
Read or copy `packages/erc4626-flows` into the fresh directory. Commit or change anything in this repository. Run `claude` interactively or in print mode. Print credentials.

## Report
Fresh-directory tree summary and tracked file count; `clean-start` commit hash; version bump location; `vaultflows_rec` grants; how the default deploy resolves to `vaultflows_rec`; plugin validation output; tool versions; the launch command; anything that could not be completed.
