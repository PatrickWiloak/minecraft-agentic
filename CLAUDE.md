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
in `crew.js` (one shared view; all bots share the world). `scripts/web.js` starts it with
`{ prefix: '/viewer', quiet: true }` and reverse-proxies it (HTTP + the socket.io websocket upgrade)
so the whole web UI - prompt box, log, 3D view - is ONE url (`:8080`); the prefix works because the
viewer client derives its socket.io path from `location.pathname`. It never throws: the `prismarine-viewer`
import is dynamic and try/caught, so a missing/broken native `canvas` module degrades to
"watch in-game" instead of crashing the build. `canvas` is an `optionalDependency` for exactly
this reason - `npm install` must never hard-fail on it. Setup + fallback docs: `docs/SETUP.md`.

**`scripts/web.js` listens and opens the browser BEFORE it boots anything.** Startup (server ->
crew -> viewer) takes ~30-60s, and doing it first meant all of that progress existed only in the
terminal - the auto-opened browser landed on an already-finished panel. `main()` now calls
`server.listen()` + `openBrowser()` up front, then runs the boot as three broadcast steps, and the
page opens on a loading screen that renders them live with the SSE log tailed underneath. Two
constraints hold this together: boot state travels inside `publicState()` (not a separate event) so
a late connect or a mid-boot reload resolves correctly from a plain `GET /status`, and the viewer
iframe must NOT be given a `src` until boot completes - `VIEWER_PORT` isn't chosen until then, so an
eager load just pins the iframe to the proxy's 502 page. Anything added to the boot path belongs in
the `boot.steps` list, or it goes back to being invisible outside the terminal.

**The 3D pane keeps its own preloader AFTER boot - dismissed on real mesh progress, never on the
iframe's `load` event.** `load` fires when the viewer's HTML arrives, which is 10-40s before the
world has streamed and meshed; hiding the cover there left a black pane that read as frozen (user
report, 2026-07-30). The overlay (`.vload` + `showVload()`/`pollVload()` in the page) instead
watches actual readiness through the same-origin iframe: the injected hook (`src/viewer-hook.js`)
collects the viewer's three.js scenes on `window.__scenes` (pinned by `npm test`), the parent polls
the biggest scene's child count - one child per meshed chunk section, the sky's cube-map scene
stays tiny so max() skips it - and dismisses when meshing settles (>=24 sections, 2.5s no growth),
with a timeout so the viewer-unavailable fallback page is never trapped behind it. Progress stages
are honest: HTML loaded -> `__cam` parked (first to-screen render) -> section count asymptote. The
same overlay covers scene-travel reloads (`reframeViewer`).

## The two self-correction loops (added 2026-07-14)
After the last block lands, `Crew.finishBuild()` runs two passes that answer two different
questions. They are ordered, and the order is load-bearing: a build with holes in it photographs
badly, so a critic shown a half-finished structure spends its whole patch fixing damage the free
pass would have fixed. **Fix what's broken, THEN ask whether it's any good.**
- **REPAIR (`src/repair.js`, free, always on) - "did the world accept it?"** `verifyBuild` already
  found the blocks that never landed and did nothing but print the count. Now they are re-placed
  (y-ascending, by their owning role). **If a round fixes zero blocks, STOP** - those blocks are not
  dropped commands, they are physically illegal (a torch on air, a door with no floor, gravel over
  water), and a third identical `/setblock` is refused identically. Escalate instead: with a live
  provider, the model is shown each failure *with the reason the game refused it* (what is at the
  coord now, what is under it) and returns a patch. Borrowed from Voyager.
