# Architecture

How a prompt becomes a building, and why the pieces are shaped the way they are.
This is the front door; the exhaustive version - every invariant, with the bug that
earned it - lives in [CLAUDE.md](../CLAUDE.md).

## The pipeline

```
 "a wizard tower"
       │
       ▼
 coordinator.js ──── providers.js ────▶ Claude / Gemini / OpenAI / Ollama
       │                                (no key? src/library/ presets instead)
       ▼
   a plan of OPS            one line each: walls, cyl, cone, door, window, scatter...
       │
       ▼
   ops.js expandOps()       THE DOOR: clamps coords to the plot, caps volume,
       │                    validates block names vs the real 1.20.1 registry,
       ▼                    drops what it can't repair
   blocks, per role
       │
       ▼
   crew.js ──▶ 4 worker bots (mason → carpenter → decorator → landscaper)
       │        building in parallel via /setblock over Mineflayer
       ▼
   finishBuild(): the two self-correction loops
       ├─ REPAIR (repair.js, free)      "did the world accept it?"  re-place, then
       │                                 ask the model about physically-refused blocks
       └─ REVIEW (critic.js, opt-in)    "is it any good?"  screenshot the live viewer,
                                         show a vision model the photos + the plan's
                                         ASCII floor maps, apply its patch
```

Everything a model returns - ops, repair patches, critic patches - is **untrusted
input** and passes through a validating door (`expandOps` or `normalizePatch`) before
touching the world. This is a hard rule: `/setblock` discards an invalid block name
*silently*, so an unvalidated hallucination doesn't fail, it just leaves a hole nothing
in the log explains.

## Why ops, not blocks

The model designs in primitives (`walls`, `cone`, `window`), the same ones the
procedural library uses - `src/library/canvas.js` expands both. One op line expands to
hundreds of blocks (~28x compression), so the model spends its output budget on design
instead of enumeration. Measured on the same prompt: 74 blocks scoring 3/10 became
2,773 blocks scoring 10/10. The deeper win is that classes of mistake become
impossible: a `walls` op cannot have gaps, `door` always places both halves, `window`
carves and glazes in a single move so glass can never float where a hole wasn't cut.

## The crew is data

Each role is one JSON file in `src/profiles/` (name, personality, materials, hard
rules). `src/profiles.js` feeds the same file to both consumers: the bots that act it
out and the coordinator prompt that must respect it. **Profile order is the build
timeline** - support before supported. The mason owns everything load-bearing because
the roles build in parallel and a block whose support arrives later gets deleted by
the game.

## The world

A local Dockerized Minecraft **1.20.1** server (`scripts/server.js`), offline-mode, on
a raised superflat (surface y=63; normal terrain puts caverns under every plot). Bots
need op to use `/setblock` - granted by mounting `docker/ops.json` keyed by offline
UUIDs, because the normal `OPS` env var does an online lookup that fails for offline
accounts. `src/world.js` pacifies the world (peaceful, no mob griefing, no command
feedback) because idle-loaded chunks spawn endermen that mine the set, and command
feedback from 4 opped bots re-broadcasting ~160 chat packets/s times everyone out.

The version pin is exact: prismarine-viewer supports 1.20.1 *specifically*, and even a
1.20.4 server shifts block-state IDs enough that the browser renders wrong blocks.

## The browser view

`src/viewer.js` serves a prismarine-viewer web view; `scripts/web.js` proxies it so
the whole control panel (prompt box, log, 3D view) is one URL. The view binds to a
dedicated **stationary camera bot** (`src/camera.js`) - never to a builder - because
the viewer reloads chunk columns every time its bot crosses a chunk boundary, and a
teleporting builder froze sections mid-build (the world was right; the picture lied).
`scripts/patch-viewer.js` patches two upstream viewer bugs at install time (all stair
blocks invisible; chunk meshes deleted at the render-radius edge) - `npm test` fails
if the patch is missing.

## Verification without an API key

The test pyramid runs with no server, no browser, no key:

| Command | What it proves |
|---|---|
| `npm test` | click-to-place against the real viewer bundle, patch/ops doors, preset audit, viewer patch present |
| `npm run test:presets` | every preset simulated on the crew's real parallel schedule with vanilla physics (pops, gravity, door support) |
| `npm run test:loops` | repair/critic patch handling, provider truncation-vs-refusal, crew profiles |
| `npm run e2e` / `npm run replay` | live server, real placement, no key |
| `npm run test:viewer` | the browser received every block the crew placed |

The recurring theme: this codebase's failures are *silent* (an unopped bot places
nothing, a disconnected bot chats into the void, an oversized `/fill` is refused
without a word), so almost every test re-reads the world or the wire instead of
trusting a success counter.
