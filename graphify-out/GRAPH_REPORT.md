# Graph Report - minecraft-agentic  (2026-07-12)

## Corpus Check
- 41 files · ~183,993 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 387 nodes · 636 edges · 29 communities (21 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2d4084b4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 15 edges
2. `Builder` - 15 edges
3. `main()` - 14 edges
4. `ensureServerUp()` - 14 edges
5. `startViewer()` - 14 edges
6. `requireMinecraftServer()` - 13 edges
7. `isLiveProvider()` - 12 edges
8. `Worker` - 12 edges
9. `⛏️ Minecraft Agentic Builder` - 12 edges
10. `buildScene()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `startViewer()`  [EXTRACTED]
  scripts/web.js → src/viewer.js
- `buildCustom()` --calls--> `providerLabel()`  [EXTRACTED]
  scripts/play.js → src/providers.js
- `main()` --calls--> `listBuilds()`  [EXTRACTED]
  scripts/play.js → src/library/index.js
- `main()` --calls--> `detectProvider()`  [EXTRACTED]
  scripts/play.js → src/providers.js
- `main()` --calls--> `isLiveProvider()`  [EXTRACTED]
  scripts/play.js → src/providers.js

## Import Cycles
- None detected.

## Communities (29 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (21): assignments, carpenter, decorator, landscaper, mason, buildOrder, blocks, task (+13 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (35): dependencies, @anthropic-ai/sdk, dotenv, @google/generative-ai, mineflayer, mineflayer-pathfinder, openai, prismarine-viewer (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (13): 🔧 All the commands, Built by [Nobler Works](https://noblerworks.com/), ⚙️ Configuration, 🤝 Contributing, ❓ FAQ, 🏗️ How it works, 🎬 Making content with it, 🤖 Meet the crew (+5 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (31): createBot(), waitForSpawn(), Crew, main(), sleep(), demo(), DEMO_BUILDS, sleep() (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (39): backdropSpots(), broadcast(), buildScene(), clearAllSites(), clients, decoBeach(), decoCherry(), decoDesert() (+31 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (23): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (7): envPath, examplePath, keyMatch, major, ok, root, todo

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (6): __dirname, listPlans(), loadPlan(), runOfflineDemo(), sleep(), Worker

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (12): ALWAYS, Browser viewer, Codebase Invariants, Common Commands, Environment, graphify, Minecraft Agentic Builder, NEVER (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 12 - "Community 12"
Cohesion: 0.32
Nodes (16): containerState(), ensureServerUp(), g(), mcBootedInLogs(), PORT, portOpen(), quiet(), r() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 14 - "Community 14"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 15 - "Community 15"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (17): Browser viewer, Choosing an AI backend (for custom builds), Commands, Get a Google Gemini key (free - recommended), Get an Anthropic Claude key (paid - highest quality), Get an OpenAI key (paid), If the viewer didn't start, Option A - Docker (recommended) (+9 more)

### Community 23 - "Community 23"
Cohesion: 0.50
Nodes (3): Done, Open, TODO

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (5): DEFAULT_BOTS, extra, names, ops, outPath

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (30): getLibraryPlan(), listBuilds(), args, ask(), b(), buildCustom(), buildPreset(), c() (+22 more)

### Community 28 - "Community 28"
Cohesion: 0.28
Nodes (16): castle(), cottage(), _disc, discPoints(), finalize(), GENERATORS, lighthouse(), makeCanvas() (+8 more)

## Knowledge Gaps
- **163 isolated node(s):** `PreToolUse`, `allow`, `kiroAgent.configureMCP`, `name`, `version` (+158 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `startViewer()` connect `Community 3` to `Community 4`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `Builder` connect `Community 6` to `Community 3`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `allow`, `kiroAgent.configureMCP` to the rest of the system?**
  _163 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09863945578231292 - nodes in this community are weakly interconnected._