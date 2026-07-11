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
 * @param {{ port?: number, firstPerson?: boolean }} [options]
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
    });
    started = true;
    console.log('\n========================================================');
    console.log(`  WATCH IN YOUR BROWSER:  http://localhost:${port}`);
    console.log('  (drag to orbit, scroll to zoom - no Minecraft needed)');
    console.log('========================================================\n');
    return true;
  } catch (err) {
    console.warn(`[Viewer] Could not start browser viewer on port ${port}: ${err.message}`);
    console.warn('[Viewer] The build will still run - watch in the Minecraft game instead.\n');
    return false;
  }
}

/** Test hook: reset the one-viewer-per-process guard. */
export function _resetViewerState() {
  started = false;
}
