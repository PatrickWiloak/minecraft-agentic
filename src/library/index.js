// Built-in build library - no LLM, no API key, no GPU. Procedural generators emit
// crew-format plans (blocks in RELATIVE coords, split across the 4 worker roles), so
// they run through the exact same crew as an AI-generated build. Each call randomizes
// size/palette so no two builds look identical. This is the zero-friction default that
// everyone gets on `npm run play` without a key.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// weighted pick: pass [item, weight] pairs
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of pairs) { if ((r -= w) <= 0) return item; }
  return pairs[0][0];
};

// Cache circle geometry so repeated rings/discs are cheap and, crucially, GAP-FREE.
const _rim = new Map();
const _disc = new Map();
// The set of (dx,dz) offsets that form a 1-block-thick, gap-free circle outline of radius r.
function rimPoints(r) {
  if (_rim.has(r)) return _rim.get(r);
  const pts = [];
  const outer = (r + 0.5) ** 2, inner = (r - 0.5) ** 2;
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= outer && d2 >= inner) pts.push([dx, dz]);
    }
  _rim.set(r, pts);
  return pts;
}
// The set of (dx,dz) offsets that fill a solid disc of radius r.
function discPoints(r) {
  if (_disc.has(r)) return _disc.get(r);
  const pts = [];
  const outer = (r + 0.5) ** 2;
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++)
      if (dx * dx + dz * dz <= outer) pts.push([dx, dz]);
  _disc.set(r, pts);
  return pts;
}

// A role-bucketed block collector. Primitives append {x,y,z,type} to one role's list.
function makeCanvas() {
  const roles = { mason: [], carpenter: [], decorator: [], landscaper: [] };
  const api = {
    roles,
    put(role, x, y, z, type) { roles[role].push({ x, y, z, type }); },
    // filled solid box (inclusive)
    box(role, x0, y0, z0, x1, y1, z1, type) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
            roles[role].push({ x, y, z, type });
    },
    // four vertical walls of a rectangle (perimeter only), y0..y1. `type` may be a
    // function (x,z,y)=>blockId for textured masonry.
    walls(role, x0, z0, x1, z1, y0, y1, type) {
      const t = typeof type === 'function' ? type : () => type;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++)
            if (x === x0 || x === x1 || z === z0 || z === z1) roles[role].push({ x, y, z, type: t(x, z, y) });
    },
    // flat rectangular slab at height y. `type` may be a function (x,z)=>blockId.
    floor(role, x0, z0, x1, z1, y, type) {
      const t = typeof type === 'function' ? type : () => type;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) roles[role].push({ x, y, z, type: t(x, z) });
    },
    // gap-free hollow cylinder wall, radius r, from y0..y1
    cyl(role, cx, cz, r, y0, y1, type) {
      const t = typeof type === 'function' ? type : () => type;
      const pts = rimPoints(r);
      for (let y = y0; y <= y1; y++) for (const [dx, dz] of pts) roles[role].push({ x: cx + dx, y, z: cz + dz, type: t(cx + dx, cz + dz, y) });
    },
    // gap-free filled disc at height y
    disc(role, cx, cz, r, y, type) {
      const t = typeof type === 'function' ? type : () => type;
      for (const [dx, dz] of discPoints(r)) roles[role].push({ x: cx + dx, y, z: cz + dz, type: t(cx + dx, cz + dz) });
    },
    // single gap-free ring at height y
    ring(role, cx, cz, r, y, type) {
      for (const [dx, dz] of rimPoints(r)) roles[role].push({ x: cx + dx, y, z: cz + dz, type });
    },
    // stepped cone / spire: radius r0 at y0, shrinking to a point going up
    cone(role, cx, cz, r0, y0, type) {
      for (let level = 0; level <= r0; level++) {
        const r = r0 - level, y = y0 + level;
        if (r <= 0) { roles[role].push({ x: cx, y, z: cz, type }); continue; }
        for (const [dx, dz] of rimPoints(r)) roles[role].push({ x: cx + dx, y, z: cz + dz, type });
      }
    },
    // remove any placed blocks matching a predicate (for carving doors/windows)
    carve(role, pred) { roles[role] = roles[role].filter((b) => !pred(b)); },
  };
  return api;
}

