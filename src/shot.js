// Photograph the build.
//
// The browser viewer already renders the world for humans; this points a headless browser at
// the same page and takes pictures, so a model can look at the build too (src/critic.js). It is
// the input half of APT's multimodal loop
// (github.com/spearsheep/APT-Architectural-Planning-LLM-Agent) - a coordinate list can tell a
// model what it asked for, and only a picture can tell it what it got.
//
// Everything here is best-effort and OPTIONAL. Playwright is a devDependency (the repo's own
// tests deliberately need no browser), so a machine without it simply gets no critique and a
// normal build. It must never take a build down.
//
// The camera is ORBITED between shots, never panned or dollied, for the same reason
// scripts/record-demo.mjs orbits: rotating around a fixed target keeps every chunk section in
// view and in memory, while travelling out of the meshed region comes back to an empty frame.
// And it only ever runs AFTER a build, with the camera bot standing still - see src/camera.js.

import { VIEWER_HOOK_JS } from './viewer-hook.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Take `angles.length` screenshots of the live viewer, orbiting between each.
 *
 * @param {{ url: string, angles?: number[], size?: {width:number,height:number},
 *           settleMs?: number, zoom?: number, log?: Function }} opts
 *   `angles` are horizontal drags in pixels from the starting view - [0, 340, 680] gives roughly
 *   three sides of the building. `settleMs` is how long to let chunks stream and mesh.
 * @returns {Promise<Array<{data: string, mediaType: string}>>} base64 PNGs, or [] on any failure
 */
export async function shootBuild(opts = {}) {
  const {
    url,
    angles = [0, 340, 680],
    size = { width: 900, height: 640 },
    settleMs = Number(process.env.SHOT_SETTLE_MS || 12000),
    zoom = 4,
    log = console.log,
  } = opts;

  if (!url) return [];

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    log('[Shot] Playwright is not installed - skipping the visual review. ' +
        '(npm i -D playwright && npx playwright install chromium)');
    return [];
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
    const page = await browser.newPage({ viewport: size });
    // The hook has to be in place BEFORE the viewer's bundle runs, or the renderer it wants to
    // catch has already been constructed and announced.
    await page.addInitScript(VIEWER_HOOK_JS);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // A camera at the origin means the page never received a position and is rendering empty
    // sky - photographing that would hand the model a blue rectangle and ask it what's wrong
    // with the roof. The viewer re-announces the camera bot's position every second precisely
    // so a page that connects between builds gets one (see src/viewer.js).
    await page.waitForFunction(
      () => window.__cam && Math.abs(window.__cam.position.x) + Math.abs(window.__cam.position.z) > 1,
      null, { timeout: 60000 }
    );
    await sleep(settleMs);

    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('the viewer page has no canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Pull back so the whole structure is in frame rather than filling it. Zooming the orbit
    // camera moves no bot and loads no chunk, so it is free.
    await page.mouse.move(cx, cy);
    for (let i = 0; i < zoom; i++) { await page.mouse.wheel(0, 240); await sleep(300); }
    await sleep(1500);

    const shots = [];
    let at = 0;
    for (const angle of angles) {
      if (angle !== at) {
        await orbit(page, cx, cy, angle - at);
        at = angle;
        await sleep(2500);   // let the newly-facing geometry finish drawing
      }
      const png = await page.screenshot({ type: 'png' });
      shots.push({ data: png.toString('base64'), mediaType: 'image/png' });
    }
    log(`[Shot] ${shots.length} view${shots.length === 1 ? '' : 's'} of the build captured.`);
    return shots;
  } catch (err) {
    log(`[Shot] Could not photograph the build (${err.message}) - skipping the visual review.`);
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}

// Drag the orbit control by `dx` pixels, in small steps - the viewer's controls treat one big
// jump as a flick and overshoot.
async function orbit(page, cx, cy, dx) {
  const steps = Math.max(1, Math.round(Math.abs(dx) / 20));
  const per = dx / steps;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + per * i, cy, { steps: 1 });
    await sleep(40);
  }
  await page.mouse.up();
}
