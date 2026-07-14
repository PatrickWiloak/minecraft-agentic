import { readFileSync } from 'node:fs';
import { complete, isLiveProvider, providerLabel } from './providers.js';
import { getLibraryPlan, listBuilds } from './library/index.js';
import { buildRoles, teamBrief } from './profiles.js';
import { planDigest } from './digest.js';
import { planFromOps, opsReference } from './ops.js';

// The team paragraph and the per-role material lists are GENERATED from src/profiles/*.json
// (see src/profiles.js) rather than written out here. They used to be duplicated: the roles
// were described in this prompt and again in worker.js, and the two drifted - the prompt never
// learned any of the rules the crew had been burned by ("a window is a hole in someone else's
// wall", "anything load-bearing belongs to the mason"). Those rules now live on the role, in
// one place, and the model is told them.
// The model designs in OPS, not in blocks (see src/ops.js for the why: a block list costs ~11
// tokens PER BLOCK, so a 900-block build was ~10k tokens of mechanical typing and the model
// simply gave up and returned 74 blocks with holes in the walls). The op reference below is
// generated from the OPS table in ops.js, so this prompt can never describe an op that does
// not exist, or miss one that does.
const COORDINATOR_PROMPT = () => `You are the lead architect coordinating a Minecraft build team. Given a build request, design a build and hand the team a plan.

You do NOT list blocks one at a time. You call BUILD OPS - each one is a shape that expands into
hundreds of blocks. A wall is one op, not four hundred coordinates. This is what lets you build
something enormous and detailed in a short plan, so USE it: spend your effort on the design.

THE OPS:
${opsReference()}

Every op takes a "role" - the worker who performs it. Your team, in build order:
${teamBrief()}

Output valid JSON, and nothing else:
{
  "name": "Build name",
  "description": "One sentence",
  "tasks": { ${buildRoles().map((r) => `"${r}": "what they are building"`).join(', ')} },
  "ops": [ { "op": "box", "role": "mason", "x0": 0, "y0": -1, "z0": 0, "x1": 12, "y1": 0, "z1": 12, "type": "stone_bricks" } ],
  "teamChat": [
    { "from": "${buildRoles()[0]}", "message": "I'll start with the foundation" },
    { "from": "${buildRoles()[1] || buildRoles()[0]}", "message": "Ready to frame when you're done!" }
  ]
}

THE SITE:
- Coordinates are relative to the build origin. Keep x and z between 0 and 39: that is the plot.
- The ground surface is y = -1. Things stand ON it, at y = 0 and up. A foundation course at
  y = -1..0 gives you a plinth to build on.
- The site is bulldozed to bare earth before you start, INCLUDING the grass. If you want lawn,
  meadow or a garden, the landscaper must lay it: a floor of grass_block at y = -1, and only
  then flowers at y = 0 on top of it. A flower on bare earth pops straight off.

MAKE IT IMPRESSIVE - this is watched as a show:
- Go big: 800-2500 blocks. Ops are cheap; a tiny hut is boring. Fill the plot.
- Height matters: towers 15-30 blocks tall, buildings at least 8 to the eaves.
- A clear, recognizable silhouette that matches the prompt at a glance.
- SOLID walls (the walls op is solid by construction - never fake a wall out of single blocks).
- Detail it: glazed windows, a real door, a roof with stairs (the cone op shingles itself),
  and lighting (lantern, sea_lantern, glowstone, torch) so it reads at night.
- Vary materials for contrast (stone_bricks + deepslate_bricks, oak + dark_oak).
- Character that fits the prompt: turrets, balconies, arches, a chimney, a terrace, a garden.

THE TIMELINE RULES. The roles build in PARALLEL, staggered a few seconds apart, in the order
above, and each works bottom-up. The game deletes a block whose support is missing, and a later
role's block REPLACES an earlier role's on the same coordinate. So:
- Every coordinate belongs to exactly ONE role. Two roles must never write the same x,y,z.
- Windows, doors and archways are HOLES. Build the wall, then carve the opening out of it, with
  the carve owned by the SAME role that built that wall. Never write glass or a door "over" a
  wall coordinate: the wall arrives later and buries it.
- For a window, use the "window" op and nothing else. It carves the hole and glazes it in one
  move, so the two can never disagree. A window's coordinates must lie ON a wall you built -
  aim one at thin air and you get nothing (previously: a pane of glass floating outside the
  building).
- Anything load-bearing (a bridge deck, a platform, a floor another role stands things on)
  belongs to the FIRST role, not to whoever happens to own that material.
- A door needs a solid block underneath it, placed by its OWN role, before it. Punch the wall
  down through the doorstep, then have the carpenter "put" a sill block there and hang the door
  on it - the carpenter builds bottom-up, so the sill is guaranteed to land first.
- Gravity blocks (sand, gravel) need solid support beneath them, and nothing may stand on water.
- Torches and lanterns need a solid block below (or beside) them that is already there.`;

