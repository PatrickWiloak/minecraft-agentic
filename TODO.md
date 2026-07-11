# TODO

Working task list for **minecraft-agentic**. Read this at the start of a work session and keep it current as work completes - check items off with a date, add follow-ups as they surface. Stale TODOs are worse than none. Security debt (if any) is tracked separately in `SECURITY-DEBT.md`.

---

## Open

- [ ] Verify one live Claude and OpenAI build once keys are available (code paths written, never exercised against the real APIs).
- [ ] Re-record the hero clip at higher fidelity if desired (current one is headless-captured at 640x360; a manual OBS capture with hand-driven camera would look even better). The 720p MP4 master lives outside the repo (scratchpad `deliverables/`).
- [ ] Before making the repo public: gitignore `graphify-out/` (public-repo rule), scan git history for secrets.
- [ ] Consider a shareable/hosted-tunnel option (e.g. one-liner to expose the local viewer) - only if there's real demand; keeps the "100% local" promise by default.
- [ ] Draft launch post (HN / Reddit r/Minecraft+r/programming / X) - the demo clip now exists.

## Done

- [x] ~~**"Clear ground" button in the web panel** - `POST /clear` bulldozes every used build site (plus the current site after a failed build) via chunked `/fill` air slabs and re-grasses the dug-up ground layer, resets the build grid to site 0. Confirm dialog, disabled while busy / when nothing's built. Verified live: cottage built then cleared, server logged 2,580 blocks aired + 1,774 grass re-laid, `built` reset to 0~~ ✅ done 2026-07-11
- [x] ~~**Single-URL web UI** - the control panel now reverse-proxies the prismarine viewer same-origin at `:8080/viewer/` (HTTP + websocket-upgrade tunnel; `startViewer` gained `prefix`/`quiet` options), so `npm run web` prints exactly one URL. Users were opening the bare `:3000` viewer and finding no prompt box. Verified: panel + viewer page + socket.io handshake through the proxy, websocket tunnel, and a full preset build (Willowbrook Cottage, 826 blocks)~~ ✅ done 2026-07-11
- [x] ~~**Web control panel (`npm run web`, `scripts/web.js`)** - persistent-crew HTTP server (built-in `http`, no new deps): a browser page with a prompt box + preset chips + live color-coded build log (SSE) + the viewer embedded in an iframe. Crew connects once and stays online; each build lands on a fresh grid patch. Graceful shutdown disbands the crew (SIGINT/SIGTERM) so quick restarts don't duplicate-login. Verified: page loads, `/status` + `/events` + `POST /build`, preset build (Willowbrook Cottage 827 blocks) and a live wizard-tower build, screenshotted~~ ✅ done 2026-07-11
- [x] ~~Dropped the other roadmap items per request (build queue/voting, more personalities, team competitions) - removed the Roadmap section from the README~~ ✅ done 2026-07-11
- [x] ~~**Live Gemini path verified end-to-end** - first-ever real LLM build: Gemini designed "Arasaka Cyberpunk Spire" (339 blocks) and the crew built it, 0 errors. Fixes needed to get there: (a) preflight `requireApiKey()` was Anthropic-only - now provider-aware (accepts any of gemini/claude/openai/ollama); (b) default Gemini model `gemini-2.0-flash` had free-tier `limit: 0` for this account - switched default to `gemini-flash-latest`; (c) hardened `parsePlan()` with a brace-extraction fallback for models that wrap JSON in prose~~ ✅ done 2026-07-11
- [x] ~~**Fixed the demo clip camera** - was swaying back-and-forth (recorder did `dir *= -1`); now a LOCKED overview during the build + a single-direction reveal orbit at the end. Re-recorded (2,937 blocks)~~ ✅ done 2026-07-11
- [x] ~~**Record a demo clip + embed at top of README** - recorded the crew building Stonewatch Keep (2,936 blocks) via headless Chromium capturing the live browser viewer; two-speed timelapse edit (14x build, 2.2x reveal); `docs/media/crew-castle-timelapse-640x360-11JUL2026.webp` (3.5MB animated WebP)~~ ✅ done 2026-07-11
- [x] ~~**Migrate the whole stack 1.20.4 -> 1.20.1** - prismarine-viewer only supports 1.20.1 exactly; on 1.20.4 block-state IDs shift and the browser view renders wrong blocks (stone bricks showed as beehives). Verified with an in-world rendered palette-grid screenshot: all preset blocks now render correctly~~ ✅ done 2026-07-11
- [x] ~~**Fix: port-open ≠ server-ready** - after `server:reset`, bots connected during world gen and died with EPIPE; `scripts/server.js` now waits for the current boot's `Done (…)!` log line~~ ✅ done 2026-07-11
- [x] ~~**Fix: `npm run play` with an arg crashed on import** - server.js validated its CLI command at import time; moved inside the direct-invocation guard~~ ✅ done 2026-07-11
- [x] ~~**play menu always shows the 4 presets** (with a key you can also type a custom idea); added MIT LICENSE + license field; README fully rewritten with hero clip, badges, FAQ~~ ✅ done 2026-07-11