function finalize(name, description, canvas, teamChat) {
  const assignments = {};
  for (const role of ['mason', 'carpenter', 'decorator', 'landscaper']) {
    // de-dupe blocks at the same coord (last write wins) to keep counts honest
    const seen = new Map();
    for (const b of canvas.roles[role]) seen.set(`${b.x},${b.y},${b.z}`, b);
    assignments[role] = { task: ROLE_TASKS[role], blocks: [...seen.values()] };
  }
  return {
    name,
    description,
    assignments,
    buildOrder: ['mason', 'carpenter', 'decorator', 'landscaper'],
    teamChat,
  };
}

const ROLE_TASKS = {
  mason: 'Stone structure - walls, towers, foundations',
  carpenter: 'Woodwork - roofs, floors, doors, framing',
  decorator: 'Windows, lighting, and finishing details',
  landscaper: 'Grounds - grass, gardens, water',
};

// Weathered stone mix - mostly clean bricks with occasional cracked/mossy for texture.
const stoneMix = () => weighted([
  ['stone_bricks', 8], ['cracked_stone_bricks', 2], ['mossy_stone_bricks', 2], ['chiseled_stone_bricks', 1],
]);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function castle() {
  const c = makeCanvas();
  const S = randInt(18, 24);           // courtyard span
  const H = randInt(6, 8);             // curtain-wall height
  const roof = pick(['dark_oak_stairs', 'spruce_stairs', 'deepslate_tile_stairs']);
  const flag = pick(['red_wool', 'blue_wool', 'purple_wool', 'yellow_wool']);
  const mid = Math.floor(S / 2);

  // --- Landscaper: lawn, 2-wide moat, and a bridge to the gate ---
  c.floor('landscaper', -5, -5, S + 5, S + 5, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let d = 2; d <= 3; d++) {
    for (let x = -d; x <= S + d; x++) { c.put('landscaper', x, -1, -d, 'water'); c.put('landscaper', x, -1, S + d, 'water'); }
    for (let z = -d; z <= S + d; z++) { c.put('landscaper', -d, -1, z, 'water'); c.put('landscaper', S + d, -1, z, 'water'); }
  }
  // stone-brick bridge across the front moat to the gate
  for (let z = -3; z <= 0; z++) { c.put('landscaper', mid, -1, z, 'stone_bricks'); c.put('landscaper', mid + 1, -1, z, 'stone_bricks'); }

  // --- Mason: curtain walls with a crenellated parapet ---
  c.walls('mason', 0, 0, S, S, 0, H - 1, stoneMix);
  // merlons (alternating blocks) along the very top
  for (let x = 0; x <= S; x++) for (let z = 0; z <= S; z++)
    if ((x === 0 || x === S || z === 0 || z === S) && ((x + z) % 2 === 0)) c.put('mason', x, H, z, 'stone_bricks');

  // --- Mason: four ROUND corner towers, taller than the walls ---
  const tH = H + 4;
  for (const [tx, tz] of [[0, 0], [0, S], [S, 0], [S, S]]) {
    c.cyl('mason', tx, tz, 2, 0, tH, stoneMix);
    c.disc('carpenter', tx, tz, 2, tH, 'spruce_planks');           // tower floor under the roof
    c.cone('carpenter', tx, tz, 3, tH + 1, roof);                  // conical roof
    c.put('decorator', tx, tH + 5, tz, flag);                      // pennant on the spire
    // arrow-slit windows + a lantern glow
    c.put('decorator', tx, tH - 2, tz + 2, 'glass_pane');
    c.put('decorator', tx, tH - 4, tz - 2, 'glass_pane');
    c.put('decorator', tx + 2, tH - 3, tz, 'sea_lantern');
  }

  // --- Gatehouse: carve a 2-wide, 3-tall arch in the front wall, frame it ---
  c.carve('mason', (b) => b.z === 0 && (b.x === mid || b.x === mid + 1) && b.y <= 3);
  c.put('carpenter', mid - 1, 4, 0, 'stone_brick_stairs');
  c.put('carpenter', mid + 2, 4, 0, 'stone_brick_stairs');
  c.put('carpenter', mid, 0, 0, 'spruce_door'); c.put('carpenter', mid + 1, 0, 0, 'spruce_door');
  c.put('decorator', mid - 1, 3, 1, 'lantern'); c.put('decorator', mid + 2, 3, 1, 'lantern');

  // --- Central keep: taller square tower with battlements + a flag ---
  const k0 = mid - 3, k1 = mid + 3, kH = H + 7;
  c.walls('mason', k0, k0, k1, k1, 0, kH, stoneMix);
  c.floor('carpenter', k0 + 1, k0 + 1, k1 - 1, k1 - 1, 0, 'spruce_planks');
  c.floor('carpenter', k0 + 1, k0 + 1, k1 - 1, k1 - 1, Math.floor(kH / 2), 'spruce_planks');
  // keep battlements
  for (let x = k0; x <= k1; x++) for (let z = k0; z <= k1; z++)
    if ((x === k0 || x === k1 || z === k0 || z === k1) && ((x + z) % 2 === 0)) c.put('mason', x, kH + 1, z, 'stone_bricks');
  // keep windows (glass on all four faces, two levels)
  for (const wy of [3, Math.floor(kH / 2) + 2]) {
    c.put('decorator', mid, wy, k0, 'glass_pane'); c.put('decorator', mid, wy, k1, 'glass_pane');
    c.put('decorator', k0, wy, mid, 'glass_pane'); c.put('decorator', k1, wy, mid, 'glass_pane');
  }
  // keep flagpole
  c.box('carpenter', mid, kH + 2, mid, mid, kH + 4, mid, 'oak_fence');
  c.put('decorator', mid, kH + 4, mid + 1, flag); c.put('decorator', mid, kH + 3, mid + 1, flag);

  // --- Decorator: torches along the wall walk ---
  for (let x = 3; x < S; x += 4) { c.put('decorator', x, H, 1, 'torch'); c.put('decorator', x, H, S - 1, 'torch'); }
  for (let z = 3; z < S; z += 4) { c.put('decorator', 1, H, z, 'torch'); c.put('decorator', S - 1, H, z, 'torch'); }

  // --- Landscaper: courtyard flowers + a couple of trees ---
  for (let i = 0; i < 14; i++) c.put('landscaper', randInt(1, S - 1), 0, randInt(1, S - 1), pick(['poppy', 'dandelion', 'blue_orchid', 'oxeye_daisy']));
  for (const [gx, gz] of [[3, S - 3], [S - 3, 3]]) {
    c.box('landscaper', gx, 0, gz, gx, 3, gz, 'oak_log');
    for (const [dx, dz] of discPoints(2)) c.put('landscaper', gx + dx, 4, gz + dz, 'oak_leaves');
    c.put('landscaper', gx, 5, gz, 'oak_leaves');
  }

  return finalize('Stonewatch Keep', 'A moated castle with round crenellated towers, a gatehouse arch, a battlemented keep, and a courtyard garden.', c, [
    { from: 'mason', message: 'Round towers this time - no more boxy corners. Raising the curtain wall!' },
    { from: 'carpenter', message: 'Conical roofs on every tower and a proper gate arch.' },
    { from: 'decorator', message: 'Lanterns at the gate, pennants up top - it will glow at night.' },
    { from: 'landscaper', message: 'Flooding the moat and laying the bridge. Trees in the courtyard.' },
  ]);
}

