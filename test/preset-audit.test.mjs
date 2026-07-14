// Preset audit - simulates the crew's ACTUAL parallel build schedule over every library
// preset and applies the game's physics to each placement, so the whole class of "verified
// 0 missing but still wrong in-world" defects is caught offline, with no server.
//
// What verifyBuild can't see, this can:
//   - RACE INVERSIONS. The crew builds in parallel with 3s staggered starts (crew.js), so
//     "later role overwrites an earlier role's block" is a race, not a rule: the decorator
//     usually places a window pane at t=6s while the mason reaches that wall layer at t=60s
//     - and the mason then fills the window back in with stone. verifyBuild only checks for
//     air, so a window that got stoned over reads as "0 missing". Presets must therefore
//     have ZERO cross-role writes to the same coord: openings are carved, never overwritten.
//   - POP-OFFS. /setblock places a torch/lantern/door on air without complaint, and the
//     block only pops when a NEIGHBOR update hits it while its support is still missing.
//     The sim replays every placement in schedule order and fires those neighbor updates.
//   - GRAVITY. Sand/gravel placed over air or water at that moment in the timeline falls.
//   - SOIL. A flower on stone, a crop off farmland, a tuft on gravel - pops silently
//     (verifyBuild deliberately skips POPS_OFF types, so gaps in a garden never count).
//   - DOORS. Both halves present, sturdy support below by the time the upper half lands
//     (that update is what deletes an unsupported door), and the two cells in FRONT of the
//     door clear at the end - a door walled in behind its own base is a defect verify
//     could never express.
//
// Generators are random, so each preset is audited across many seeded runs; any defect on
// any seed fails. Run: npm run test:presets
import { getLibraryPlan, listBuilds } from '../src/library/index.js';
import { buildRoute } from '../src/worker.js';

const STAGGER_MS = 3000;   // crew.js: parallel role start stagger
const BLOCK_MS = 100;      // crew.js: per-block delay in parallel mode
const RUNS = Number(process.env.RUNS) || 60;   // seeds per preset

// --- deterministic RNG so failures are reproducible ------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- block classification ----------------------------------------------------------------
const parseType = (type) => {
  const m = /^([a-z_0-9]+)(?:\[(.*)\])?$/.exec(type);
  if (!m) return null;
  const states = {};
  if (m[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); states[k] = v; }
  return { name: m[1], states };
};

const GRAVITY = /^(sand|red_sand|gravel|.*_concrete_powder)$/;
const FLOWERS = /^(poppy|dandelion|cornflower|oxeye_daisy|blue_orchid|allium|pink_petals)$/;
const CROPS = /^(wheat|carrots)$/;
// valid ground per the 1.20 block tags (flowers may also sit on farmland; saplings/grass may not)
const FLOWER_SOIL = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mud|moss_block|mycelium|farmland)$/;
const PLANT_SOIL = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mud|moss_block|mycelium)$/;
const DEAD_BUSH_SOIL = /^(sand|red_sand|dirt|coarse_dirt|podzol|.*terracotta)$/;
// blocks whose TOP face is not sturdy - nothing that needs solid footing can stand on these
const NOT_STURDY = /(_pane$|_fence$|^fence|_door$|_slab$|_stairs$|_trapdoor$|torch|lantern$|campfire|end_rod|_wall$|^water$|^air$|^farmland$|^dirt_path$|_leaves$)/;
const sturdyTop = (b) => b && b.name !== 'air' && !NOT_STURDY.test(b.name) &&
  !FLOWERS.test(b.name) && !CROPS.test(b.name) && !/^(grass|dead_bush|.*_sapling)$/.test(b.name);
const nonAir = (b) => b && b.name !== 'air' && b.name !== 'water';

