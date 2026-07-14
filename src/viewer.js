// Browser viewer: streams the bot's view of the world to a web page so anyone
// can watch the build in a browser - no Minecraft client (or Minecraft purchase)
// required. Powered by prismarine-viewer, which piggybacks on the bot's existing
// connection to the server.
//
// prismarine-viewer depends on the native `canvas` module. We keep it OPTIONAL:
// if canvas failed to build (some platforms lack the prebuilt binary), the build
// still runs perfectly - you just watch in the Minecraft game instead of a browser.

import net from 'net';

let started = false;

// How far the browser renders, in CHUNKS. prismarine-viewer defaults to 6 (~96 blocks),
// which was fine when the view chased a worker around the site. It no longer does: the view
// is bound to a bot that never moves (src/camera.js), so the render distance alone has to
// reach whatever we want on screen.
//
// 16 chunks = 256 blocks. That covers the whole 3x3 build grid the web panel lays out
// (origin .. origin+120) with the scene's decoration ring behind it, so the edge of the
// render sits off camera instead of cutting a hard horizon through the shot. Two ceilings
// sit above this and BOTH have to move for a bigger number to draw anything:
//   - the server's VIEW_DISTANCE (scripts/server.js, now 24): the browser renders the bot's
//     copy of the world, and the bot never received chunks the server didn't stream to it.
//   - the browser's frame budget: every chunk is geometry to mesh, and it is quadratic.
// 24 here shows the entire 337x337 scene platform, at a real cost in framerate.
const VIEW_DISTANCE = parseInt(process.env.VIEWER_DISTANCE || '16', 10);

function viewerDisabled() {
  return process.env.VIEWER === 'off' || process.argv.includes('--no-viewer');
}

// Returns true if nothing is already listening on the port. prismarine-viewer's
// express server emits EADDRINUSE *asynchronously* (not as a throw), so a plain
// try/catch can't stop it from crashing the process - we must check up front.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port);
  });
}

/**
 * Start a single browser viewer bound to `bot`. Safe to call more than once -
 * only the first call binds a port (all bots share one world, so one view shows
 * everyone building). Never throws: on any failure it logs and returns false.
 *
 * @param {import('mineflayer').Bot} bot - a spawned mineflayer bot
 * @param {{ port?: number, firstPerson?: boolean, prefix?: string, quiet?: boolean, viewDistance?: number }} [options]
 *   `prefix` serves the viewer under a URL path (e.g. '/viewer') so another server
 *   can reverse-proxy it on its own origin; `quiet` skips the WATCH banner for
 *   callers that print their own URL (the web control panel); `viewDistance` is in
 *   CHUNKS (see VIEW_DISTANCE below).
 * @returns {Promise<boolean>} true if the viewer started
 */
