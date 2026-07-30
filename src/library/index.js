// Built-in build library - no LLM, no API key, no GPU. Procedural generators emit
// crew-format plans (blocks in RELATIVE coords, split across the 4 worker roles), so
// they run through the exact same crew as an AI-generated build. Each call randomizes
// size/palette so no two builds look identical. This is the zero-friction default that
// everyone gets on `npm run play` without a key.

import {
  makeCanvas, finalize, rimPoints, discPoints, faceCentre, STAIR_CAP, POPS_OFF, ROLE_TASKS,
} from './canvas.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// weighted pick: pass [item, weight] pairs
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of pairs) { if ((r -= w) <= 0) return item; }
  return pairs[0][0];
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

  // --- Mason: the bridge and the gate threshold, laid FIRST ---
  // The bridge belongs to the mason even though it's part of the grounds, because of the
  // order the crew builds in. The site is aired out before anyone starts, so the ground layer
  // is briefly empty; if the bridge waits for the landscaper (last), the moat water it also
  // pours floods that empty layer, reaches the gate, and washes the doors away - a door whose
  // support block turns to water breaks instantly. Both gate doors used to vanish exactly
  // this way, ~26s after the carpenter hung them. Stone under the gate before any water.
  const bridge = [];
  for (let z = -3; z <= 0; z++) for (const x of [mid, mid + 1]) { c.put('mason', x, -1, z, 'stone_bricks'); bridge.push(`${x},${z}`); }

  // --- Landscaper: lawn and a 2-wide moat (the bridge is the mason's, above) ---
  c.floor('landscaper', -5, -5, S + 5, S + 5, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let d = 2; d <= 3; d++) {
    for (let x = -d; x <= S + d; x++) { c.put('landscaper', x, -1, -d, 'water'); c.put('landscaper', x, -1, S + d, 'water'); }
    for (let z = -d; z <= S + d; z++) { c.put('landscaper', -d, -1, z, 'water'); c.put('landscaper', S + d, -1, z, 'water'); }
  }
  // ...and the grounds keep OFF the bridge: the landscaper builds last, so a grass block or a
  // moat block dropped on the bridge deck would undo it (and re-open the gate to the water).
  c.carve('landscaper', (b) => b.y === -1 && bridge.includes(`${b.x},${b.z}`));

  // --- Mason: curtain walls with a crenellated parapet ---
  c.walls('mason', 0, 0, S, S, 0, H - 1, stoneMix);
  // merlons (alternating blocks) along the very top
  for (let x = 0; x <= S; x++) for (let z = 0; z <= S; z++)
    if ((x === 0 || x === S || z === 0 || z === S) && ((x + z) % 2 === 0)) c.put('mason', x, H, z, 'stone_bricks');

  // --- Mason: four ROUND corner towers, taller than the walls ---
  // Openings in the towers (arrow slits, the lantern) are PUNCHED out of the mason's list
  // and filled by the decorator - never overwritten. The crew builds in parallel with 3s
  // staggered starts, so the decorator reaches "its" wall coords ~50s before the mason does,
  // and the mason would stone every window back over. Same rule for the keep and gate below.
  const tH = H + 4;
  for (const [tx, tz] of [[0, 0], [0, S], [S, 0], [S, S]]) {
    c.cyl('mason', tx, tz, 2, 0, tH, stoneMix);
    c.disc('carpenter', tx, tz, 1, tH, 'spruce_planks');           // floor INSIDE the wall ring
    c.cone('carpenter', tx, tz, 3, tH + 1, roof);                  // conical roof (oriented stairs)
    // pennant: pole + cloth, like the keep's - a lone wool cube on a spire tip reads as
    // "why is there a random purple block up there", not as a flag (user report, 2026-07-30)
    c.put('carpenter', tx, tH + 5, tz, 'oak_fence');               // pole on the spire cap
    c.put('decorator', tx, tH + 6, tz, flag);
    c.put('decorator', tx + (tx === 0 ? 1 : -1), tH + 6, tz, flag);   // cloth flies INTO the plot
    // arrow-slit windows + a lantern glow, in carved openings
    const openings = [[tx, tH - 2, tz + 2], [tx, tH - 4, tz - 2], [tx + 2, tH - 3, tz]];
    c.punch('mason', openings);
    c.put('decorator', tx, tH - 2, tz + 2, 'glass_pane');
    c.put('decorator', tx, tH - 4, tz - 2, 'glass_pane');
    c.put('decorator', tx + 2, tH - 3, tz, 'sea_lantern');
  }

  // --- Gatehouse: carve a 2-wide, 3-tall arch in the front wall, frame it ---
  // y >= 0: carve the DOORWAY, not the ground under it. `b.y <= 3` alone also ate the bridge
  // deck at y=-1, which re-opened the gate to the moat and drowned the doors.
  c.carve('mason', (b) => b.z === 0 && (b.x === mid || b.x === mid + 1) && b.y >= 0 && b.y <= 3);
  // arch corbels sit IN the wall - punch their coords or the mason walls them back over
  c.punch('mason', [[mid - 1, 4, 0], [mid + 2, 4, 0]]);
  c.put('carpenter', mid - 1, 4, 0, 'stone_brick_stairs[facing=east,half=top]');
  c.put('carpenter', mid + 2, 4, 0, 'stone_brick_stairs[facing=west,half=top]');
  c.door('carpenter', mid, 0, 0, 'spruce_door'); c.door('carpenter', mid + 1, 0, 0, 'spruce_door');
  // gate torches on the OUTSIDE face of the wall. The old floating lanterns at z=1 had air
  // below them and popped the moment any block update reached them; a wall torch's support
  // is the wall block behind it, which is the only neighbor event it ever gets.
  c.put('decorator', mid - 1, 3, -1, 'wall_torch[facing=north]');
  c.put('decorator', mid + 2, 3, -1, 'wall_torch[facing=north]');

  // --- Central keep: taller square tower with battlements + a flag ---
  const k0 = mid - 3, k1 = mid + 3, kH = H + 7;
  c.walls('mason', k0, k0, k1, k1, 0, kH, stoneMix);
  c.floor('carpenter', k0 + 1, k0 + 1, k1 - 1, k1 - 1, 0, 'spruce_planks');
  c.floor('carpenter', k0 + 1, k0 + 1, k1 - 1, k1 - 1, Math.floor(kH / 2), 'spruce_planks');
  c.floor('carpenter', k0 + 1, k0 + 1, k1 - 1, k1 - 1, kH, 'spruce_planks');   // roof deck
  // keep battlements
  for (let x = k0; x <= k1; x++) for (let z = k0; z <= k1; z++)
    if ((x === k0 || x === k1 || z === k0 || z === k1) && ((x + z) % 2 === 0)) c.put('mason', x, kH + 1, z, 'stone_bricks');
  // keep windows (glass on all four faces, two levels) - punched openings, see the towers
  const keepWins = [];
  for (const wy of [3, Math.floor(kH / 2) + 2])
    keepWins.push([mid, wy, k0], [mid, wy, k1], [k0, wy, mid], [k1, wy, mid]);
  c.punch('mason', keepWins);
  for (const [wx, wy, wz] of keepWins) c.put('decorator', wx, wy, wz, 'glass_pane');
  // keep flagpole - planted ON the roof deck (it used to start 2 blocks above an open-topped
  // keep and float there)
  c.box('carpenter', mid, kH + 1, mid, mid, kH + 3, mid, 'oak_fence');
  c.put('decorator', mid, kH + 3, mid + 1, flag); c.put('decorator', mid, kH + 2, mid + 1, flag);

  // --- Decorator: torches on the battlements ---
  // On top of the merlons ((x+z) even, so they have stone below) - the old ones sat one
  // block INSIDE the wall at wall-walk height with nothing under them, and popped. The
  // range stays 4 in from the corners: the round towers own the perimeter coords there
  // (their cylinders rise past H+1 and would overwrite a torch).
  for (const z of [0, S]) for (let x = 4; x <= S - 4; x += 4) {
    const xm = (x + z) % 2 === 0 ? x : x + 1;
    c.put('decorator', xm, H + 1, z, 'torch');
  }
  for (const x of [0, S]) for (let z = 4; z <= S - 4; z += 4) {
    const zm = (x + z) % 2 === 0 ? z : z + 1;
    c.put('decorator', x, H + 1, zm, 'torch');
  }

  // --- Landscaper: courtyard flowers + a couple of trees ---
  for (let i = 0; i < 14; i++) c.put('landscaper', randInt(1, S - 1), 0, randInt(1, S - 1), pick(['poppy', 'dandelion', 'blue_orchid', 'oxeye_daisy']));
  // trees sit clear of the corner towers AND the keep - leaves overwrite whatever wall
  // block they land on, and at (3, S-3) the canopy clipped the tower masonry
  for (const [gx, gz] of [[4, S - 4], [S - 4, 4]]) {
    c.box('landscaper', gx, 0, gz, gx, 3, gz, 'oak_log');
    for (const [dx, dz] of discPoints(2)) c.put('landscaper', gx + dx, 4, gz + dz, 'oak_leaves[persistent=true]');
    c.put('landscaper', gx, 5, gz, 'oak_leaves[persistent=true]');
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
  // Each floor stays strictly INSIDE its tier's wall ring: a disc that touches the ring
  // fights the mason for the rim coords (parallel build - whoever gets there last wins).
  c.disc('carpenter', cx, cz, R - 1, base1 + Math.floor(t1 / 2), 'dark_oak_planks');
  c.disc('carpenter', cx, cz, R - 2, base2, 'dark_oak_planks');
  c.disc('carpenter', cx, cz, Math.max(R - 3, 1), base3, 'dark_oak_planks');
  // bookshelves ringing the study
  for (const [dx, dz] of rimPoints(R - 3 > 0 ? R - 3 : 1)) c.put('carpenter', cx + dx, base2 + 1, cz + dz, 'bookshelf');

  // --- Spiral windows all the way up ---
  // Snap each window onto an actual wall-ring point (trig + rounding often landed BESIDE
  // the ring), then punch that coord out of the mason's list so the pane owns it.
  for (let wy = 2; wy < top; wy += 2) {
    const a = ((wy * 50) % 360) * Math.PI / 180;
    const rr = wy < base2 ? R : wy < base3 ? R - 1 : R - 2;
    let best = null, bestD = Infinity;
    for (const [dx, dz] of rimPoints(rr)) {
      const d = (dx - rr * Math.cos(a)) ** 2 + (dz - rr * Math.sin(a)) ** 2;
      if (d < bestD) { bestD = d; best = [dx, dz]; }
    }
    c.punch('mason', [[cx + best[0], wy, cz + best[1]]]);
    c.put('decorator', cx + best[0], wy, cz + best[1], weighted([['glass_pane', 3], ['purple_stained_glass_pane', 1]]));
  }

  // --- Overhanging balcony at the top tier (fenced walk on an overhang) ---
  for (const [dx, dz] of rimPoints(R - 1)) {
    c.put('carpenter', cx + dx, top - 1, cz + dz, 'dark_oak_slab');   // overhang lip
    c.put('carpenter', cx + dx, top, cz + dz, 'dark_oak_fence');      // railing
  }

  // --- Conical roof + arcane, glowing crown ---
  c.disc('carpenter', cx, cz, Math.max(R - 3, 1), top, 'dark_oak_planks');   // deck inside the wall ring
  c.cone('carpenter', cx, cz, R, top + 1, 'dark_oak_stairs');
  c.put('decorator', cx, top + R + 2, cz, 'end_rod');   // spire tip ABOVE the apex cap, not inside it
  c.box('decorator', cx - 1, top - 2, cz - 1, cx + 1, top - 2, cz + 1, 'glowstone'); // lantern room glow
  // floating ring of runes (glowstone) orbiting the top tier
  for (const [dx, dz] of rimPoints(R + 1)) if ((dx + dz) % 2 === 0) c.put('decorator', cx + dx, top - 3, cz + dz, weighted([['sea_lantern', 2], ['amethyst_block', 1]]));

  // --- Entrance + lantern ledge ---
  c.carve('mason', (b) => b.x === cx && b.z === cz - R && b.y >= 0 && b.y <= 2);   // doorway only, not the ground
  c.put('mason', cx, -1, cz - R, 'stone_bricks');   // threshold: the door needs support from the first role
  c.punch('landscaper', [[cx, -1, cz - R]]);        // ...and the lawn must not replace it later
  c.door('carpenter', cx, 0, cz - R, 'dark_oak_door');
  // soul lanterns sit ON the tier-1 trim ledge at the four compass points (they used to
  // float INSIDE the tower - Math.round(R*0.6) landed them in mid-air behind the wall)
  for (const [dx, dz] of [[R + 1, 0], [-(R + 1), 0], [0, R + 1], [0, -(R + 1)]])
    c.put('decorator', cx + dx, t1 + 1, cz + dz, 'soul_lantern');

  // --- Herb garden at the base ---
  // Only on the grass ring (inside the landscaped disc, outside the tower) and clear of the
  // path to the door - a flower scattered past the disc sits on air and pops.
  for (let i = 0; i < 12; i++) {
    const dx = randInt(-(R + 2), R + 2), dz = randInt(-(R + 2), R + 2);
    const d2 = dx * dx + dz * dz;
    if (d2 <= R * R || d2 > (R + 2.5) ** 2) continue;          // inside tower / off the lawn
    if (Math.abs(dx) <= 1 && dz <= -(R - 1)) continue;         // the doorway approach
    c.put('landscaper', cx + dx, 0, cz + dz, pick(['poppy', 'dandelion', 'oak_sapling', 'allium', 'cornflower']));
  }

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
  // The chimney stands at (chimX, chimZ) and rises clear of the roof - the roof below is
  // built AROUND it (see roofPut). Get that wrong and the carpenter's stairs overwrite a
  // brick mid-column, which reads in-world as a hole punched through the chimney.
  const chimX = W - 1, chimZ = 1;
  c.walls('mason', 0, 0, W, D, 0, 0, () => weighted([['cobblestone', 6], ['mossy_cobblestone', 3], ['stone_bricks', 1]]));
  c.box('mason', chimX, 1, chimZ, chimX, H + 4, chimZ, 'bricks');
  c.put('decorator', chimX, H + 5, chimZ, 'campfire');   // "smoke" on the chimney

  // --- Carpenter: timber-frame walls, corner posts, floor ---
  c.walls('carpenter', 0, 0, W, D, 1, H, wall);
  for (const [x, z] of [[0, 0], [0, D], [W, 0], [W, D]]) c.box('carpenter', x, 1, z, x, H, z, beam);
  // top plate beam
  c.walls('carpenter', 0, 0, W, D, H, H, beam);
  c.floor('carpenter', 1, 1, W - 1, D - 1, 0, 'oak_planks');

  // --- Carpenter: pitched roof WITH an overhang (stairs both slopes + ridge) ---
  // The roof yields to the chimney: the one column the chimney occupies is left open so the
  // brickwork runs unbroken from the footing to the campfire. Stairs carry a facing so each
  // slope actually slopes (default stairs all face north - one side of the roof rendered as
  // backwards steps).
  const roofPut = (x, y, z, type) => { if (!(x === chimX && z === chimZ)) c.put('carpenter', x, y, z, type); };
  for (let r = 0; r <= midX; r++) {
    for (let z = -1; z <= D + 1; z++) {          // -1..D+1 = 1-block eave overhang
      roofPut(r, H + 1 + r, z, 'spruce_stairs[facing=east]');
      roofPut(W - r, H + 1 + r, z, 'spruce_stairs[facing=west]');
    }
  }
  // ridge cap - spans midX..W-midX so an odd-width roof gets BOTH of its peak columns
  // capped (it used to cap one and leave a bare stair line beside it)
  for (let z = -1; z <= D + 1; z++)
    for (let x = midX; x <= W - midX; x++) roofPut(x, H + 1 + midX, z, 'spruce_slab');

  // --- Carpenter: close the gables ---
  // The walls stop at H and the roof rises to H+1+midX, which left open triangles at both
  // ends - you could see straight through the attic. Fill each gable up to its slope, with
  // a little round-ish window under the ridge.
  for (const gz of [0, D]) {
    for (let x = 1; x <= W - 1; x++) {
      const g = Math.min(x, W - x);
      for (let y = H + 1; y <= H + g; y++)
        if (!(x === chimX && gz === chimZ) && !(x === midX && y === H + 2)) c.put('carpenter', x, y, gz, wall);
    }
    c.put('decorator', midX, H + 2, gz, 'glass_pane');   // attic window in the gap left above
  }

  // --- Decorator: door, windows with panes, warm lighting ---
  c.carve('carpenter', (b) => b.x === midX && b.z === 0 && (b.y === 1 || b.y === 2));
  c.door('carpenter', midX, 1, 0, 'oak_door');
  // wall torches beside the door, on the OUTSIDE face - the old lanterns were written onto
  // wall coords the carpenter reaches later and got planked over (parallel-build race)
  c.put('decorator', midX - 1, 3, -1, 'wall_torch[facing=north]');
  c.put('decorator', midX + 1, 3, -1, 'wall_torch[facing=north]');
  // ...and lanterns on the gate posts by the path
  c.put('decorator', midX - 1, 1, -3, 'lantern'); c.put('decorator', midX + 1, 1, -3, 'lantern');
  for (const [wx, wz] of [[2, 0], [W - 2, 0], [2, D], [W - 2, D], [0, Math.floor(D / 2)], [W, Math.floor(D / 2)]]) {
    c.carve('carpenter', (b) => b.x === wx && b.z === wz && b.y === 2);
    c.put('decorator', wx, 2, wz, 'glass_pane');
  }
  // window flower boxes on the front
  c.put('decorator', 2, 1, -1, 'spruce_trapdoor'); c.put('decorator', W - 2, 1, -1, 'spruce_trapdoor');

  // --- Landscaper: flowers scattered + a small pond ---
  // The scatter keeps off the path (flowers can't live on dirt_path), out of the pond
  // (they can't live on water either), and out of the veg rows (a sapling on farmland pops).
  const pondX = -2, pondZ = Math.floor(D / 2);
  for (let i = 0; i < 14; i++) {
    const fx = randInt(-2, W + 2), fz = randInt(-2, D);
    if (fx === midX && fz <= 0) continue;                                      // the path
    if ((fx - pondX) ** 2 + (fz - pondZ) ** 2 <= 2) continue;                  // the pond
    c.put('landscaper', fx, 0, fz, pick(['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'oak_sapling']));
  }
  for (const [dx, dz] of discPoints(1)) c.put('landscaper', pondX + dx, -1, pondZ + dz, 'water');

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
  // No GRAVEL in this layer: it sits directly on the water disc below, and gravity blocks
  // with water under them fall straight through - 39 of them went missing from the island.
  // Gravel is fine on the surface course above, which has solid rock beneath it.
  c.disc('landscaper', cx, cz, R + 3, -1, () => weighted([['stone', 5], ['cobblestone', 3]]));
  // island surface - remember where the grass lands so the tufts can live ON it (they used
  // to be written at the surface's own y, replacing a random surface block and standing on
  // the bare stone underneath, where every one of them popped)
  const grassCells = [];
  for (const [dx, dz] of discPoints(R + 2)) {
    const t = weighted([['grass_block', 4], ['stone', 3], ['gravel', 3]]);
    c.put('landscaper', cx + dx, 0, cz + dz, t);
    if (t === 'grass_block') grassCells.push([dx, dz]);
  }
  // a short stone jetty reaching out over the water - the tower door opens onto it
  for (let jz = R + 2; jz <= R + 6; jz++) { c.put('landscaper', cx, 0, cz + jz, 'stone_bricks'); c.put('landscaper', cx - 1, 0, cz + jz, 'oak_planks'); c.put('landscaper', cx + 1, 0, cz + jz, 'oak_planks'); }
  // lamp posts at the jetty's end
  c.put('landscaper', cx - 1, 1, cz + R + 5, 'oak_fence'); c.put('landscaper', cx + 1, 1, cz + R + 5, 'oak_fence');
  c.put('decorator', cx - 1, 2, cz + R + 5, 'lantern'); c.put('decorator', cx + 1, 2, cz + R + 5, 'lantern');

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
  // deck between the shaft top (H) and the lantern room (H+2) - without it the lantern
  // room hovered over an open one-block ring of air
  c.disc('carpenter', cx, cz, R, H + 1, 'spruce_planks');

  // --- Decorator: the glass lantern room + a brilliant light ---
  c.cyl('decorator', cx, cz, R, H + 2, H + 4, 'glass');
  c.box('decorator', cx - 1, H + 2, cz - 1, cx + 1, H + 4, cz + 1, 'glowstone');   // the light core
  c.put('decorator', cx, H + 3, cz, 'sea_lantern');
  // domed cap + beacon spike (the spike sits ABOVE the dome's apex - it used to share the
  // apex coord and the carpenter's cone block replaced it)
  c.cone('carpenter', cx, cz, R + 1, H + 5, 'red_concrete');
  c.put('decorator', cx, H + R + 7, cz, 'end_rod');
  // portholes + glow blocks down the shaft, in carved openings (the parallel build means the
  // mason places its wall AFTER the decorator has already been here - overwrites lose)
  const shaftOpenings = [];
  for (let py = 4; py < H; py += 4) shaftOpenings.push([cx, py, cz - R], [cx + R, py, cz]);
  c.punch('mason', shaftOpenings);
  for (let py = 4; py < H; py += 4) { c.put('decorator', cx, py, cz - R, 'glass_pane'); c.put('decorator', cx + R, py, cz, 'sea_lantern'); }

  // --- Entrance: through the flared base, opening onto the jetty ---
  // The old door was on the far side, one block up, floating over the carved-out island
  // surface (it popped the instant its upper half landed) and walled in behind the flared
  // base. Now it's punched through the flare itself, level with the jetty deck.
  c.punch('mason', [[cx, 1, cz + R + 1], [cx, 2, cz + R + 1]]);
  c.door('carpenter', cx, 1, cz + R + 1, 'spruce_door', 'south');

  // --- A few tufts of grass on the island's grassy patches ---
  for (let i = 0; i < 8 && grassCells.length; i++) {
    const [dx, dz] = pick(grassCells);
    if (dx * dx + dz * dz <= (R + 1.5) ** 2) continue;             // under the tower ring
    if (Math.abs(dx) <= 1 && dz >= R + 2) continue;                // the jetty rewrites these
    c.put('landscaper', cx + dx, 1, cz + dz, pick(['grass', 'poppy', 'dandelion']));
  }

  // The landscaper builds LAST, so the island surface would be laid straight over the
  // tower's flared base ring, replacing stone with grass and gravel. Carve the surface off
  // that ring (and only that ring - the cells INSIDE it are the ground floor the door steps
  // onto). Must stay the landscaper's final act so nothing sneaks back in.
  const ringOuter = (R + 1.5) ** 2, ringInner = (R + 0.5) ** 2;
  c.carve('landscaper', (b) => {
    const d2 = (b.x - cx) ** 2 + (b.z - cz) ** 2;
    return b.y >= 0 && d2 <= ringOuter && d2 >= ringInner;
  });

  return finalize('Beacon Point Lighthouse', 'A candy-striped lighthouse on a rocky island - a tapered banded tower, a railed gallery, a glass lantern room blazing with light, and a jetty over the water.', c, [
    { from: 'mason', message: 'Banding the tower red-and-white as she rises - flared base for the surf.' },
    { from: 'carpenter', message: 'A railed gallery deck and a domed cap up top.' },
    { from: 'decorator', message: 'Glowstone core behind glass - this beam will carry for miles.' },
    { from: 'landscaper', message: 'Rocky island, a ring of water, and a little jetty out front.' },
  ]);
}

function windmill() {
  const c = makeCanvas();
  const cx = 8, cz = 8, R = 4;
  const H = randInt(11, 13);           // tower height
  const body = () => weighted([['white_terracotta', 6], ['white_concrete', 5], ['smooth_quartz', 1]]);
  const hubY = H - 3, hubZ = cz - R - 1;   // sail hub floats one block clear of the wall

  // --- Landscaper: lawn, path, wheat field, hay ---
  c.floor('landscaper', -5, -5, 21, 19, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let z = 13; z <= 18; z++) c.put('landscaper', cx, -1, z, 'dirt_path');
  // wheat field beside the mill: farmland rows fed by a water channel
  for (let fx = 15; fx <= 20; fx++) for (let fz = 4; fz <= 12; fz++) {
    if (fz === 8) { c.put('landscaper', fx, -1, fz, 'water'); continue; }
    c.put('landscaper', fx, -1, fz, 'farmland');
    c.put('landscaper', fx, 0, fz, 'wheat');
  }
  c.put('landscaper', 14, 0, 14, 'hay_block'); c.put('landscaper', 14, 1, 14, 'hay_block');
  c.put('landscaper', 13, 0, 15, 'hay_block');
  // gate posts by the path get lanterns (decorator's lantern lands on air and floats until
  // the fence arrives beneath it - the arrival is the only neighbor event it ever gets)
  c.put('landscaper', cx - 1, 0, 17, 'oak_fence'); c.put('landscaper', cx + 1, 0, 17, 'oak_fence');
  c.put('decorator', cx - 1, 1, 17, 'lantern'); c.put('decorator', cx + 1, 1, 17, 'lantern');

  // --- Mason: stone skirt + whitewashed tower ---
  c.cyl('mason', cx, cz, R + 1, 0, 1, stoneMix);
  c.cyl('mason', cx, cz, R, 0, H, body);
  // doorway punched through BOTH rings on the path side (the skirt would wall the door in)
  c.punch('mason', [[cx, 0, cz + R], [cx, 1, cz + R], [cx, 2, cz + R], [cx, 0, cz + R + 1], [cx, 1, cz + R + 1]]);
  c.put('mason', cx, -1, cz + R, 'stone_bricks');       // threshold, laid by the first role
  c.punch('landscaper', [[cx, -1, cz + R]]);            // ...that the lawn must not replace
  c.door('carpenter', cx, 0, cz + R, 'spruce_door', 'south');

  // --- Carpenter: cap + sails ---
  c.cone('carpenter', cx, cz, R + 1, H + 1, 'dark_oak_stairs');   // overhanging cap
  c.put('carpenter', cx, hubY, hubZ, 'dark_oak_log');             // sail hub
  for (let i = 1; i <= 6; i++) {                                  // X-shaped sail arms
    c.put('carpenter', cx + i, hubY + i, hubZ, 'dark_oak_fence');
    c.put('carpenter', cx - i, hubY - i, hubZ, 'dark_oak_fence');
    c.put('carpenter', cx - i, hubY + i, hubZ, 'dark_oak_fence');
    c.put('carpenter', cx + i, hubY - i, hubZ, 'dark_oak_fence');
  }

  // --- Decorator: pinwheel sail cloth + windows ---
  for (let i = 2; i <= 6; i++) {                                  // one panel per arm, offset
    c.put('decorator', cx + i, hubY + i - 1, hubZ, 'white_wool'); // clockwise for a pinwheel
    c.put('decorator', cx - i, hubY - i + 1, hubZ, 'white_wool');
    c.put('decorator', cx - i + 1, hubY + i, hubZ, 'white_wool');
    c.put('decorator', cx + i - 1, hubY - i, hubZ, 'white_wool');
  }
  const wins = [[cx, 4, cz - R], [cx + R, 6, cz], [cx - R, 8, cz]];
  c.punch('mason', wins);
  for (const [wx, wy, wz] of wins) c.put('decorator', wx, wy, wz, 'glass_pane');
  c.put('decorator', cx, H - 1, cz + R, 'glass_pane');
  c.punch('mason', [[cx, H - 1, cz + R]]);

  return finalize('Gristmill Rise', 'A whitewashed windmill with pinwheel sails, a dark-oak cap, and a wheat field fed by a channel.', c, [
    { from: 'mason', message: 'Stone skirt, then whitewash all the way up. A proper mill tower.' },
    { from: 'carpenter', message: 'Hanging the cap and rigging four sail arms off the hub.' },
    { from: 'decorator', message: 'Cloth on the sails, glass in the windows - she almost turns.' },
    { from: 'landscaper', message: 'Wheat in rows, hay stacked, and a path to the door.' },
  ]);
}

function pagoda() {
  const c = makeCanvas();
  const m = 6;                          // centre
  const wall = () => weighted([['white_concrete', 7], ['white_terracotta', 3]]);
  const tile = 'red_nether_brick_stairs';
  // an eave: a rectangle ring of roof stairs, tall side facing the building
  const eave = (x0, z0, x1, z1, y) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      const facing = x === x0 ? 'east' : x === x1 ? 'west' : z === z0 ? 'south' : 'north';
      c.put('carpenter', x, y, z, `${tile}[facing=${facing}]`);
    }
  };

  // --- Landscaper: garden - lawn, koi pond, cherry trees, stone lanterns ---
  c.floor('landscaper', -5, -5, 19, 17, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (const [dx, dz] of discPoints(2)) c.put('landscaper', 16 + dx, -1, 8 + dz, 'water');
  for (const [dx, dz] of rimPoints(3)) c.put('landscaper', 16 + dx, -1, 8 + dz, 'stone');
  for (const [tx, tz] of [[-3, 12], [16, -2]]) {
    c.box('landscaper', tx, 0, tz, tx, 3, tz, 'cherry_log');
    for (const [dx, dz] of discPoints(2)) c.put('landscaper', tx + dx, 4, tz + dz, 'cherry_leaves[persistent=true]');
    c.put('landscaper', tx, 5, tz, 'cherry_leaves[persistent=true]');
  }
  // stone lanterns flanking the steps: decorator's torch floats until the cobble arrives
  c.put('landscaper', 3, 0, -3, 'cobblestone'); c.put('landscaper', 9, 0, -3, 'cobblestone');
  c.put('decorator', 3, 1, -3, 'torch'); c.put('decorator', 9, 1, -3, 'torch');

  // --- Mason: plinth + three white tiers ---
  c.floor('mason', -1, -1, 13, 13, 0, () => weighted([['stone_bricks', 7], ['polished_andesite', 3]]));
  for (const sx of [m - 1, m, m + 1]) c.put('mason', sx, 0, -2, 'stone_brick_stairs[facing=south]');
  c.walls('mason', 1, 1, 11, 11, 1, 4, wall);
  c.walls('mason', 3, 3, 9, 9, 6, 8, wall);
  c.walls('mason', 5, 5, 7, 7, 10, 11, wall);
  // dark-oak corner posts own the tier corners - punched from the mason's walls
  const posts = [];
  for (const [px, pz] of [[1, 1], [1, 11], [11, 1], [11, 11]]) for (let y = 1; y <= 4; y++) posts.push([px, y, pz]);
  for (const [px, pz] of [[3, 3], [3, 9], [9, 3], [9, 9]]) for (let y = 6; y <= 8; y++) posts.push([px, y, pz]);
  c.punch('mason', posts);
  for (const [px, py, pz] of posts) c.put('carpenter', px, py, pz, 'dark_oak_log');

  // --- Carpenter: eaves, floors, and the crowning roof ---
  eave(0, 0, 12, 12, 5);
  eave(2, 2, 10, 10, 9);
  eave(4, 4, 8, 8, 12);
  c.floor('carpenter', 4, 4, 8, 8, 6, 'dark_oak_planks');    // tier-2 floor
  c.put('carpenter', m, 10, m, 'dark_oak_planks');           // tier-3 floor
  eave(5, 5, 7, 7, 13);
  c.put('carpenter', m, 13, m, 'red_nether_bricks');         // seal the roof peak

  // --- Decorator: door, windows, gold finial, hanging lanterns ---
  // The carpenter lays its own door SILL first: the mason's plinth layer takes ~20s to walk
  // and the door can't wait for it - an unsupported lower half pops the moment the upper
  // half lands. A same-role sill is deterministic (y-ascending puts it before the door).
  c.punch('mason', [[m, 0, 1], [m, 1, 1], [m, 2, 1]]);
  c.put('carpenter', m, 0, 1, 'dark_oak_planks');
  c.door('carpenter', m, 1, 1, 'dark_oak_door');
  const wins = [[3, 3, 1], [9, 3, 1], [1, 3, m], [11, 3, m], [3, 3, 11], [9, 3, 11], [m, 7, 3], [m, 7, 9], [3, 7, m], [9, 7, m]];
  c.punch('mason', wins);
  for (const [wx, wy, wz] of wins) c.put('decorator', wx, wy, wz, 'glass_pane');
  c.put('decorator', m, 14, m, 'gold_block');
  c.put('decorator', m, 15, m, 'end_rod');
  // lanterns hang beneath the first eave's corners (support above arrives later - safe, the
  // eave landing is the only neighbor event these cells ever see)
  for (const [lx, lz] of [[0, 0], [12, 0], [0, 12], [12, 12]])
    c.put('decorator', lx, 4, lz, 'lantern[hanging=true]');

  return finalize('The Vermilion Pagoda', 'A three-tiered pagoda - white walls, dark posts, flaring red eaves with hanging lanterns, a koi pond and cherry trees.', c, [
    { from: 'mason', message: 'Three white tiers on a stone plinth, each smaller than the last.' },
    { from: 'carpenter', message: 'Red tiled eaves that flare at every storey, and a sealed peak.' },
    { from: 'decorator', message: 'Gold on the spire, lanterns under the eaves. Serenity.' },
    { from: 'landscaper', message: 'A koi pond, stone lanterns, and cherry blossom at the gate.' },
  ]);
}

function ship() {
  const c = makeCanvas();
  // hull outline per x-slice: [zMin, zMax]
  const slices = new Map();
  for (let x = 5; x <= 6; x++) slices.set(x, [10, 14]);       // stern
  for (let x = 7; x <= 22; x++) slices.set(x, [9, 15]);       // midship
  slices.set(23, [10, 14]); slices.set(24, [11, 13]); slices.set(25, [12, 12]);   // bow taper

  // --- Mason: the hull - bottom plate in the water, planked sides ---
  const plate = new Set();
  const hullWood = () => weighted([['dark_oak_planks', 8], ['spruce_planks', 2]]);
  for (const [x, [z0, z1]] of slices) for (let z = z0; z <= z1; z++) {
    c.put('mason', x, -1, z, 'dark_oak_planks');
    plate.add(`${x},${z}`);
  }
  for (const [x, [z0, z1]] of slices) {
    for (let y = 0; y <= 2; y++) {
      c.put('mason', x, y, z0, hullWood()); c.put('mason', x, y, z1, hullWood());
      if (x === 5 || x === 25) for (let z = z0; z <= z1; z++) c.put('mason', x, y, z, hullWood());
    }
  }

  // --- Landscaper: the anchorage - a lawn shore around a basin of water ---
  // The lawn stays OUT of the basin rectangle: a grass block written under the hull (or
  // where water goes) is a cross-role overwrite the audit rightly rejects.
  const inBasin = (x, z) => x >= 0 && x <= 29 && z >= 5 && z <= 19;
  for (let x = -3; x <= 31; x++) for (let z = 1; z <= 23; z++)
    if (!inBasin(x, z)) c.put('landscaper', x, -1, z, weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let x = 0; x <= 29; x++) for (let z = 5; z <= 19; z++)
    if (!plate.has(`${x},${z}`)) c.put('landscaper', x, -1, z, 'water');
  // jetty out to the ship's side (stopping one short of the hull), with a lamp at the end
  for (let z = 16; z <= 19; z++) for (let x = 13; x <= 15; x++) c.put('landscaper', x, 0, z, 'oak_planks');
  c.put('landscaper', 14, 1, 19, 'oak_fence');
  c.put('decorator', 14, 2, 19, 'lantern');

  // --- Carpenter: deck, quarterdeck, masts, bowsprit ---
  for (const [x, [z0, z1]] of slices) for (let z = z0 + 1; z < z1; z++)
    if (x >= 6 && x <= 24) c.put('carpenter', x, 1, z, 'spruce_planks');
  c.floor('carpenter', 5, 10, 9, 14, 3, 'spruce_planks');       // quarterdeck
  for (let z = 10; z <= 14; z++) c.put('carpenter', 5, 4, z, 'spruce_fence');
  for (let x = 6; x <= 8; x++) { c.put('carpenter', x, 4, 10, 'spruce_fence'); c.put('carpenter', x, 4, 14, 'spruce_fence'); }
  c.box('carpenter', 11, 2, 12, 11, 12, 12, 'dark_oak_log');    // main mast
  c.box('carpenter', 19, 2, 12, 19, 10, 12, 'dark_oak_log');    // fore mast
  for (let z = 10; z <= 14; z++) { c.put('carpenter', 11, 11, z, 'dark_oak_fence'); c.put('carpenter', 19, 9, z, 'dark_oak_fence'); }
  c.put('carpenter', 26, 3, 12, 'oak_log'); c.put('carpenter', 27, 4, 12, 'oak_log');   // bowsprit

  // --- Decorator: sails, flags, figurehead, stern lamps ---
  for (let y = 4; y <= 10; y++) for (let z = 9; z <= 15; z++) c.put('decorator', 10, y, z, 'white_wool');
  for (let y = 4; y <= 8; y++) for (let z = 10; z <= 14; z++) c.put('decorator', 18, y, z, 'white_wool');
  c.put('decorator', 11, 13, 12, 'red_wool'); c.put('decorator', 19, 11, 12, 'red_wool');
  c.put('decorator', 26, 2, 12, 'gold_block');                  // figurehead
  c.put('decorator', 5, 5, 10, 'lantern'); c.put('decorator', 5, 5, 14, 'lantern');   // on the rail

  return finalize('The Wandering Gull', 'A dark-oak galleon at anchor - full white sails on two masts, a quarterdeck, a gold figurehead, and a lantern-lit jetty.', c, [
    { from: 'mason', message: 'Laying the keel and planking the hull watertight.' },
    { from: 'carpenter', message: 'Decks down, masts up, bowsprit out over the water.' },
    { from: 'decorator', message: 'Canvas aloft and colours flying - she is ready to sail.' },
    { from: 'landscaper', message: 'Flooding the anchorage and running out the jetty.' },
  ]);
}

function temple() {
  const c = makeCanvas();
  const m = 9;
  const sandMix = () => weighted([['sandstone', 6], ['smooth_sandstone', 3], ['cut_sandstone', 2], ['chiseled_sandstone', 1]]);

  // --- Landscaper: desert apron with dunes, palms, dead bushes ---
  c.floor('landscaper', -4, -6, 22, 22, -1, 'sand');
  const duneCells = new Set();
  const onZiggurat = (x, z) => x >= 0 && x <= 18 && z >= 0 && z <= 18;   // sand may drift TO the base, never onto it
  for (const [mx, mz] of [[-2, 19], [20, -4], [19, 17]]) {
    for (const [dx, dz] of discPoints(2)) {
      if (onZiggurat(mx + dx, mz + dz)) continue;
      c.put('landscaper', mx + dx, 0, mz + dz, 'sand');
      duneCells.add(`${mx + dx},${mz + dz}`);
    }
    if (!onZiggurat(mx, mz)) c.put('landscaper', mx, 1, mz, 'sand');
  }
  for (const [bx, bz] of [[-3, 2], [3, 20], [20, 8], [-2, 12], [15, -5]])
    if (!duneCells.has(`${bx},${bz}`)) c.put('landscaper', bx, 0, bz, 'dead_bush');
  for (const [px, pz] of [[-2, 16], [21, 2]]) {
    c.box('landscaper', px, 0, pz, px, 4, pz, 'jungle_log');
    for (const [dx, dz] of discPoints(2)) c.put('landscaper', px + dx, 5, pz + dz, 'jungle_leaves[persistent=true]');
    c.put('landscaper', px, 6, pz, 'jungle_leaves[persistent=true]');
  }

  // --- Mason: the ziggurat - four solid steps + a shrine ---
  c.box('mason', 0, 0, 0, 18, 1, 18, sandMix);
  c.box('mason', 2, 2, 2, 16, 3, 16, sandMix);
  c.box('mason', 4, 4, 4, 14, 5, 14, sandMix);
  c.box('mason', 6, 6, 6, 12, 7, 12, sandMix);
  c.walls('mason', 7, 7, 11, 11, 8, 10, sandMix);
  // grand staircase: a channel punched up the south face, stairs riding the terraces
  const channel = [];
  for (const y of [1, 3, 5, 7]) for (let x = m - 1; x <= m + 1; x++) channel.push([x, y, y - 1]);
  c.punch('mason', channel);
  for (let y = 0; y <= 7; y++) for (let x = m - 1; x <= m + 1; x++)
    c.put('carpenter', x, y, y - 1, 'sandstone_stairs[facing=south]');
  // open doorway into the shrine (no door - a temple stands open)
  c.punch('mason', [[m, 8, 7], [m, 9, 7]]);
  // obelisks flanking the approach
  c.box('mason', 1, 0, -3, 1, 5, -3, 'smooth_sandstone');
  c.box('mason', 17, 0, -3, 17, 5, -3, 'smooth_sandstone');

  // --- Carpenter: shrine roof ---
  c.floor('carpenter', 7, 7, 11, 11, 11, 'smooth_sandstone');

  // --- Decorator: the golden sun - altar, caps, flames ---
  c.put('decorator', m, 8, 10, 'gold_block');          // altar
  c.put('decorator', m, 9, 10, 'torch');               // altar flame (same role, gold below first)
  c.put('decorator', m, 12, m, 'gold_block');          // roof crest
  c.put('decorator', 1, 6, -3, 'gold_block'); c.put('decorator', 1, 7, -3, 'torch');
  c.put('decorator', 17, 6, -3, 'gold_block'); c.put('decorator', 17, 7, -3, 'torch');
  c.put('decorator', m - 1, 8, 6, 'sea_lantern');      // doorway glow, set into the terrace top
  c.put('decorator', m + 1, 8, 6, 'sea_lantern');
  c.punch('mason', [[m - 1, 8, 6], [m + 1, 8, 6]]);

  return finalize('Temple of the Golden Sun', 'A four-stepped sandstone ziggurat - a grand stair to an open shrine with a golden altar, obelisks, palms and dunes.', c, [
    { from: 'mason', message: 'Four terraces of sandstone, squared to the sun. Obelisks at the gate.' },
    { from: 'carpenter', message: 'Cutting the grand stair up the south face, terrace by terrace.' },
    { from: 'decorator', message: 'Gold on the altar, gold on the crest - flames on the obelisks.' },
    { from: 'landscaper', message: 'Dunes drift against the base. Palms where the shade falls.' },
  ]);
}

function observatory() {
  const c = makeCanvas();
  const cx = 10, cz = 10, R = 4, top = 12;
  const stone = () => weighted([['deepslate_bricks', 6], ['polished_deepslate', 3], ['cracked_deepslate_bricks', 1]]);

  // --- Landscaper: lawn, gravel walk, night garden ---
  c.floor('landscaper', -4, -4, 24, 24, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  for (let z = 18; z <= 23; z++) c.put('landscaper', cx, -1, z, 'gravel');
  for (let i = 0; i < 8; i++) {
    const dx = randInt(-9, 9), dz = randInt(-9, 9);
    const d2 = dx * dx + dz * dz;
    if (d2 <= 64 || Math.abs(dx) <= 1 && dz > 4) continue;    // off the plinth, off the walk
    c.put('landscaper', cx + dx, 0, cz + dz, pick(['grass', 'poppy', 'oxeye_daisy']));
  }

  // --- Mason: plinth + deepslate tower ---
  c.disc('mason', cx, cz, 7, 0, () => weighted([['stone_bricks', 6], ['polished_andesite', 4]]));
  c.disc('mason', cx, cz, 6, 1, () => weighted([['stone_bricks', 6], ['polished_andesite', 4]]));
  c.cyl('mason', cx, cz, R, 2, top, stone);
  c.ring('mason', cx, cz, R + 1, top, 'polished_deepslate');    // cornice ledge
  // entry steps down the plinth
  c.put('mason', cx, 1, cz + 7, 'stone_brick_stairs[facing=north]');
  c.put('mason', cx, 0, cz + 8, 'stone_brick_stairs[facing=north]');

  // --- Carpenter: observing deck + the quartz dome (with an open viewing slit) ---
  c.disc('carpenter', cx, cz, 3, top, 'dark_oak_planks');
  c.ring('carpenter', cx, cz, R, top + 1, 'smooth_quartz');
  c.ring('carpenter', cx, cz, R, top + 2, 'smooth_quartz');
  c.ring('carpenter', cx, cz, R - 1, top + 3, 'smooth_quartz');
  c.ring('carpenter', cx, cz, R - 2, top + 4, 'smooth_quartz');
  c.disc('carpenter', cx, cz, 1, top + 5, 'smooth_quartz');
  c.punch('carpenter', [[cx, top + 1, cz - R], [cx, top + 2, cz - R], [cx, top + 3, cz - R + 1], [cx, top + 4, cz - R + 2]]);

  // --- Decorator: the telescope, embedded glow, door lights ---
  // the barrel climbs out through the slit at 45 degrees
  c.put('decorator', cx, top + 1, cz, 'polished_deepslate');
  c.put('decorator', cx, top + 2, cz - 1, 'polished_deepslate');
  c.put('decorator', cx, top + 3, cz - 2, 'polished_deepslate');
  c.put('decorator', cx, top + 4, cz - 3, 'polished_deepslate');
  c.put('decorator', cx, top + 5, cz - 4, 'amethyst_block');    // the lens, catching starlight
  c.put('decorator', cx, top + 6, cz, 'end_rod');               // aerial on the dome cap
  const glows = [[cx, 6, cz - R], [cx + R, 9, cz], [cx - R, 4, cz]];
  c.punch('mason', glows);
  for (const [gx, gy, gz] of glows) c.put('decorator', gx, gy, gz, 'amethyst_block');
  const wins = [[cx, 8, cz + R], [cx - R, 7, cz]];
  c.punch('mason', wins);
  for (const [wx, wy, wz] of wins) c.put('decorator', wx, wy, wz, 'glass_pane');
  // soul lanterns on the plinth ring, clear of the tower (support arrives from below)
  for (const [lx, lz] of [[cx + 6, cz], [cx - 6, cz], [cx, cz - 6]])
    c.put('decorator', lx, 2, lz, 'soul_lantern');

  // --- Entrance ---
  // Same sill trick as the pagoda: the mason won't reach the plinth cell under the door for
  // ~20s, so the carpenter brings its own support (lowest carpenter y = placed first).
  c.punch('mason', [[cx, 1, cz + R], [cx, 2, cz + R], [cx, 3, cz + R]]);
  c.put('carpenter', cx, 1, cz + R, 'dark_oak_planks');
  c.door('carpenter', cx, 2, cz + R, 'dark_oak_door', 'south');

  return finalize('Celestia Observatory', 'A deepslate observatory on a stone plinth - a quartz dome with an open slit, a telescope aimed at the sky, and amethyst glowing in the walls.', c, [
    { from: 'mason', message: 'A round plinth and a deepslate drum - built to hold still for the stars.' },
    { from: 'carpenter', message: 'Closing the quartz dome, slit open to the northern sky.' },
    { from: 'decorator', message: 'The telescope is aimed and the amethyst is humming. Clear skies.' },
    { from: 'landscaper', message: 'A gravel walk and a quiet night garden around the base.' },
  ]);
}

function mushroomHouse() {
  const c = makeCanvas();
  const R = randInt(2, 3);             // stem radius
  const H = randInt(5, 6);             // stem height
  const capR = R + 4;                  // cap overhang radius
  const cx = capR + 3, cz = capR + 3;
  const cap = weighted([['red_mushroom_block', 8], ['brown_mushroom_block', 2]]);
  const spotted = cap === 'red_mushroom_block';   // brown caps have no spots

  // --- Landscaper: a mushroom-forest lawn - grass with mycelium/podzol patches ---
  // Track the fungal cells: small mushrooms may ONLY live on mycelium/podzol (on plain
  // grass they need darkness and pop in daylight - same class of soil rule as the flowers).
  const shroomCells = [];
  for (const [dx, dz] of discPoints(capR + 5)) {
    const t = weighted([['grass_block', 6], ['mycelium', 3], ['podzol', 1]]);
    c.put('landscaper', cx + dx, -1, cz + dz, t);
    if (t !== 'grass_block') shroomCells.push([dx, dz]);
  }

  // --- Mason: the stem - one round white column ---
  c.cyl('mason', cx, cz, R, 0, H, 'mushroom_stem');

  // --- Carpenter: the cap - a dome overhanging the stem, gills underneath ---
  c.ring('carpenter', cx, cz, capR, H + 1, cap);
  c.disc('carpenter', cx, cz, capR - 1, H + 1, 'mushroom_stem');       // gill underside
  c.disc('carpenter', cx, cz, capR, H + 2, cap);
  c.disc('carpenter', cx, cz, capR - 1, H + 3, cap);
  c.disc('carpenter', cx, cz, capR - 3, H + 4, cap);
  c.disc('carpenter', cx, cz, Math.max(capR - 5, 1), H + 5, cap);

  // --- Decorator: white spots set INTO the cap (punched, never overwritten) ---
  if (spotted) {
    const spots = [];
    rimPoints(capR).forEach(([dx, dz], i) => { if (i % 4 === 0) spots.push([cx + dx, H + 2, cz + dz]); });
    rimPoints(capR - 1).forEach(([dx, dz], i) => { if (i % 4 === 2) spots.push([cx + dx, H + 3, cz + dz]); });
    rimPoints(capR - 3).forEach(([dx, dz], i) => { if (i % 3 === 0) spots.push([cx + dx, H + 4, cz + dz]); });
    spots.push([cx, H + 5, cz]);
    c.punch('carpenter', spots);
    for (const [sx, sy, sz] of spots) c.put('decorator', sx, sy, sz, 'white_wool');
  }
  // shroomlights glowing among the gills, at the four compass points of the underside
  const glows = [[cx + R + 2, H + 1, cz], [cx - R - 2, H + 1, cz], [cx, H + 1, cz + R + 2], [cx, H + 1, cz - R - 2]];
  c.punch('carpenter', glows);
  for (const [gx, gy, gz] of glows) c.put('decorator', gx, gy, gz, 'shroomlight');

  // --- Door + windows in the stem ---
  // Same threshold trick as the wizard tower: the door needs support from the FIRST role
  // (the lawn is the landscaper's, and it arrives 9s after the mason starts).
  c.punch('mason', [[cx, 0, cz - R], [cx, 1, cz - R], [cx, 2, cz - R]]);
  c.put('mason', cx, -1, cz - R, 'rooted_dirt');
  c.punch('landscaper', [[cx, -1, cz - R]]);
  c.door('carpenter', cx, 0, cz - R, 'spruce_door');
  const wins = [[cx - R, 2, cz], [cx + R, 3, cz], [cx, 3, cz + R]];
  c.punch('mason', wins);
  for (const [wx, wy, wz] of wins) c.put('decorator', wx, wy, wz, 'glass_pane');
  // lanterns flanking the path - support is the lawn, which arrives later (pagoda pattern:
  // the lawn landing beneath them is the only neighbor event these cells ever see)
  c.put('decorator', cx - 1, 0, cz - R - 2, 'lantern');
  c.put('decorator', cx + 1, 0, cz - R - 2, 'lantern');

  // --- Landscaper: a path out the front, toadstool children, small mushrooms ---
  for (let z = cz - capR - 4; z < cz - R; z++) c.put('landscaper', cx, -1, z, 'dirt_path');
  // two knee-high toadstools flanking the house, clear of the cap's footprint
  for (const [tx, tz] of [[cx - capR - 2, cz + 2], [cx + capR + 1, cz - 3]]) {
    c.put('landscaper', tx, 0, tz, 'mushroom_stem');
    c.put('landscaper', tx, 1, tz, cap);
  }
  // small mushrooms scattered on the fungal patches (never on the path or under the door)
  let planted = 0;
  for (const [dx, dz] of shroomCells) {
    if (planted >= 8) break;
    if (dx * dx + dz * dz <= (R + 1.5) ** 2) continue;             // under the stem ring
    if (Math.abs(dx) <= 1 && dz <= -(R - 1)) continue;             // the doorway approach
    if (planted % 2 === 0 || Math.random() < 0.5) { c.put('landscaper', cx + dx, 0, cz + dz, pick(['red_mushroom', 'brown_mushroom'])); planted++; }
  }

  return finalize('Toadstool Hollow', 'A mushroom-cap cottage - a round white stem under a spotted dome, shroomlights glowing in the gills, toadstool children on a mycelium lawn.', c, [
    { from: 'mason', message: 'One round white stem, straight and true. Strangest wall I have ever raised.' },
    { from: 'carpenter', message: 'The cap overhangs on every side - gills underneath, dome on top.' },
    { from: 'decorator', message: 'White spots on the dome and shroomlights in the gills. It glows!' },
    { from: 'landscaper', message: 'Mycelium underfoot and toadstool children around the garden.' },
  ]);
}

function treehouse() {
  const c = makeCanvas();
  const P = randInt(7, 9);             // platform height
  const cx = 12, cz = 12;              // trunk NW column (the trunk is 2x2: cx..cx+1, cz..cz+1)
  const wood = pick(['oak', 'dark_oak']);
  const log = `${wood}_log`, plank = `${wood}_planks`;
  const leaf = pick([`${wood}_leaves[persistent=true]`, 'azalea_leaves[persistent=true]']);
  const x0 = cx - 4, x1 = cx + 5, z0 = cz - 4, z1 = cz + 5;   // 10x10 platform
  const hx1 = x0 + 6, hz1 = z0 + 6;    // hut: x0..hx1, z0..hz1 (the trunk passes through it)
  const inTrunk = (x, z) => x >= cx && x <= cx + 1 && z >= cz && z <= cz + 1;

  // --- Landscaper: forest floor (plain grass - a podzol speckle read as mud splats) ---
  c.floor('landscaper', x0 - 4, z0 - 4, x1 + 4, z1 + 4, -1, 'grass_block');
  for (let z = z1 + 2; z <= z1 + 4; z++) c.put('landscaper', x1, -1, z, 'dirt_path');   // path to the ladder

  // --- Mason: the giant trunk, its root flare, and the stilts - everything load-bearing ---
  c.box('mason', cx, 0, cz, cx + 1, P + 8, cz + 1, log);
  for (const [rx, rz] of [[cx - 1, cz], [cx + 2, cz + 1], [cx, cz - 1], [cx + 1, cz + 2]]) c.put('mason', rx, 0, rz, log);
  // stilts under the platform corners; the ladder corner's stilt rises THROUGH the deck
  // (the deck cell above it is punched below) so the ladder has backing its whole height
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1]]) c.box('mason', px, 0, pz, px, P - 1, pz, log);
  c.box('mason', x1, 0, z1, x1, P, z1, log);

  // --- Carpenter: platform deck, railing, the hut, its roof, the ladder ---
  c.floor('carpenter', x0, z0, x1, z1, P, plank);
  c.punch('carpenter', [
    [cx, P, cz], [cx + 1, P, cz], [cx, P, cz + 1], [cx + 1, P, cz + 1],   // the trunk owns its columns
    [x1, P, z1],                                                          // the ladder stilt tops out here
  ]);
  // hut walls with log corners, wrapped around the trunk
  c.walls('carpenter', x0, z0, hx1, hz1, P + 1, P + 3, plank);
  for (const [wx, wz] of [[x0, z0], [x0, hz1], [hx1, z0], [hx1, hz1]]) c.box('carpenter', wx, P + 1, wz, wx, P + 3, wz, log);
  // stepped hip roof; every stair carries a facing, and the trunk keeps its own columns
  const roofPut = (x, y, z, type) => { if (!inTrunk(x, z)) c.put('carpenter', x, y, z, type); };
  const roofRing = (rx0, rz0, rx1, rz1, y) => {
    for (let x = rx0; x <= rx1; x++) for (let z = rz0; z <= rz1; z++) {
      if (x !== rx0 && x !== rx1 && z !== rz0 && z !== rz1) continue;
      const facing = x === rx0 ? 'east' : x === rx1 ? 'west' : z === rz0 ? 'south' : 'north';
      roofPut(x, y, z, `spruce_stairs[facing=${facing}]`);
    }
  };
  roofRing(x0 - 1, z0 - 1, hx1 + 1, hz1 + 1, P + 4);   // eave overhang
  roofRing(x0, z0, hx1, hz1, P + 4);                   // ...meets the wall top, no gap ring
  roofRing(x0 + 1, z0 + 1, hx1 - 1, hz1 - 1, P + 5);
  for (let x = x0 + 2; x <= hx1 - 2; x++) for (let z = z0 + 2; z <= hz1 - 2; z++) roofPut(x, P + 6, z, `${wood}_slab`);
  // deck railing on the open sides (skip the hut's own walls and the ladder top-out corner)
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
    if (x <= hx1 && z <= hz1) continue;                // the hut stands here
    if (x === x1 && z === z1) continue;                // climb-out gap above the ladder stilt
    c.put('carpenter', x, P + 1, z, `${wood}_fence`);
  }
  // the ladder climbs the corner stilt from the ground to the deck
  for (let y = 0; y <= P; y++) c.put('carpenter', x1, y, z1 + 1, 'ladder[facing=south]');
  // hut door onto the deck - its support is the carpenter's own floor, laid first (y-ascending)
  c.punch('carpenter', [[hx1, P + 1, z0 + 3], [hx1, P + 2, z0 + 3]]);
  c.door('carpenter', hx1, P + 1, z0 + 3, `${wood}_door`, 'east');

  // --- Decorator: windows, lanterns on the railing, a light under the eaves ---
  const wins = [[x0, P + 2, z0 + 2], [x0, P + 2, z0 + 4], [x0 + 2, P + 2, z0], [x0 + 4, P + 2, z0]];
  c.punch('carpenter', wins);
  for (const [wx, wy, wz] of wins) c.put('decorator', wx, wy, wz, 'glass_pane');
  // lanterns sit on railing posts (support arrives from the carpenter later - the fence
  // landing beneath them is the only neighbor event these cells see; keep them spaced so
  // they never update each other while unsupported)
  c.put('decorator', x1, P + 2, z0, 'lantern');
  c.put('decorator', x1, P + 2, cz, 'lantern');
  c.put('decorator', x0 + 2, P + 2, z1, 'lantern');
  c.put('decorator', x1 - 1, P + 2, z1, 'lantern');
  // a lamp post at the foot of the ladder (post is the landscaper's; the lantern rides it)
  c.put('landscaper', x1 - 2, 0, z1 + 2, `${wood}_fence`);
  c.put('decorator', x1 - 2, 1, z1 + 2, 'lantern');

  // --- Landscaper: the canopy (clear of the roof below and of the trunk's own columns) ---
  // big and dense, or the "giant tree" reads as a bush on a box (seen on the first live build)
  const canopy = (r, y) => {
    for (const [dx, dz] of discPoints(r))
      if (!(y <= P + 8 && inTrunk(cx + dx, cz + dz)))   // the trunk owns its columns up to its top
        c.put('landscaper', cx + dx, y, cz + dz, leaf);
  };
  canopy(7, P + 7);
  canopy(7, P + 8);
  canopy(6, P + 9);
  canopy(4, P + 10);
  for (const [dx, dz] of discPoints(2)) c.put('landscaper', cx + dx, P + 11, cz + dz, leaf);
  // shrubs and flowers on the forest floor, clear of the stilts, path and ladder
  for (let i = 0; i < 10; i++) {
    const fx = randInt(x0 - 3, x1 + 3), fz = randInt(z0 - 3, z1 + 3);
    if (fx >= x0 && fx <= x1 && fz >= z0 && fz <= z1) continue;      // under the platform
    if (fx === x1 && fz >= z1) continue;                             // the path + ladder foot
    if (fx === x1 - 2 && fz === z1 + 2) continue;                    // the lamp post holds a lantern
    c.put('landscaper', fx, 0, fz, pick(['poppy', 'oxeye_daisy', 'cornflower', `${wood === 'oak' ? 'oak' : 'dark_oak'}_sapling`]));
  }

  return finalize('The Old Oak Hideout', 'A stilted treehouse wrapped around a giant tree - a plank deck with a railed edge, a hip-roofed hut the trunk grows through, a ladder up a corner stilt, and a broad canopy overhead.', c, [
    { from: 'mason', message: 'Wood today? Fine - the trunk and the stilts hold everything up, so they are mine.' },
    { from: 'carpenter', message: 'Deck, hut, roof, ladder - a whole house up a tree. Watch the last rung.' },
    { from: 'decorator', message: 'Lanterns along the railing so you can find the ladder after dark.' },
    { from: 'landscaper', message: 'The canopy goes on last - a roof of leaves over the roof of slabs.' },
  ]);
}

