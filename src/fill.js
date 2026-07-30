// /fill, without the silent 32768-block cliff.
//
// Minecraft's `/fill` refuses any region larger than 32,768 blocks - and refuses it the way
// this project keeps getting bitten by: the command goes out as chat, the server discards it,
// and NOTHING says so. The panel learned this the hard way on `/fillbiome` (a naive 32x32x66
// tiling was 67k per command, so four of every five were dropped and only the thin edge strips
// of a scene ever landed), and the crew's own "let me clear the area first!" had the same shape
// - one `/fill` over the whole plan bounding box. Every preset happens to fit (the castle is
// the largest at 20,808), but an ops build may legally span the plot to y=48, which is 122,112
// blocks: the clear silently does nothing, and the coordinator's prompt has meanwhile promised
// the model a site "bulldozed to bare earth before you start".
//
// So the split lives in ONE place and everything that clears ground uses it.
//
// Split on VOLUME - halve the longest axis until it fits - rather than tiling into 32^3 cubes:
// a long thin box like a shore ring (3 x 1 x 289 = 867 blocks) is then a single command instead
// of ten. The small pause between commands keeps us under the server's chat rate limit; too
// fast and the bot is kicked for spamming. 45ms (~22 cmd/s) tests clean.

export const FILL_CAP = 32768;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How many `/fill` commands a region needs. Pure - the split rule, without a bot. */
export function fillPlan(x0, y0, z0, x1, y1, z1, cap = FILL_CAP) {
  const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
  const box = [lo(x0, x1), lo(y0, y1), lo(z0, z1), hi(x0, x1), hi(y0, y1), hi(z0, z1)];
  const out = [];
  const split = ([ax, ay, az, bx, by, bz]) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    if ((dx + 1) * (dy + 1) * (dz + 1) <= cap) { out.push([ax, ay, az, bx, by, bz]); return; }
    if (dx >= dy && dx >= dz) {
      const m = ax + (dx >> 1);
      split([ax, ay, az, m, by, bz]); split([m + 1, ay, az, bx, by, bz]);
    } else if (dz >= dy) {
      const m = az + (dz >> 1);
      split([ax, ay, az, bx, by, m]); split([ax, ay, m + 1, bx, by, bz]);
    } else {
      const m = ay + (dy >> 1);
      split([ax, ay, az, bx, m, bz]); split([ax, m + 1, az, bx, by, bz]);
    }
  };
  split(box);
  return out;
}

/**
 * Fill a region with `block`, as however many `/fill` commands it takes.
 *
 * @param {object} bot        any connected mineflayer bot with operator permission
 * @param {{ delay?: number, assert?: Function }} [opts]
 *   `assert` runs before every command - the panel passes its lead-is-alive check, because
 *   `bot.chat()` on a dropped bot is a silent no-op and hundreds of fills can evaporate.
 */
export async function fillRegion(bot, x0, y0, z0, x1, y1, z1, block, opts = {}) {
  const { delay = 45, assert } = opts;
  const type = String(block).replace(/^minecraft:/, '');
  for (const [ax, ay, az, bx, by, bz] of fillPlan(x0, y0, z0, x1, y1, z1)) {
    if (assert) assert();
    bot.chat(`/fill ${ax} ${ay} ${az} ${bx} ${by} ${bz} minecraft:${type}`);
    await sleep(delay);
  }
}

/** The bounding box of a block list, optionally grown by `pad` on every side. */
export function blockBounds(blocks, pad = 0) {
  if (!blocks?.length) return null;
  const axis = (k) => {
    const vs = blocks.map((b) => b[k]);
    return [Math.min(...vs) - pad, Math.max(...vs) + pad];
  };
  const [x0, x1] = axis('x'), [y0, y1] = axis('y'), [z0, z1] = axis('z');
  return { x0, y0, z0, x1, y1, z1 };
}

/**
 * Air out everything a plan is about to occupy. The site is cleared to BARE EARTH including
 * the grass, which is exactly what the coordinator's prompt tells the model to expect - if
 * this quietly does nothing, a landscaper's flowers land on ground that was never cleared and
 * the design the model wrote is not the one that gets built.
 */
export async function clearForPlan(bot, plan, opts = {}) {
  const blocks = Object.values(plan.assignments || {}).flatMap((a) => a.blocks || []);
  const b = blockBounds(blocks);
  if (!b) return 0;
  await fillRegion(bot, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, 'air', opts);
  return fillPlan(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1).length;
}
