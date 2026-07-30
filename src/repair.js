// The build looks at itself, and fixes what didn't land.
//
// Inspired by Voyager (github.com/MineDojo/Voyager), whose central loop is not "write code" but
// "write code, run it, read the environment's complaint, rewrite it". We already produced the
// complaint and threw it away: Crew.verifyBuild() re-reads the world after a build and counts
// the blocks that never arrived, and the only thing anyone did with that number was print it.
// A build could finish with 40 blocks missing and the panel would say "done".
//
// So this closes the loop, in two escalating passes:
//
//   1. REPLACE (free, always on). Re-issue the missing blocks, y-ascending. This catches the
//      dropped ones - a command that went out while a worker was mid-timeout, a chunk that
//      wasn't loaded yet. If a pass fixes nothing, the blocks are not dropped, they are
//      IMPOSSIBLE, and re-sending them a third time will not help. Stop and escalate.
//
//   2. ASK (needs an LLM key). A block that will not stay is a design error: a torch on air, a
//      door with no floor, gravel over water. That is exactly Voyager's "execution error" signal,
//      and a model can act on it - but only if it is told WHY the game refused, so each failure
//      is reported with what is actually at that coordinate now and what is (or isn't) holding
//      it up. The model returns a patch, the patch is applied and re-verified, and it becomes
//      part of the plan - the design is what improved, not just the world.
//
// Presets never reach step 2 (the panel forces LLM_PROVIDER=library for them), and they don't
// need to: test/preset-audit.test.mjs already simulates them. Step 2 is for live model builds,
// which have nobody checking their geometry.

import { Vec3 } from 'vec3';
import { complete, isLiveProvider } from './providers.js';
import { planDigest } from './digest.js';
import { buildRoles } from './profiles.js';
import { normalizeType, LIMITS } from './ops.js';
import { parseJsonish } from './json.js';

// Blocks that legitimately vanish on their own if their support isn't right (a poppy on a wall
// footing, wheat on plain dirt). They are the build's own business, not a dropped command, and
// re-placing them just makes them pop off again - so they are never counted as missing.
export const POPS_OFF = /poppy|dandelion|cornflower|orchid|allium|daisy|sapling|wheat|carrots|grass$|petals|dead_bush|torch|water|fire|campfire/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The plan's blocks, one per coordinate, last write wins - exactly what the build ends up as. */
export function expectedBlocks(plan) {
  const expected = new Map();
  for (const role of plan.buildOrder || Object.keys(plan.assignments || {}))
    for (const b of plan.assignments?.[role]?.blocks || [])
      expected.set(`${b.x},${b.y},${b.z}`, { ...b, role });
  return expected;
}

/**
 * The structure blocks that are NOT in the world. Read from the bot's own copy of the world,
 * so it costs nothing.
 *
 * @returns {Array<{x,y,z,type,role}>}
 */
export function missingBlocks(bot, plan) {
  const out = [];
  for (const b of expectedBlocks(plan).values()) {
    if (POPS_OFF.test(b.type)) continue;
    if (bot.blockAt(new Vec3(b.x, b.y, b.z))?.name === 'air') out.push(b);
  }
  return out;
}

/** Re-issue a set of blocks, y-ascending so support always precedes what stands on it. */
async function place(crew, blocks, { delay = 60 } = {}) {
  const ordered = [...blocks].sort((a, b) => a.y - b.y);
  for (const b of ordered) {
    const worker = crew.workers.get(b.role) || crew.activeWorkers[0];
    if (!worker?.alive) throw new Error(`${b.role || 'the crew'} is disconnected - cannot repair`);
    worker.bot.chat(`/setblock ${b.x} ${b.y} ${b.z} minecraft:${b.type}`);
    worker.blocksPlaced++;
    await sleep(delay);
  }
}

/**
 * Close the loop on a finished build.
 *
 * @param {import('./crew.js').Crew} crew
 * @param {object} plan - mutated in place if the model patches it
 * @param {{ rounds?: number, ask?: boolean, log?: Function }} [opts]
 * @returns {Promise<{before:number, after:number, replaced:number, patch:object|null}>}
 */