function balloon() {
  const c = makeCanvas();
  const cx = 11, cz = 11;
  const B = 3;                          // basket floor height (it hovers - moments from lift-off)
  const E = 8;                          // envelope bottom
  const [colA, colB] = pick([
    ['red_wool', 'white_wool'], ['yellow_wool', 'purple_wool'], ['lime_wool', 'white_wool'],
    ['orange_wool', 'white_wool'], ['cyan_wool', 'white_wool'], ['magenta_wool', 'yellow_wool'],
  ]);
  // vertical stripes: eight sectors around the axis, alternating the two colours
  const stripe = (x, z) => (Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / (Math.PI / 4))) % 2 === 0 ? colA : colB);

  // --- Landscaper: the launch meadow ---
  c.floor('landscaper', cx - 11, cz - 11, cx + 11, cz + 11, -1, () => weighted([['grass_block', 9], ['coarse_dirt', 1]]));
  // hay bales stacked by the field edge
  c.put('landscaper', cx + 8, 0, cz - 7, 'hay_block'); c.put('landscaper', cx + 8, 1, cz - 7, 'hay_block');
  c.put('landscaper', cx + 7, 0, cz - 6, 'hay_block');
  // a windsock on a pole, reading the breeze
  c.box('landscaper', cx - 8, 0, cz + 8, cx - 8, 3, cz + 8, 'oak_fence');
  c.put('landscaper', cx - 7, 3, cz + 8, 'orange_wool');
  c.put('landscaper', cx - 6, 3, cz + 8, 'white_wool');
  // a picnic laid out to watch the ascent
  c.put('landscaper', cx + 7, 0, cz + 7, 'red_carpet'); c.put('landscaper', cx + 8, 0, cz + 7, 'white_carpet');
  c.put('landscaper', cx + 7, 0, cz + 8, 'white_carpet'); c.put('landscaper', cx + 8, 0, cz + 8, 'red_carpet');

  // --- Mason: the launch plinth and its anchor stones ---
  const plinth = [];
  for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) plinth.push([x, -1, z]);
  c.punch('landscaper', plinth);        // the lawn must not be written back over the plinth
  for (const [px, py, pz] of plinth) c.put('mason', px, py, pz, weighted([['stone_bricks', 6], ['polished_andesite', 4]]));
  for (const [ax, az] of [[cx - 3, cz - 3], [cx + 3, cz - 3], [cx - 3, cz + 3], [cx + 3, cz + 3]])
    c.put('mason', ax, 0, az, 'chiseled_stone_bricks');

  // --- Carpenter: basket, mooring line, ropes up to the envelope ---
  c.box('carpenter', cx, 0, cz, cx, B - 1, cz, 'oak_fence');            // the mooring, holding her down
  c.floor('carpenter', cx - 1, cz - 1, cx + 1, cz + 1, B, 'dark_oak_planks');
  c.walls('carpenter', cx - 1, cz - 1, cx + 1, cz + 1, B + 1, B + 1, 'dark_oak_planks');
  for (const [rx, rz] of [[cx - 1, cz - 1], [cx + 1, cz - 1], [cx - 1, cz + 1], [cx + 1, cz + 1]])
    c.box('carpenter', rx, B + 2, rz, rx, E - 1, rz, 'dark_oak_fence'); // rigging to the envelope rim

  // --- Decorator: the striped envelope, the burner, the sandbags ---
  c.put('decorator', cx, B + 3, cz, 'glowstone');                       // the burner, roaring
  c.put('decorator', cx, B + 4, cz, 'end_rod');                         // its flame
  c.cyl('decorator', cx, cz, 2, E, E, stripe);
  c.cyl('decorator', cx, cz, 3, E + 1, E + 1, stripe);
  c.cyl('decorator', cx, cz, 4, E + 2, E + 2, stripe);
  c.cyl('decorator', cx, cz, 5, E + 3, E + 6, stripe);
  c.cyl('decorator', cx, cz, 4, E + 7, E + 7, stripe);
  c.cyl('decorator', cx, cz, 3, E + 8, E + 8, stripe);
  c.cyl('decorator', cx, cz, 2, E + 9, E + 9, stripe);
  c.disc('decorator', cx, cz, 2, E + 10, stripe);                       // crown
  c.put('decorator', cx - 2, B, cz, 'hay_block');                       // ballast sacks on the rim
  c.put('decorator', cx + 2, B, cz + 1, 'hay_block');

  return finalize('The Skylark', 'A striped hot-air balloon straining at its mooring - a wicker basket on a stone plinth, rigging up to a two-colour envelope, a glowing burner, and a picnic laid out to watch.', c, [
    { from: 'mason', message: 'A plinth and four anchor stones. She pulls harder than she looks.' },
    { from: 'carpenter', message: 'Basket lashed, rigging up, one mooring line holding her down.' },
    { from: 'decorator', message: 'Stripes all the way round and the burner lit - ready when you are.' },
    { from: 'landscaper', message: 'Windsock says a gentle easterly. Picnic is out - up she goes!' },
  ]);
}

