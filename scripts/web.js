#!/usr/bin/env node
// `npm run web` - a browser control panel for the crew.
//
// Unlike `npm run play` (a one-shot CLI build), this starts a PERSISTENT crew: the
// four bots connect once and stay connected, and a web page lets you submit prompt
// after prompt and watch each build appear - the viewer embedded right on the page.
//
//   npm run web         # open http://localhost:8080
//
// No key -> preset buttons (castle/tower/cottage/lighthouse) build from the free
// library. With a key -> type any prompt and the AI designs it. Each build lands on
// a fresh patch of ground so you end up with a little gallery.
import 'dotenv/config';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureServerUp } from './server.js';
import { Crew } from '../src/crew.js';
import { startViewer } from '../src/viewer.js';
import { detectProvider, isLiveProvider, providerLabel } from '../src/providers.js';
import { listBuilds } from '../src/library/index.js';
import { Vec3 } from 'vec3';

const WEB_PORT = parseInt(process.env.WEB_PORT || '8080', 10);
// The viewer's port is internal - the page only ever talks to WEB_PORT and we
// reverse-proxy /viewer/ to this. It's a `let` because if the preferred port is
// taken (a stale process, a second panel), we roll to the next free one rather
// than silently disabling the viewer for the whole session.
let VIEWER_PORT = parseInt(process.env.VIEWER_PORT || '3000', 10);

// First free port at/after `from`, so a busy 3000 can never kill the browser view.
async function findFreePort(from) {
  for (let p = from; p < from + 20; p++) {
    const free = await new Promise((resolve) => {
      const t = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => t.close(() => resolve(true)))
        .listen(p, '127.0.0.1');
    });
    if (free) return p;
  }
  return from;
}

// Pop the control panel in the default browser once the server is up. Opt out
// with --no-open or NO_OPEN=1 (e.g. on headless boxes). Tries each opener in
// order and gives up silently - the printed URL always works as a fallback.
function openBrowser(url) {
  if (process.env.NO_OPEN === '1' || process.argv.includes('--no-open')) return;
  const isWSL = process.platform === 'linux' && /microsoft/i.test(os.release());
  const openers =
    process.platform === 'darwin' ? ['open'] :
    process.platform === 'win32' ? ['start ""'] :
    isWSL ? ['wslview', 'explorer.exe', 'xdg-open'] :   // WSL: hand off to the Windows default browser
    ['xdg-open', 'sensible-browser'];
  const tryNext = (i) => {
    if (i >= openers.length) return;
    exec(`${openers[i]} "${url}"`, (err) => {
      // explorer.exe opens the browser but still exits non-zero - don't cascade
      // after it, or we'd open a duplicate tab. (127 = command not found: DO cascade.)
      if (err && openers[i] === 'explorer.exe' && err.code !== 127) return;
      if (err) tryNext(i + 1);
    });
  };
  tryNext(0);
}

// --- live log fan-out (Server-Sent Events) -------------------------------------
const clients = new Set();          // open SSE responses
const logBuffer = [];               // recent lines, replayed to new clients
const MAX_BUFFER = 300;

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch { /* dropped */ } }
}
function pushLog(text) {
  for (const raw of String(text).split('\n')) {
    const s = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();   // strip ANSI colour
    if (!s.trim()) continue;
    logBuffer.push(s);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
    broadcast({ type: 'log', line: s });
  }
}
// Tee console output to the web log while keeping the terminal output intact.
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    try { pushLog(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); } catch { /* noop */ }
  };
}

