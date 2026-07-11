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
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureServerUp } from './server.js';
import { Crew } from '../src/crew.js';
import { startViewer } from '../src/viewer.js';
import { detectProvider, isLiveProvider, providerLabel } from '../src/providers.js';
import { listBuilds } from '../src/library/index.js';

const WEB_PORT = parseInt(process.env.WEB_PORT || '8080', 10);
const VIEWER_PORT = parseInt(process.env.VIEWER_PORT || '3000', 10);

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

// --- build state ----------------------------------------------------------------
const state = {
  provider: detectProvider(),
  live: isLiveProvider(),
  providerLabel: providerLabel(),
  busy: false,
  phase: 'idle',            // idle | planning | building | done | error
  last: null,               // { name, blocks, prompt }
  buildCount: 0,
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
  };
}

let crew, baseOrigin;

// A tidy grid of build sites so successive builds don't overlap.
function nextOrigin() {
  const col = state.buildCount % 5, row = Math.floor(state.buildCount / 5) % 5;
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
    setPhase('building');
    const plan = await crew.executeBuild(prompt || 'a surprise build', { origin });
    const blocks = crew.activeWorkers.reduce((s, w) => s + w.blocksPlaced, 0);
    state.buildCount++;
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

// Bulldoze every used build site back to a clean slate: air out the footprint and
// lay fresh grass where builds dug into the ground (moats, lawns, paths all go one
// layer deep). Uses /fill via an opped bot - instant, no server restart, terrain
// outside the build grid untouched.
async function clearAllSites() {
  if (state.busy) throw new Error('A build is already running.');
  state.busy = true;
  // A failed build leaves debris on the CURRENT site without bumping buildCount -
  // sweep that site too when the last attempt errored.
  const failedExtra = state.phase === 'error' ? 1 : 0;
  setPhase('clearing', { last: null });
  const sites = Math.min(state.buildCount + failedExtra, 25);   // the grid wraps at 5x5 - sites get reused past 25
  console.log(`\n[Web] Clearing ${sites} build site(s)...`);
  const bot = crew.activeWorkers[0].bot;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < sites; i++) {
      const col = i % 5, row = Math.floor(i / 5) % 5;
      const o = { x: baseOrigin.x + col * 40, y: baseOrigin.y, z: baseOrigin.z + row * 40 };
      // builds extend ~8 blocks past their origin on the low side (castle moat/lawn)
      const [x0, x1, z0, z1] = [o.x - 8, o.x + 39, o.z - 8, o.z + 39];
      // /fill caps at 32768 blocks per command - clear the 48x48 footprint in 14-layer slabs
      for (let y = o.y; y <= o.y + 59; y += 14) {
        bot.chat(`/fill ${x0} ${y} ${z0} ${x1} ${Math.min(y + 13, o.y + 59)} ${z1} minecraft:air`);
        await sleep(150);
      }
      bot.chat(`/fill ${x0} ${o.y - 1} ${z0} ${x1} ${o.y - 1} ${z1} minecraft:grass_block`);
      await sleep(150);
    }
    state.buildCount = 0;
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
    return res.end(JSON.stringify({ ...publicState(), builds: listBuilds() }));
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

  // Anchor the build grid at the surface near the crew's spawn (positive Y so the
  // browser viewer frames it), then start the viewer so the page shows the world
  // immediately - even before the first build.
  const p = crew.activeWorkers[0].bot.entity.position;
  baseOrigin = { x: Math.floor(p.x) + 6, y: Math.floor(p.y), z: Math.floor(p.z) + 6 };
  for (const w of crew.activeWorkers) await w.teleportTo(baseOrigin.x - 5, baseOrigin.y, baseOrigin.z - 5);
  await startViewer(crew.activeWorkers[0].bot, { prefix: '/viewer', quiet: true });

  server.listen(WEB_PORT, () => {
    console.log('\n========================================================');
    console.log(`  OPEN IN YOUR BROWSER:  http://localhost:${WEB_PORT}`);
    console.log(`  (prompt box + presets + live 3D view, all on one page)`);
    console.log('========================================================\n');
  });
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

  let live = false, busy = false;

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
    if (s.phase==='planning') t.textContent = 'Designing your build...';
    else if (s.phase==='building') t.textContent = 'Building' + (s.last?' ':'') + '...';
    else if (s.phase==='clearing') t.textContent = 'Clearing the ground...';
    else if (s.phase==='done' && s.last && s.last.prompt==='clear') t.textContent = 'Ground cleared - fresh slate ready';
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
  });

  const es = new EventSource('/events');
  es.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type==='log') addLog(d.line); else if (d.type==='status') setStatus(d); };
</script>
</body></html>`;