// Would this block survive where it stands right now? null = not an attachable, always fine.
function invalidReason(b, at) {
  const below = at(0, -1, 0), above = at(0, 1, 0);
  const { name, states } = b;
  if (name === 'torch') return sturdyTop(below) ? null : 'torch needs a sturdy block below';
  if (name === 'wall_torch') {
    const f = states.facing || 'north';
    const d = { north: [0, 0, 1], south: [0, 0, -1], east: [-1, 0, 0], west: [1, 0, 0] }[f];
    const wall = at(d[0], 0, d[2]);
    return wall && !NOT_STURDY.test(wall.name) && wall.name !== 'air' ? null : `wall_torch needs a wall behind it (facing=${f})`;
  }
  if (/^(lantern|soul_lantern)$/.test(name)) {
    if (states.hanging === 'true') return nonAir(above) ? null : 'hanging lantern needs a block above';
    return nonAir(below) && !FLOWERS.test(below.name) ? null : 'lantern needs a block below';
  }
  if (name === 'campfire') return nonAir(below) ? null : 'campfire needs a block below';
  if (name === 'end_rod') return sturdyTop(below) ? null : 'end_rod needs a full face below';
  if (/_door$/.test(name)) {
    if (states.half === 'upper') return at(0, -1, 0) && /_door$/.test(at(0, -1, 0).name) ? null : 'upper door half without a lower half';
    return sturdyTop(below) ? null : 'door needs a sturdy block below';
  }
  if (FLOWERS.test(name)) return below && FLOWER_SOIL.test(below.name) ? null : `flower on ${below?.name || 'air'}`;
  if (CROPS.test(name)) return below && below.name === 'farmland' ? null : `crop on ${below?.name || 'air'}`;
  if (/^(grass|.*_sapling)$/.test(name)) return below && PLANT_SOIL.test(below.name) ? null : `${name} on ${below?.name || 'air'}`;
  if (name === 'dead_bush') return below && DEAD_BUSH_SOIL.test(below.name) ? null : `dead_bush on ${below?.name || 'air'}`;
  return null;
}
const isAttachable = (b) => invalidReason(b, () => ({ name: 'bedrock', states: {} })) !== null ||
  /torch|lantern$|campfire|end_rod|_door$/.test(b.name) || FLOWERS.test(b.name) || CROPS.test(b.name) ||
  /^(grass|dead_bush|.*_sapling)$/.test(b.name);

// --- the simulation ----------------------------------------------------------------------
function simulate(plan) {
  const issues = [];
  const roles = plan.buildOrder;
  const all = roles.flatMap((r) => plan.assignments[r]?.blocks || []);
  const bbox = {
    minX: Math.min(...all.map((b) => b.x)), maxX: Math.max(...all.map((b) => b.x)),
    minY: Math.min(...all.map((b) => b.y)), maxY: Math.max(...all.map((b) => b.y)),
    minZ: Math.min(...all.map((b) => b.z)), maxZ: Math.max(...all.map((b) => b.z)),
  };

  // The site as the crew finds it: levelSite laid solid ground at y -4..-1, everything above
  // is air - and then executeBuild fills the plan's whole bounding box with air (crew.js),
  // which briefly empties the ground INSIDE the box too. That window is load-bearing: it is
  // exactly how the castle moat once reached the gate before the bridge existed.
  const world = new Map();   // "x,y,z" -> {name, states, role, t}
  const AIR = { name: 'air', states: {} };
  const blockAt = (x, y, z) => {
    const hit = world.get(`${x},${y},${z}`);
    if (hit) return hit;
    const cleared = x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY && z >= bbox.minZ && z <= bbox.maxZ;
    if (y >= -4 && y <= -1 && !cleared) return { name: 'grass_block', states: {}, role: 'ground' };
    return AIR;
  };

  // schedule: role i starts at i*3s, one block per 100ms, in buildRoute order
  const events = [];
  roles.forEach((role, i) => {
    const route = buildRoute(plan.assignments[role]?.blocks || []);
    route.forEach((b, j) => {
      const parsed = parseType(b.type);
      if (!parsed) { issues.push(`unparseable block type "${b.type}" (${role})`); return; }
      events.push({ t: i * STAGGER_MS + j * BLOCK_MS, role, roleIndex: i, x: b.x, y: b.y, z: b.z, ...parsed });
    });
  });
  events.sort((a, b) => a.t - b.t || a.roleIndex - b.roleIndex);

  const overlaps = new Map();   // coord -> [writes...]
  const key = (e) => `${e.x},${e.y},${e.z}`;
  const revalidate = (x, y, z, causeDesc) => {
    const b = world.get(`${x},${y},${z}`);
    if (!b || !isAttachable(b)) return;
    const at = (dx, dy, dz) => blockAt(x + dx, y + dy, z + dz);
    const bad = invalidReason(b, at);
    if (bad) {
      world.delete(`${x},${y},${z}`);
      issues.push(`POP: ${b.name} at (${x},${y},${z}) [${b.role}] popped off when ${causeDesc} - ${bad}`);
      // a popped lower door half takes the upper with it
      if (/_door$/.test(b.name)) world.delete(`${x},${y + 1},${z}`);
    }
  };

  for (const e of events) {
    const prev = blockAt(e.x, e.y, e.z);
    if (prev.role && prev.role !== 'ground' && prev.role !== e.role && prev.name !== 'air') {
      const k = key(e);
      if (!overlaps.has(k)) overlaps.set(k, [{ role: prev.role, name: prev.name, t: prev.t }]);
      overlaps.get(k).push({ role: e.role, name: e.name, t: e.t });
    }

    // leaves must be placed persistent: a fresh leaf starts at distance 7, and a random tick
    // in the window before neighbor updates settle its real distance decays it - one palm
    // leaf per few thousand placed, silently (found live on the temple, 2026-07-13)
    if (/_leaves$/.test(e.name) && e.states.persistent !== 'true')
      issues.push(`LEAVES: ${e.name} at (${e.x},${e.y},${e.z}) [${e.role}] placed without persistent=true - it can decay before its distance settles`);

    // gravity check at the moment of placement
    if (GRAVITY.test(e.name)) {
      const below = blockAt(e.x, e.y - 1, e.z);
      if (below.name === 'air' || below.name === 'water')
        issues.push(`FALL: ${e.name} at (${e.x},${e.y},${e.z}) [${e.role}] placed over ${below.name} at t=${(e.t / 1000).toFixed(1)}s - it falls`);
    }

    world.set(key(e), { name: e.name, states: e.states, role: e.role, t: e.t });

    // /setblock updates the six neighbors - an unsupported attachable pops right here
    revalidate(e.x + 1, e.y, e.z, `${e.name} was set beside it`);
    revalidate(e.x - 1, e.y, e.z, `${e.name} was set beside it`);
    revalidate(e.x, e.y + 1, e.z, `${e.name} was set above it`);
    revalidate(e.x, e.y - 1, e.z, `${e.name} was set below it`);
    revalidate(e.x, e.y, e.z + 1, `${e.name} was set beside it`);
    revalidate(e.x, e.y, e.z - 1, `${e.name} was set beside it`);
  }

  // cross-role writes to one coord are a race, full stop - report every one
  for (const [k, writes] of overlaps) {
    const byTime = writes[writes.length - 1];
    const byRole = [...writes].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role))[writes.length - 1];
    const inverted = byTime.role !== byRole.role;
    issues.push(`OVERLAP${inverted ? ' (RACE-INVERTED)' : ''}: (${k}) written by ${writes.map((w) => `${w.role}:${w.name}@${(w.t / 1000).toFixed(1)}s`).join(' then ')}`);
  }

  // end-state: everything attachable must be valid where it stands
  for (const [k, b] of world) {
    const [x, y, z] = k.split(',').map(Number);
    const at = (dx, dy, dz) => blockAt(x + dx, y + dy, z + dz);
    const bad = invalidReason(b, at);
    if (bad) issues.push(`FRAGILE: ${b.name} at (${k}) [${b.role}] ends the build invalid - ${bad}`);
  }

  // doors: both halves, and daylight in front
  for (const [k, b] of world) {
    if (!/_door$/.test(b.name) || b.states.half !== 'lower') continue;
    const [x, y, z] = k.split(',').map(Number);
    const upper = world.get(`${x},${y + 1},${z}`);
    if (!upper || !/_door$/.test(upper.name)) issues.push(`DOOR: lower half at (${k}) has no upper half`);
    const f = b.states.facing || 'north';
    const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[f];
    for (const dy of [0, 1]) {
      const front = blockAt(x + d[0], y + dy, z + d[1]);
      if (front.name !== 'air' && !/_pane$|torch|lantern/.test(front.name))
        issues.push(`DOOR: (${k}) is blocked - ${front.name} [${front.role}] stands in front of it (facing=${f})`);
    }
  }

  // aesthetics: a roof built of stairs that all face default-north reads as broken shingles
  for (const [k, b] of world)
    if (/_stairs$/.test(b.name) && !b.states.facing) issues.push(`STAIRS: ${b.name} at (${k}) [${b.role}] has no facing - renders as a default-north step`);

  return issues;
}