// --- scenes ----------------------------------------------------------------------
// A "scene" is a CONSTRUCTED pretty starting point, not a trip into the messy real
// world. Each is built in place at the home spawn as a clean, flat, self-contained
// platform: a solid encasing base (so no caves/ravines poke through underneath), a
// themed surface, and tasteful backdrop decoration around the edges - leaving the
// centre flat and clear to build on. `ground` = the surface block (also used to
// level individual build sites); `support` = the non-gravity block that encases the
// base; `decorate` = optional edge dressing (water, trees, peaks...).
const SCENES = {
  spawn:     { label: 'Plains',      ground: 'grass_block', support: 'stone',     decorate: decoPlains },
  beach:     { label: 'Beach',       ground: 'sand',        support: 'sandstone', decorate: decoBeach },
  desert:    { label: 'Desert',      ground: 'sand',        support: 'sandstone', decorate: decoDesert },
  mountains: { label: 'Mountains',   ground: 'grass_block', support: 'stone',     decorate: decoMountains },
  snowy:     { label: 'Snowy',       ground: 'snow_block',  support: 'stone',     decorate: decoSnowy },
  jungle:    { label: 'Jungle',      ground: 'grass_block', support: 'stone',     decorate: decoJungle },
  cherry:    { label: 'Cherry Grove', ground: 'grass_block', support: 'stone',    decorate: decoCherry },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every scene's walkable surface sits at this fixed height. Building at a constant
// Y (rather than wherever the crew happens to stand) keeps scenes predictable and
// above sea level, so water never seeps in and the platform reads as a clean raised
// clearing regardless of the natural terrain it replaces.
const STAGE_Y = 72;

// --- build state ----------------------------------------------------------------
const state = {
  provider: detectProvider(),
  live: isLiveProvider(),
  providerLabel: providerLabel(),
  busy: false,
  phase: 'idle',            // idle | planning | building | clearing | traveling | done | error
  last: null,               // { name, blocks, prompt }
  buildCount: 0,
  background: 'spawn',
  builtScenes: new Set(),   // scenes constructed this session (or detected pre-built)
  sceneBuildCounts: {},     // per-scene build-grid position, so each plot keeps its own gallery
};
function setPhase(phase, extra = {}) {
  state.phase = phase;
  Object.assign(state, extra);
  broadcast({ type: 'status', ...publicState() });
}
function publicState() {
  return {
    provider: state.provider, live: state.live, providerLabel: state.providerLabel,
    busy: state.busy, phase: state.phase, last: state.last, built: state.buildCount,
    background: state.background,
  };
}

let crew, baseOrigin, SPAWN;

// Park each bot on its own spot along the front edge of the site - all four on
// one block renders as a single bot in the viewer. Teleports fire in parallel.
async function formation(o) {
  await Promise.all(crew.activeWorkers.map((w, i) => w.teleportTo(o.x - 2 + i * 8, o.y, o.z - 6)));
}

// A tidy grid of build sites so successive builds don't overlap. Kept to 3x3 so
// every site lands on the constructed scene platform (which is sized to match).
function nextOrigin() {
  const col = state.buildCount % 3, row = Math.floor(state.buildCount / 3) % 3;
  return { x: baseOrigin.x + col * 40, y: baseOrigin.y, z: baseOrigin.z + row * 40 };
}

async function runBuild({ prompt, preset }) {
  if (state.busy) throw new Error('A build is already running.');
  state.busy = true;
  const label = preset ? `preset:${preset}` : prompt;
  setPhase('planning', { last: null });
  console.log(`\n[Web] Build request: "${label}"`);

  // Presets always come from the free library, even if an AI key is set. Force it
  // for the duration of this build, then restore the user's provider.
  const savedProvider = process.env.LLM_PROVIDER;
  const savedLibrary = process.env.LIBRARY_BUILD;
  if (preset) { process.env.LLM_PROVIDER = 'library'; process.env.LIBRARY_BUILD = preset; }

  try {
    for (const w of crew.activeWorkers) w.blocksPlaced = 0;   // per-build count
    const origin = nextOrigin();
    // Flatten a platform first so the build sits level on any terrain (mountainside,
    // beach dunes...). Teleport the lead there first - /fill needs loaded chunks.
    const lead = crew.activeWorkers[0];
    await lead.teleportTo(origin.x + 16, origin.y, origin.z + 16);
    await levelSite(lead.bot, origin);
    setPhase('building');
    const plan = await crew.executeBuild(prompt || 'a surprise build', { origin });
    const blocks = crew.activeWorkers.reduce((s, w) => s + w.blocksPlaced, 0);
    state.buildCount++;
    state.sceneBuildCounts[state.background] = state.buildCount;   // remember this plot's gallery size
    setPhase('done', { last: { name: plan.name, blocks, prompt: label } });
    console.log(`[Web] Done: "${plan.name}" (${blocks} blocks)`);
  } catch (err) {
    console.error(`[Web] Build failed: ${err.message}`);
    setPhase('error', { last: { name: 'Build failed', blocks: 0, prompt: err.message } });
  } finally {
    if (preset) {
      if (savedProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = savedProvider;
      if (savedLibrary === undefined) delete process.env.LIBRARY_BUILD; else process.env.LIBRARY_BUILD = savedLibrary;
    }
    state.busy = false;
    // Keep the terminal phase ('done' or 'error') so the result stays on screen
    // until the next build starts - just broadcast that we're no longer busy.
    broadcast({ type: 'status', ...publicState() });
  }
}

function groundBlock() {
  return (SCENES[state.background] || {}).ground || 'grass_block';
}

// The scene platform spans the 3x3 build grid (sites at +0/+40/+80 from the anchor,
// each up to +39) plus a decorative margin.
function sceneBounds(o) {
  return { x0: o.x - 16, x1: o.x + 128, z0: o.z - 16, z1: o.z + 128 };
}

// Each scene lives on its OWN permanent plot, laid out in a row from the world
// spawn. Because the Minecraft world is saved to disk, a scene built once stays
// built forever - revisiting it is just a teleport, no rebuild.
function plotAnchor(id) {
  const i = Math.max(0, Object.keys(SCENES).indexOf(id));
  return { x: SPAWN.x + i * 320, y: STAGE_Y, z: SPAWN.z };
}

// Has this plot already been constructed (this session or a previous one)? Signature
// check that natural terrain won't match: the themed ground sits at EXACTLY o.y-1
// with air just above, over the encasing support block. Waits for the plot's chunk
// to stream in first (a freshly-teleported bot reads null until it loads), so a
// scene built in a PRIOR session is still recognised on restart.
async function isSceneBuilt(bot, o, sc) {
  const at = (y) => { try { const b = bot.blockAt(new Vec3(o.x + 20, y, o.z + 20)); return b && b.name; } catch { return null; } };
  for (let i = 0; i < 20; i++) {          // up to ~5s for the chunk to load
    if (at(o.y - 1) !== null) break;
    await sleep(250);
  }
  return at(o.y) === 'air' && at(o.y - 1) === sc.ground && at(o.y - 3) === sc.support;
}

// /fill caps at 32768 blocks per command. Tile any region into <=32^3 boxes so a
// single logical fill can be arbitrarily large. The small pause keeps us under the
// server's chat/command rate limit (too fast -> "kicked for spamming"); 45ms (~22
// cmd/s) tests clean and is ~2.5x faster than the old conservative 110ms.
async function fillRegion(bot, x0, y0, z0, x1, y1, z1, block) {
  for (let x = x0; x <= x1; x += 32)
    for (let z = z0; z <= z1; z += 32)
      for (let y = y0; y <= y1; y += 32) {
        bot.chat(`/fill ${x} ${y} ${z} ${Math.min(x + 31, x1)} ${Math.min(y + 31, y1)} ${Math.min(z + 31, z1)} minecraft:${block}`);
        await sleep(45);
      }
}

// --- scene decoration -------------------------------------------------------------
// All decoration lives in a BACKDROP band on the far edges of the platform, so the
// 3x3 build grid in the near corner (o .. o+119) stays flat and clear.
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.round(rnd(a, b));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function put(bot, x, y, z, block) { bot.chat(`/setblock ${x} ${y} ${z} minecraft:${block}`); }

// Random spots along the far +x and +z edges (the backdrop), clear of the build grid.
function backdropSpots(o, b, n) {
  const spots = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.5) spots.push([ri(b.x0 + 6, b.x1 - 6), ri(o.z + 100, b.z1 - 4)]);
    else spots.push([ri(o.x + 100, b.x1 - 4), ri(b.z0 + 6, b.z1 - 6)]);
  }
  return spots;
}

