// Look at the finished build, and say what's wrong with it.
//
// Inspired by APT (github.com/spearsheep/APT-Architectural-Planning-LLM-Agent), which pairs an
// LLM's spatial reasoning with MULTIMODAL input and a reflection step, rather than trusting the
// first plan it wrote. The gap it fills here is the one src/repair.js can't: repair asks the
// GAME what it refused, and the game only ever objects to blocks that are physically illegal.
// It has no opinion about a tower with no windows, a roof that doesn't read as a roof, or a
// castle that came out looking like a shed. Only a picture reveals those, so the critic gets
// both halves of the same build:
//
//   - the BLUEPRINT (src/digest.js): the plan, laid out as one ASCII floor map per layer. This
//     is what makes the critique actionable - the model can see that the wall it thinks is
//     missing is at y=6, z=3, and hand back a patch in coordinates we can execute.
//   - the PICTURE (src/shot.js): three orbited screenshots of what actually got built.
//
// Neither alone is enough. Given only the plan, the model re-reads its own homework and says it
// looks fine. Given only the picture, it can describe the flaw beautifully and cannot tell you
// where it is.
//
// This costs an extra (vision) model call per build, so it is OPT-IN: CRITIC=on, or the web
// panel's review toggle. It needs a vision-capable provider and a running browser viewer, and
// degrades to a no-op without either.

import { completeVision, supportsVision, isLiveProvider, providerLabel } from './providers.js';
import { planDigest } from './digest.js';
import { shootBuild } from './shot.js';
import { normalizePatch, parseJson } from './repair.js';
import { buildRoles } from './profiles.js';

const CRITIC_PROMPT = `You are a master Minecraft architect reviewing a build your crew has just finished.

You are given the BLUEPRINT (the plan, drawn as one floor map per y layer) and PHOTOGRAPHS of
what the crew actually built, taken from three angles.

Judge the BUILD, not the plan. Look for the things only a picture can show:
- Does it read as the thing it was supposed to be, at a glance, from across the street?
- Holes: a wall with a gap in it, a roof that doesn't close, a face that was never built.
- A silhouette that is dull, squat, or lopsided - a shape with no presence.
- Missing basics: no door, no windows, no light, no roofline.
- Blank surfaces: a big flat wall with nothing on it, no depth, no trim, no contrast.
- Anything absurd: blocks floating unsupported, a structure with no way in.

Then patch it. The patch is applied to the world exactly as given, so it must be precise.

Output valid JSON and nothing else:
{
  "verdict": "one sentence - what this build IS, as a stranger would describe it",
  "score": 7,
  "issues": ["the north wall has no windows", "the roof ridge is flat and reads as unfinished"],
  "add":    [{ "x": 0, "y": 0, "z": 0, "type": "glass_pane", "role": "decorator" }],
  "remove": [{ "x": 0, "y": 0, "z": 0 }]
}

- "score" is 1-10 on how well the build delivers on the request. Be honest; 10 is rare.
- Coordinates are RELATIVE to the build origin, exactly as in the blueprint. Read them OFF the
  blueprint - the floor maps give you the exact x, y and z of every block. Do not guess
  coordinates from the photographs.
- "add" places a block, "remove" deletes one. Both are also folded back into the plan.
- Every coordinate belongs to exactly one role; a support block must belong to a role that
  builds EARLIER than whatever stands on it.
- Blocks need support: nothing floats, torches and doors need something solid to hold them,
  gravity blocks (sand, gravel) need solid ground, and nothing stands on water.
- Keep the patch surgical and under 120 blocks. You are improving this build, not replacing it.
- If the build is genuinely good, say so and return empty "add" and "remove". A patch that
  makes it worse is much worse than no patch.`;

/**
 * Review a finished build and return a patch. Never throws.
 *
 * @param {object} plan - the plan the crew just executed (absolute coords + .origin)
 * @param {{ url: string, log?: Function, shots?: Array }} opts
 *   `url` is the running viewer (see viewerUrl() in src/viewer.js). `shots` is an escape hatch
 *   for tests - pass images and no browser is launched.
 * @returns {Promise<{verdict, score, issues, add, remove}|null>} null if the review didn't run
 */
export async function reviewBuild(plan, opts = {}) {
  const { url, log = console.log } = opts;

  if (!isLiveProvider() || !supportsVision()) {
    log(`[Critic] ${providerLabel()} cannot look at pictures - skipping the visual review.`);
    return null;
  }

  const images = opts.shots || (await shootBuild({ url, log }));
  if (!images.length) return null;   // shootBuild already said why

  log('[Critic] Showing the build to the model...');
  let raw;
  try {
    raw = await completeVision({
      system: CRITIC_PROMPT,
      user:
        `The crew was asked for: "${plan.prompt || plan.name}".\n` +
        `Build order (earlier roles build first): ${(plan.buildOrder || buildRoles()).join(' -> ')}\n\n` +
        `BLUEPRINT\n${planDigest(plan)}\n\n` +
        `The photographs show the finished build from three angles. Review it and output only JSON.`,
      images,
      // 16384, not 4096: a reasoning model thinks against this budget before it writes a word,
      // and reading three pictures is a lot to think about - at 4096 the review came back as
      // half an object and reported itself as "the model did not return valid JSON".
      maxTokens: 16384,
    });
  } catch (err) {
    log(`[Critic] The review failed (${err.message}) - the build stands as-is.`);
    return null;
  }

  let review;
  try {
    review = parseJson(raw);
  } catch {
    log('[Critic] The model did not return a usable review - the build stands as-is.');
    return null;
  }

  // normalizePatch is repair.js's - same coordinate frame, same role validation, same refusal
  // to emit `/setblock ... minecraft:undefined`. A critic patch and a repair patch are the same
  // kind of object and must be trusted exactly as little.
  const patch = normalizePatch(review, plan, 120);
  const out = {
    verdict: (review.verdict || '').toString().slice(0, 300),
    score: Number.isFinite(review.score) ? review.score : null,
    issues: (review.issues || []).slice(0, 10).map((i) => i.toString().slice(0, 200)),
    add: patch.add,
    remove: patch.remove,
  };

  log(`[Critic] ${out.score ?? '?'}/10 - ${out.verdict}`);
  for (const issue of out.issues) log(`[Critic]   - ${issue}`);
  return out;
}