export async function repairBuild(crew, plan, opts = {}) {
  const { rounds = 2, ask = process.env.REPAIR !== 'off', log = console.log } = opts;
  const lead = crew.activeWorkers[0];
  if (!lead?.bot) return null;

  let missing = missingBlocks(lead.bot, plan);
  const before = missing.length;
  if (!before) return { before: 0, after: 0, replaced: 0, patch: null };

  log(`[Repair] ${before} blocks never landed - re-placing them.`);

  // --- pass 1: re-place ------------------------------------------------------------
  let replaced = 0;
  for (let round = 1; round <= rounds && missing.length; round++) {
    await crew.ensureAlive();
    await place(crew, missing);
    replaced += missing.length;
    // The server echoes the block changes back to the bot before its world copy agrees with
    // reality; reading too early reports everything as still missing and burns a round.
    await sleep(2000);

    const after = missingBlocks(lead.bot, plan);
    const fixed = missing.length - after.length;
    log(`[Repair] round ${round}: ${fixed} recovered, ${after.length} still missing.`);
    missing = after;
    // No progress means these blocks are not dropped commands, they are physically refused.
    // A third identical /setblock will be refused identically. Escalate instead.
    if (fixed <= 0) break;
  }

  if (!missing.length) {
    log(`[Repair] All ${before} blocks recovered - the build matches the plan.`);
    return { before, after: 0, replaced, patch: null };
  }

  // --- pass 2: ask the model why -----------------------------------------------------
  if (!ask || !isLiveProvider()) {
    log(`[Repair] ${missing.length} blocks will not stay (no support / illegal placement). ` +
        (isLiveProvider() ? '' : 'Set an LLM key to have the model fix the design.'));
    return { before, after: missing.length, replaced, patch: null };
  }

  let patch = null;
  try {
    patch = await askForPatch(lead.bot, plan, missing, log);
  } catch (err) {
    log(`[Repair] The model could not produce a fix (${err.message}) - leaving the build as-is.`);
    return { before, after: missing.length, replaced, patch: null };
  }

  if (!patch || (!patch.add?.length && !patch.remove?.length)) {
    log('[Repair] The model had no fix to offer.');
    return { before, after: missing.length, replaced, patch: null };
  }

  await executePatch(crew, plan, patch);

  const after = missingBlocks(lead.bot, plan);
  log(`[Repair] Patched: +${patch.add?.length || 0} blocks, -${patch.remove?.length || 0}. ` +
      `${after.length} still missing.`);
  return { before, after: after.length, replaced, patch };
}

/**
 * Fold a patch into the plan AND into the world. Used by the repair loop and by the visual
 * critic (src/critic.js) - a patch is a patch, whether the game complained or the model did.
 *
 * Removals go first: a patch that clears a bad block and re-places a good one on the same
 * coordinate has to happen in that order, or the removal deletes the fix.
 */
export async function executePatch(crew, plan, patch) {
  applyPatch(plan, patch);
  await crew.ensureAlive();
  for (const b of patch.remove || []) {
    const worker = crew.workers.get(b.role) || crew.activeWorkers[0];
    if (!worker?.alive) throw new Error('the crew is disconnected - cannot apply the patch');
    worker.bot.chat(`/setblock ${b.x} ${b.y} ${b.z} minecraft:air`);
    await sleep(60);
  }
  await place(crew, patch.add || []);
  // The server has to echo the changes back before the bot's copy of the world agrees with
  // reality - verifying any sooner reports the fix itself as missing.
  await sleep(2000);
  return plan;
}

// The model works in the plan's relative coordinates; the world works in absolute ones. Every
// number that crosses that boundary in the wrong frame lands the fix in a neighbouring plot, so
// the origin is threaded through explicitly rather than kept anywhere ambient.
const rel = (b, o) => ({ x: b.x - o.x, y: b.y - o.y, z: b.z - o.z });
const abs = (b, o) => ({ x: b.x + o.x, y: b.y + o.y, z: b.z + o.z });

// Report each failure the way the game sees it: what is at the coordinate now, and what is
// under it. "stone_brick_stairs at 4,7,12 did not stay; below it is air" is a diagnosis. A bare
// coordinate list is just a complaint, and a model can't act on a complaint.
function failureReport(bot, missing, origin, limit = 60) {
  const rows = missing.slice(0, limit).map((b) => {
    const r = rel(b, origin);
    const below = bot.blockAt(new Vec3(b.x, b.y - 1, b.z))?.name ?? 'unknown';
    const at = bot.blockAt(new Vec3(b.x, b.y, b.z))?.name ?? 'unknown';
    return `  ${b.role}: ${b.type} at (${r.x},${r.y},${r.z}) - the block below is ${below}, the space itself is now ${at}`;
  });
  if (missing.length > limit) rows.push(`  ...and ${missing.length - limit} more`);
  return rows.join('\n');
}

const REPAIR_PROMPT = `You are the lead architect of a Minecraft build crew, reviewing a build that has just finished.

Some blocks in your plan are NOT in the world. The crew issued every one of them, twice, and the
game refused them - so these are not dropped commands, they are placements Minecraft will not
accept. Your job is to work out why, and patch the PLAN so the structure is complete and legal.

The usual causes, in order of likelihood:
- Nothing is holding it up. Torches, lanterns, doors, ladders, signs, rails, plants and gravity
  blocks (sand, gravel, concrete_powder) all need a solid neighbour or a solid block below. Fix:
  add the missing support block (owned by an EARLIER role than the thing standing on it), or move
  the block to somewhere that has support, or drop it.
- It sits on or in water/lava. Fix: give it solid ground, or drop it.
- A door's lower half has no floor, or its upper half has no lower half. A door is two blocks.
- The block is decorative and simply cannot go there. Fix: drop it.

Output valid JSON and nothing else:
{
  "analysis": "one or two sentences on what actually went wrong",
  "add":    [{ "x": 0, "y": 0, "z": 0, "type": "stone_bricks", "role": "mason" }],
  "remove": [{ "x": 0, "y": 0, "z": 0 }]
}

- Coordinates are RELATIVE to the build origin, exactly as in the blueprint below.
- "add" places a block (this also adds it to the plan). Use it for missing SUPPORT.
- "remove" deletes a block from the plan - use it for placements that can never work.
- A support block must belong to a role that builds EARLIER than the block it supports.
- Keep the patch small and surgical. Do not redesign the build. Under 80 entries.`;