async function placeTree(bot, x, y, z, log, leaf, h = 5) {
  for (let i = 0; i < h; i++) put(bot, x, y + i, z, log);
  for (let dy = h - 2; dy <= h + 1; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - h) > 3) continue;   // rounded canopy
        if (dx === 0 && dz === 0 && dy < h) continue;                          // don't bury the trunk
        put(bot, x + dx, y + dy, z + dz, leaf);
      }
  await sleep(40);
}

async function scatterTrees(bot, o, b, log, leaf, n = 9) {
  for (const [x, z] of backdropSpots(o, b, n)) await placeTree(bot, x, o.y, z, log, leaf, ri(4, 6));
}

async function decoPlains(bot, o, b) {
  await scatterTrees(bot, o, b, 'oak_log', 'oak_leaves', 8);
  for (const [x, z] of backdropSpots(o, b, 18)) put(bot, x, o.y, z, pick(['poppy', 'dandelion', 'cornflower', 'oxeye_daisy']));
}
async function decoJungle(bot, o, b) {
  await scatterTrees(bot, o, b, 'jungle_log', 'jungle_leaves', 11);
}
async function decoCherry(bot, o, b) {
  await scatterTrees(bot, o, b, 'cherry_log', 'cherry_leaves', 11);
  for (const [x, z] of backdropSpots(o, b, 24)) put(bot, x, o.y, z, 'pink_petals');
}
async function decoDesert(bot, o, b) {
  for (const [x, z] of backdropSpots(o, b, 12)) {
    const h = ri(2, 4);
    for (let k = 0; k < h; k++) put(bot, x, o.y + k, z, 'cactus');   // flat sand + spacing = cactus survives
  }
  for (const [x, z] of backdropSpots(o, b, 10)) put(bot, x, o.y, z, 'dead_bush');
  await sleep(40);
}
async function decoSnowy(bot, o, b) {
  // a calm frozen pond on the far +z edge, flush with the surface
  await fillRegion(bot, b.x0, o.y - 1, o.z + 96, b.x1, o.y - 1, b.z1, 'packed_ice');
  await scatterTrees(bot, o, { ...b, z1: o.z + 92 }, 'spruce_log', 'spruce_leaves', 7);
}
async function decoMountains(bot, o, b) {
  // stone peaks with snow caps along the far edges - a backdrop skyline
  for (let i = 0; i < 5; i++) {
    const [x, z] = backdropSpots(o, b, 1)[0];
    const R = ri(5, 8), H = ri(9, 15);
    for (let y = 0; y < H; y++) {
      const r = Math.max(1, Math.round(R * (1 - y / H)));
      await fillRegion(bot, x - r, o.y + y, z - r, x + r, o.y + y, z + r, y > H - 3 ? 'snow_block' : 'stone');
    }
  }
}
async function decoBeach(bot, o, b) {
  // a clean, calm, contained pool along the far +z edge - a pretty ocean stand-in
  // with none of the real ocean's kelp/seagrass/uneven floor.
  const z0 = o.z + 88;
  await fillRegion(bot, b.x0, o.y - 4, z0, b.x1, o.y - 3, b.z1, 'sand');    // flat pool floor
  await fillRegion(bot, b.x0, o.y - 2, z0, b.x1, o.y - 1, b.z1, 'water');   // 2-deep calm water, flush shoreline
}