// --- run ---------------------------------------------------------------------------------
const realRandom = Math.random;
let failed = 0;
for (const { id } of listBuilds()) {
  const distinct = new Map();   // issue signature -> {count, example, seeds}
  for (let seed = 1; seed <= RUNS; seed++) {
    Math.random = mulberry32(seed * 0x9e3779b9);
    let plan;
    try { plan = getLibraryPlan(id); } finally { Math.random = realRandom; }
    for (const issue of simulate(plan)) {
      const sig = issue.replace(/\(-?\d+,-?\d+,-?\d+\)/g, '(x,y,z)').replace(/@[\d.]+s/g, '').replace(/t=[\d.]+s/g, '');
      if (!distinct.has(sig)) distinct.set(sig, { count: 0, example: issue, seeds: [] });
      const d = distinct.get(sig);
      d.count++;
      if (d.seeds.length < 3) d.seeds.push(seed);
    }
  }
  if (distinct.size === 0) {
    console.log(`✓ ${id}: clean across ${RUNS} runs`);
  } else {
    failed++;
    console.log(`✗ ${id}: ${distinct.size} distinct issue(s) across ${RUNS} runs`);
    for (const [, d] of distinct) console.log(`    [x${d.count}, seeds ${d.seeds.join(',')}] ${d.example}`);
  }
}
process.exit(failed ? 1 : 0);
