import { Worker } from './worker.js';
import { Coordinator } from './coordinator.js';
import { startViewer } from './viewer.js';

export class Crew {
  constructor(apiKey, serverOptions = {}) {
    this.coordinator = new Coordinator(apiKey);
    this.serverOptions = serverOptions;
    this.workers = new Map();
    this.activeWorkers = [];
  }

  async assembleTeam(roles = ['mason', 'carpenter', 'decorator', 'landscaper']) {
    console.log('\n[Crew] Assembling build team...\n');

    for (const role of roles) {
      const worker = new Worker(role);
      await worker.connect(this.serverOptions);
      this.workers.set(role, worker);
      this.activeWorkers.push(worker);
      await this.sleep(1000); // Stagger connections
    }

    console.log(`\n[Crew] Team assembled: ${roles.join(', ')}\n`);
    return this;
  }

  async executeBuild(prompt, options = {}) {
    const { origin = { x: 0, y: 64, z: 0 }, sequential = false } = options;

    // Get the plan from coordinator
    const plan = await this.coordinator.planBuild(prompt, {
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z
    });

    // Teleport the workers to the build site - each to their OWN spot along the
    // front edge (all four on one block looks like a single bot in the viewer).
    console.log('\n[Crew] Moving team to build site...');
    for (const [i, worker] of this.activeWorkers.entries()) {
      await worker.teleportTo(origin.x - 2 + i * 8, origin.y, origin.z - 6);
    }
    await this.sleep(1000);

    // Start the browser viewer now that the bots are AT the build site. The viewer
    // locks its camera onto the bound bot's first reported position, so starting it
    // here frames the build (not the bots' spawn point). One shared view for the crew.
    if (this.activeWorkers.length > 0) {
      await startViewer(this.activeWorkers[0].bot);
    }

    // Clear area
    const allBlocks = Object.values(plan.assignments).flatMap(a => a.blocks);
    if (allBlocks.length > 0) {
      const maxX = Math.max(...allBlocks.map(b => b.x));
      const maxY = Math.max(...allBlocks.map(b => b.y));
      const maxZ = Math.max(...allBlocks.map(b => b.z));
      const minX = Math.min(...allBlocks.map(b => b.x));
      const minY = Math.min(...allBlocks.map(b => b.y));
      const minZ = Math.min(...allBlocks.map(b => b.z));

      const leader = this.activeWorkers[0];
      leader.say("Let me clear the area first!");
      leader.bot.chat(`/fill ${minX} ${minY} ${minZ} ${maxX} ${maxY} ${maxZ} minecraft:air`);
      await this.sleep(2000);
    }

    // Play team chat intro
    console.log('\n[Crew] Team discussion:');
    for (const chat of plan.teamChat.slice(0, 3)) {
      const worker = this.workers.get(chat.from);
      if (worker) {
        worker.say(chat.message);
        console.log(`  ${chat.from}: "${chat.message}"`);
        await this.sleep(2000);
      }
    }

    // Execute build in order
    console.log('\n[Crew] Starting construction!\n');

    if (sequential) {
      // One at a time
      for (const role of plan.buildOrder) {
        const worker = this.workers.get(role);
        const assignment = plan.assignments[role];

        if (worker && assignment && assignment.blocks.length > 0) {
          console.log(`[${worker.name}] Starting: ${assignment.task}`);
          worker.say(`My turn! ${assignment.task}`);
          await worker.buildBlocks(assignment.blocks, { groundY: origin.y });
          worker.say("Done with my part!");
          await this.sleep(1000);
        }
      }
    } else {
      // Parallel with staggered starts
      const buildPromises = [];

      for (let i = 0; i < plan.buildOrder.length; i++) {
        const role = plan.buildOrder[i];
        const worker = this.workers.get(role);
        const assignment = plan.assignments[role];

        if (worker && assignment && assignment.blocks.length > 0) {
          // Stagger start times based on dependencies
          const delay = i * 3000;

          const buildTask = (async () => {
            await this.sleep(delay);
            console.log(`[${worker.name}] Starting: ${assignment.task}`);
            worker.say(`Starting my work: ${assignment.task}`);
            await worker.buildBlocks(assignment.blocks, { delay: 100, groundY: origin.y });
            worker.say("Finished my section!");
          })();

          buildPromises.push(buildTask);
        }
      }

      await Promise.all(buildPromises);
    }

    // Celebrate
    await this.sleep(1000);
    console.log('\n[Crew] Build complete!');

    for (const worker of this.activeWorkers) {
      worker.say("Great teamwork everyone!");
      await this.sleep(500);
    }

    const totalBlocks = this.activeWorkers.reduce((sum, w) => sum + w.blocksPlaced, 0);
    console.log(`\nTotal blocks placed: ${totalBlocks}`);

    return plan;
  }

  async disbandTeam() {
    console.log('\n[Crew] Disbanding team...');
    for (const worker of this.activeWorkers) {
      worker.say("See you next build!");
      await this.sleep(300);
      worker.disconnect();
    }
    this.workers.clear();
    this.activeWorkers = [];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
