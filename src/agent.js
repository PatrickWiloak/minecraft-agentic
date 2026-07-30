import { complete, isLiveProvider, providerLabel } from './providers.js';
import { getLibraryPlan } from './library/index.js';

const SYSTEM_PROMPT = `You are a Minecraft builder agent. Given a description of what to build, you output a JSON build plan.

Your response must be valid JSON with this structure:
{
  "name": "Structure name",
  "description": "Brief description",
  "blocks": [
    { "x": 0, "y": 0, "z": 0, "type": "stone_bricks" },
    ...
  ],
  "narration": ["First I'll lay the foundation...", "Now adding walls...", ...]
}

Make it IMPRESSIVE (this is watched as a show):
- Go big: 400-800 blocks. Give it height and a recognizable silhouette.
- Detail it: windows (glass/glass_pane), a real door, a proper roof (stairs), and lighting
  (torches, lanterns, glowstone) so it reads well and glows.
- Vary materials for contrast; add features that fit the prompt.

Rules:
- Use relative coordinates starting from 0,0,0 (the build origin)
- Use valid Minecraft block names (oak_planks, stone_bricks, glass, oak_door, torch, etc.)
- 400-800 blocks (hard ceiling 800 so the plan isn't truncated)
- Include 3-5 narration messages the bot can say while building
- Build from bottom to top (lower Y values first)
- Be creative but structurally sound

Common block types: stone, cobblestone, stone_bricks, oak_planks, oak_log, glass, glass_pane, oak_door, oak_stairs, torch, lantern, chest, crafting_table, furnace, bookshelf, wool (white_wool, red_wool, etc.), concrete, terracotta`;

export class BuilderAgent {
  // apiKey kept for backwards compatibility; providers read keys from env directly.
  constructor(_apiKey) {
    this.buildHistory = [];
  }

  async generateBuildPlan(prompt, context = {}) {
    const { originX = 0, originY = 64, originZ = 0 } = context;

    let plan;
    if (!isLiveProvider()) {
      // No live LLM configured - flatten a built-in library build into a single-agent plan.
      const lib = getLibraryPlan(process.env.LIBRARY_BUILD || 'random');
      const blocks = Object.values(lib.assignments).flatMap(a => a.blocks || []);
      plan = {
        name: lib.name,
        description: lib.description,
        blocks,
        narration: (lib.teamChat || []).map(t => t.message),
      };
      console.log(`[Agent] No LLM key set - using built-in library build: "${plan.name}"`);
    } else {
      console.log(`[Agent] Generating "${prompt}" with ${providerLabel()}...`);
      const content = await complete({
        system: SYSTEM_PROMPT,
        maxTokens: 12288,
        user: `Build this: ${prompt}\n\nBuild origin will be at X=${originX}, Y=${originY}, Z=${originZ}. Output only valid JSON.`,
      });
      try {
        const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                          content.match(/```\n?([\s\S]*?)\n?```/);
        plan = JSON.parse(jsonMatch ? jsonMatch[1] : content);
      } catch (err) {
        console.error('[Agent] Failed to parse build plan:', err.message);
        throw new Error('The model did not return valid JSON. Try again, or use a stronger model.');
      }
    }

    // Offset coordinates to world position
    plan.blocks = plan.blocks.map(block => ({
      ...block,
      x: block.x + originX,
      y: block.y + originY,
      z: block.z + originZ
    }));

    plan.origin = { x: originX, y: originY, z: originZ };
    this.buildHistory.push(plan);

    console.log(`[Agent] Plan ready: ${plan.name} (${plan.blocks.length} blocks)`);
    return plan;
  }
}
