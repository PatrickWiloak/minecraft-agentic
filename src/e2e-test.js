// End-to-end smoke test - NO API key needed.
// Connects a real bot to the server, starts the browser viewer, and places blocks
// from the cached tavern plan. Verifies: bot spawns, viewer HTTP server serves a
// page, and blocks actually appear in the world (read back with bot.blockAt).
//
//   npm run server   # make sure a server is up first
//   npm run e2e
import 'dotenv/config';
import http from 'http';
import { createRequire } from 'module';
import { createBot, waitForSpawn } from './bot.js';
import { startViewer } from './viewer.js';
import { requireMinecraftServer } from './preflight.js';

const require = createRequire(import.meta.url);
const plan = require('./plans/tavern.json');

const PORT = parseInt(process.env.VIEWER_PORT || '3000', 10);
const pass = (m) => console.log(`\x1b[32m  ✔ ${m}\x1b[0m`);
const fail = (m) => { console.error(`\x1b[31m  ✖ ${m}\x1b[0m`); process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpOk(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(null));
  });
}

async function main() {
  console.log('\n=== E2E smoke test (no API key needed) ===\n');
  await requireMinecraftServer();

  const bot = createBot({ username: 'E2ETester' });
  await waitForSpawn(bot);
  pass('bot connected and spawned');

  const viewerStarted = await startViewer(bot);
  await sleep(2500); // let the express server bind
  if (viewerStarted) {
    const code = await httpOk(`http://localhost:${PORT}/`);
    if (code === 200) pass(`browser viewer serving HTTP 200 at http://localhost:${PORT}`);
    else fail(`viewer did not serve a page (status: ${code})`);
  } else {
    console.warn('  ! viewer did not start (canvas missing?) - skipping HTTP check');
  }

  // Place blocks near the bot's own position so the chunk is loaded (blockAt needs
  // a loaded chunk to read back). Build a few blocks up so we're clear of the ground.
  const p = bot.entity.position;
  const origin = { x: Math.floor(p.x) + 3, y: Math.floor(p.y) + 1, z: Math.floor(p.z) + 3 };
  const sample = plan.assignments.mason.blocks.slice(0, 8);

  // Clear then build
  bot.chat(`/fill ${origin.x} ${origin.y} ${origin.z} ${origin.x + 6} ${origin.y + 4} ${origin.z + 6} minecraft:air`);
  await sleep(500);
  for (const blk of sample) {
    bot.chat(`/setblock ${origin.x + blk.x} ${origin.y + blk.y} ${origin.z + blk.z} minecraft:${blk.type}`);
    await sleep(120);
  }
  await sleep(1500);

  // Read one placed block back from the world to prove it landed
  const check = sample[0];
  const pos = { x: origin.x + check.x, y: origin.y + check.y, z: origin.z + check.z };
  const { Vec3 } = require('vec3');
  const worldBlock = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
  if (worldBlock && worldBlock.name !== 'air') pass(`block placed & verified in world: ${worldBlock.name} at ${pos.x},${pos.y},${pos.z}`);
  else fail(`expected a placed block at ${pos.x},${pos.y},${pos.z}, found: ${worldBlock ? worldBlock.name : 'unknown'}`);

  console.log(process.exitCode ? '\n\x1b[31mE2E FAILED\x1b[0m\n' : '\n\x1b[32mE2E PASSED\x1b[0m\n');
  bot.quit();
  await sleep(500);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('E2E crashed:', e); process.exit(1); });