// A worked example, chosen to match the request - mindcraft
// (github.com/mindcraft-bots/mindcraft) selects few-shot examples per request rather than
// pinning one set in the prompt. It does it with embeddings; we do it with word overlap
// against the nine library presets, which needs no model call and no extra dependency, and
// on a nine-item corpus lands the right one ("a haunted lighthouse" -> lighthouse).
//
// What the example buys is everything the presets were taught the hard way: real scale, layers
// that stack, and openings punched OUT of walls rather than written over them. Set FEWSHOT=off
// to send the prompt bare.
const STOPWORDS = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'in', 'on', 'that', 'for', 'to', 'my', 'some', 'build', 'me']);

export function pickExample(prompt) {
  const words = (prompt || '').toLowerCase().match(/[a-z]+/g) || [];
  const wanted = words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  let best = null;
  let bestScore = 0;
  for (const b of listBuilds()) {
    const hay = `${b.id} ${b.name}`.toLowerCase();
    const score = wanted.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = b.id; }
  }
  // Nothing matched (which is the common case - "a floating pirate cove" is not in the
  // library). Fall back to the castle: it is the preset that exercises the most of the
  // timeline rules above (a bridge owned by the mason, punched gate and windows, a moat).
  return best || 'castle';
}

// Two examples, and they do different jobs.
//
// The OPS example is a complete, working plan in the exact format we want back. It is the one
// build in this project that is audited on the same simulator as the presets (see
// test/preset-audit.test.mjs), so every trick it demonstrates - the punched openings, the
// carpenter's door sill, the landscaper's lawn laid before its flowers - is proven to survive
// a real parallel build rather than merely described in prose above.
//
// The SHAPE example is the closest library preset, drawn as ASCII floor maps. It answers the
// one question the watchtower cannot: what does a pagoda (or a ship, or an observatory)
// actually look like, layer by layer, at real scale. mindcraft picks its few-shot examples per
// request with embeddings; nine presets need nothing more than word overlap.
function exampleSection(prompt) {
  if (process.env.FEWSHOT === 'off') return '';
  const ops = readFileSync(new URL('./plans/reference-ops.json', import.meta.url), 'utf8');
  const shape = getLibraryPlan(pickExample(prompt));
  return (
    `\n\nHere is a COMPLETE worked plan in the exact format you must answer in. Study how the ` +
    `openings are punched out of the wall that owns them, how the door gets a sill from its own ` +
    `role, and how the lawn is laid before anything is planted on it.\n\n` +
    `<worked_example>\n${ops.trim()}\n</worked_example>\n\n` +
    `And here is one of our hand-built reference builds, drawn layer by layer, to show you the ` +
    `SCALE and silhouette we expect. Do NOT copy it, and do NOT answer in this format - your ` +
    `answer is ops.\n\n` +
    `<reference_build>\n${planDigest(shape)}\n</reference_build>`
  );
}

export class Coordinator {
  // apiKey kept for backwards compatibility; providers read keys from env directly.
  constructor(_apiKey) {}

