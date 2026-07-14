import { complete, isLiveProvider, providerLabel } from './providers.js';
import { getLibraryPlan, listBuilds } from './library/index.js';
import { buildRoles, teamBrief } from './profiles.js';
import { planDigest } from './digest.js';

// The team paragraph and the per-role material lists are GENERATED from src/profiles/*.json
// (see src/profiles.js) rather than written out here. They used to be duplicated: the roles
// were described in this prompt and again in worker.js, and the two drifted - the prompt never
// learned any of the rules the crew had been burned by ("a window is a hole in someone else's
// wall", "anything load-bearing belongs to the mason"). Those rules now live on the role, in
// one place, and the model is told them.
const COORDINATOR_PROMPT = () => `You are the lead architect coordinating a Minecraft build team. Given a build request, create a detailed plan that divides work among specialized workers.

Your team, in build order:
${teamBrief()}

Output valid JSON:
{
  "name": "Build name",
  "description": "Brief description",
  "assignments": {
${buildRoles().map((r) => `    "${r}": { "task": "What they're building", "blocks": [{ "x": 0, "y": 0, "z": 0, "type": "stone_bricks" }] }`).join(',\n')}
  },
  "buildOrder": ${JSON.stringify(buildRoles())},
  "teamChat": [
    { "from": "${buildRoles()[0]}", "message": "I'll start with the foundation" },
    { "from": "${buildRoles()[1] || buildRoles()[0]}", "message": "Ready to frame when you're done!" }
  ]
}

Make it IMPRESSIVE - this is watched as a show, so aim high:
- Go big: 500-900 blocks total. A tiny hut is boring; build something with presence.
- Height matters: towers 15-25 blocks tall, buildings at least 6-8 blocks to the eaves.
- Give it a clear, recognizable silhouette that matches the prompt at a glance.
- Detail it: windows (glass/glass_pane), a real entrance (doors), rooflines with stairs, and
  lighting (torches, lanterns, glowstone, sea_lantern) so it reads well and glows.
- Vary materials for contrast (e.g. stone_bricks + deepslate_bricks, oak + dark_oak).
- Add character features that fit the prompt: turrets, balconies, banners, arches, a chimney,
  a garden, water. Make choices a human builder would be proud of.

Rules:
- Coordinates are relative (0,0,0 = build origin, y grows upward)
- Total 500-900 blocks (hard ceiling 900 so the plan isn't truncated)
- Each worker should have meaningful work (can be empty if not needed)
- Structurally sound: walls connect, roofs are supported, nothing floats absurdly

THE TIMELINE RULES. The roles build in PARALLEL, staggered a few seconds apart, in the order
above. The game deletes a block whose support is missing, and a later role's block REPLACES an
earlier role's block on the same coordinate. So:
- Every coordinate belongs to exactly ONE role. Two roles must never write the same x,y,z.
- Windows, doors and archways are HOLES: simply leave those coordinates out of the wall-builder's
  block list. Do NOT place glass or a door "over" a wall block - the wall arrives later and
  buries it.
- Anything load-bearing (a bridge deck, a platform, a floor another role stands things on)
  belongs to the FIRST role, not to whoever happens to own that material.
- A door is two blocks tall (lower half then upper half) and needs a solid block underneath it
  that an EARLIER role placed.
- Gravity blocks (sand, gravel) need solid support beneath them, and nothing may stand on water.`;

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

function exampleSection(prompt) {
  if (process.env.FEWSHOT === 'off') return '';
  const example = getLibraryPlan(pickExample(prompt));
  return (
    `\n\nHere is one of our hand-built reference builds, laid out layer by layer. Study its ` +
    `SCALE, how each layer stacks on the one below, and how the window and door openings are ` +
    `simply absent from the wall layers rather than drawn over them. Match this quality. Do NOT ` +
    `copy it, and do NOT answer in this format - your answer is JSON.\n\n` +
    `<reference_build>\n${planDigest(example)}\n</reference_build>`
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
        maxTokens: 16384, // big builds (up to ~900 blocks) need room or the JSON truncates
        user: `Plan this build for the team: ${prompt}\n\nBuild origin: X=${originX}, Y=${originY}, Z=${originZ}. Output only valid JSON.`,
      });
      plan = parsePlan(content);
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
