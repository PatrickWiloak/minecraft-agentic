import 'dotenv/config';
import { Crew } from './crew.js';

const DEMO_BUILDS = [
  'a medieval blacksmith shop with forge and anvil',
  'a cozy tavern with outdoor seating',
  'a wizard tower with enchanting room',
  'a small castle gatehouse',
  'a village market with stalls'
];

async function multiAgentDemo() {
  console.log('===========================================');
  console.log('   MINECRAFT MULTI-AGENT BUILD DEMO');
  console.log('===========================================\n');

  const prompt = process.argv[2] || DEMO_BUILDS[Math.floor(Math.random() * DEMO_BUILDS.length)];
  const sequential = process.argv.includes('--sequential');

  console.log(`Build: "${prompt}"`);
  console.log(`Mode: ${sequential ? 'Sequential' : 'Parallel (staggered)'}\n`);

  const crew = new Crew(process.env.ANTHROPIC_API_KEY, {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565')
  });

  try {
    // Assemble the team
    await crew.assembleTeam(['mason', 'carpenter', 'decorator', 'landscaper']);

    // Small delay to let you position camera in Minecraft
    console.log('\n>>> Starting build in 5 seconds - position your camera! <<<\n');
    await sleep(5000);

    // Execute the build
    await crew.executeBuild(prompt, {
      origin: { x: 0, y: 64, z: 0 }, // Adjust based on your world
      sequential
    });

    console.log('\n>>> Demo complete! <<<');
    console.log('>>> Bots will disconnect in 10 seconds <<<\n');

    await sleep(10000);

  } catch (err) {
    console.error('Demo failed:', err);
  } finally {
    await crew.disbandTeam();
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

multiAgentDemo().catch(console.error);