export async function startViewer(bot, options = {}) {
  if (viewerDisabled()) {
    console.log('[Viewer] Browser viewer disabled (VIEWER=off / --no-viewer).');
    return false;
  }
  if (started) return false;

  const port = parseInt(options.port || process.env.VIEWER_PORT || '3000', 10);

  if (!(await isPortFree(port))) {
    console.warn(`\n[Viewer] Port ${port} is already in use - skipping the browser viewer.`);
    console.warn(`[Viewer] Set VIEWER_PORT to a free port (e.g. VIEWER_PORT=3001) to enable it.`);
    console.warn('[Viewer] The build will still run - watch in the Minecraft game instead.\n');
    return false;
  }

  let mineflayerViewer;
  try {
    // Self-heal the installed prismarine-viewer BEFORE anything serves its bundle: upstream
    // treats any block whose name contains "air" as air - which matches "stAIRs", so every
    // stair block meshes to nothing and buildings render roofless in the browser while the
    // world is perfectly fine. postinstall applies the same patch; this covers installs that
    // predate it. Idempotent and cheap. See scripts/patch-viewer.js.
    try {
      const { patchViewer } = await import('../scripts/patch-viewer.js');
      patchViewer({ quiet: true });
    } catch { /* never let the patch stop the viewer */ }

    // Dynamic import so a missing/broken `canvas` native module degrades
    // gracefully instead of crashing the whole process at load time.
    const pv = await import('prismarine-viewer');
    mineflayerViewer = (pv.default || pv).mineflayer;
  } catch (err) {
    console.warn('\n[Viewer] Browser viewer unavailable (could not load prismarine-viewer).');
    console.warn(`[Viewer] Reason: ${err.message}`);
    console.warn('[Viewer] The build will still run - watch in the Minecraft game instead.');
    console.warn('[Viewer] To enable the browser view, see docs/SETUP.md (install the `canvas` module).\n');
    return false;
  }

  try {
    mineflayerViewer(bot, {
      port,
      firstPerson: options.firstPerson ?? false,
      prefix: options.prefix || '',
      viewDistance: options.viewDistance ?? VIEW_DISTANCE,
    });
    started = true;

    // Tell every connected browser where the camera IS, once a second.
    //
    // prismarine-viewer sends the camera position to a client from one place only:
    // `bot.on('move')` (lib/mineflayer.js). The page ignores everything until that first
    // packet arrives - `firstPositionUpdate` in lib/index.js is what aims the camera and sets
    // the orbit target - so a browser that connects while the bot is standing still NEVER
    // learns where to look and renders the world from the origin: an empty blue frame, no
    // matter how much world was streamed to it.
    //
    // Our camera bot (src/camera.js) exists precisely BECAUSE it never moves, so it only ever
    // emits 'move' when it's teleported between builds. Connect (or reload) the page while the
    // crew is idle - which is most of the time - and you got the blue frame. Re-announcing the
    // position covers any client that arrives between moves.
    //
    // This does NOT reintroduce chunk churn: the handler also calls WorldView.updatePosition,
    // which does load/unload work only when the bot crosses a CHUNK boundary (worldView.js) -
    // an unchanged position is a no-op. The stationary-camera invariant holds.
    const heartbeat = setInterval(() => { if (bot.entity) bot.emit('move'); }, 1000);
    heartbeat.unref?.();
    bot.once('end', () => clearInterval(heartbeat));
    if (!options.quiet) {
      console.log('\n========================================================');
      console.log(`  WATCH IN YOUR BROWSER:  http://localhost:${port}`);
      console.log('  (drag to orbit, scroll to zoom - no Minecraft needed)');
      console.log('========================================================\n');
    }
    return true;
  } catch (err) {
    console.warn(`[Viewer] Could not start browser viewer on port ${port}: ${err.message}`);
    console.warn('[Viewer] The build will still run - watch in the Minecraft game instead.\n');
    return false;
  }
}

/**
 * The way every caller should start the view: bind it to a dedicated camera bot that never
 * moves, rather than to a bot that is out there building.
 *
 * prismarine-viewer re-sends chunk columns whenever the bot it is bound to crosses a chunk
 * boundary, and meshes chunk sections asynchronously. Race the two - which a bot walking or
 * teleporting around a build site does constantly - and finished geometry gets thrown away
 * with nothing to re-queue it, so a chunk section stays frozen at whatever it last drew. A
 * cottage build measured 132 unload/reload cycles and rendered as a roofless house with its
 * ridge beam floating in mid-air, while the real world had the whole roof. See src/camera.js.
 *
 * Falls back to binding the view to `opBot` itself if the camera can't connect - a slightly
 * flaky picture beats no picture.
 *
 * @param {import('mineflayer').Bot} opBot - a spawned, OPPED bot (it has to /tp the camera)
 * @param {{ at?: {x,y,z}, serverOptions?: object } & Parameters<typeof startViewer>[1]} [options]
 * @returns {Promise<boolean>} true if the viewer started
 */
export async function attachViewer(opBot, options = {}) {
  if (viewerDisabled() || started) return false;
  const { at, serverOptions = {}, ...viewerOptions } = options;
  try {
    const { Camera } = await import('./camera.js');
    const camera = new Camera();
    await camera.connect(serverOptions, opBot, at || opBot.entity?.position);
    const ok = await startViewer(camera.bot, viewerOptions);
    if (ok) return true;
    camera.disconnect();
  } catch (err) {
    console.warn(`[Viewer] Camera bot unavailable (${err.message}) - falling back to the builder's own view.`);
  }
  return startViewer(opBot, viewerOptions);
}

/** Test hook: reset the one-viewer-per-process guard. */
export function _resetViewerState() {
  started = false;
}
