// Regression test for click-to-place (`npm run test:pick`).
//
// Clicking the 3D view to choose where the crew builds is the one feature that reaches into
// prismarine-viewer's internals: the page reads the camera the proxy hook parks on the viewer's
// window, unprojects the cursor through it, and intersects the ray with the scene's ground plane
// (the viewer's scene is in real world coordinates, so the hit IS the block coordinate).
//
// A browser isn't needed to check any of that - only three.js is. So this rebuilds the viewer's
// exact camera (prismarine-viewer/lib/index.js: PerspectiveCamera(75, w/h, 0.1, 1000) placed at
// botPos + (0,20,20), OrbitControls aimed at botPos) and runs the REAL pickGround(), lifted out
// of the page source in scripts/web.js so this test can never drift from the code it covers.
import * as THREE from 'three';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, 'scripts/web.js'), 'utf8');

// Lift pickGround() out of the served page, so we test the shipped code and not a copy of it.
const m = src.match(/function pickGround\(w, e\) \{[\s\S]*?\n {2}\}/);
if (!m) {
  console.error('FAIL  could not find pickGround() in scripts/web.js - did the page change?');
  process.exit(1);
}
const surfaceY = 72;   // STAGE_Y: the top face of every scene's ground
const pickGround = new Function('surfaceY', `return (${m[0]});`)(surfaceY);