function wizardTower() {
  const c = makeCanvas();
  const R = randInt(4, 5);             // base radius
  const cx = R + 3, cz = R + 3;
  const t1 = randInt(7, 9);            // base tier height
  const t2 = randInt(6, 8);            // mid tier
  const t3 = randInt(4, 6);            // top tier
  const body = weighted([['stone_bricks', 6], ['deepslate_bricks', 3], ['cracked_stone_bricks', 1]]);
  const trim = 'polished_deepslate';

  c.disc('landscaper', cx, cz, R + 3, -1, () => weighted([['grass_block', 8], ['podzol', 2]]));

  // --- Tapered tiers: wide base -> narrower -> narrowest, each capped with a trim band ---
  let y = 0;
  const base1 = y;               c.cyl('mason', cx, cz, R, y, y + t1, body);           y += t1;
  c.ring('mason', cx, cz, R, y, trim); c.ring('mason', cx, cz, R + 1, y, trim);        y += 1;
  const base2 = y;               c.cyl('mason', cx, cz, R - 1, y, y + t2, body);       y += t2;
  c.ring('mason', cx, cz, R - 1, y, trim);                                             y += 1;
  const base3 = y;               c.cyl('mason', cx, cz, R - 2, y, y + t3, body);       y += t3;
  const top = y;

  // --- Interior floors between tiers ---
  c.disc('carpenter', cx, cz, R - 1, base1 + Math.floor(t1 / 2), 'dark_oak_planks');
  c.disc('carpenter', cx, cz, R - 1, base2, 'dark_oak_planks');
  c.disc('carpenter', cx, cz, R - 2, base3, 'dark_oak_planks');
  // bookshelves ringing the study
  for (const [dx, dz] of rimPoints(R - 3 > 0 ? R - 3 : 1)) c.put('carpenter', cx + dx, base2 + 1, cz + dz, 'bookshelf');

  // --- Spiral windows all the way up ---
  for (let wy = 2; wy < top; wy += 2) {
    const a = (wy * 50) % 360;
    const rr = wy < base2 ? R : wy < base3 ? R - 1 : R - 2;
    const wx = Math.round(cx + rr * Math.cos(a * Math.PI / 180));
    const wz = Math.round(cz + rr * Math.sin(a * Math.PI / 180));
    c.put('decorator', wx, wy, wz, weighted([['glass_pane', 3], ['purple_stained_glass_pane', 1]]));
  }

  // --- Overhanging balcony at the top tier (fenced walk on an overhang) ---
  for (const [dx, dz] of rimPoints(R - 1)) {
    c.put('carpenter', cx + dx, top - 1, cz + dz, 'dark_oak_slab');   // overhang lip
    c.put('carpenter', cx + dx, top, cz + dz, 'dark_oak_fence');      // railing
  }

  // --- Conical roof + arcane, glowing crown ---
  c.disc('carpenter', cx, cz, R - 2, top, 'dark_oak_planks');
  c.cone('carpenter', cx, cz, R, top + 1, 'dark_oak_stairs');
  c.put('decorator', cx, top + R + 1, cz, 'end_rod');                 // spire tip
  c.box('decorator', cx - 1, top - 2, cz - 1, cx + 1, top - 2, cz + 1, 'glowstone'); // lantern room glow
  // floating ring of runes (glowstone) orbiting the top tier
  for (const [dx, dz] of rimPoints(R + 1)) if ((dx + dz) % 2 === 0) c.put('decorator', cx + dx, top - 3, cz + dz, weighted([['sea_lantern', 2], ['amethyst_block', 1]]));

  // --- Entrance + torches ---
  c.carve('mason', (b) => b.x === cx && b.z === cz - R && b.y <= 2);
  c.put('carpenter', cx, 0, cz - R, 'dark_oak_door');
  for (const [dx, dz] of [[R, 0], [-R, 0], [0, R], [0, -R]]) c.put('decorator', cx + Math.round(dx * 0.6), 3, cz + Math.round(dz * 0.6), 'soul_lantern');

  // --- Herb garden at the base ---
  for (let i = 0; i < 12; i++) c.put('landscaper', cx + randInt(-R - 2, R + 2), 0, cz + randInt(-R - 2, R + 2), pick(['poppy', 'dandelion', 'oak_sapling', 'allium', 'cornflower']));

  return finalize('The Arcane Spire', 'A tapered three-tier wizard tower with spiral windows, a bookshelf study, an overhanging balcony, and a glowing arcane crown.', c, [
    { from: 'mason', message: 'Three tapered tiers, each thinner than the last - no gaps in my stonework this time.' },
    { from: 'carpenter', message: 'Study floors, a balcony overhang, and a cone to cap it.' },
    { from: 'decorator', message: 'End rod on the spire, a ring of runes, and glowstone in the lantern room. Arcane.' },
    { from: 'landscaper', message: 'An herb garden of alliums and poppies at the foot.' },
  ]);
}

