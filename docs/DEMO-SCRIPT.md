# Demo script

First person, spoken live over the screen capture. Speak at the beats, stay quiet in the waits, cut the waits in the edit (no speed-up). Numbers in brackets are read off the screen. Never say: yield, APY, share price, TVL, risk.

## Beat 1 — Intro and architecture (~45 s)

**Screen:** camera, then the README on GitHub scrolled to the architecture diagram.

**Say:** "Hi, I built Streamsmith. It turns one sentence into a live, verified data pipeline on The Graph, and then hands that data to an AI agent that's only allowed to act when everything checks out.

Here's the problem. AI can write a Substreams pipeline in minutes now. But nobody trusts a pipeline an AI wrote, because you can't tell if it's subtly wrong. Streamsmith makes that trust checkable.

Here's the whole system on one page. At the top, a human prompt. The official Substreams skills turn it into Rust code that has to match a frozen public contract. Then Streamsmith's promotion pipeline, the part I built: gate, publish, deploy, receipt, and MCP generation. Nothing gets past the gate without eighteen checks passing. Deploy lands the data in ClickHouse through The Graph. The receipt binds five hashes together, and the generated MCP server re-checks them every minute. If anything mismatches or the data goes stale, it refuses instead of answering. At the bottom, the payoff: Vaultpilot reads that MCP, decides, and acts through a Privy business wallet under a policy the owner set. Now let me build it from scratch."

## Beat 2 — The clean directory and the contract (~35 s)

**Type:**
```
cd streamsmith-recording
git status --porcelain
git rev-parse HEAD
git tag --points-at HEAD
date -u
ls specs/
```

**Say:** "Clean directory, tagged clean-start so anyone can verify. No pipeline code. This folder is the contract, and it's the only thing I wrote by hand. A schema that says what the data must look like. A config with the chain, the vault addresses and the sampling interval. And a gate file: eighteen checks against real blocks that must pass before anything ships. Streamsmith reads these three files and holds the AI to them. The AI never touches them; the prompt forbids it, and the gate verifies they're unmodified."

## Beat 3 — The prompt (~25 s)

**Type:**
```
set -a; source .env; set +a
claude --model opus --plugin-dir vendor/substreams-skills --plugin-dir packages/streamsmith
```

**Say:** "I'm opening Claude Code with two plugins. The official Substreams skills from StreamingFast teach it how to write the pipeline. Streamsmith teaches it how to prove the result is right."

Paste the quoted paragraph from `specs/prompt.md` as one message.

**Say:** "One instruction: build a pipeline for ERC-4626 vault activity on Base, match this schema, don't stop until the gate passes. Then I don't touch the keyboard."

## Beat 4 — Watching it work (say each line only when it happens)

- Manifest and Rust appear: "It's writing the manifest, the protobuf bindings, and the Rust modules from the contract."
- First build error: "A build error. It reads the compiler, fixes it, builds again. No human input."
- Gate starts: "Now the gate. Eighteen checks against real Base blocks where the correct answer is already known. Nothing ships until every one passes."
- Gate passes: "Green. Eighteen of eighteen."
- Publish: "It publishes to the Substreams registry as version 0.1.1."
- Deploy, rows landing: "Deploys the sink into ClickHouse. Rows landing within seconds of each block."
- Receipt: "And the Deployment Receipt. Module hash, parameters, schema, gate result, one file. This receipt is the whole idea. It says exactly what was verified and exactly what is running."
- If it stops with evidence instead: "It stopped with evidence instead of shipping something wrong. That's the feature." Keep recording.

## Beat 5 — The output (~20 s)

**Type:**
```
cat runs/CURRENT
ls receipts/ runs/$(cat runs/CURRENT)/
head -40 receipts/*.json
```

**Say:** "Receipt, gate evidence, deploy record, MCP manifest, all in the run folder. In rehearsal this took twenty-four minutes and eight builds with no human input after the prompt."

## Beat 6 — Ask the data, then the refusal (~40 s, main repo)

**Type** (in the main repository; `.env` supplies the read-only credentials so nothing is shown):
```
set -a; source .env; set +a
claude mcp add mcp-vaultflows -e CLICKHOUSE_URL=$CH_CLOUD_URL -e CLICKHOUSE_USER=$CH_CLOUD_RO_USER -e CLICKHOUSE_PASSWORD=$CH_CLOUD_RO_PASSWORD -e CLICKHOUSE_DATABASE=vaultflows_hosted -e BASE_RPC_URL=https://mainnet.base.org -- node packages/mcp-vaultflows/bin/server.js
claude mcp add mcp-vaultflows-stale -e MAX_LAG_BLOCKS=1 -e CLICKHOUSE_URL=$CH_CLOUD_URL -e CLICKHOUSE_USER=$CH_CLOUD_RO_USER -e CLICKHOUSE_PASSWORD=$CH_CLOUD_RO_PASSWORD -e CLICKHOUSE_DATABASE=vaultflows_hosted -e BASE_RPC_URL=https://mainnet.base.org -- node packages/mcp-vaultflows/bin/server.js
claude
```

Ask: *"Using mcp-vaultflows, compare observed-window share-value growth for the two approved Base vaults and show recent net flows."* Then: *"Ask mcp-vaultflows-stale the same question."*

**Say:** "From the receipt, Streamsmith generates a typed MCP server, so any agent can ask in plain language. Every answer carries provenance: which module hash, which block, how far behind head. Now the same question against a copy that only tolerates one block of lag. It refuses. No guess, no partial answer. A pipeline that refuses is the only kind I'd let an agent act on."

## Beat 7 — Vaultpilot (~55 s, main repo)

**Type:**
```
pnpm --filter @ethonline26/vaultpilot demo:denied
pnpm --filter @ethonline26/vaultpilot agent:once --source cloud
```
Then the dashboard at localhost:3000.

**Say:** "So what do you do with verified data? I built Vaultpilot, a treasury agent for a business wallet on Privy. I set the policy as the owner: two approved vaults, a per-action cap, deposit and withdraw only. The agent gets a key that can do nothing else.

First it tries an unapproved vault. Privy denies it at the policy layer, before any transaction exists.

Now the real decision on real data. The two vaults differ by [N] basis points of share-value growth over the observed window."

**If the deposit worked and the differential is above threshold:** "That's above my threshold. The data is fresh, the receipt matches, so it rotates: withdraw here, deposit there. Two real transactions on Base. The ten percent wrapper fee is on screen, not hidden."

**If the differential is below threshold:** "That's below my threshold, so the honest answer is hold, and the agent holds. It refuses to churn for nothing."

**If Privy's vaults were not accepting deposits at recording time:** "At recording time, Privy's Earn vaults for this app weren't accepting deposits, so the funded transaction is the one clip I couldn't show. The wallet, the policy, the denial and the decision are live."

**Dashboard:** "Every fact the agent used is on this screen: the observed windows with their block ranges, the guardrails, the policy, and the pipeline stamp carrying the same hashes as the receipt."

## Beat 8 — Close (~25 s)

**Screen:** the architecture diagram again, then a still with: GATE PASSED · outputModuleHash · head/lag · decision.

**Say:** "Everything you saw is public: the package on the registry, the repo, the receipts, the run evidence. Streamsmith makes AI-generated Substreams reproducible, and safe enough for an agent to act on. Describe the data you want. Get a tested, live pipeline with a receipt. And an agent that only moves when the receipt holds. Thanks for watching."

## Delivery notes

- Terminal font large, camera small. Judges read the terminal.
- Pause a full second after "It refuses."
- Read numbers off the screen.
- Cut the waits; never speed up footage.
