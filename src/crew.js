import { Worker } from './worker.js';
import { Coordinator } from './coordinator.js';
import { startViewer } from './viewer.js';
import { Camera } from './camera.js';
import { pacifyWorld } from './world.js';
import { Vec3 } from 'vec3';

// Blocks that legitimately vanish on their own if their support isn't right (a poppy on a
// wall footing, wheat on plain dirt). Excluded from the build-integrity check.
const POPS_OFF = /poppy|dandelion|cornflower|orchid|allium|daisy|sapling|wheat|carrots|grass$|petals|dead_bush|torch|water|fire|campfire/;

export class Crew {
  constructor(apiKey, serverOptions = {}) {
    this.coordinator = new Coordinator(apiKey);
    this.serverOptions = serverOptions;
    this.workers = new Map();
    this.activeWorkers = [];
    this.camera = null;   // the viewer renders from this bot, and ONLY this bot (see camera.js)
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
    // Hostile mobs demolish finished builds (creeper craters, endermen lifting the lawn) and
    // fire spreads off the cottage's campfire. One opped bot switches all of it off.
    if (this.activeWorkers.length > 0) {
      await pacifyWorld(this.activeWorkers[0].bot);
      // The camera bot is NOT one of the workers on purpose - see src/camera.js. Workers
      // teleport around the site as they build, and a moving viewer bot churns chunks and
      // leaves half-meshed geometry (the roofless-cottage bug).
      this.camera = new Camera();
      await this.camera.connect(this.serverOptions, this.activeWorkers[0].bot);
    }
    return this;
  }

  /** The bot the browser viewer renders from: the camera if we have one, else the lead. */
  viewerBot() {
    return this.camera?.alive ? this.camera.bot : this.activeWorkers[0]?.bot;
  }

  /** Point the camera at a site. Only safe BETWEEN builds - a moving camera churns chunks. */
  async aimCamera(origin) {
    if (!this.camera?.alive || !this.activeWorkers[0]?.alive) return;
    await this.camera.park(this.activeWorkers[0].bot, {
      x: origin.x - 2, y: origin.y + 2, z: origin.z - 8,
    });
  }

  // A worker that timed out is still in the roster but its /setblock commands go nowhere.
  // Reconnect the dead ones before a build rather than silently building half a house.
  async ensureAlive() {
    for (const worker of this.activeWorkers) {
      if (worker.alive) continue;
      console.log(`[Crew] ${worker.name} was disconnected - reconnecting...`);
      await worker.connect();
      await this.sleep(500);
    }
    // A dead camera means a frozen browser view - the build still runs, but nobody sees it.
    if (this.camera && !this.camera.alive && this.activeWorkers[0]?.alive) {
      console.log('[Crew] Camera was disconnected - reconnecting...');
      await this.camera.connect(this.serverOptions, this.activeWorkers[0].bot);
    }
  }

  // What actually LANDED. The blocks-placed counter only counts commands we sent; this
  // re-reads the world (from the lead bot's own copy of it, so it's free) and reports the
  // blocks that aren't there. A silently-truncated build now shows up as a number instead
  // of a missing roof.
  verifyBuild(plan) {
    const bot = this.activeWorkers[0]?.bot;
    if (!bot) return null;
    const expected = new Map();   // last write wins, same as the build order
    for (const role of plan.buildOrder || Object.keys(plan.assignments))
      for (const b of plan.assignments[role]?.blocks || []) expected.set(`${b.x},${b.y},${b.z}`, b);

    let missing = 0;
    const byType = {};
    for (const b of expected.values()) {
      // A flower or sapling set on an unsuitable support pops off by itself - that's the
      // build's own business, not a dropped command. Only count STRUCTURE that never landed.
      if (POPS_OFF.test(b.type)) continue;
      const got = bot.blockAt(new Vec3(b.x, b.y, b.z));
      if (got && got.name === 'air') { missing++; byType[b.type] = (byType[b.type] || 0) + 1; }
    }
    return { expected: expected.size, missing, byType };
  }

  async executeBuild(prompt, options = {}) {
    // `aimCamera: false` for callers that own the camera themselves (the web panel parks it
    // once per plot, so it can frame the whole build grid instead of chasing each build).
    const { origin = { x: 0, y: 64, z: 0 }, sequential = false, aimCamera = true } = options;
    await this.ensureAlive();

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

    // Aim the camera at the site and start the browser view from IT, not from a worker.
    // The viewer locks its camera onto the bound bot's first reported position, so aiming
    // before starting frames the build (not the bots' spawn point). The camera then holds
    // still for the whole build, which is what keeps the render honest - see src/camera.js.
    if (aimCamera) await this.aimCamera(origin);
    const eye = this.viewerBot();
    if (eye) await startViewer(eye);

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

    const check = this.verifyBuild(plan);
    if (check && check.missing > 0) {
      const worst = Object.entries(check.byType).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([t, n]) => `${t} x${n}`).join(', ');
      console.warn(`[Crew] WARNING: ${check.missing} of ${check.expected} blocks are not in the world - the build is incomplete (${worst}).`);
    }
    plan.verified = check;

    return plan;
  }

  async disbandTeam() {
    console.log('\n[Crew] Disbanding team...');
    for (const worker of this.activeWorkers) {
      worker.say("See you next build!");
      await this.sleep(300);
      worker.disconnect();
    }
    if (this.camera) { this.camera.disconnect(); this.camera = null; }
    this.workers.clear();
    this.activeWorkers = [];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