// Level one build site into a flat platform: air out the footprint, then lay a
// solid 4-deep base of the background's ground block (covers moats, dug-up lawns,
// and gentle slopes - so builds sit flat on ANY terrain). The lead bot must be
// teleported to the site first: /fill only works in loaded chunks.
async function levelSite(bot, o) {
  // builds extend ~8 blocks past their origin on the low side (castle moat/lawn)
  const [x0, x1, z0, z1] = [o.x - 8, o.x + 39, o.z - 8, o.z + 39];
  // /fill caps at 32768 blocks per command - clear the 48x48 footprint in 14-layer slabs
  for (let y = o.y; y <= o.y + 59; y += 14) {
    bot.chat(`/fill ${x0} ${y} ${z0} ${x1} ${Math.min(y + 13, o.y + 59)} ${z1} minecraft:air`);
    await sleep(150);
  }
  bot.chat(`/fill ${x0} ${o.y - 4} ${z0} ${x1} ${o.y - 1} ${z1} minecraft:${groundBlock()}`);
  await sleep(150);
}

// Bulldoze every used build site back to a clean slate. Uses /fill via an opped
// bot - instant, no server restart, terrain outside the build grid untouched.
async function clearAllSites() {
  if (state.busy) throw new Error('A build is already running.');
  state.busy = true;
  // A failed build leaves debris on the CURRENT site without bumping buildCount -
  // sweep that site too when the last attempt errored.
  const failedExtra = state.phase === 'error' ? 1 : 0;
  setPhase('clearing', { last: null });
  const sites = Math.min(state.buildCount + failedExtra, 9);   // the grid wraps at 3x3 - sites get reused past 9
  console.log(`\n[Web] Clearing ${sites} build site(s)...`);
  const lead = crew.activeWorkers[0];
  try {
    for (let i = 0; i < sites; i++) {
      const col = i % 3, row = Math.floor(i / 3) % 3;
      const o = { x: baseOrigin.x + col * 40, y: baseOrigin.y, z: baseOrigin.z + row * 40 };
      await lead.teleportTo(o.x + 16, o.y, o.z + 16);   // load the site's chunks
      await levelSite(lead.bot, o);
    }
    state.buildCount = 0;
    state.sceneBuildCounts[state.background] = 0;
    await formation(baseOrigin);
    setPhase('done', { last: { name: 'Ground cleared', blocks: 0, prompt: 'clear' } });
    console.log('[Web] Ground cleared - fresh slate.');
  } catch (err) {
    console.error(`[Web] Clear failed: ${err.message}`);
    setPhase('error', { last: { name: 'Clear failed', blocks: 0, prompt: err.message } });
  } finally {
    state.busy = false;
    broadcast({ type: 'status', ...publicState() });
  }
}

