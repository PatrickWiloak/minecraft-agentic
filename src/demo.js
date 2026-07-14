import 'dotenv/config';
import { createBot, waitForSpawn } from './bot.js';
import { Builder } from './builder.js';
import { BuilderAgent } from './agent.js';
import { attachViewer } from './viewer.js';
import { requireApiKey, requireMinecraftServer } from './preflight.js';

const DEMO_BUILDS = [
  'a small cozy cottage with a chimney and garden',
  'a medieval watchtower',
  'a Japanese torii gate',
  'a spooky graveyard with tombstones',
  'a pirate ship'
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demo() {
  console.log('=== Minecraft Agentic Builder - DEMO ===\n');

  const prompt = process.argv[2] || DEMO_BUILDS[Math.floor(Math.random() * DEMO_BUILDS.length)];

  // Fail fast with friendly guidance if the key or server is missing
  requireApiKey();
  await requireMinecraftServer();

  console.log(`Demo build: "${prompt}"\n`);

  // Create bot
  const bot = createBot({
    username: process.env.MC_USERNAME || 'DemoBuilder'
  });

  const builder = new Builder(bot);
  const agent = new BuilderAgent(process.env.ANTHROPIC_API_KEY);

  console.log('Connecting to server...');
  await waitForSpawn(bot);
  await builder.init();

  // Open the browser viewer so you can watch without the Minecraft game
  await attachViewer(bot);

  await sleep(1000);

  // Get position and announce
  const pos = bot.entity.position;
  const origin = {
    x: Math.floor(pos.x) + 10,
    y: Math.floor(pos.y),
    z: Math.floor(pos.z) + 10
  };

  bot.chat(`Hello! I'm going to build: ${prompt}`);
  await sleep(2000);

  // Generate plan
  console.log('Generating build plan with Claude...');
  const plan = await agent.generateBuildPlan(prompt, {
    originX: origin.x,
    originY: origin.y,
    originZ: origin.z
  });

  console.log(`\nBuild Plan: ${plan.name}`);
  console.log(`Blocks: ${plan.blocks.length}`);
  console.log(`Origin: ${origin.x}, ${origin.y}, ${origin.z}\n`);

  // Teleport near the build
  bot.chat(`/tp ${bot.username} ${origin.x - 5} ${origin.y} ${origin.z - 5}`);
  await sleep(1000);

  // Clear area first
  bot.chat('Let me clear the area first...');
  await sleep(1000);

  const maxX = Math.max(...plan.blocks.map(b => b.x)) - origin.x + 1;
  const maxY = Math.max(...plan.blocks.map(b => b.y)) - origin.y + 1;
  const maxZ = Math.max(...plan.blocks.map(b => b.z)) - origin.z + 1;

  bot.chat(`/fill ${origin.x} ${origin.y} ${origin.z} ${origin.x + maxX} ${origin.y + maxY} ${origin.z + maxZ} minecraft:air`);
  await sleep(2000);

  // Start building with narration
  let narrationIndex = 0;
  const narrationInterval = Math.floor(plan.blocks.length / plan.narration.length);

  bot.chat("Here we go!");
  await sleep(1000);

  for (let i = 0; i < plan.blocks.length; i++) {
    const block = plan.blocks[i];

    // Narrate at intervals
    if (i > 0 && i % narrationInterval === 0 && narrationIndex < plan.narration.length) {
      bot.chat(plan.narration[narrationIndex]);
      narrationIndex++;
    }

    bot.chat(`/setblock ${block.x} ${block.y} ${block.z} minecraft:${block.type}`);
    await sleep(75); // Visible building speed
  }

  await sleep(1000);
  bot.chat(`Done! "${plan.name}" complete - ${plan.blocks.length} blocks placed.`);

  console.log('\nDemo complete! Press Ctrl+C to exit.');
}

demo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
