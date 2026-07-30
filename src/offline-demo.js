import 'dotenv/config';
import { Worker } from './worker.js';
import { clearForPlan } from './fill.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadPlan(name) {
  const planPath = join(__dirname, 'plans', `${name}.json`);
  const data = readFileSync(planPath, 'utf-8');
  return JSON.parse(data);
}

function listPlans() {
  const plansDir = join(__dirname, 'plans');
  return readdirSync(plansDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

async function runOfflineDemo() {
  console.log('==========================================');
  console.log('   MINECRAFT MULTI-AGENT BUILD DEMO');
  console.log('   (Offline Mode - No API Key Needed)');
  console.log('==========================================\n');

  // Pick plan
  const availablePlans = listPlans();
  const planName = process.argv[2] || availablePlans[0] || 'tavern';

  if (!availablePlans.includes(planName)) {
    console.log(`Plan "${planName}" not found.`);
    console.log(`Available plans: ${availablePlans.join(', ')}`);
    process.exit(1);
  }

  console.log(`Loading plan: ${planName}\n`);
  const plan = loadPlan(planName);

  // Apply origin offset
  const origin = { x: 0, y: 64, z: 0 };
  for (const role of Object.keys(plan.assignments)) {
    plan.assignments[role].blocks = plan.assignments[role].blocks.map(b => ({
      ...b,
      x: b.x + origin.x,
      y: b.y + origin.y,
      z: b.z + origin.z
    }));
  }

  console.log(`Build: ${plan.name}`);
  console.log(`Description: ${plan.description}\n`);

  // Connect workers
  const serverOptions = {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565')
  };

  const workers = new Map();
  const roles = ['mason', 'carpenter', 'decorator', 'landscaper'];

  console.log('Assembling build crew...\n');

  for (const role of roles) {
    if (plan.assignments[role] && plan.assignments[role].blocks.length > 0) {
      const worker = new Worker(role);
      await worker.connect(serverOptions);
      workers.set(role, worker);
      await sleep(3000); // Wait longer between bot connections
    }
  }

  console.log('\n>>> Bots connected! Position your camera in Minecraft <<<');
  console.log('>>> Build starts in 5 seconds... <<<\n');
  await sleep(5000);

  // Teleport all workers to build site
  const firstWorker = workers.values().next().value;
  firstWorker.bot.chat(`/tp @a ${origin.x - 10} ${origin.y + 5} ${origin.z - 10}`);
  await sleep(1000);

  // Clear build area - split across as many /fill commands as the region needs, since one
  // caps at 32,768 blocks and is refused silently above that (see src/fill.js).
  firstWorker.say("Let me clear the area first!");
  await clearForPlan(firstWorker.bot, plan);
  await sleep(2000);

  // Play team chat intro
  console.log('Team discussion:');
  for (const chat of plan.teamChat.slice(0, 4)) {
    const worker = workers.get(chat.from);
    if (worker) {
      worker.say(chat.message);
      console.log(`  [${chat.from}] ${chat.message}`);
      await sleep(2500);
    }
  }

  // Execute build - staggered parallel
  console.log('\nBuilding...\n');

  const buildPromises = [];
  let staggerDelay = 0;

  for (const role of plan.buildOrder) {
    const worker = workers.get(role);
    const assignment = plan.assignments[role];

    if (worker && assignment && assignment.blocks.length > 0) {
      const delay = staggerDelay;
      staggerDelay += 8000; // Stagger each worker by 8 seconds

      const buildTask = (async () => {
        await sleep(delay);
        console.log(`[${worker.name}] Starting: ${assignment.task}`);
        worker.say(`Starting: ${assignment.task}`);
        await worker.buildBlocks(assignment.blocks, { delay: 250, narrate: true });
        worker.say("My part is done!");
        console.log(`[${worker.name}] Finished!`);
      })();

      buildPromises.push(buildTask);
    }
  }

  await Promise.all(buildPromises);

  // Celebrate
  await sleep(1000);
  console.log('\n==========================================');
  console.log(`   BUILD COMPLETE: ${plan.name}`);
  console.log('==========================================\n');

  for (const worker of workers.values()) {
    worker.say("Great teamwork everyone!");
    await sleep(300);
  }

  const totalBlocks = [...workers.values()].reduce((sum, w) => sum + w.blocksPlaced, 0);
  console.log(`Total blocks placed: ${totalBlocks}`);
  console.log('\nBots will disconnect in 10 seconds...');

  await sleep(10000);

  for (const worker of workers.values()) {
    worker.disconnect();
  }

  process.exit(0);
}

runOfflineDemo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
