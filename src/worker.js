import { createBot, waitForSpawn } from './bot.js';
import { Builder } from './builder.js';
import { allProfiles, profile } from './profiles.js';

// Who the bots ARE now lives in src/profiles/*.json, one file per role (see src/profiles.js).
// The same file feeds the coordinator's system prompt, so a role's rules and the bot that
// plays it can't drift apart. Kept in this shape so nothing downstream had to change.
const PERSONALITIES = Object.fromEntries(allProfiles().map((p) => [p.key, p]));

export class Worker {
  constructor(personality = 'mason', options = {}) {
    const config = profile(personality) || profile('mason');

    this.personality = personality;
    this.name = options.name || config.name;
    this.role = config.role;
    this.color = config.color;
    this.phrases = config.phrases;

    this.bot = null;
    this.builder = null;
    this.busy = false;
    this.blocksPlaced = 0;
    this.alive = false;
    this.serverOptions = {};
  }

  async connect(serverOptions = this.serverOptions) {
    this.serverOptions = serverOptions;
    this.bot = createBot({
      ...serverOptions,
      username: this.name
    });

    await waitForSpawn(this.bot);
    this.alive = true;
    // A disconnected bot's `bot.chat()` is a SILENT no-op: it keeps "placing" blocks into
    // nothing while blocksPlaced happily counts up, so a bot that times out mid-build used
    // to produce a half-built house and a cheerful "Build complete!". Track liveness so
    // buildBlocks can fail loudly instead (and so the crew can reconnect it).
    this.bot.on('end', (reason) => {
      this.alive = false;
      console.warn(`[${this.name}] Disconnected: ${reason}`);
    });
    this.builder = new Builder(this.bot);
    await this.builder.init();

    // Creative mode (bots are opped): no fall/suffocation damage while they hop
    // around the site following their work.
    this.bot.chat('/gamemode creative');

    console.log(`[${this.name}] ${this.role} ready for work!`);
    this.say(`${this.role} reporting for duty!`);

    return this;
  }

  say(message) {
    if (this.bot) {
      this.bot.chat(message);
    }
  }

  randomPhrase() {
    return this.phrases[Math.floor(Math.random() * this.phrases.length)];
  }

  async buildBlocks(blocks, options = {}) {
    // groundY: pass the build site's ground level to make the worker WORK THE SITE
    // like a real builder - hop over to stand beside each stretch of blocks it's
    // placing (at ground level, so nobody floats) and look at the block being set.
    const { delay = 250, narrate = true, groundY } = options;

    blocks = buildRoute(blocks);

    this.busy = true;
    const narrateEvery = Math.floor(blocks.length / 3) || 1;
    let sinceMove = Infinity;   // force a hop to the first block

    for (let i = 0; i < blocks.length; i++) {
      if (!this.busy) break;
      if (!this.alive) {
        this.busy = false;
        throw new Error(`${this.name} disconnected after ${i}/${blocks.length} blocks - build is incomplete`);
      }

      const block = blocks[i];

      if (groundY !== undefined && this.bot.entity) {
        const p = this.bot.entity.position;
        const far = Math.abs(p.x - block.x) + Math.abs(p.z - block.z) > 10;
        if (sinceMove >= 8 || far) {
          const dx = Math.random() < 0.5 ? -2 : 3;
          const dz = Math.random() < 0.5 ? -2 : 3;
          this.bot.chat(`/tp ${this.name} ${block.x + dx} ${groundY} ${block.z + dz}`);
          sinceMove = 0;
        }
        sinceMove++;
        const pos = this.bot.entity.position;
        this.bot.lookAt(pos.offset(block.x + 0.5 - pos.x, block.y + 0.5 - pos.y, block.z + 0.5 - pos.z)).catch(() => {});
      }

      // The block lands by server command, not by the bot actually reaching out and
      // placing it, so there is no animation on it at all. Swing anyway: it costs one
      // packet and it is the difference between a builder and a bystander on camera.
      this.bot.swingArm('right');
      this.bot.chat(`/setblock ${block.x} ${block.y} ${block.z} minecraft:${block.type}`);
      this.blocksPlaced++;

      if (narrate && i > 0 && i % narrateEvery === 0) {
        this.say(this.randomPhrase());
      }

      await this.sleep(delay);
    }

    this.busy = false;
    return this.blocksPlaced;
  }

  async teleportTo(x, y, z) {
    this.bot.chat(`/tp ${this.name} ${x} ${y} ${z}`);
    await this.sleep(500);
  }

  stop() {
    this.busy = false;
  }

  disconnect() {
    if (this.bot) {
      this.bot.quit();
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Order a role's blocks into a route a human bricklayer would actually walk.
//
// The generators emit blocks in whatever order the geometry loops happen to run - a whole
// wall, then a whole floor, then a stretch of trim on the far side. The worker hops to
// stand beside its work every 8 blocks (see buildBlocks), so in generator order it spends
// the build teleporting back and forth across the site. Sorting the list so consecutive
// blocks are ADJACENT turns those long jumps into a shuffle along the course being laid.
//
// The ordering is not free to choose, though - build order is a timeline, and a block whose
// support arrives later is deleted by the game (see CLAUDE.md). So the primary key is y,
// ASCENDING: every block is placed after the one it stands on. That is what keeps a door's
// lower half ahead of its upper half, a flower ahead of nothing, and gravel off of air.
// Within a single y layer, nothing supports anything else, so we are free to take the
// nearest-neighbour route.
function buildRoute(blocks) {
  const layers = new Map();
  for (const b of blocks) {
    if (!layers.has(b.y)) layers.set(b.y, []);
    layers.get(b.y).push(b);
  }
  const route = [];
  for (const y of [...layers.keys()].sort((a, b) => a - b)) route.push(...walkLayer(layers.get(y)));
  return route;
}

// Nearest-neighbour walk through one horizontal layer, starting from the block the
// generator emitted first.
//
// The one thing this must not do is change WHICH WRITE LANDS LAST on a coordinate. A plan
// that sets a coord twice (place a wall, then carve it back to air) encodes its intent in
// the order of those two entries, and reordering them silently inverts it - a carved window
// fills back in, or a wall never appears. Library plans can't hit this (finalize() in
// src/library de-dupes each role's coords, last write wins, before we ever see them), but a
// live model's plan is raw and absolutely can. So: if a layer repeats a coord at all, hand
// it back untouched and take the ugly camera work over a wrong build.
function walkLayer(layer) {
  const coords = new Set(layer.map((b) => `${b.x},${b.z}`));
  if (coords.size !== layer.length) return layer;

  const remaining = layer.slice();
  const route = [remaining.shift()];
  while (remaining.length) {
    const from = route[route.length - 1];
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = Math.abs(remaining[i].x - from.x) + Math.abs(remaining[i].z - from.z);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    route.push(remaining.splice(best, 1)[0]);
  }
  return route;
}

export { PERSONALITIES, buildRoute };
