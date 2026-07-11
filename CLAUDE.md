# Minecraft Agentic Builder

## Overview
AI agents that build Minecraft worlds autonomously while you watch. Claude generates a
shared build plan, then one or more Mineflayer bots place blocks to realize it. The
multi-agent "crew" mode spawns 4 specialized bots (mason, carpenter, decorator,
landscaper) that collaborate, each with its own personality and chat. Built primarily as
content-creation / research material (time-lapse build footage).

## Environment
- **Status**: Experimental / research project
- **Live URL**: N/A (runs against a local Minecraft server)
- **Cloud**: None (calls the Anthropic API directly)
- **Requires**: Minecraft Java Edition server **1.20.1** (version must match - bots target 1.20.1), `online-mode=false`, command blocks enabled, and **bot usernames opped** (see Codebase Invariants)

## Tech Stack
- Runtime: Node.js (ESM)
- Minecraft: `mineflayer` + `mineflayer-pathfinder` + `prismarine-viewer`
- AI: pluggable via `src/providers.js` - Claude (`@anthropic-ai/sdk`), Gemini (`@google/generative-ai`,
  free tier), OpenAI (`openai`), or local Ollama (HTTP). No key -> procedural `src/library/` builds.
  Provider auto-detected from whichever key is set; override with `LLM_PROVIDER`.
- Config: `dotenv`

## Browser viewer
`src/viewer.js` starts a `prismarine-viewer` web view (default `http://localhost:3000`) so anyone
can watch a build in a browser without a Minecraft client - the headline feature for open-source
appeal. It's opt-out via `VIEWER=off` / `--no-viewer` and port-configurable via `VIEWER_PORT`.
`startViewer(bot)` is called on the single bot in `demo.js`/`index.js` and on the first worker only
in `crew.js` (one shared view; all bots share the world). It never throws: the `prismarine-viewer`
import is dynamic and try/caught, so a missing/broken native `canvas` module degrades to
"watch in-game" instead of crashing the build. `canvas` is an `optionalDependency` for exactly
this reason - `npm install` must never hard-fail on it. Setup + fallback docs: `docs/SETUP.md`.

## Codebase Invariants
- **The bots build with `/setblock`, `/fill`, `/tp` - these require operator permission.** On a
  fresh dedicated server the bots connect but silently place nothing until opped. Because the server
  is `online-mode=false`, the itzg `OPS` env var does NOT work (it does an online PlayerDB lookup that
  fails for offline usernames and prevents the server from starting). Instead `docker-compose.yml`
  mounts `docker/ops.json`, a prebuilt ops list keyed by each bot's **offline UUID** (v3 MD5 of
  `OfflinePlayer:<name>`). Regenerate with `npm run ops` (`scripts/gen-ops.js`); a custom `MC_USERNAME`
  must be added (`npm run ops -- Name`) and the server restarted. #1 "why isn't it building" gotcha,
  verified end-to-end 2026-07-10 (full crew built 252 blocks in-world, no manual op).
- **Server version must be 1.20.1 - and 1.20.1 specifically, not just "any 1.20".** Two reasons:
  (1) the itzg image defaults to *latest* Minecraft; unpinned = bot connect mismatch. (2) prismarine-viewer
  supports 1.20.1 EXACTLY (its supported list jumps 1.20.1 -> 1.21.1); running 1.20.4 shifts block-state IDs
  vs the viewer's 1.20.1 assets, and the browser view renders wrong blocks (stone bricks showed as beehives,
  gray_concrete as gravel - found 2026-07-11 via a rendered-palette screenshot test). The server pin lives in
  `scripts/server.js` + compose; the bot pin in `src/bot.js`; both overridable with `MC_VERSION` (don't).
- **Port 25565 open ≠ server ready.** Docker's proxy binds the port the instant the container starts,
  minutes before a fresh world finishes generating - a bot connecting then dies with `EPIPE`.
  `scripts/server.js` therefore waits for the `]: Done (…s)!` line in the container logs (scoped to the
  current boot via `StartedAt`) before declaring the server up. Found 2026-07-11 via `server:reset` + play.
- `npm run e2e` (single bot) and `npm run replay` (full crew from cached plan) both verify the whole
  path - server, ops, viewer, block placement - against a live server with NO API key. Run one after
  changing bot connection, block placement, or the viewer.

## Common Commands
```sh
npm install
npm run play           # THE one command: ensures server is up, shows the build menu
                       #   (4 library presets always free; with a key you can also type any idea)
npm run play "a wizard tower"   # skip the menu - the AI designs it (needs a provider key in .env)

# play orchestrates these (usable directly):
npm run server         # start local server via scripts/server.js (plain docker, NO compose plugin needed)
npm run server:stop    # stop (world kept); server:reset wipes; server:logs tails
npm run replay         # full 4-bot crew from cached plan (no API key; assumes server up)
npm run e2e            # single-bot smoke test (no API key)
npm run ops            # regenerate docker/ops.json (offline-UUID operators)

npm run setup          # onboarding: creates .env, checks Node/Docker/server
npm run demo "a castle" # single-agent build (uses your AI key, or the library if none)
npm run offline        # offline demo (no Docker / no key)
```
AI backend: no key -> `src/library/` procedural builds; set GEMINI/ANTHROPIC/OPENAI key (or
`LLM_PROVIDER=ollama`) for custom prompts. `crew`/`play` with no key still build (from library).
In-game chat: `!build <description>`, `!stop`. Flags: `--sequential`, `--no-viewer`.
Note: `scripts/server.js` manages the container with plain `docker` (run/start/stop), so no
Compose plugin is required. `docker-compose.yml` is kept as an optional alternative.

## Project Structure
```
src/
  bot.js          Mineflayer bot connection
  builder.js      block placement logic
  worker.js       individual worker bot with personality
  coordinator.js  plans + assigns work across the crew (via providers, or library if no key)
  crew.js         multi-agent orchestration
  agent.js        single-agent build planning
  providers.js    LLM abstraction (claude/gemini/openai/ollama) + auto-detect + library fallback
  library/        procedural builds (castle/wizardTower/cottage/lighthouse) used when no AI key is set
  viewer.js       browser viewer (prismarine-viewer) with graceful fallback
  preflight.js    friendly checks (API key set, server reachable) before connecting
  e2e-test.js     end-to-end smoke test (no API key needed)
  crew-replay.js  full crew build from a cached plan (no API key)
  index.js        interactive CLI
  demo.js / multi-demo.js / offline-demo.js   demos
  plans/          cached build plans (e.g. tavern.json)
scripts/play.js     `npm run play` - the one command (server-up + build)
scripts/server.js   start/stop/reset the Docker server (plain docker, no compose)
scripts/setup.js    `npm run setup` onboarding helper
scripts/gen-ops.js  `npm run ops` - generates docker/ops.json (offline UUIDs)
docker-compose.yml  optional compose alternative to scripts/server.js
docker/ops.json     prebuilt operator list (bots need op for /setblock)
```

## Safety Guardrails
### NEVER
- Commit `.env` or the Anthropic API key (only `.env.example` belongs in git).
- Point the bots at a production / online-mode server.

### ALWAYS
- Keep `ANTHROPIC_API_KEY` in `.env` (gitignored).
- Be mindful of token spend in `crew` mode (4 bots = more model calls).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