// The viewer's camera, as prismarine-viewer sets it up on its first position update.
const W = 1200, H = 800;
const bot = { x: -154, y: surfaceY, z: -48 };
function viewerCamera(pos, target) {
  const cam = new THREE.PerspectiveCamera(75, W / H, 0.1, 1000);
  cam.position.set(pos.x, pos.y, pos.z);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
// pickGround() reads its camera off the viewer's window and the cursor off a DOM event. The fake
// window here deliberately carries NOTHING but the camera - no THREE. That is the real page: the
// viewer's bundle keeps three.js in module scope, so anything pickGround() needs it has to get
// from the camera instance itself. Handing it a THREE (which this test used to do) mocks away the
// exact condition that made every click a no-op in the browser while this file reported PASS.
const click = (cam, x, y) => pickGround({ __cam: cam, innerWidth: W, innerHeight: H }, { clientX: x, clientY: y });

let failed = 0;
const pass = (ok, name, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const cam = viewerCamera({ x: bot.x, y: bot.y + 20, z: bot.z + 20 }, bot);

// The load-bearing assertion. The camera is aimed straight at the bot, so a click dead centre
// MUST come back as the bot's own coordinates. If the unprojection, the ray, the ground plane
// or the world-coordinate assumption were wrong, this is where it shows.
const centre = click(cam, W / 2, H / 2);
pass(centre && Math.hypot(centre.x - bot.x, centre.z - bot.z) <= 2,
  'click at centre lands on the bot the camera looks at',
  `got (${centre && centre.x}, ${centre && centre.z}) want (${bot.x}, ${bot.z})`);

// Lower on screen = nearer the camera. Catches an inverted vertical axis, which would put every
// build on the wrong side of the crew.
const low = click(cam, W / 2, H * 0.75);
pass(low && low.z > bot.z, 'clicking lower on screen moves the spot toward the camera', `z ${low && low.z} > ${bot.z}`);

// Catches a mirrored horizontal axis.
const left = click(cam, W * 0.25, H / 2);
const right = click(cam, W * 0.75, H / 2);
pass(left && right && left.x < bot.x && right.x > bot.x,
  'horizontal axis is not mirrored', `left ${left && left.x} < ${bot.x} < right ${right && right.x}`);

// A ray that can never meet the ground (orbited under the platform, looking further down) must be
// refused. A naive plane intersection cheerfully returns the point BEHIND the camera instead.
const under = viewerCamera({ x: bot.x, y: surfaceY - 30, z: bot.z + 20 }, { x: bot.x, y: surfaceY - 50, z: bot.z });
pass(click(under, W / 2, H / 2) === null, 'a ray pointing away from the ground is refused');

// A near-horizontal ray meets the plane thousands of blocks away - refuse it rather than report
// a wild spot the crew would then be asked to build on.
const grazing = viewerCamera({ x: bot.x, y: surfaceY + 1, z: bot.z + 20 }, { x: bot.x, y: surfaceY + 0.999, z: bot.z - 900 });
pass(click(grazing, W / 2, H / 2) === null, 'a near-horizontal ray is refused, not reported as a spot');

// --- the hook: does the page get a camera at all? --------------------------------------------
// Everything above tests the MATH, and the math was never wrong. The bug was upstream of it: the
// proxy's injected hook waited for the viewer to assign `window.THREE`, which the browser bundle
// never does (that line lives in prismarine-viewer's NODE entry, lib/index.js). So `__cam` stayed
// undefined, pickGround() returned null on every click, and "Pick a spot" silently did nothing -
// with this file green the whole time, because it handed pickGround a camera directly. These
// checks run the REAL injected script and hold it against the REAL installed bundle.

// 1. Run the actual hook against a fake three.js renderer and see if it parks the camera.
const hookSrc = (src.match(/const VIEWER_HOOK = `<script>([\s\S]*?)<\/script>`/) || [])[1];
if (!hookSrc) {
  pass(false, 'VIEWER_HOOK found in scripts/web.js');
} else {
  const win = {};
  new Function('window', hookSrc)(win);
  const devtools = win.__THREE_DEVTOOLS__;
  pass(!!devtools && typeof devtools.dispatchEvent === 'function',
    'the hook installs a __THREE_DEVTOOLS__ listener before the bundle loads');
  if (devtools) {
    // three.js observes Scenes through the same channel - the hook must not mistake one for the renderer.
    devtools.dispatchEvent({ type: 'observe', detail: { type: 'Scene', isScene: true } });
    const renderer = {
      domElement: {}, seen: null, target: null,
      getRenderTarget() { return this.target; },
      render(scene, camera) { this.seen = camera; return 'rendered'; },
    };
    devtools.dispatchEvent({ type: 'observe', detail: renderer });
    const out = renderer.render('scene', cam);
    pass(win.__cam === cam, 'the hook captures the live camera off the renderer it observes');
    pass(renderer.seen === cam && out === 'rendered', 'the wrapped render() still renders (camera and return value intact)');
    // The viewer's sky is a CubeCamera pass through the SAME render(): 6 faces drawn to a
    // cube render target with cameras parked at the origin. The hook must ignore any pass
    // that isn't going to the screen, or __cam flips to an identity camera every frame and
    // picks miss the ground at random.
    const cubeFaceCam = new THREE.PerspectiveCamera(90, 1, 0.1, 10);
    renderer.target = { isWebGLCubeRenderTarget: true };
    renderer.render('scene', cubeFaceCam);
    pass(win.__cam === cam, 'an off-screen pass (CubeCamera sky) does not steal the parked camera');
    renderer.target = null;
  }
}

// 3. The drag guard must arm on POINTERDOWN, not mousedown. The bundle's orbit controls
// preventDefault() their pointerdown, and per the Pointer Events spec a canceled pointerdown
// suppresses the compatibility mousedown entirely - while click still fires. A mousedown-armed
// guard therefore never arms, reads every click as a drag from (0,0), and eats it silently.
pass(/doc\.addEventListener\('pointerdown', \(e\) => \{ sx = e\.clientX; sy = e\.clientY; \}\)/.test(src),
  'the page arms its click-vs-drag guard on pointerdown');
pass(!/doc\.addEventListener\('mousedown'/.test(src),
  'the page does not listen for mousedown in the viewer doc (suppressed by the controls)');

// 2. Hold the hook against the installed viewer: it must talk to a global the bundle really uses.
const bundle = path.join(root, 'node_modules/prismarine-viewer/public/index.js');
if (!existsSync(bundle)) {
  console.log('SKIP  prismarine-viewer not installed - hook/bundle handshake unchecked');
} else {
  const js = readFileSync(bundle, 'utf8');
  pass(js.includes('__THREE_DEVTOOLS__') && hookSrc && hookSrc.includes('__THREE_DEVTOOLS__'),
    'the shipped bundle dispatches to the same global the hook listens on');
  pass(!/(?:window|global|globalThis)\.THREE\s*=/.test(js),
    'the bundle still does NOT set window.THREE - nothing may wait for it',
    '(if this ever fails, prismarine-viewer changed; the hook may be simplified)');
}

console.log(failed ? `\n${failed} failure(s)` : '\nAll click-to-place checks passed.');
process.exit(failed ? 1 : 0);