// --- scene construction -----------------------------------------------------------
// Go to a scene. Each scene has its own PERMANENT plot, so it's only ever built
// once - the first visit constructs it (clean flat platform, solid encased base so
// no caves show underneath, themed surface, edge decoration); every visit after is
// an instant teleport, because the world is saved to disk. `force` rebuilds from
// scratch (used by "Clear ground").
async function buildScene(id, { force = false } = {}) {
  const sc = SCENES[id];
  if (state.busy) throw new Error('A build is already running.');
  state.busy = true;
  const o = plotAnchor(id);
  const knownBuilt = !force && state.builtScenes.has(id);
  setPhase('switching', { last: null });   // provisional; flips to building_scene only if we actually build
  const lead = crew.activeWorkers[0];
  try {
    baseOrigin = { x: o.x, y: o.y, z: o.z };
    state.background = id;
    const b = sceneBounds(o);
    // Decide whether the plot needs constructing. Known-built (this session) skips
    // straight to the teleport; otherwise park the crew above the plot, let its
    // chunks stream in, and probe for a scene built in a previous session.
    // The lead bot must be at the plot to build/probe (fills need loaded chunks).
    const parkAbove = () => Promise.all(crew.activeWorkers.map((w, i) => w.teleportTo(o.x + 56 + i * 2, o.y + 40, o.z + 56)));
    let needBuild = force || !knownBuilt;
    if (needBuild && !force) {
      await parkAbove();
      await sleep(1200);
      needBuild = !(await isSceneBuilt(lead.bot, o, sc));
    }
    if (needBuild) {
      setPhase('building_scene');
      console.log(`\n[Web] Building the ${sc.label} scene (first time)...`);
      if (force) { await parkAbove(); await sleep(1200); }   // rebuilding - make sure chunks are loaded
      console.log(`[Web] Clearing the ground and laying the ${sc.label} platform...`);
      await fillRegion(lead.bot, b.x0, o.y, b.z0, b.x1, o.y + 31, b.z1, 'air');            // shear off everything above (1 tile tall - spawn is flat)
      await fillRegion(lead.bot, b.x0, o.y - 34, b.z0, b.x1, o.y - 3, b.z1, sc.support);   // solid encasing base (hides caves), 1 tile deep
      await fillRegion(lead.bot, b.x0, o.y - 2, b.z0, b.x1, o.y - 1, b.z1, sc.ground);     // themed flat surface
      console.log(`[Web] Dressing the ${sc.label} scene...`);
      if (sc.decorate) await sc.decorate(lead.bot, o, b);
      state.sceneBuildCounts[id] = 0;   // a freshly built plot starts empty
    } else {
      console.log(`\n[Web] Switching to the ${sc.label} scene (already built)...`);
    }
    state.builtScenes.add(id);
    state.buildCount = state.sceneBuildCounts[id] || 0;   // resume THIS plot's own gallery
    await formation(o);
    setPhase('done', { last: { name: `${sc.label} scene ready`, blocks: 0, prompt: 'scene' } });
    console.log(`[Web] ${sc.label} scene ready - build grid anchored at (${o.x}, ${o.y}, ${o.z}).`);
  } catch (err) {
    console.error(`[Web] Scene failed: ${err.message}`);
    setPhase('error', { last: { name: 'Scene failed', blocks: 0, prompt: err.message } });
  } finally {
    state.busy = false;
    broadcast({ type: 'status', ...publicState() });
  }
}