- **REVIEW (`src/critic.js`, costs a vision call, opt-in via `CRITIC=on` or the panel's checkbox) -
  "is it any good?"** The game has no opinion about a tower with no windows. `src/shot.js` drives a
  headless browser against the live viewer, orbits it for 3 angles, and the model gets the pictures
  **next to `planDigest()`'s ASCII floor maps of its own plan**. Both halves are required: given only
  the plan the model re-reads its own homework and approves it; given only a photo it can describe
  the flaw but cannot say WHERE it is. Borrowed from APT.
- **The critic's shot must be FRAMED on the build, or the model critiques the lawn.** The browser's
  orbit camera looks at the camera bot from 20 up / 20 south, so that bot's position IS the centre
  of the picture - and during a build it stands at the CORNER of the site (`aimCamera`), because at
  that point there is nothing to centre on yet. `Crew.frameBuild()` re-parks it on the plan's
  bounding-box centre before the shot, **in all three axes**. Both halves were found by looking at
  the actual PNGs: parked at the origin, the tower sat in the corner of an acre of grass, half out
  of frame; then parked at ground level, the shot aimed at the tower's FEET and the whole top half
  (32-block build) fell off the top of the frame. This is the one moment it is safe to move the
  camera - the last block has landed and the next build hasn't started. Pinned by `npm run test:loops`.
- **Every patch from a model is untrusted input - and it is exactly as untrusted as an op, so it
  goes through the same three checks `expandOps` makes.** `normalizePatch()` is the only door: it
  converts plan-relative coords to world-absolute (get that backwards and the fix lands on the
  neighbouring plot), **clamps them to the plot in the RELATIVE frame first** (clamping world
  coordinates against plot-relative bounds would land the whole patch on the origin), **validates
  the block name against the real 1.20.1 registry via `normalizeType`** - repairing near-misses
  (`stone_brick` -> `stone_bricks`) and dropping hallucinations, since `/setblock ...
  minecraft:wooden_plank` is discarded by the server without a word and the hole it was meant to
  fix just stays - coerces unknown roles, and **drops any entry with no block type** (that one goes
  out as `minecraft:undefined`). The name check and the clamp were missing here for as long as
  `expandOps` had them; added 2026-07-29. `npm run test:loops` pins all of it.
- A patch is applied to the **PLAN**, not just the world (`applyPatch`), so the next `verifyBuild`
  holds the patched design to account too. The design is what improved, not just the output.

## The model designs in OPS, not in blocks (added 2026-07-14)
**The presets were never better because a human designed them - they were better because a human
gave them PRIMITIVES.** A preset says `walls(...)` and gets 400 gap-free blocks; the model was
asked for that same wall as a JSON array with one object per block, ~11 tokens each. A 900-block
build is then ~10k tokens of pure mechanical enumeration and the castle (3,338 blocks) is ~38k -
which no output budget could buy. So the model did what anyone would when told to enumerate
thousands of tedious items: it shortcut, returning **74 blocks with holes in the walls**, and our
own critic scored it **3/10** and was right.
- `src/ops.js` gives the model the SAME primitives, via `src/library/canvas.js` (extracted from
  the library so presets and AI builds are expanded by identical code). An op is one line and
  expands to hundreds of blocks (~28x compression), so the model can finally afford the scale we
  ask for and spends its budget on DESIGN instead of typing. Same prompt, measured: **74 blocks /
  3/10 -> 2,773 blocks / 10/10, 0 missing.**
- **The point is not compression, it is that the old mistakes become IMPOSSIBLE.** A `walls` op is
  gap-free by construction; `door` always places both halves; `cone` orients its own stair
  shingles. Every rule this crew learned the hard way used to be *requested in prose* and
  reproduced by hand hundreds of times without a slip. Now it is enforced once, in code.
- **If a rule needs two ops to AGREE, make it one op.** Glazing was `punch` the wall + place the
  glass, and the model got the two coordinate sets subtly out of step: the live 10/10 build had
  **panes of glass floating in mid-air outside the tower**, which the critic never mentioned. The
  `window` op now carves and glazes in one move, and glazes ONLY coordinates where a wall was
  really removed (`canvas.punch` returns what it removed) - so a window aimed at thin air is a
  no-op instead of a floating cube. `door` was already this shape; `window` is the same lesson.
- **Every op is UNTRUSTED INPUT** - the same job `normalizePatch` does in `repair.js`. `expandOps`
  is the only door: it clamps coords to the plot (or the fix lands on the neighbour's build),
  refuses a runaway op outright (clamping a world-sized `box` still fills the plot solid), caps the
  total, coerces unknown roles, drops unknown ops - and **validates block names against the real
  1.20.1 registry**, repairing near-misses (`stone_brick` -> `stone_bricks`) and dropping the rest.
  A hallucinated name is the quietest failure in the project: `/setblock` discards it without a
  word, leaving holes nothing in the log explains. A model that ignores the format and returns raw
  BLOCKS is converted to `put` ops and goes through the same door.
- **The op reference in the coordinator's prompt is GENERATED from the `OPS` table**, so the prompt
  cannot describe an op that does not exist or miss one that does.
- **The worked example (`src/plans/reference-ops.json`) is the most-copied build in the project** -
  it is shown to the model on EVERY request, so if it degrades, every AI build degrades with it. It
  is therefore audited on the same parallel-physics simulator as the thirteen presets
  (`npm run test:presets`), and writing it flushed out two real bugs the audit caught before any
  model ever saw it: flowers scattered onto ground that `executeBuild` had cleared to air, and a
  door hung before the mason's foundation reached it. Pinned by `npm run test:ops`.

## Codebase Invariants

**Full text - each invariant with the incident that produced it, the proof, and the file that owns the rule now: [docs/INVARIANTS.md](docs/INVARIANTS.md).** Read it before changing build, fill, planning or the self-correction loops. The rules:

- **`/fill` caps at 32,768 blocks per command and refuses anything larger SILENTLY - so nothing in this project may issue a raw `/fill` over a region it has not bounded.**
- **Three things make a model call fail while looking like the model "refused to answer", and both of the first two were live bugs on 2026-07-14.**
- **The crew is DATA (`src/profiles/*.json`), and the profile order IS the build timeline.**
- **`bot.chat()` on a disconnected bot is a SILENT no-op - it does not throw.**
- **Bots need a long keepalive timeout (`checkTimeoutInterval`, 120s - `MC_TIMEOUT`).**
- **Two panels cannot share a server.**
- **The bots build with `/setblock`, `/fill`, `/tp` - these require operator permission.**
- **The world is a RAISED superflat - solid rock from bedrock to a grass surface at y=63 - and the layer heights are load-bearing.**
- **Server version must be 1.20.1 - and 1.20.1 specifically, not just "any 1.20".**
- **Port 25565 open ≠ server ready.**
- **A disconnected bot places blocks into the void, silently.**
- **The world must be pacified or it eats the set.**
- **Roles overwrite each other: `/setblock` REPLACES, and the crew builds mason -> carpenter -> decorator -> landscaper.**
- **Build order is a TIMELINE, not just a z-order - and the site is aired out before anyone starts.**
- **A worker's block list may be REORDERED for the camera, but only within a y layer.**
- **The browser view must be bound to a bot that NEVER MOVES, or it renders a lie.**
- **How far the browser can see has TWO ceilings, and the lower one wins.**
- **The browser only learns where to point from a bot `move` event - and the camera bot never moves.**
- **A browser tab can silently miss ENTITY events, leaving builders drawn floating at stale mid-hop positions - so `startViewer()` re-announces every entity too.**
- **The view must be aimed at the SITE, not the plot.**
- **prismarine-viewer's BROWSER bundle never touches `window` - not even for THREE.**
- **The world outlives the process - and BOTH halves of the panel's site logic have now been burned by forgetting it.**
- **The world outlives the process; `state.sceneSites` does not.**
- **prismarine-viewer ships with a bug that makes EVERY STAIR BLOCK invisible in the browser - and this project patches it at install AND at startup.**
- **prismarine-viewer also DELETES a chunk's meshes the instant it slides out of the camera's radius - which made the plot's perimeter blink at every build start - and this project patches that too.**
- **The crew builds in PARALLEL (role i starts at i*3000ms, ~10 blocks/s), so "a later role overwrites an earlier role's block" is a RACE, not a technique - and the earlier role usually wins.**
- **`npm run e2e` (single bot) and `npm run replay` (full crew from cached plan) both verify the whole path - server, ops, viewer, block placement - against a live server with NO API key**
- **`npm test` (`test/pick-ground.test.mjs`) covers click-to-place, the one feature that depends on prismarine-viewer's internals**
## Common Commands
```sh
npm install
npm run play           # THE one command: ensures server is up, shows the build menu
                       #   (13 library presets always free; with a key you can also type any idea)
npm run play "a wizard tower"   # skip the menu - the AI designs it (needs a provider key in .env)
npm run web            # browser control panel (scripts/web.js) - persistent crew + prompt/watch UI at :8080

# play orchestrates these (usable directly):
npm run server         # start local server via scripts/server.js (plain docker, NO compose plugin needed)
npm run server:stop    # stop (world kept); server:reset wipes; server:logs tails
npm run server:recreate # rebuild the CONTAINER, keep the world - the ONLY way a changed server
                       #   setting (VIEW_DISTANCE, MEMORY) takes effect; docker bakes -e at run
npm run replay         # full 4-bot crew from cached plan (no API key; assumes server up)
npm run e2e            # single-bot smoke test (no API key)
npm test               # click-to-place + agent loops + preset audit (no browser, no server, no key)
npm run test:loops     # repair/critic patch handling, crew profiles, blueprint format (no server)
npm run test:presets   # simulate every preset on the crew's real parallel schedule (no server)
npm run test:viewer    # does the BROWSER see what the crew built? (needs a server, no key)
npm run ops            # regenerate docker/ops.json (offline-UUID operators)
npm run record         # record a timelapse clip from a RUNNING `npm run web` (needs ffmpeg + playwright);
                       #   writes a date-stamped .mp4 master + compressed .webp. NOTE: the README's hero
                       #   media is SCREENSHOTS of finished builds (docs/media/crew-*.png) as of 2026-07-14 -
                       #   the software-GL + webp-compressed footage reads much worse than stills

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
  worker.js       individual worker bot with personality (loaded from profiles/)
  profiles/       THE CREW AS DATA - one JSON per role (name, phrases, materials, hard rules).
  profiles.js       Feeds both the bots and the coordinator's prompt. Order = build timeline.
  coordinator.js  plans + assigns work across the crew (via providers, or library if no key).
                  Its team paragraph is GENERATED from profiles/, and it shows the model a
                  matching library preset as a worked example (pickExample; FEWSHOT=off)
  crew.js         multi-agent orchestration + finishBuild() (the two loops below)
  repair.js       REPAIR loop: re-place what never landed; ask the model why the rest won't
                  stay. Also owns normalizePatch/applyPatch - the ONLY door for model patches
  critic.js       REVIEW loop: show the finished build to a vision model, apply its patch
  shot.js         headless-browser screenshots of the live viewer (Playwright, optional)
  digest.js       planDigest() - a plan as one ASCII floor map per y layer. The blueprint both
                  loops hand to the model; also the coordinator's few-shot example format
  agent.js        single-agent build planning
  providers.js    LLM abstraction (claude/gemini/openai/ollama) + vision (completeVision/
                  supportsVision) + auto-detect + library fallback. extractClaudeText/
                  extractOpenAIText are the truncation-vs-refusal decision, per provider
  fill.js         fillRegion/fillPlan/clearForPlan - /fill caps at 32768 blocks and is refused
                  SILENTLY above it, so the split lives here and everything clearing ground uses it
  json.js         parseJsonish() - the one fence-tolerant JSON extractor for model replies
  library/        procedural builds (13 presets: castle, wizard tower, cottage, lighthouse,
                  windmill, pagoda, ship, desert temple, observatory, mushroom house,
                  treehouse, hot-air balloon, rocket pad) used when no AI key is set
  viewer.js       browser viewer (prismarine-viewer) with graceful fallback; viewerUrl()
  viewer-hook.js  the three.js devtools handshake - the only way to reach the viewer's camera
                  from outside its bundle. Injected by web.js (click-to-place + the viewer
                  preloader's mesh-progress signal via __scenes) AND shot.js
  camera.js       the stationary bot the viewer renders from (a moving one freezes chunks)
  world.js        pacifyWorld() - peaceful, no mob griefing/fire/weather, no command-feedback spam
  preflight.js    friendly checks (API key set, server reachable) before connecting
  e2e-test.js     end-to-end smoke test (no API key needed)
  crew-replay.js  full crew build from a cached plan (no API key)
  index.js        interactive CLI
  demo.js / multi-demo.js / offline-demo.js   demos
  plans/          cached build plans (e.g. tavern.json)
scripts/play.js     `npm run play` - the one command (server-up + build)
scripts/web.js      `npm run web` - persistent-crew web control panel (http + SSE, embeds the viewer)
scripts/record-demo.mjs  `npm run record` - drives a headless browser against a running panel and
                    cuts the two-speed timelapse (build fast, reveal orbit slow). Camera is ORBITED,
                    never panned/dollied mid-build, and it refuses to publish an unfinished build.
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
