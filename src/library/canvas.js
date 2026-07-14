// The build primitives - the single implementation of "how a shape becomes blocks".
//
// This used to live inside index.js, private to the procedural presets. It was extracted
// because the presets were not better than the AI builds for any reason a model could fix:
// a preset says `walls(...)` and gets 400 gap-free blocks, while the model was asked to
// hand-type every one of those blocks as {"x":..,"y":..,"z":..,"type":".."} - about 11
// tokens each. A 900-block build is then ~10k tokens of pure mechanical enumeration and the
// castle (3,338 blocks) is ~38k, which no budget we could set would buy. So the model did
// what anyone does when asked to enumerate thousands of tedious items: it shortcut, handing
// back 74 blocks with holes in the walls. The critic scored it 3/10 and was right.
//
// Now `src/ops.js` lets the MODEL call these same primitives (see the op vocabulary there),
// so an AI plan and a library preset are built by identical code. Every hard rule this crew
// learned the hard way - gap-free circles, both halves of a door, stair facings on a cone,
// openings PUNCHED rather than overwritten - is enforced here by construction, once, instead
// of being requested in prose and reproduced by hand several hundred times without a slip.
export const ROLES = ['mason', 'carpenter', 'decorator', 'landscaper'];

// The facing that points a stair's tall half at (0,0) - used to orient cone-roof shingles.
export const faceCentre = (dx, dz) =>
  Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : (dz > 0 ? 'north' : 'south');

// The full block a stair apex is capped with (a stair's top face can't support anything).
export const STAIR_CAP = {
  dark_oak_stairs: 'dark_oak_planks', spruce_stairs: 'spruce_planks', oak_stairs: 'oak_planks',
  deepslate_tile_stairs: 'deepslate_tiles', stone_brick_stairs: 'stone_bricks',
};

// Cache circle geometry so repeated rings/discs are cheap and, crucially, GAP-FREE.
const _rim = new Map();
const _disc = new Map();

/** The (dx,dz) offsets forming a 1-block-thick, gap-free circle outline of radius r. */
export function rimPoints(r) {
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

/** The (dx,dz) offsets filling a solid disc of radius r. */
export function discPoints(r) {
  if (_disc.has(r)) return _disc.get(r);
  const pts = [];
  const outer = (r + 0.5) ** 2;
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++)
      if (dx * dx + dz * dz <= outer) pts.push([dx, dz]);
  _disc.set(r, pts);
  return pts;
}

