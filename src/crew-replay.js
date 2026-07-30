// Crew demo from the built-in library - NO API key needed. Everything is real
// (workers, chat, teleport, block placement, browser viewer); the build comes from
// the procedural library instead of an LLM. Set LIBRARY_BUILD=castle|wizardTower|cottage
// to force one, otherwise it's random.
//
//   npm run server            # make sure the server is up (bots must be opped)
//   node src/crew-replay.js
import 'dotenv/config';
// Force the library backend so this is always the free, no-key demo even if a key is set.
process.env.LLM_PROVIDER = 'library';

import { Crew } from './crew.js';
import { requireMinecraftServer } from './preflight.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Crew library build (no API key) ===\n');
  await requireMinecraftServer();

  const sequential = process.argv.includes('--sequential');

  const crew = new Crew(null, {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565', 10),
  });

  try {
    await crew.assembleTeam(['mason', 'carpenter', 'decorator', 'landscaper']);

    // Build at the surface near the bots so it's on the ground and in view (positive Y).
    const p = crew.activeWorkers[0].bot.entity.position;
    const origin = { x: Math.floor(p.x) + 4, y: Math.floor(p.y), z: Math.floor(p.z) + 4 };
    console.log(`\n[Replay] Build origin: ${origin.x}, ${origin.y}, ${origin.z}`);
    console.log('[Replay] Open http://localhost:3000 to watch!\n');
    await sleep(2000);

    await crew.executeBuild('(library build)', { origin, sequential });

    const LOOK_SECONDS = parseInt(process.env.LOOK_SECONDS || '120', 10);
    console.log(`\n[Replay] Build complete. Bots stay connected ${LOOK_SECONDS}s so you can look around.`);
    console.log('[Replay] Open/refresh http://localhost:3000 - drag to orbit, scroll to zoom.');
    await sleep(LOOK_SECONDS * 1000);
  } catch (err) {
    console.error('[Replay] Failed:', err);
  } finally {
    await crew.disbandTeam();
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
