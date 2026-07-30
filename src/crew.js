import { Worker } from './worker.js';
import { Coordinator } from './coordinator.js';
import { startViewer, viewerUrl } from './viewer.js';
import { Camera } from './camera.js';
import { pacifyWorld } from './world.js';
import { buildRoles } from './profiles.js';
import { expectedBlocks, missingBlocks, repairBuild, executePatch } from './repair.js';
import { reviewBuild } from './critic.js';
import { clearForPlan } from './fill.js';

export class Crew {
  constructor(apiKey, serverOptions = {}) {
    this.coordinator = new Coordinator(apiKey);
    this.serverOptions = serverOptions;
    this.workers = new Map();
    this.activeWorkers = [];
    this.camera = null;   // the viewer renders from this bot, and ONLY this bot (see camera.js)
  }

  async assembleTeam(roles = buildRoles()) {
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

  /**
   * Centre the view on the FINISHED build, using the plan's own bounding box.
   *
   * The browser's orbit camera looks at the camera bot from 20 up and 20 south, so wherever
   * that bot stands is the middle of the picture - and at build time it stands at the CORNER
   * of the site (aimCamera, above), because at that point there is nothing to centre on yet.
   * That is fine for watching a build go up. It is not fine for photographing one: the first
   * shots the critic ever took came back as an acre of empty grass with the tower shoved into
   * the bottom-right corner, half out of frame, and a model handed that would have critiqued
   * the lawn.
   *
   * Safe here and only here: the last block has landed and the next build hasn't started, so
   * the stationary-camera invariant (src/camera.js) still holds.
   */
  async frameBuild(plan) {
    if (!this.camera?.alive || !this.activeWorkers[0]?.alive) return;
    const blocks = Object.values(plan.assignments || {}).flatMap((a) => a.blocks || []);
    if (!blocks.length) return;
    const mid = (k) => {
      const vs = blocks.map((b) => b[k]);
      return Math.round((Math.min(...vs) + Math.max(...vs)) / 2);
    };
    // The bot's position is the camera's LOOK-AT TARGET, so it goes at the middle of the
    // build in all three axes - including y. Parking it at ground level (which is where a
    // builder would stand) aims the shot at the tower's FEET: the wizard tower is 32 blocks
    // tall and its whole top half, spire included, fell off the top of the frame.
    const ys = blocks.map((b) => b.y);
    const centreY = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    await this.camera.park(this.activeWorkers[0].bot, { x: mid('x'), y: centreY, z: mid('z') });
    // The viewer only learns the camera moved from a `move` event, which it re-announces once
    // a second (src/viewer.js) - give it time to reach the page before we photograph it.
    await this.sleep(2000);
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

  // Every command the crew issues to the world leaves as a chat message, and `bot.chat()` on
  // a bot that has dropped is a SILENT no-op - so a lead that dies part way through a clear
  // lets the remaining fills evaporate with a clean log. Raise instead.
  assertLead() {
    const lead = this.activeWorkers[0];
    if (!lead?.alive) throw new Error('the lead bot dropped - its commands would go nowhere');
  }

  // What actually LANDED. The blocks-placed counter only counts commands we sent; this
  // re-reads the world (from the lead bot's own copy of it, so it's free) and reports the
  // blocks that aren't there. A silently-truncated build shows up as a number instead of a
  // missing roof. The missing-block scan itself lives in src/repair.js, which is also what
  // ACTS on it - counting the damage and fixing it should never be able to disagree about
  // what "missing" means.
  verifyBuild(plan) {
    const bot = this.activeWorkers[0]?.bot;
    if (!bot) return null;
    const missing = missingBlocks(bot, plan);
    const byType = {};
    for (const b of missing) byType[b.type] = (byType[b.type] || 0) + 1;
    return { expected: expectedBlocks(plan).size, missing: missing.length, byType, blocks: missing };
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

    // Clear area. This goes out as however many /fill commands the region needs - one /fill
    // caps at 32,768 blocks and is REFUSED SILENTLY above that, and an ops build may legally
    // span the plot to y=48 (122,112 blocks), so the single fill this used to send simply
    // vanished on exactly the big builds that most needed clearing. See src/fill.js.
    this.assertLead();
    const leader = this.activeWorkers[0];
    leader.say("Let me clear the area first!");
    const fills = await clearForPlan(leader.bot, plan, { assert: () => this.assertLead() });
    if (fills > 1) console.log(`[Crew] Cleared the site in ${fills} fills (the region is over the /fill cap).`);
    await this.sleep(2000);

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

    await this.sleep(1000);
    console.log('\n[Crew] Blocks placed - checking the work.');

    const totalBlocks = this.activeWorkers.reduce((sum, w) => sum + w.blocksPlaced, 0);
    console.log(`Total blocks placed: ${totalBlocks}`);

    // Nobody celebrates before the work has been checked. Everything from here is the crew
    // holding its own build to account, in two passes that answer two different questions.
    await this.finishBuild(plan, options);

    for (const worker of this.activeWorkers) {
      worker.say("Great teamwork everyone!");
      await this.sleep(500);
    }
    console.log('\n[Crew] Build complete!');

    return plan;
  }

  /**
   * The two review passes, run after every build. Split out of executeBuild so the web panel
   * can report each phase as it happens, and so a build that skips one still gets the other.
   *
   *   1. REPAIR - "did the world accept what we told it?" The game is the judge. Free, always
   *      on. src/repair.js re-places anything that never landed, and (with a key) asks the
   *      model to fix the design behind anything that refuses to stay. Voyager's loop.
   *   2. REVIEW - "does it look like what was asked for?" A vision model is the judge, shown
   *      photographs of the build next to its own blueprint. Costs a model call, so it is
   *      opt-in (CRITIC=on). APT's loop.
   *
   * The order matters: a build with holes in it photographs badly, and a critic shown a
   * half-finished structure spends its patch fixing damage the repair pass would have fixed
   * for free. Fix what's broken, THEN ask whether it's any good.
   */
  async finishBuild(plan, options = {}) {
    const { repair = true, review = process.env.CRITIC === 'on', onPhase = () => {} } = options;

    plan.verified = this.verifyBuild(plan);
    if (plan.verified?.missing) {
      const worst = Object.entries(plan.verified.byType).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([t, n]) => `${t} x${n}`).join(', ');
      console.warn(`[Crew] ${plan.verified.missing} of ${plan.verified.expected} blocks are not in the world (${worst}).`);
    }

    if (repair && plan.verified?.missing) {
      onPhase('repairing');
      try {
        plan.repair = await repairBuild(this, plan);
        plan.verified = this.verifyBuild(plan);
      } catch (err) {
        console.warn(`[Crew] Repair pass failed: ${err.message}`);
      }
    }
    if (plan.verified && !plan.verified.missing) console.log('[Crew] Every block in the plan is in the world.');

    if (!review) return plan;
    onPhase('reviewing');
    try {
      // Point the camera at the thing we are about to photograph. Without this the shot is
      // framed on the corner the build STARTED from - see frameBuild.
      await this.frameBuild(plan);
      const critique = await reviewBuild(plan, { url: viewerUrl() });
      plan.review = critique;
      if (critique && (critique.add.length || critique.remove.length)) {
        console.log(`[Crew] Applying the review: +${critique.add.length} blocks, -${critique.remove.length}.`);
        await executePatch(this, plan, critique);
        plan.verified = this.verifyBuild(plan);
      }
    } catch (err) {
      console.warn(`[Crew] Visual review failed: ${err.message}`);
    }
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