- [x] ~~**Upgraded the built-in library builds** - gap-free circular masonry (`cyl`/`disc`/`cone` primitives fix the old ring-gapping bug), textured/weathered stone, round castle towers + moat + gatehouse arch, tapered 3-tier wizard tower with a glowing crown, timber-framed cottage with an overhanging roof + fenced garden, and a NEW 4th build: **Beacon Point Lighthouse**. Verified live: lighthouse placed 1161 blocks, zero errors~~ ✅ done 2026-07-11
- [x] ~~**Multi-provider LLM backend** (`src/providers.js`) - Gemini (free tier) / Claude / OpenAI / Ollama auto-detected from whichever key is set; an explicit `LLM_PROVIDER` with no key degrades to the library instead of crashing~~ ✅ done 2026-07-11
- [x] ~~Wire up the browser viewer (`src/viewer.js`) so anyone can watch without owning Minecraft; graceful fallback if `canvas` is missing~~ ✅ done 2026-07-10
- [x] ~~Rewrite README + add `docs/SETUP.md` (copy-paste setup, troubleshooting)~~ ✅ done 2026-07-10
- [x] ~~**End-to-end test against a live Docker server** - `npm run e2e` (1 bot) + `npm run replay` (full crew): bot(s) spawn, viewer serves HTTP 200, tavern built & 252 blocks verified in-world~~ ✅ done 2026-07-10
- [x] ~~**Fix: bots need OP to `/setblock`** - mount `docker/ops.json` (offline UUIDs) via compose; `npm run ops` regenerates it. The itzg `OPS` env does NOT work offline (online PlayerDB lookup fails, server won't boot). #1 silent-failure gotcha~~ ✅ done 2026-07-10
- [x] ~~**Added `npm run replay`** - full 4-bot crew builds a cached tavern with no API key (live-demo / regression path)~~ ✅ done 2026-07-10
- [x] ~~**One-command UX: `npm run play`** (`scripts/play.js` + `scripts/server.js`) - ensures the server is up (plain docker, no compose plugin) then runs the crew; cached tavern with no key, or `npm run play "prompt"` for a live Claude build. Verified cold-start (stopped→auto-start→build) and warm-start paths~~ ✅ done 2026-07-10
- [x] ~~**Fix: pin server to 1.20.4** (itzg defaults to latest = connect mismatch)~~ ✅ done 2026-07-10
- [x] ~~**Fix: viewer port-in-use crash** - `startViewer` now pre-checks the port and degrades gracefully~~ ✅ done 2026-07-10
- [x] ~~Streamline onboarding: `npm run setup`, `npm run server`, `src/preflight.js` friendly errors~~ ✅ done 2026-07-10