function rocket() {
  const c = makeCanvas();
  const cx = 11, cz = 11;
  const H = randInt(11, 13);            // body top
  const accent = pick(['red_concrete', 'blue_concrete', 'orange_concrete']);
  const gx0 = cx + 4, gx1 = cx + 6, gz0 = cz - 1, gz1 = cz + 1;   // gantry footprint

  // --- Landscaper: the range - lawn, a gravel service road, fuel tanks ---
  c.floor('landscaper', cx - 11, cz - 11, cx + 11, cz + 11, -1, () => weighted([['grass_block', 8], ['coarse_dirt', 2]]));
  for (let x = gx1 + 1; x <= cx + 11; x++) c.put('landscaper', x, -1, cz, 'gravel');
  for (const [tx, tz] of [[cx - 8, cz - 8], [cx - 8, cz - 5]]) {
    c.cyl('landscaper', tx, tz, 1, 0, 2, 'white_concrete');
    c.disc('landscaper', tx, tz, 1, 3, 'white_concrete');
  }

  // --- Mason: the pad (hazard-striped rim, scorched core), the mount legs, the nozzle ---
  const padCells = discPoints(7).map(([dx, dz]) => [cx + dx, -1, cz + dz]);
  c.punch('landscaper', padCells);      // the lawn keeps off the pad
  for (const [px, py, pz] of padCells) {
    const d2 = (px - cx) ** 2 + (pz - cz) ** 2;
    const t = d2 >= 6.5 ** 2 ? ((px + pz) % 2 === 0 ? 'yellow_concrete' : 'black_concrete')
      : d2 <= 2.5 ** 2 ? weighted([['blackstone', 6], ['coal_block', 4]])
        : weighted([['polished_andesite', 6], ['stone_bricks', 4]]);
    c.put('mason', px, py, pz, t);
  }
  for (const [lx, lz] of [[cx + 2, cz], [cx - 2, cz], [cx, cz + 2], [cx, cz - 2]])
    c.box('mason', lx, 0, lz, lx, 1, lz, 'polished_blackstone');        // launch mount legs
  c.ring('mason', cx, cz, 1, 1, 'polished_blackstone');                 // engine nozzle
  c.cyl('mason', cx, cz, 2, 2, H, (x, z, y) => (y === 6 ? accent : 'white_concrete'));

  // --- Carpenter: nose cone, fins, and the wooden gantry ---
  c.cone('carpenter', cx, cz, 2, H + 1, accent);
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    c.box('carpenter', cx + 3 * ux, 2, cz + 3 * uz, cx + 3 * ux, 4, cz + 3 * uz, accent);
    c.put('carpenter', cx + 4 * ux, 2, cz + 4 * uz, accent);
  }
  for (const [px, pz] of [[gx0, gz0], [gx0, gz1], [gx1, gz0], [gx1, gz1]])
    c.box('carpenter', px, 0, pz, px, H - 3, pz, 'oak_log');            // gantry corner posts
  for (const py of [3, 7, H - 2]) c.floor('carpenter', gx0, gz0, gx1, gz1, py, 'oak_planks');
  c.put('carpenter', cx + 3, H - 2, cz, 'oak_planks');                  // crew bridge to the hatch
  for (let x = gx0; x <= gx1; x++) for (let z = gz0; z <= gz1; z++)     // top-platform railing
    if (x === gx0 || x === gx1 || z === gz0 || z === gz1) c.put('carpenter', x, H - 1, z, 'oak_fence');
  c.box('carpenter', gx1, H - 1, gz0, gx1, H + 1, gz0, 'oak_fence');    // flag pole

  // --- Decorator: portholes, the engine glow, the flag, a beacon lamp ---
  c.put('decorator', cx, 0, cz, 'glowstone');                           // engine, idling under the nozzle
  c.put('decorator', cx, H + 4, cz, 'end_rod');                         // antenna on the cone tip
  const ports = [[cx, 4, cz - 2], [cx, 8, cz - 2], [cx + 2, 10, cz]];
  c.punch('mason', ports);
  for (const [px, py, pz] of ports) c.put('decorator', px, py, pz, 'glass_pane');
  c.put('decorator', gx1, H + 2, gz0, accent.replace('_concrete', '_wool'));   // the flag
  c.put('decorator', gx0 + 1, H - 1, cz, 'sea_lantern');                // floodlight on the top platform

  return finalize('Pioneer Pad', 'A striped rocket on its launch mount - hazard-ringed pad, four fins and a bright nose cone, a wooden gantry with a crew bridge, engine glowing for the countdown.', c, [
    { from: 'mason', message: 'Pad poured, mount legs set, and the hull is straight to the millimetre.' },
    { from: 'carpenter', message: 'Gantry up, crew bridge across, fins bolted on. She looks fast standing still.' },
    { from: 'decorator', message: 'Portholes glazed, flag up, engine idling. T-minus whenever you are ready.' },
    { from: 'landscaper', message: 'Fuel tanks topped off and the service road raked. Clear the pad!' },
  ]);
}