// --- viewer reverse proxy ---------------------------------------------------------
// The prismarine viewer runs on its own internal port but is served through THIS
// server under /viewer/, so the user only ever needs one URL. The viewer client
// derives its socket.io path from the page URL (location.pathname + 'socket.io'),
// and the viewer server is started with { prefix: '/viewer' } to match - the proxy
// is a pure pass-through, no path rewriting.
function proxyToViewer(req, res) {
  const upstream = http.request({
    host: '127.0.0.1', port: VIEWER_PORT, path: req.url,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${VIEWER_PORT}` },
  }, (ures) => {
    res.writeHead(ures.statusCode, ures.headers);
    ures.pipe(res);
  });
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<body style="background:#0f1216;color:#8b98a5;font:14px sans-serif;display:flex;align-items:center;justify-content:center;height:95vh;text-align:center">' +
      'Browser viewer unavailable (the `canvas` module may be missing - see docs/SETUP.md).<br>The builds still run - watch in the Minecraft game instead.</body>');
  });
  req.pipe(upstream);
}

// --- HTTP server ----------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${WEB_PORT}`);

  if (url.pathname === '/viewer') { res.writeHead(302, { Location: '/viewer/' }); return res.end(); }
  if (url.pathname.startsWith('/viewer/')) return proxyToViewer(req, res);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ...publicState(), builds: listBuilds(),
      backgrounds: Object.entries(SCENES).map(([id, b]) => ({ id, label: b.label })),
    }));
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'status', ...publicState() })}\n\n`);
    for (const line of logBuffer) res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/build') {
    const body = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
    const prompt = (payload.prompt || '').toString().trim();
    const preset = (payload.preset || '').toString().trim();
    if (state.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'busy' })); }
    if (!prompt && !preset) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'empty' })); }
    runBuild({ prompt, preset }).catch((e) => console.error('[Web]', e.message));   // fire-and-forget
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'POST' && url.pathname === '/background') {
    const body = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
    const id = (payload.background || '').toString();
    if (!SCENES[id]) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'unknown scene' })); }
    if (state.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'busy' })); }
    buildScene(id).catch((e) => console.error('[Web]', e.message));   // fire-and-forget
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'POST' && url.pathname === '/clear') {
    if (state.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'busy' })); }
    if (!state.buildCount && state.phase !== 'error') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'nothing to clear' })); }
    clearAllSites().catch((e) => console.error('[Web]', e.message));   // fire-and-forget
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404); res.end('not found');
});

// socket.io upgrades from HTTP polling to a websocket - tunnel those raw to the
// viewer by replaying the upgrade request over a plain TCP pipe.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/viewer/')) return socket.destroy();
  const upstream = net.connect(VIEWER_PORT, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    upstream.write(raw + '\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

// --- startup --------------------------------------------------------------------
async function main() {
  console.log('\n  Minecraft Agentic Builder - Web UI\n');
  await ensureServerUp();

  crew = new Crew(null, { host: process.env.MC_HOST || 'localhost', port: parseInt(process.env.MC_PORT || '25565', 10) });
  await crew.assembleTeam(['mason', 'carpenter', 'decorator', 'landscaper']);

  // Anchor scenes at the stable WORLD spawn (not the crew's saved position, which
  // drifts as they build) at a fixed height, then start the viewer.
  const bot = crew.activeWorkers[0].bot;
  const sp = bot.spawnPoint || bot.entity.position;
  baseOrigin = { x: Math.floor(sp.x) + 6, y: STAGE_Y, z: Math.floor(sp.z) + 6 };
  SPAWN = { ...baseOrigin };   // every scene is constructed here
  await formation(baseOrigin);
  VIEWER_PORT = await findFreePort(VIEWER_PORT);   // never let a stale port disable the view
  await startViewer(bot, { prefix: '/viewer', quiet: true, port: VIEWER_PORT });

  server.listen(WEB_PORT, () => {
    console.log('\n========================================================');
    console.log(`  OPEN IN YOUR BROWSER:  http://localhost:${WEB_PORT}`);
    console.log(`  (prompt box + presets + live 3D view, all on one page)`);
    console.log('========================================================\n');
    openBrowser(`http://localhost:${WEB_PORT}`);
  });

  // Construct a clean Plains scene right away so the very first thing the user sees
  // is a tidy flat starting point, not raw spawn terrain. Fire-and-forget so the
  // page is available immediately and they watch it build in.
  buildScene('spawn').catch((e) => console.error('[Web]', e.message));
}

