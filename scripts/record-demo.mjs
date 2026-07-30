// Record the hero clip: a headless browser watches the built-in 3D view while the crew builds,
// then the footage is cut into a two-speed timelapse (fast build, slow reveal orbit).
//
//   npm run web                 # in one terminal - the recorder drives THIS panel
//   npm run record              # in another
//   npm run record -- --preset=wizardTower --scene=snowy --size=1280x720
//
// Needs `npx playwright install chromium` (or a `playwright` install) and `ffmpeg` on PATH.
// Neither is a runtime dependency - this is a content tool, and the repo's own tests
// deliberately need no browser.
//
// Two things about the camera are load-bearing, both learned the hard way:
//   - It is ORBITED, never panned or dollied. The viewer meshes chunk sections asynchronously
//     and drops finished geometry for sections it thinks are unloaded; a camera that travels
//     out of the meshed region comes back to an empty blue frame. Rotating around a fixed
//     target keeps every section in view and in memory.
//   - The orbit happens only AFTER the build is done. During the build the camera holds
//     perfectly still, which is what makes the footage speed up cleanly.
import { spawn } from 'child_process';
import { mkdir, rm, readdir, stat } from 'fs/promises';
import path from 'path';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const PANEL = `http://localhost:${process.env.WEB_PORT || 8080}`;
const PRESET = arg('preset', 'castle');
const SCENE = arg('scene', 'cherry');
const [OUT_W, OUT_H] = arg('size', '1280x720').split('x').map(Number);
const BUILD_SPEED = Number(arg('build-speed', 33));    // timelapse factor while building
const REVEAL_SPEED = Number(arg('reveal-speed', 4.5)); // gentler, for the final orbit
const OUT_DIR = arg('out', 'docs/media');
const NAME = arg('name', `crew-${PRESET}-timelapse`);