function cottage() {
  const c = makeCanvas();
  const W = randInt(9, 11), D = randInt(7, 9), H = 4;
  const wall = pick(['oak_planks', 'spruce_planks']);
  const beam = wall === 'oak_planks' ? 'spruce_log' : 'oak_log';
  const midX = Math.floor(W / 2);

  // --- Grounds: lawn, a gravel path, a picket fence, a garden plot ---
  c.floor('landscaper', -4, -4, W + 4, D + 4, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let z = -4; z <= 0; z++) c.put('landscaper', midX, -1, z, 'dirt_path');   // path to the door
  // picket fence perimeter
  for (let x = -3; x <= W + 3; x++) { c.put('landscaper', x, 0, -3, 'oak_fence'); c.put('landscaper', x, 0, D + 3, 'oak_fence'); }
  for (let z = -3; z <= D + 3; z++) { c.put('landscaper', -3, 0, z, 'oak_fence'); c.put('landscaper', W + 3, 0, z, 'oak_fence'); }
  c.carve('landscaper', (b) => b.type === 'oak_fence' && b.x === midX && b.z === -3);   // gate gap
  // veg garden: tilled rows with crops
  for (let gx = 2; gx <= W - 2; gx += 2) for (let gz = D + 1; gz <= D + 2; gz++) {
    c.put('landscaper', gx, -1, gz, 'farmland'); c.put('landscaper', gx, 0, gz, pick(['wheat', 'carrots', 'poppy']));
  }

  // --- Mason: stone footing + a brick chimney ---
  c.walls('mason', 0, 0, W, D, 0, 0, () => weighted([['cobblestone', 6], ['mossy_cobblestone', 3], ['stone_bricks', 1]]));
  c.box('mason', W - 1, 1, 1, W - 1, H + 4, 1, 'bricks');
  c.put('decorator', W - 1, H + 5, 1, 'campfire');   // "smoke" on the chimney

  // --- Carpenter: timber-frame walls, corner posts, floor ---
  c.walls('carpenter', 0, 0, W, D, 1, H, wall);
  for (const [x, z] of [[0, 0], [0, D], [W, 0], [W, D]]) c.box('carpenter', x, 1, z, x, H, z, beam);
  // top plate beam
  c.walls('carpenter', 0, 0, W, D, H, H, beam);
  c.floor('carpenter', 1, 1, W - 1, D - 1, 0, 'oak_planks');

  // --- Carpenter: pitched roof WITH an overhang (stairs both slopes + ridge) ---
  for (let r = 0; r <= midX; r++) {
    for (let z = -1; z <= D + 1; z++) {          // -1..D+1 = 1-block eave overhang
      c.put('carpenter', r, H + 1 + r, z, 'spruce_stairs');
      c.put('carpenter', W - r, H + 1 + r, z, 'spruce_stairs');
    }
  }
  for (let z = -1; z <= D + 1; z++) c.put('carpenter', midX, H + 1 + midX, z, 'spruce_slab');   // ridge cap

  // --- Decorator: door, windows with panes, warm lighting ---
  c.carve('carpenter', (b) => b.x === midX && b.z === 0 && (b.y === 1 || b.y === 2));
  c.put('carpenter', midX, 1, 0, 'oak_door');
  c.put('decorator', midX - 1, 3, 0, 'lantern'); c.put('decorator', midX + 1, 3, 0, 'lantern');
  for (const [wx, wz] of [[2, 0], [W - 2, 0], [2, D], [W - 2, D], [0, Math.floor(D / 2)], [W, Math.floor(D / 2)]]) {
    c.carve('carpenter', (b) => b.x === wx && b.z === wz && b.y === 2);
    c.put('decorator', wx, 2, wz, 'glass_pane');
  }
  // window flower boxes on the front
  c.put('decorator', 2, 1, -1, 'spruce_trapdoor'); c.put('decorator', W - 2, 1, -1, 'spruce_trapdoor');

  // --- Landscaper: flowers scattered + a small pond ---
  for (let i = 0; i < 14; i++) c.put('landscaper', randInt(-2, W + 2), 0, randInt(-2, D + 2), pick(['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'oak_sapling']));
  for (const [dx, dz] of discPoints(1)) c.put('landscaper', -2 + dx, -1, Math.floor(D / 2) + dz, 'water');

  return finalize('Willowbrook Cottage', 'A timber-framed cottage with an overhanging pitched roof, a brick chimney with a campfire, a fenced flower garden, and a veg plot.', c, [
    { from: 'mason', message: 'Cobble footing and a proper brick chimney - I even lit a fire up top.' },
    { from: 'carpenter', message: 'Exposed beams, a floor, and a pitched roof with an eave overhang.' },
    { from: 'decorator', message: 'Glass in every window, lanterns by the door, flower boxes on the sills.' },
    { from: 'landscaper', message: 'Picket fence, a veg patch out back, wildflowers and a little pond.' },
  ]);
}

function lighthouse() {
  const c = makeCanvas();
  const R = randInt(3, 4);
  const cx = R + 5, cz = R + 5;
  const H = randInt(16, 22);
  const band = pick([['white_concrete', 'red_concrete'], ['white_concrete', 'black_concrete'], ['smooth_quartz', 'red_terracotta']]);

  // --- Landscaper: a rocky island ringed by water ---
  c.disc('landscaper', cx, cz, R + 6, -2, 'water');
  c.disc('landscaper', cx, cz, R + 3, -1, () => weighted([['stone', 5], ['cobblestone', 3], ['gravel', 2]]));
  c.disc('landscaper', cx, cz, R + 2, 0, () => weighted([['grass_block', 4], ['stone', 3], ['gravel', 3]]));
  // a short stone jetty reaching out over the water
  for (let jz = R + 2; jz <= R + 6; jz++) { c.put('landscaper', cx, 0, cz + jz, 'stone_bricks'); c.put('landscaper', cx - 1, 0, cz + jz, 'oak_planks'); c.put('landscaper', cx + 1, 0, cz + jz, 'oak_planks'); }

  // --- Mason: tapered banded tower ---
  let y = 0;
  const stripe = (x, z, yy) => band[Math.floor(yy / 3) % 2];
  // slightly flared base
  c.cyl('mason', cx, cz, R + 1, y, y + 2, 'stone_bricks');
  c.cyl('mason', cx, cz, R, y + 3, H, stripe);
  // interior spiral floor markers
  for (let fy = 4; fy < H; fy += 5) c.disc('carpenter', cx, cz, R - 1, fy, 'spruce_planks');

  // --- Carpenter: gallery balcony below the lantern room ---
  for (const [dx, dz] of rimPoints(R + 1)) {
    c.put('carpenter', cx + dx, H, cz + dz, 'spruce_slab');       // overhang deck
    c.put('carpenter', cx + dx, H + 1, cz + dz, 'spruce_fence');  // railing
  }

  // --- Decorator: the glass lantern room + a brilliant light ---
  c.cyl('decorator', cx, cz, R, H + 2, H + 4, 'glass');
  c.box('decorator', cx - 1, H + 2, cz - 1, cx + 1, H + 4, cz + 1, 'glowstone');   // the light core
  c.put('decorator', cx, H + 3, cz, 'sea_lantern');
  // domed cap + beacon spike
  c.cone('carpenter', cx, cz, R + 1, H + 5, 'red_concrete');
  c.put('decorator', cx, H + R + 6, cz, 'end_rod');
  // portholes glowing down the shaft
  for (let py = 4; py < H; py += 4) { c.put('decorator', cx, py, cz - R, 'glass_pane'); c.put('decorator', cx + R, py, cz, 'sea_lantern'); }

  // --- Entrance ---
  c.carve('mason', (b) => b.x === cx && b.z === cz - R && b.y <= 2 && b.y >= 1);
  c.put('carpenter', cx, 1, cz - R, 'spruce_door');
  c.put('decorator', cx - 1, 3, cz - R, 'lantern'); c.put('decorator', cx + 1, 3, cz - R, 'lantern');

  // --- A few tufts of grass / a boat vibe ---
  for (let i = 0; i < 8; i++) c.put('landscaper', cx + randInt(-R - 2, R + 2), 0, cz + randInt(-R - 2, R + 2), pick(['grass', 'poppy', 'dandelion']));

  return finalize('Beacon Point Lighthouse', 'A candy-striped lighthouse on a rocky island - a tapered banded tower, a railed gallery, a glass lantern room blazing with light, and a jetty over the water.', c, [
    { from: 'mason', message: 'Banding the tower red-and-white as she rises - flared base for the surf.' },
    { from: 'carpenter', message: 'A railed gallery deck and a domed cap up top.' },
    { from: 'decorator', message: 'Glowstone core behind glass - this beam will carry for miles.' },
    { from: 'landscaper', message: 'Rocky island, a ring of water, and a little jetty out front.' },
  ]);
}

const GENERATORS = { castle, wizardTower, cottage, lighthouse };

/** List the library builds available for the menu. */
export function listBuilds() {
  return [
    { id: 'castle', name: 'Stonewatch Keep - a moated castle with round towers' },
    { id: 'wizardTower', name: 'The Arcane Spire - a tapered wizard tower that glows' },
    { id: 'cottage', name: 'Willowbrook Cottage - a timber cottage with a garden' },
    { id: 'lighthouse', name: 'Beacon Point Lighthouse - a striped tower on a rocky isle' },
  ];
}

/**
 * Build a library plan. `id` picks a generator; 'random' (default) chooses one.
 * Returns a crew-format plan with RELATIVE coordinates (offset by the caller).
 */
export function getLibraryPlan(id = 'random') {
  const key = (id === 'random' || !GENERATORS[id]) ? pick(Object.keys(GENERATORS)) : id;
  const plan = GENERATORS[key]();
  plan.libraryId = key;
  return plan;
}