// Disconnect the bots on exit so a quick restart doesn't collide with our own
// still-connected bots (same usernames -> "duplicate_login" kick on the new run).
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[Web] Shutting down - disbanding the crew...');
  try { if (crew) await crew.disbandTeam(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => { console.error('\n[Web] Fatal:', e.message); process.exit(1); });

// --- the page (inlined so there are no static assets to serve) ------------------
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Agentic Builder</title>
<style>
  :root {
    --bg:#0f1216; --panel:#171b21; --panel2:#1c222a; --edge:#252c35; --edge2:#323b47;
    --ink:#e6edf3; --dim:#8b98a5; --accent:#3fb950; --accent2:#58a6ff; --danger:#f85149;
  }
  * { box-sizing:border-box; }
  /* Stylized scrollbars everywhere (Firefox + WebKit) */
  * { scrollbar-width:thin; scrollbar-color:var(--edge2) transparent; }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--edge2); border-radius:999px; border:2px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-thumb:hover { background:#465264; background-clip:padding-box; }
  ::-webkit-scrollbar-corner { background:transparent; }
  html, body { overflow-x:hidden; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  header { display:flex; align-items:center; gap:12px; padding:12px 18px; border-bottom:1px solid var(--edge); background:linear-gradient(180deg,var(--panel2),var(--panel)); }
  header h1 { font-size:16px; margin:0; font-weight:700; letter-spacing:.01em; }
  header h1 .pick { opacity:.55; font-weight:500; }
  .badge { margin-left:auto; font-size:12px; padding:4px 11px; border-radius:999px; border:1px solid var(--edge2); color:var(--dim); white-space:nowrap; }
  .badge.live { color:var(--accent); border-color:#1f6f36; background:#0e2a17; }
  main { display:grid; grid-template-columns:390px minmax(0,1fr); gap:0; height:calc(100vh - 53px); }
  @media (max-width:820px){ main { grid-template-columns:1fr; height:auto; } .viewer { height:60vh; } }
  .panel { padding:18px; border-right:1px solid var(--edge); display:flex; flex-direction:column; gap:16px; min-width:0; overflow:hidden; }
  .field { display:flex; flex-direction:column; gap:7px; min-width:0; }
  .row { display:flex; gap:8px; min-width:0; }
  input[type=text] { flex:1; min-width:0; background:#0b0e12; border:1px solid var(--edge2); color:var(--ink); padding:11px 13px; border-radius:9px; font-size:14px; transition:border-color .15s, box-shadow .15s; }
  input[type=text]::placeholder { color:#5f6b78; }
  input[type=text]:focus { outline:0; border-color:var(--accent2); box-shadow:0 0 0 3px rgba(88,166,255,.15); }
  input[type=text]:disabled { opacity:.45; cursor:not-allowed; }
  button { background:var(--accent); color:#04140a; border:0; padding:11px 18px; border-radius:9px; font-weight:700; cursor:pointer; transition:filter .15s, transform .05s; white-space:nowrap; }
  button:hover:not(:disabled){ filter:brightness(1.08); }
  button:active:not(:disabled){ transform:translateY(1px); }
  button:disabled { opacity:.4; cursor:not-allowed; }
  button.ghost { background:var(--panel2); border:1px solid var(--edge2); color:var(--ink); font-weight:600; padding:8px 13px; font-size:13px; }
  button.ghost:hover:not(:disabled){ border-color:var(--accent2); color:var(--accent2); background:#182130; filter:none; }
  button.ghost.active { border-color:var(--accent); color:var(--accent); }
  button.ghost.danger { padding:5px 11px; font-size:12px; flex:none; background:transparent; }
  button.ghost.danger:hover:not(:disabled){ border-color:var(--danger); color:var(--danger); background:#1f1315; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .hint { color:var(--dim); font-size:12px; margin:0; }
  .status { padding:11px 13px; border-radius:9px; background:#0b0e12; border:1px solid var(--edge2); font-size:13px; min-height:42px; display:flex; align-items:center; gap:9px; }
  .status #statusText { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--dim); flex:none; }
  .dot.busy { background:var(--accent2); animation:pulse 1s infinite; box-shadow:0 0 0 3px rgba(88,166,255,.18); }
  .dot.done { background:var(--accent); } .dot.error { background:var(--danger); }
  @keyframes pulse { 50%{ opacity:.35; } }
  .logwrap { flex:1; display:flex; flex-direction:column; gap:7px; min-height:0; }
  .log { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; background:#080b0e; border:1px solid var(--edge); border-radius:9px; padding:11px 12px; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; color:#b9c5d1; }
  .log .l { white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
  .log .l.crew { color:#7ee2a8; } .log .l.coord { color:#9db8ff; } .log .l.me { color:#e3b341; }
  .log:empty::before { content:'Waiting for build activity...'; color:#5f6b78; }
  .viewer { position:relative; background:#000; min-width:0; overflow:hidden; }
  .viewer iframe { width:100%; height:100%; border:0; display:block; }
  .viewer .cover { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; color:var(--dim); padding:20px; pointer-events:none; }
  label.small { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
</style></head>
<body>
<header>
  <h1>&#9935; Minecraft Agentic Builder <span class="pick">- crew control</span></h1>
  <span id="badge" class="badge">-</span>
</header>
<main>
  <section class="panel">
    <div class="field">
      <label class="small" for="prompt">Describe a build</label>
      <div class="row">
        <input id="prompt" type="text" placeholder="a haunted mansion with a graveyard" autocomplete="off">
        <button id="go">Build</button>
      </div>
      <p id="hint" class="hint"></p>
    </div>
    <div class="field">
      <label class="small">Or pick a preset (always free)</label>
      <div id="chips" class="chips"></div>
    </div>
    <div class="field">
      <label class="small">Scene - a pretty flat starting point</label>
      <div id="bgs" class="chips"></div>
    </div>
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">Connecting...</span>
      <button id="clear" class="ghost danger" style="margin-left:auto" title="Bulldoze every build and re-grass the ground" disabled>Clear ground</button>
    </div>
    <div class="logwrap">
      <label class="small">Live build log</label>
      <div id="log" class="log"></div>
    </div>
  </section>
  <section class="viewer">
    <iframe id="view" src="/viewer/" title="build viewer"></iframe>
    <div class="cover" id="cover">Loading the world view...<br>drag to orbit &middot; scroll to zoom</div>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  $('view').addEventListener('load', () => $('cover').style.display = 'none');

  let live = false, busy = false, lastBg;
  // The viewer's camera locks onto the bot's position when it CONNECTS, so after
  // the crew travels somewhere new we reload the iframe to re-frame the new scene -
  // no manual page refresh. Query string busts cache; the socket.io path comes from
  // location.pathname (still /viewer/) so the connection is unaffected.
  function reframeViewer(){ $('cover').style.display = 'flex'; $('view').src = '/viewer/?t=' + Date.now(); }

  function classify(line){
    if (/^\\[Crew\\]/.test(line)) return 'crew';
    if (/^\\[Coordinator\\]/.test(line)) return 'coord';
    if (/^\\[Web\\]/.test(line)) return 'me';
    return '';
  }
  function addLog(line){
    const el = document.createElement('div');
    el.className = 'l ' + classify(line);
    el.textContent = line;
    const box = $('log'); box.appendChild(el); box.scrollTop = box.scrollHeight;
    while (box.children.length > 400) box.removeChild(box.firstChild);
  }
  function setStatus(s){
    live = s.live; busy = s.busy;
    if (lastBg === undefined) lastBg = s.background;
    else if (s.background !== lastBg) { lastBg = s.background; reframeViewer(); }
    $('badge').textContent = s.live ? s.providerLabel : 'no key - library mode';
    $('badge').className = 'badge' + (s.live ? ' live' : '');
    $('prompt').disabled = !s.live;
    $('hint').textContent = s.live
      ? 'Powered by ' + s.providerLabel + '. Type anything.'
      : 'No AI key set - use the presets below, or add a key (Gemini is free) for custom prompts.';
    const dot = $('dot'), t = $('statusText');
    dot.className = 'dot ' + (s.busy ? 'busy' : (s.phase==='done'?'done':s.phase==='error'?'error':''));
    $('go').disabled = s.busy || !s.live;
    $('clear').disabled = s.busy || (!s.built && s.phase!=='error');
    document.querySelectorAll('#chips button').forEach(b => b.disabled = s.busy);
    document.querySelectorAll('#bgs button').forEach(b => {
      b.disabled = s.busy;
      b.classList.toggle('active', b.dataset.id === s.background);
    });
    if (s.phase==='planning') t.textContent = 'Designing your build...';
    else if (s.phase==='building') t.textContent = 'Building' + (s.last?' ':'') + '...';
    else if (s.phase==='clearing') t.textContent = 'Clearing the ground...';
    else if (s.phase==='building_scene') t.textContent = 'Building the scene (one time)...';
    else if (s.phase==='switching') t.textContent = 'Switching scene...';
    else if (s.phase==='done' && s.last && s.last.prompt==='clear') t.textContent = 'Ground cleared - fresh slate ready';
    else if (s.phase==='done' && s.last && s.last.prompt==='scene') t.textContent = s.last.name + ' - ready to build';
    else if (s.phase==='done' && s.last) t.textContent = 'Done: ' + s.last.name + ' (' + s.last.blocks + ' blocks)';
    else if (s.phase==='error' && s.last) t.textContent = 'Error: ' + s.last.prompt;
    else t.textContent = busy ? 'Working...' : 'Idle - ready to build';
  }

  async function build(payload){
    if (busy) return;
    const r = await fetch('/build', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (r.status === 409) addLog('[Web] A build is already running - wait for it to finish.');
  }
  $('go').addEventListener('click', () => { const p = $('prompt').value.trim(); if (p) build({ prompt: p }); });
  $('clear').addEventListener('click', () => {
    if (busy) return;
    if (!confirm('Bulldoze every build and re-grass the ground?')) return;
    fetch('/clear', { method:'POST' });
  });
  $('prompt').addEventListener('keydown', (e) => { if (e.key==='Enter'){ const p=$('prompt').value.trim(); if(p) build({prompt:p}); } });

  fetch('/status').then(r=>r.json()).then(s => {
    setStatus(s);
    const chips = $('chips');
    (s.builds||[]).forEach(b => {
      const btn = document.createElement('button');
      btn.className='ghost'; btn.textContent = b.name.split(' - ')[0];
      btn.title = b.name; btn.onclick = () => build({ preset: b.id });
      chips.appendChild(btn);
    });
    const rnd = document.createElement('button');
    rnd.className='ghost'; rnd.textContent='Surprise me'; rnd.onclick=()=>build({preset:'random'});
    chips.appendChild(rnd);
    const bgs = $('bgs');
    (s.backgrounds||[]).forEach(b => {
      const btn = document.createElement('button');
      btn.className='ghost'; btn.textContent = b.label; btn.dataset.id = b.id;
      btn.onclick = () => {
        if (busy) return;
        fetch('/background', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ background: b.id }) });
      };
      bgs.appendChild(btn);
    });
    setStatus(s);
  });

  const es = new EventSource('/events');
  es.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type==='log') addLog(d.line); else if (d.type==='status') setStatus(d); };
</script>
</body></html>`;