// Every rendered deliverable carries a DMMMYYYY stamp (e.g. 13JUL2026) at the end of the name.
const dateStamp = (d = new Date()) => {
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${d.getDate()}${M[d.getMonth()]}${d.getFullYear()}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[record] ${m}`);

// The panel shares one event loop with the bots, and laying a scene is thousands of /fill
// commands - it can take many seconds to answer. Retry rather than mistake "busy" for "down".
async function panel(pathname, body, { tries = 20 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(PANEL + pathname, {
        signal: AbortSignal.timeout(30000),
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      return await res.json();
    } catch (e) { last = e; await sleep(3000); }
  }
  throw new Error(`the panel at ${PANEL} never answered ${pathname} (${last?.message})`);
}
const status = () => panel('/status');

async function waitIdle(what, timeoutMs = 900000) {
  const t0 = Date.now();
  for (;;) {
    const s = await status();
    if (!s.busy) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(2000);
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} failed:\n${err.slice(-1500)}`))));
  });
}
const probeDuration = (f) => run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', f]).then(Number);

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('This needs Playwright: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  let s;
  try { s = await status(); } catch {
    console.error(`No control panel on ${PANEL}. Start one first:  npm run web`);
    process.exit(1);
  }
  if (s.busy) say('the panel is busy (a build or a scene) - waiting for it to finish...');

  const tmp = path.join('/tmp', `mc-record-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Move to the backdrop BEFORE recording, so the clip opens on a finished scene rather than
  // on the crew laying a platform. A scene is built once and cached, so this is usually a teleport.
  //
  // The panel refuses work while it is busy (it answers {error:'busy'}) and it may still be
  // laying its default scene when we arrive. Ignoring that answer is how a run ended up
  // recording the wrong plot - so wait for it to be free, then insist the switch was accepted.
  say(`scene: ${SCENE}`);
  await waitIdle('the panel to be free');
  for (let i = 0; ; i++) {
    const res = await panel('/background', { background: SCENE });
    if (res.ok) break;
    if (i >= 10) throw new Error(`the panel would not switch scene: ${res.error}`);
    await sleep(5000);
    await waitIdle('the panel to be free');
  }
  await sleep(1500);
  await waitIdle('the scene');
  const now = await status();
  if (now.background !== SCENE) throw new Error(`scene is "${now.background}", expected "${SCENE}"`);

  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: OUT_W, height: OUT_H },
    recordVideo: { dir: tmp, size: { width: OUT_W, height: OUT_H } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();                       // the video's own clock starts about here
  const at = () => (Date.now() - t0) / 1000;

  // The viewer page directly, not the panel - the clip is the world, not the UI.
  await page.goto(`${PANEL}/viewer/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cam && Math.abs(window.__cam.position.x) > 1,
    null, { timeout: 120000 });
  say('camera up - letting the world stream in');
  await sleep(20000);                          // chunks arrive and mesh

  // Frame the shot BEFORE the crew starts. The panel points the camera at the site, which puts
  // the build in the middle of the picture but close; pulling back a few notches fits the whole
  // thing with some scene around it. Dollying the orbit camera moves no bot and loads no chunk,
  // so it costs nothing - but do it now, because once blocks start landing the view must hold
  // still (a moving view is what freezes chunk meshes mid-build).
  const box0 = await page.locator('canvas').boundingBox();
  await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  for (let i = 0; i < Number(arg('zoom', 4)); i++) { await page.mouse.wheel(0, 240); await sleep(400); }
  await sleep(6000);

  say(`building: ${PRESET}`);
  const tBuild = at();
  await panel('/build', { preset: PRESET });
  await sleep(3000);
  const done = await waitIdle('the build');
  const tDone = at();

  // Never publish a clip of a build that didn't happen. A worker that drops mid-build (or a
  // panel that gets killed) leaves a half-built shell and the panel reports it - without this
  // check the recorder cheerfully cut a 40-second timelapse of a castle that was never finished
  // and overwrote a good take with it.
  if (done.phase === 'error' || !done.last?.blocks) {
    await ctx.close(); await browser.close();
    await rm(tmp, { recursive: true, force: true });
    throw new Error(`the build did not finish (${done.last?.name || done.phase}) - nothing recorded. `
      + 'Check the panel log, then run this again.');
  }
  say(`built in ${Math.round(tDone - tBuild)}s: ${done.last?.name} (${done.last?.blocks} blocks)`);
  await sleep(4000);                           // hold on the finished build

  // Reveal orbit: one slow, single-direction sweep. Rotation only (see the header).
  say('reveal orbit');
  const box = await page.locator('canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 90; i++) {
    await page.mouse.move(cx + i * 4, cy - Math.min(i, 30), { steps: 1 });
    await sleep(90);
  }
  await page.mouse.up();
  await sleep(3000);
  const tEnd = at();

  await ctx.close();                           // flushes the video file
  await browser.close();

  const raw = path.join(tmp, (await readdir(tmp)).find((f) => f.endsWith('.webm')));
  say('editing...');

  // Map wall-clock seconds onto the RECORDING's own timeline before trimming anything.
  // Playwright's screencast captures whatever frames the (software-rendered) page manages to
  // produce and muxes them at a fixed rate, so the file's clock is NOT wall time: a 200-second
  // session came out as a ~580-second video. Trimming at raw wall-clock timestamps therefore cut
  // the wrong moments and stretched the result to 52s when 18s was asked for. One scale factor
  // fixes it, and it also has to divide the speed-ups, or the timelapse is off by the same ratio.
  const rawDur = await probeDuration(raw);
  const k = rawDur / tEnd;                       // recorded seconds per wall second
  const t = (wall) => (wall * k).toFixed(3);
  const buildSpeed = BUILD_SPEED * k;
  const revealSpeed = REVEAL_SPEED * k;

  // Two-speed cut: the build races by, the reveal breathes. Trim the pre-build idle entirely.
  const a = Math.max(0, tBuild - 1);
  const filter =
    `[0:v]trim=start=${t(a)}:end=${t(tDone + 4)},setpts=(PTS-STARTPTS)/${buildSpeed.toFixed(3)}[b];` +
    `[0:v]trim=start=${t(tDone + 4)}:end=${t(tEnd)},setpts=(PTS-STARTPTS)/${revealSpeed.toFixed(3)}[r];` +
    `[b][r]concat=n=2:v=1:a=0[v]`;

  const stamp = dateStamp();
  const mp4 = path.join(OUT_DIR, `${NAME}-${OUT_W}x${OUT_H}-${stamp}.mp4`);
  const webpW = Number(arg('webp-width', 800));
  const webpH = Math.round((webpW / OUT_W) * OUT_H / 2) * 2;
  const webp = path.join(OUT_DIR, `${NAME}-${webpW}x${webpH}-${stamp}.webp`);

  // The full-quality master. Keep it for editing / uploading elsewhere.
  await run('ffmpeg', ['-y', '-i', raw, '-filter_complex', filter, '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);

  // The README embeds an animated WebP: GitHub renders it inline, no player, no autoplay policy
  // to fight. It also has to be SMALL - it loads on every visit to the repo. 800px at 10fps with
  // real (lossy) compression lands around 4-6MB for a two-minute build; 960px at 12fps and q55
  // produced 35MB, which is not a README asset, it's a download.
  await run('ffmpeg', ['-y', '-i', mp4, '-vf', `fps=10,scale=${webpW}:-1:flags=lanczos`,
    '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(arg('webp-quality', 38)),
    '-compression_level', '6', '-loop', '0', '-preset', 'picture', '-an', '-vsync', '0', webp]);

  await rm(tmp, { recursive: true, force: true });
  const mb = async (f) => Math.round((await stat(f)).size / 1e5) / 10;
  const dur = await probeDuration(mp4);
  say(`${Math.round(dur)}s clip`);
  say(`mp4:  ${mp4} (${await mb(mp4)} MB)`);
  say(`webp: ${webp} (${await mb(webp)} MB)   <- embed this in the README`);
  if (await mb(webp) > 8) say('WARNING: that WebP is heavy for a README - raise --webp-quality or drop --webp-width.');
}

main().catch((e) => { console.error('[record]', e.message); process.exit(1); });
