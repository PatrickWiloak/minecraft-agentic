// Fix prismarine-viewer's "stairs are air" bug in the installed package.
//
// viewer/lib/models.js (and its webpack bundle public/worker.js, which is what the BROWSER
// actually runs) skips model lookup for any block whose name contains the substring "air" -
// meant for air/cave_air/void_air, but "stAIRs" matches too, so every stair block in the
// game meshes to zero geometry and simply does not exist in the browser view. That is why
// a finished cottage rendered as a roofless shell with its slab ridge floating in mid-air
// (slabs render; the stairs under them don't), and why the castle's tower cones showed as
// floating apex caps. The world was always right; the picture wasn't. Found 2026-07-13.
//
// Patching the installed files is the only option: the browser loads the PREBUILT bundle,
// so fixing the source alone changes nothing. Idempotent - safe to run any number of times.
// Wired into `postinstall` (fresh installs) AND called from src/viewer.js at startup
// (existing installs, and belt-and-suspenders if npm ever reinstalls the package).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

export function patchViewer({ quiet = false } = {}) {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('prismarine-viewer/package.json'));
  } catch {
    return { patched: 0, ok: false, reason: 'prismarine-viewer not installed' };
  }

  const targets = [
    {
      file: path.join(pkgDir, 'viewer/lib/models.js'),
      from: /(\w+)\.name\.includes\('air'\)/g,
      to: "($1.name === 'air' || $1.name.endsWith('_air'))",
    },
    {
      file: path.join(pkgDir, 'public/worker.js'),
      from: /(\w+)\.name\.includes\("air"\)/g,
      to: '($1.name==="air"||$1.name.endsWith("_air"))',
    },
    {
      // the main-thread bundle carries the same mesher for the primitives path
      file: path.join(pkgDir, 'public/index.js'),
      from: /(\w+)\.name\.includes\("air"\)/g,
      to: '($1.name==="air"||$1.name.endsWith("_air"))',
    },
  ];

  let patched = 0;
  for (const t of targets) {
    if (!fs.existsSync(t.file)) continue;
    const src = fs.readFileSync(t.file, 'utf8');
    if (!t.from.test(src)) continue;   // already patched (or upstream fixed it)
    fs.writeFileSync(t.file, src.replace(t.from, (m, v) => t.to.replace(/\$1/g, v)));
    patched++;
    if (!quiet) console.log(`[patch-viewer] fixed stairs-are-air in ${path.relative(pkgDir, t.file)}`);
  }
  return { patched, ok: true };
}

// Verify mode for tests: exit 1 if the installed files still carry the bug.
export function checkViewer() {
  const pkgDir = path.dirname(require.resolve('prismarine-viewer/package.json'));
  const bad = [];
  for (const rel of ['viewer/lib/models.js', 'public/worker.js', 'public/index.js']) {
    const f = path.join(pkgDir, rel);
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/\w+\.name\.includes\(['"]air['"]\)/.test(src)) bad.push(rel);
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = checkViewer();
    if (bad.length) {
      console.error(`[patch-viewer] UNPATCHED - stairs will be invisible in the browser: ${bad.join(', ')}`);
      console.error('[patch-viewer] run: node scripts/patch-viewer.js');
      process.exit(1);
    }
    console.log('[patch-viewer] ok - stairs render in the browser view');
  } else {
    const res = patchViewer();
    if (!res.ok) { console.error(`[patch-viewer] ${res.reason}`); process.exit(1); }
    console.log(res.patched ? `[patch-viewer] patched ${res.patched} file(s)` : '[patch-viewer] already patched - nothing to do');
  }
}
