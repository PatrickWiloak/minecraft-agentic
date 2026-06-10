# Graph Report - minecraft-agentic  (2026-06-09)

## Corpus Check
- 26 files · ~14,460 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 190 nodes · 216 edges · 22 communities (14 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d2ec166`
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

## God Nodes (most connected - your core abstractions)
1. `Builder` - 15 edges
2. `Worker` - 12 edges
3. `What You Must Do When Invoked` - 11 edges
4. `/graphify` - 10 edges
5. `Minecraft Agentic Builder` - 9 edges
6. `createBot()` - 7 edges
7. `waitForSpawn()` - 7 edges
8. `Crew` - 7 edges
9. `graphify reference: extra exports and benchmark` - 7 edges
10. `BuilderAgent` - 6 edges

## Surprising Connections (you probably didn't know these)
- `demo()` --calls--> `createBot()`  [EXTRACTED]
  src/demo.js → src/bot.js
- `main()` --calls--> `createBot()`  [EXTRACTED]
  src/index.js → src/bot.js
- `demo()` --calls--> `waitForSpawn()`  [EXTRACTED]
  src/demo.js → src/bot.js
- `main()` --calls--> `waitForSpawn()`  [EXTRACTED]
  src/index.js → src/bot.js

## Import Cycles
- None detected.

## Communities (22 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (21): assignments, carpenter, decorator, landscaper, mason, buildOrder, blocks, task (+13 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (18): dependencies, @anthropic-ai/sdk, dotenv, mineflayer, mineflayer-pathfinder, prismarine-viewer, description, devDependencies (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (16): 1. Set up a Minecraft Server, 2. Install Dependencies, 3. Configure Environment, 4. Run the Demo, Architecture, Configuration, Content Ideas, For Content Creation (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (8): BuilderAgent, createBot(), waitForSpawn(), demo(), DEMO_BUILDS, sleep(), main(), PERSONALITIES

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (5): Coordinator, Crew, DEMO_BUILDS, multiAgentDemo(), sleep()

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (14): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.20
Nodes (9): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Usage (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (5): graphify, Minecraft Agentic Builder, Quick Start, Requirements, Status

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 12 - "Community 12"
Cohesion: 0.53
Nodes (5): __dirname, listPlans(), loadPlan(), runOfflineDemo(), sleep()

### Community 13 - "Community 13"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 14 - "Community 14"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 15 - "Community 15"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

## Knowledge Gaps
- **93 isolated node(s):** `PreToolUse`, `kiroAgent.configureMCP`, `name`, `version`, `description` (+88 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Builder` connect `Community 6` to `Community 3`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `Worker` connect `Community 8` to `Community 3`, `Community 4`, `Community 12`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `kiroAgent.configureMCP`, `name` to the rest of the system?**
  _93 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._