  async planBuild(prompt, context = {}) {
    const { originX = 0, originY = 64, originZ = 0 } = context;

    let plan;
    if (!isLiveProvider()) {
      // No live LLM configured - build from the built-in procedural library (no key needed).
      plan = getLibraryPlan(process.env.LIBRARY_BUILD || 'random');
      console.log(`[Coordinator] No LLM key set - using built-in library build: "${plan.name}"`);
    } else {
      console.log(`[Coordinator] Planning "${prompt}" with ${providerLabel()}...`);
      const content = await complete({
        system: COORDINATOR_PROMPT() + exampleSection(prompt),
        // Ops are ~28x denser than a block list, so this is now enormous headroom rather than
        // the binding constraint it used to be - and a reasoning model spends part of it
        // THINKING before it writes a character (see providers.js).
        maxTokens: 16384,
        user: `Plan this build for the team: ${prompt}\n\nOutput only valid JSON.`,
      });
      plan = toPlan(parsePlan(content), prompt);
    }

    // Offset all coordinates to world position
    for (const role of Object.keys(plan.assignments)) {
      plan.assignments[role].blocks = (plan.assignments[role].blocks || []).map(block => ({
        ...block,
        x: block.x + originX,
        y: block.y + originY,
        z: block.z + originZ
      }));
    }

    plan.origin = { x: originX, y: originY, z: originZ };
    plan.prompt = prompt;

    const totalBlocks = Object.values(plan.assignments)
      .reduce((sum, a) => sum + (a.blocks ? a.blocks.length : 0), 0);

    console.log(`[Coordinator] Plan ready: "${plan.name}" - ${totalBlocks} total blocks`);
    for (const [role, assignment] of Object.entries(plan.assignments)) {
      console.log(`  - ${role}: ${assignment.blocks ? assignment.blocks.length : 0} blocks (${assignment.task})`);
    }

    return plan;
  }
}

/**
 * Turn whatever the model returned into a crew-format plan - through ONE validated door.
 *
 * The model is asked for ops, but a model that ignores the format and hands back a raw block
 * list must not bypass validation: its coordinates, roles and block names are exactly as
 * untrusted as an op's. So a block list is converted into `put` ops and expanded through the
 * same `expandOps`, which clamps it to the plot, caps the total, and repairs or drops
 * hallucinated block names (`stone_brick` -> `stone_bricks`; `wooden_plank` -> dropped) that
 * the server would otherwise discard in silence, leaving unexplained holes in the build.
 */
export function toPlan(spec, prompt) {
  if (Array.isArray(spec.ops) && spec.ops.length) return planFromOps(spec);

  if (spec.assignments && typeof spec.assignments === 'object') {
    console.log('[Coordinator] The model answered with raw blocks, not ops - converting.');
    const ops = [];
    const tasks = {};
    for (const [role, a] of Object.entries(spec.assignments)) {
      if (a?.task) tasks[role] = a.task;
      for (const b of Array.isArray(a?.blocks) ? a.blocks : []) {
        ops.push({ op: 'put', role, x: b.x, y: b.y, z: b.z, type: b.type });
      }
    }
    if (ops.length) return planFromOps({ ...spec, tasks, ops });
  }

  throw new Error(
    `The model returned neither ops nor blocks for "${prompt}". Try again, or use a stronger model.`
  );
}

// Extract and parse a JSON plan from a model response (handles ```json fences).
function parsePlan(content) {
  // Try, in order: a ```json fence, any ``` fence, the raw string, then the widest
  // {...} span (handles models that wrap JSON in prose like "Here is the JSON: {...}").
  const candidates = [];
  const fenced = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/```\n?([\s\S]*?)\n?```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(content);
  const first = content.indexOf('{'), last = content.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(content.slice(first, last + 1));

  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try the next candidate */ }
  }
  console.error('[Coordinator] Failed to parse plan. First 200 chars:', content.slice(0, 200));
  throw new Error('The model did not return valid JSON. Try again, or use a stronger model.');
}
