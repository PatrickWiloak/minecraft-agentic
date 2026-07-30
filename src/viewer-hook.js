// The one way to get hold of prismarine-viewer's camera from outside its bundle.
//
// prismarine-viewer's BROWSER bundle puts nothing on `window` - not even THREE. (The
// `global.THREE = require('three')` line belongs to lib/index.js and lib/headless.js, which are
// the NODE entry points; the bundle the browser runs keeps three.js in module scope and exports
// nothing. A hook that waits for window.THREE waits forever, which is how click-to-place spent
// its entire life silently returning "no hit" on every click.)
//
// What the bundle DOES offer is three.js's own devtools handshake: every WebGLRenderer and Scene
// it constructs dispatches an 'observe' CustomEvent - whose `detail` IS the object - at
// `window.__THREE_DEVTOOLS__`, if one exists. So define one before the bundle loads, catch the
// renderer, and wrap its render(), which is handed the live camera every single frame. That
// handshake is a supported three.js API (r128 here), not a bundle internal.
//
// Two consumers, which is why this is a module and not a string inside one of them:
//   - scripts/web.js injects it into the viewer page it proxies, for click-to-place.
//   - src/shot.js injects it into a headless page, so the visual critic can wait for a camera
//     that actually has a position before it photographs the build.
// test/pick-ground.test.mjs runs THIS source against a fake renderer and asserts the real
// prismarine-viewer bundle on disk still dispatches to the global it depends on.

export const VIEWER_HOOK_JS = `
(function () {
  var hooked = false;
  try {
    window.__scenes = [];
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent: function (e) {
        var o = e && e.detail;
        // Scenes announce themselves here too - collect them ALL (the panel's loading
        // overlay reads the biggest one's child count as its mesh-progress signal; the
        // sky's cube-map scene stays tiny, so taking the max skips it automatically)...
        if (o && o.isScene && window.__scenes.indexOf(o) < 0) window.__scenes.push(o);
        // ...but the renderer is the one with a canvas.
        if (hooked || !o || typeof o.render !== 'function' || !o.domElement) return;
        hooked = true;
        var render = o.render.bind(o);
        // Only the to-screen pass carries the user's camera. The viewer also renders the
        // scene through this same render() for its sky: a CubeCamera pass drawing 6 faces
        // to a cube render target with cameras parked at the origin - park one of THOSE
        // and every pick unprojects through an identity camera and misses the ground.
        o.render = function (scene, camera) {
          if (!o.getRenderTarget || o.getRenderTarget() === null) window.__cam = camera;
          return render(scene, camera);
        };
      },
    };
  } catch (e) { /* viewer still works, placement falls back to auto */ }
})();
`;

/** The hook as a <script> tag, for injecting into the viewer's HTML. */
export const VIEWER_HOOK_TAG = `<script>${VIEWER_HOOK_JS}</script>`;