const GENERATORS = { castle, wizardTower, cottage, lighthouse, windmill, pagoda, ship, temple, observatory, mushroomHouse, treehouse, balloon, rocket };

/** List the library builds available for the menu. */
export function listBuilds() {
  return [
    { id: 'castle', name: 'Stonewatch Keep - a moated castle with round towers' },
    { id: 'wizardTower', name: 'The Arcane Spire - a tapered wizard tower that glows' },
    { id: 'cottage', name: 'Willowbrook Cottage - a timber cottage with a garden' },
    { id: 'lighthouse', name: 'Beacon Point Lighthouse - a striped tower on a rocky isle' },
    { id: 'windmill', name: 'Gristmill Rise - a working windmill over golden wheat' },
    { id: 'pagoda', name: 'The Vermilion Pagoda - three tiers of flaring red eaves' },
    { id: 'ship', name: 'The Wandering Gull - a galleon at anchor, sails set' },
    { id: 'temple', name: 'Temple of the Golden Sun - a sandstone ziggurat in the dunes' },
    { id: 'observatory', name: 'Celestia Observatory - a domed spire aimed at the stars' },
    { id: 'mushroomHouse', name: 'Toadstool Hollow - a spotted mushroom-cap cottage that glows' },
    { id: 'treehouse', name: 'The Old Oak Hideout - a stilted treehouse in a giant canopy' },
    { id: 'balloon', name: 'The Skylark - a striped hot-air balloon straining at its mooring' },
    { id: 'rocket', name: 'Pioneer Pad - a rocket on its gantry, counting down' },
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