async function askForPatch(bot, plan, missing, log) {
  const origin = plan.origin || { x: 0, y: 0, z: 0 };
  log(`[Repair] Asking the model why ${missing.length} blocks won't stay...`);

  const user =
    `The build is "${plan.name}"${plan.prompt ? ` (requested: "${plan.prompt}")` : ''}.\n` +
    `Build order (earlier roles build first): ${(plan.buildOrder || buildRoles()).join(' -> ')}\n\n` +
    `BLUEPRINT\n${planDigest(plan)}\n\n` +
    `THESE BLOCKS ARE NOT IN THE WORLD\n${failureReport(bot, missing, origin)}\n\n` +
    `Patch the plan. Output only JSON.`;

  // 16384, not 4096: a reasoning model spends this budget THINKING before it writes any JSON,
  // and a patch that gets cut off mid-object is indistinguishable from a model that refused.
  // maxTokens is a ceiling, not a spend - a short patch still costs a short patch.
  const raw = await complete({ system: REPAIR_PROMPT, user, maxTokens: 16384 });
  const patch = parseJson(raw);
  if (patch.analysis) log(`[Repair] Model: ${patch.analysis}`);

  return normalizePatch(patch, plan);
}

/**
 * Take a model's raw patch and make it safe to execute.
 *
 * This is the SAME DOOR `expandOps` is for the coordinator's ops (src/ops.js), and it now
 * enforces the same three things, because a patch is exactly as untrusted as an op:
 *
 *  - a real BLOCK NAME. `normalizeType` checks it against the actual 1.20.1 registry, repairs
 *    the near-misses models reach for (`stone_brick` -> `stone_bricks`) and drops the rest.
 *    This is the quietest failure in the project: `/setblock x y z minecraft:wooden_plank` is
 *    discarded by the server without a word, so the repair "succeeds" and the hole stays.
 *    (A missing type is worse still - it goes out as `minecraft:undefined`.)
 *  - COORDINATES INSIDE THE PLOT. Clamped in plan-relative space, before the conversion to
 *    world-absolute, exactly as ops are: a hallucinated coordinate must never put a block on
 *    the neighbouring build.
 *  - a ROLE WE ACTUALLY HAVE, coerced rather than dropped - losing a fix over a job title
 *    would be worse than mislabelling it.
 */
export function normalizePatch(patch, plan, limit = 80) {
  const origin = plan.origin || { x: 0, y: 0, z: 0 };
  const roles = plan.buildOrder?.length ? plan.buildOrder : buildRoles();
  const known = new Set(roles);
  const ok = (b) => b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Clamp in the model's own frame (relative), then convert - the other order clamps world
  // coordinates against plot-relative bounds and lands the whole patch at the origin.
  const inPlot = (b) => ({
    x: clamp(Math.round(b.x), LIMITS.minXZ, LIMITS.maxXZ),
    y: clamp(Math.round(b.y), LIMITS.minY, LIMITS.maxY),
    z: clamp(Math.round(b.z), LIMITS.minXZ, LIMITS.maxXZ),
  });
  const role = (b) => (known.has(b.role) ? b.role : roles[0]);

  return {
    analysis: patch.analysis || '',
    add: (patch.add || [])
      .filter(ok)
      .map((b) => ({ ...b, type: normalizeType(b.type) }))
      .filter((b) => b.type)
      .map((b) => ({ ...abs(inPlot(b), origin), type: b.type, role: role(b) }))
      .slice(0, limit),
    remove: (patch.remove || [])
      .filter(ok)
      .map((b) => ({ ...abs(inPlot(b), origin), role: role(b) }))
      .slice(0, limit),
  };
}

/**
 * Fold a patch into the plan, so the DESIGN is what improved and not just the world. The next
 * verify pass then holds the patched plan to account too.
 */
export function applyPatch(plan, patch) {
  const gone = new Set((patch.remove || []).map((b) => `${b.x},${b.y},${b.z}`));
  for (const role of Object.keys(plan.assignments || {})) {
    const a = plan.assignments[role];
    a.blocks = (a.blocks || []).filter((b) => !gone.has(`${b.x},${b.y},${b.z}`));
  }
  for (const b of patch.add || []) {
    const role = plan.assignments[b.role] ? b.role : (plan.buildOrder || Object.keys(plan.assignments))[0];
    (plan.assignments[role].blocks ||= []).push({ x: b.x, y: b.y, z: b.z, type: b.type });
  }
  plan.patches = (plan.patches || []).concat({ analysis: patch.analysis, add: patch.add?.length || 0, remove: patch.remove?.length || 0 });
  return plan;
}

/** Same fence-tolerant JSON extraction the coordinator uses - one copy, in src/json.js. */
export const parseJson = parseJsonish;
