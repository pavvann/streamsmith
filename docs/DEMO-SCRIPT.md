# Demo script (3:30)

Spoken lines are short on purpose. Numbers in brackets are read off the screen at recording time. Never say: yield, APY, share price, TVL, risk.

## 0:00–0:18 — Cold open

**Screen:** empty directory, `git status` clean, tag `clean-start`, `date -u`. Then one slide: *One prompt. A verified Substreams pipeline, live and agent-ready.*

**Say:** "This directory holds a data contract and nothing else. No pipeline code. In the next three minutes, one sentence turns it into a live, verified pipeline on The Graph that an agent trusts with money."

## 0:18–0:58 — The prompt

**Screen:** Claude Code opens with the official Substreams skills and the Streamsmith plugin loaded. The prompt is pasted once. Fast cuts: manifest written, Rust modules appear, a build error, the fix, `streamsmith gate` running, `GATE PASSED 18/18`.

**Say:** "One human instruction, pasted once. The official Substreams skills teach the agent how to write the pipeline. Streamsmith teaches it how to prove the result is right. It writes the Rust, builds, fixes its own errors, then runs the gate: eighteen checks against real Base blocks where the correct answer is already known. Nothing is published until every check passes. In rehearsal this took twenty-four minutes and eight builds with no human input after the prompt. The uncut recording is linked."

## 0:58–1:28 — Published, deployed, receipted

**Screen:** the package page on substreams.dev; `streamsmith deploy status` with head block and lag; ClickHouse row counts climbing; the Graph Market deployment in state `DEPLOYED`; the receipt JSON with the hashes highlighted.

**Say:** "Green gate, so it ships. The package goes to the Substreams registry. The Graph runs it as a hosted sink into ClickHouse, and rows land within seconds of each block. Then Streamsmith writes a Deployment Receipt: module hash, parameters, schema, and the gate result, bound together in one file. That receipt is the whole idea. It states exactly what was verified and what is running."

## 1:28–1:58 — Ask the data, then the refusal

**Screen:** Claude with the generated MCP server attached. Question: *"Compare observed-window share-value growth for the two approved Base vaults and show recent net flows."* Typed answer with the provenance block. Then the freshness limit is forced to one block and the same question returns `stale_data`.

**Say:** "From the receipt, Streamsmith generates a typed MCP server, so any agent can ask in plain language. Every answer carries provenance: which module hash, which block, how far behind head. Now the data is stale. It refuses. No guess, no partial answer. A pipeline that refuses is the only kind an agent should be allowed to act on."

## 1:58–2:53 — Money moves, inside policy

**Screen:** Vaultpilot dashboard: the decision, the two observed windows with their block ranges, the differential in basis points, the policy card. Terminal: `demo:denied` returns the policy denial. Then `demo:rotate --execute`: Privy withdraw and deposit, two Basescan links, the position updates. The wrapper-fee disclosure is visible.

**Say:** "Vaultpilot is a treasury agent for a business wallet on Privy. The owner sets the policy: two approved vaults, a per-action cap, deposit and withdraw only. The agent holds a key that can do nothing else. First it tries an unapproved vault. Privy denies it at the policy layer, before any transaction exists. Then the real decision. Share-value growth over the observed window differs between the two vaults by [N] basis points, above the threshold; the data is fresh and the receipt matches, so it rotates. Withdraw here, deposit there. Two transactions on Base. The ten percent wrapper fee is on screen, not hidden."

**If the decision is hold:** "Today the two vaults differ by [N] basis points, below the threshold, so the honest decision is hold, and the agent holds. Here is the same flow as a deposit instead: one real transaction on Base, inside the same policy."

## 2:53–3:30 — Close

**Screen:** the architecture diagram centred on the receipt. Then the hold frame for three seconds: `GATE PASSED · outputModuleHash · head/lag · decision · Base tx hash`. Caption: **One prompt. Live pipeline. Money moved.**

**Say:** "Everything here is public: the package on the registry, the repo, the receipt, the uncut recording and its hash. Streamsmith makes AI-generated Substreams reproducible, and safe enough for an agent to act on. Describe the data you want. Get a tested, live pipeline with a receipt. And an agent that only moves when the receipt holds."

## Delivery notes

- Speak slower than feels natural. Pause one full second after "It refuses."
- Read every number off the screen; do not memorise them.
- If the gate fails on camera, keep the footage. Say: "It stopped with evidence instead of shipping something wrong. That is the feature." Then show the rehearsal pass.
- Keep the terminal font large. One idea per shot.
