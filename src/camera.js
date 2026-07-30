// The camera bot: a fifth, invisible, NEVER-MOVING bot that exists only so the browser
// viewer has something to render from.
//
// WHY THIS EXISTS. prismarine-viewer renders the world as seen by ONE bot, and it re-sends
// (unloads + reloads) chunk columns every time that bot crosses a chunk boundary. It also
// meshes chunk sections asynchronously in a worker. Those two facts race: if a section's
// mesh job is in flight when its column is unloaded, `worldrenderer.js` throws the finished
// geometry away (it checks `loadedChunks` when the job returns) and NOTHING re-queues it -
// the section is left frozen at whatever it last rendered.
//
// We used to bind the viewer to the lead WORKER, and workers teleport around the site
// constantly (see Worker.buildBlocks - they hop next to each stretch of blocks they place).
// A single cottage build measured 132 chunk unload/reload cycles, and the sections holding
// the roof froze mid-build: the browser showed a roofless house with the ridge beam hanging
// in the air, while the actual server world had a perfectly good roof. The bug was never in
// the build - only in the picture of it.
//
// So: give the viewer its own bot that NEVER moves. No movement -> no chunk churn -> no
// dropped meshes -> what you see is what got built. It is a spectator (invisible, doesn't
// show up in shot and can't be shoved around) with physics disabled (mineflayer would
// otherwise apply its own gravity and drift the camera downwards forever).
import { createBot, waitForSpawn } from './bot.js';

export const CAMERA_NAME = 'Cam';

export class Camera {
  constructor() {
    this.bot = null;
    this.alive = false;
    this.serverOptions = {};
  }

  /**
   * Connect the camera and park it. `opBot` must be an OPPED bot (any worker): the camera
   * itself is never opped, so somebody else has to /tp it and put it in spectator.
   */
  async connect(serverOptions = this.serverOptions, opBot = null, at = null) {
    this.serverOptions = serverOptions;
    this.bot = createBot({ ...serverOptions, username: CAMERA_NAME });
    await waitForSpawn(this.bot);
    this.alive = true;
    this.bot.on('end', () => { this.alive = false; });

    // Mineflayer runs its own client-side physics. In spectator there is nothing to stand
    // on, so it would fall forever - and every metre of that fall is a `move` event, which
    // is precisely the chunk churn this bot exists to avoid. Freeze it.
    this.bot.physicsEnabled = false;

    if (opBot) {
      opBot.chat(`/gamemode spectator ${CAMERA_NAME}`);
      if (at) await this.park(opBot, at);
    }
    console.log(`[${CAMERA_NAME}] Camera online - the browser view renders from here.`);
    return this;
  }

  /**
   * Move the camera. This DOES churn chunks, so only ever call it between builds (when
   * switching scenes) - never while the crew is placing blocks.
   */
  async park(opBot, { x, y, z }) {
    if (!this.alive) return;
    opBot.chat(`/tp ${CAMERA_NAME} ${x} ${y} ${z}`);
    await new Promise((r) => setTimeout(r, 600));
  }

  disconnect() {
    if (this.bot) this.bot.quit();
  }
}
