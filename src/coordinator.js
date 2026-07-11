import { complete, isLiveProvider, providerLabel } from './providers.js';
import { getLibraryPlan } from './library/index.js';

const COORDINATOR_PROMPT = `You are the lead architect coordinating a Minecraft build team. Given a build request, create a detailed plan that divides work among specialized workers.

Your team:
- mason: Handles stone, brick, cobblestone - foundations and walls
- carpenter: Handles wood, planks, logs, stairs - framing, floors, roofs
- decorator: Handles torches, lanterns, furniture, details - interior touches
- landscaper: Handles grass, flowers, leaves, water - outdoor beautification

Output valid JSON:
{
  "name": "Build name",
  "description": "Brief description",
  "assignments": {
    "mason": {
      "task": "What they're building",
      "blocks": [{ "x": 0, "y": 0, "z": 0, "type": "stone_bricks" }, ...]
    },
    "carpenter": {
      "task": "What they're building",
      "blocks": [...]
    },
    "decorator": {
      "task": "What they're building",
      "blocks": [...]
    },
    "landscaper": {
      "task": "What they're building",
      "blocks": [...]
    }
  },
  "buildOrder": ["mason", "carpenter", "decorator", "landscaper"],
  "teamChat": [
    { "from": "mason", "message": "I'll start with the foundation" },
    { "from": "carpenter", "message": "Ready to frame when you're done!" },
    ...
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
- Coordinates are relative (0,0,0 = build origin)
- Total 500-900 blocks (hard ceiling 900 so the plan isn't truncated)
- buildOrder determines sequence (some can overlap if independent)
- Include 4-6 teamChat messages showing collaboration
- Each worker should have meaningful work (can be empty if not needed)
- Build from ground up: mason first, then carpenter, decorator, landscaper last
- Structurally sound: walls connect, roofs are supported, nothing floats absurdly

Block types by role:
- mason: stone, cobblestone, stone_bricks, mossy_stone_bricks, bricks, deepslate_bricks
- carpenter: oak_planks, oak_log, oak_stairs, spruce_planks, dark_oak_planks, oak_fence, oak_door
- decorator: torch, lantern, chest, bookshelf, crafting_table, furnace, bed, carpet, flower_pot
- landscaper: grass_block, dirt, oak_leaves, flowers (poppy, dandelion), water, oak_sapling`;

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
        system: COORDINATOR_PROMPT,
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
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/```\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[Coordinator] Failed to parse plan:', err.message);
    throw new Error('The model did not return valid JSON. Try again, or use a stronger model.');
  }
}