/** A role-bucketed block collector. Primitives append {x,y,z,type} to one role's list. */
export function makeCanvas() {
  const roles = { mason: [], carpenter: [], decorator: [], landscaper: [] };
  const api = {
    roles,
    put(role, x, y, z, type) { roles[role].push({ x, y, z, type }); },
    // filled solid box (inclusive). `type` may be a function (x,z,y)=>blockId.
    box(role, x0, y0, z0, x1, y1, z1, type) {
      const t = typeof type === 'function' ? type : () => type;
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
            roles[role].push({ x, y, z, type: t(x, z, y) });
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
    // stepped cone / spire: radius r0 at y0, shrinking to a point going up. Stairs get a
    // computed [facing=] so their tall half points at the axis - a cone of default stairs
    // all faces north, which reads as broken shingles on three of its four sides. The apex
    // is capped with the stair's SOLID block (STAIR_CAP): a stair top face isn't sturdy, so
    // an end rod or flag on a stair apex pops off.
    cone(role, cx, cz, r0, y0, type) {
      const stair = /_stairs$/.test(type);
      for (let level = 0; level <= r0; level++) {
        const r = r0 - level, y = y0 + level;
        if (r <= 0) { roles[role].push({ x: cx, y, z: cz, type: STAIR_CAP[type] || type }); continue; }
        for (const [dx, dz] of rimPoints(r)) {
          const t = stair ? `${type}[facing=${faceCentre(dx, dz)}]` : type;
          roles[role].push({ x: cx + dx, y, z: cz + dz, type: t });
        }
      }
    },
    // carve exact coordinates out of a role's list (for door/window openings - openings must
    // be CARVED, never overwritten: the crew builds in PARALLEL with 3s staggered starts, so
    // a decorator pane placed at t=6s on a mason wall coord gets stoned back over when the
    // mason reaches that layer at t=60s. verifyBuild only checks for air and can't see it.)
    // Returns the coords it actually removed. That return value is what lets `window` (see
    // ops.js) glaze ONLY real holes: a model that punches where there is no wall used to get a
    // pane hanging in mid-air outside the building, which is precisely what it looked like.
    punch(role, pts) {
      const s = new Set(pts.map((p) => p.join(',')));
      const removed = [];
      roles[role] = roles[role].filter((b) => {
        const at = `${b.x},${b.y},${b.z}`;
        if (!s.has(at)) return true;
        removed.push([b.x, b.y, b.z]);
        return false;
      });
      return removed;
    },
    // A door is TWO blocks. `/setblock` sets one, and a lower door half with no upper half
    // above it is an invalid block state - the game deletes it on the next block update, so
    // doors placed as a single block vanish (the castle's gate lost both of them). Place both
    // halves, and give them a facing so the door isn't hung backwards.
    door(role, x, y, z, type, facing = 'north') {
      roles[role].push({ x, y, z, type: `${type}[half=lower,facing=${facing}]` });
      roles[role].push({ x, y: y + 1, z, type: `${type}[half=upper,facing=${facing}]` });
    },
    // remove any placed blocks matching a predicate (for carving doors/windows)
    carve(role, pred) { roles[role] = roles[role].filter((b) => !pred(b)); },
  };
  return api;
}

// Blocks that need a valid support and simply pop off if they don't get one. Scattered by the
// landscaper/decorator, they sometimes land on a block an earlier role already placed - and
// because /setblock REPLACES, the wall or floor block is gone and the plant then pops off on
// the next tick, leaving a hole. Drop those instead of placing them (see finalize).
export const POPS_OFF = /^(poppy|dandelion|cornflower|oxeye_daisy|blue_orchid|allium|oak_sapling|wheat|carrots|grass|dead_bush|pink_petals)$/;

export const ROLE_TASKS = {
  mason: 'Stone structure - walls, towers, foundations',
  carpenter: 'Woodwork - roofs, floors, doors, framing',
  decorator: 'Windows, lighting, and finishing details',
  landscaper: 'Grounds - grass, gardens, water',
};

/**
 * Turn a canvas into a crew-format plan.
 *
 * The de-dupe and the POPS_OFF guard are the two rules that keep a plan honest, and both are
 * about roles overwriting each other: `/setblock` REPLACES, and the crew runs mason ->
 * carpenter -> decorator -> landscaper, so a later role's block silently deletes an earlier
 * role's. A flower that lands on a wall coordinate removes the wall AND then pops off itself,
 * leaving a real hole in the building.
 */
export function finalize(name, description, canvas, teamChat, tasks = ROLE_TASKS) {
  const assignments = {};
  const claimed = new Set();   // every coord a role has already taken, in build order
  for (const role of ROLES) {
    // de-dupe blocks at the same coord (last write wins) to keep counts honest
    const seen = new Map();
    for (const b of canvas.roles[role]) seen.set(`${b.x},${b.y},${b.z}`, b);
    const blocks = [];
    for (const b of seen.values()) {
      const at = `${b.x},${b.y},${b.z}`;
      if (POPS_OFF.test(b.type) && claimed.has(at)) continue;   // don't punch a hole to plant a flower
      blocks.push(b);
      claimed.add(at);
    }
    assignments[role] = { task: tasks[role] || ROLE_TASKS[role], blocks };
  }
  return { name, description, assignments, buildOrder: [...ROLES], teamChat };
}
