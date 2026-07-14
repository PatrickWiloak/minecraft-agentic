// Does the browser actually SHOW what the crew built?
//
// This is the one bug class you cannot catch by reading the world back: the build lands
// perfectly, `verifyBuild` reports 0 missing, the log says "Build complete" - and the browser
// still draws a roofless house with a beam floating over it. The picture was wrong, not the
// build. (Found 2026-07-13. See src/camera.js for the mechanism.)
//
// So this test watches the viewer's OWN socket.io stream - the exact bytes the browser gets -
// and rebuilds the world from it, then asserts two things:
//
//   1. Every block the crew placed reached the browser.       (the data)
//   2. Not one chunk column was unloaded during the build.    (the render)
//
// (2) is the real assertion. prismarine-viewer meshes chunk sections in a worker and throws
// the finished geometry away if the column was unloaded while the job was in flight - and
// nothing ever re-queues it, so the section stays frozen at whatever it last drew. Chunks only
// unload when the bot the viewer is bound to crosses a chunk boundary. Bind the view to a
// bot that BUILDS (they teleport around the site constantly) and you get 132 unload/reload
// cycles in a single cottage and a frozen roof. Bind it to a camera bot that never moves and
// you get 0. That number is the whole fix, so this test asserts on it directly.
//
// Needs a live server (npm run server). No API key: the cottage comes from src/library/.
import 'dotenv/config';
import { Crew } from '../src/crew.js';
import { startViewer } from '../src/viewer.js';
import { io } from 'socket.io-client';
import { Vec3 } from 'vec3';
import Chunk from 'prismarine-chunk';

const VERSION = process.env.MC_VERSION || '1.20.1';
const PORT = parseInt(process.env.VIEWER_PORT || '3007', 10);
process.env.LLM_PROVIDER = 'library';     // no API key needed - build from the library
process.env.LIBRARY_BUILD = 'cottage';    // the build that surfaced the bug: a big pitched roof

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); };

// --- the browser's data layer, faithfully: chunk columns + incremental block updates ------
const ChunkColumn = Chunk(VERSION);
const columns = new Map();
const events = { loadChunk: 0, unloadChunk: 0, blockUpdate: 0 };
const local = (v) => ((v % 16) + 16) % 16;
const ckey = (x, z) => `${Math.floor(x / 16) * 16},${Math.floor(z / 16) * 16}`;
function browserBlockAt(x, y, z) {
  const col = columns.get(ckey(x, z));
  if (!col) return null;
  try { return col.getBlockStateId(new Vec3(local(x), y, local(z))); } catch { return null; }
}

console.log('\n=== viewer sync: does the browser see what the crew built? ===\n');

const crew = new Crew(null, {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
});
await crew.assembleTeam(['mason', 'carpenter', 'decorator', 'landscaper']);

const lead = crew.activeWorkers[0].bot;
const sp = lead.spawnPoint || lead.entity.position;
const origin = { x: Math.floor(sp.x) + 6, y: 72, z: Math.floor(sp.z) + 6 };

await crew.aimCamera(origin);
const eye = crew.viewerBot();
if (eye && eye.username !== lead.username) pass(`view is bound to the camera bot (${eye.username}), not a builder`);
else fail('view is bound to a bot that BUILDS - it will churn chunks and freeze sections');

await startViewer(eye, { port: PORT, quiet: true });
await sleep(1500);

const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
socket.on('loadChunk', ({ x, z, chunk }) => {
  events.loadChunk++;
  try { columns.set(`${x},${z}`, ChunkColumn.fromJson(chunk)); } catch { /* not our problem here */ }
});
socket.on('unloadChunk', ({ x, z }) => { events.unloadChunk++; columns.delete(`${x},${z}`); });
socket.on('blockUpdate', ({ pos, stateId }) => {
  events.blockUpdate++;
  const col = columns.get(ckey(pos.x, pos.z));
  if (!col) return;
  try { col.setBlockStateId(new Vec3(local(pos.x), pos.y, local(pos.z)), stateId); } catch { /* ditto */ }
});
await new Promise((r) => socket.on('connect', r));
await sleep(4000);   // let the opening chunk spiral arrive

// Only count churn caused by the BUILD - the camera is parked before this point.
const unloadsBeforeBuild = events.unloadChunk;
const plan = await crew.executeBuild('a cottage', { origin, aimCamera: false });
await sleep(6000);   // let the stream settle

// --- assertions ---------------------------------------------------------------------------
const churn = events.unloadChunk - unloadsBeforeBuild;
if (churn === 0) pass('0 chunk columns unloaded during the build (nothing can freeze a section)');
else fail(`${churn} chunk columns unloaded MID-BUILD - sections will freeze and the render will lie`);

const expected = plan.buildOrder.flatMap((role) => plan.assignments[role].blocks);
let missing = 0;
const byType = {};
for (const b of expected) {
  const real = lead.blockAt(new Vec3(b.x, b.y, b.z));
  if (!real || real.name === 'air') continue;          // never landed / popped off - verifyBuild's job
  const state = browserBlockAt(b.x, b.y, b.z);
  if (state === null || state === 0) { missing++; byType[b.type] = (byType[b.type] || 0) + 1; }
}
if (missing === 0) pass(`all ${expected.length} placed blocks reached the browser`);
else fail(`${missing} blocks are in the world but NOT in the browser: ${JSON.stringify(byType)}`);

console.log(`\n  stream: ${events.loadChunk} loadChunk, ${events.unloadChunk} unloadChunk, ${events.blockUpdate} blockUpdate`);
console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mViewer is honest: what you see is what got built.\x1b[0m\n');

await crew.disbandTeam();
process.exit(failures ? 1 : 0);
