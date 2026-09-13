# A21 — Vaultpilot dashboard: never render a machine path

## Goal
The ledger footer of the dashboard prints the absolute filesystem paths of the snapshot and ledger files (`originDetail` in `apps/vaultpilot/web/lib/state.ts`, rendered in `web/app/components/Ledger.tsx`). Replace every such path with a repo-relative name (for example `apps/vaultpilot/.vaultpilot-snapshot.json`) or the bare file name, keeping the "written <timestamp>" part. The `/api/state` JSON must not contain an absolute path either. Add or adjust a unit test so a `/Users/`-style prefix can never come back.

## Constraints
Touch only `apps/vaultpilot/web/**` and its tests. No deployment of any kind. `pnpm -r test` green. Commit with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, then `git push origin main` (normal push). Do not stop any running process. No `/Users/...` strings in tracked files or the report.
