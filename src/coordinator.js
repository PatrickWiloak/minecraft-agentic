import Anthropic from '@anthropic-ai/sdk';

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

Rules:
- Coordinates are relative (0,0,0 = build origin)
- Keep total under 400 blocks for demos
- buildOrder determines sequence (some can overlap if independent)
- Include 4-6 teamChat messages showing collaboration
- Each worker should have meaningful work (can be empty if not needed)
- Build from ground up: mason first, then carpenter, decorator, landscaper last

Block types by role:
- mason: stone, cobblestone, stone_bricks, mossy_stone_bricks, bricks, deepslate_bricks
- carpenter: oak_planks, oak_log, oak_stairs, spruce_planks, dark_oak_planks, oak_fence, oak_door
- decorator: torch, lantern, chest, bookshelf, crafting_table, furnace, bed, carpet, flower_pot
- landscaper: grass_block, dirt, oak_leaves, flowers (poppy, dandelion), water, oak_sapling`;

export class Coordinator {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async planBuild(prompt, context = {}) {
    const { originX = 0, originY = 64, originZ = 0 } = context;

    console.log(`[Coordinator] Planning collaborative build: "${prompt}"`);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: COORDINATOR_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Plan this build for the team: ${prompt}\n\nBuild origin: X=${originX}, Y=${originY}, Z=${originZ}. Output only valid JSON.`
        }
      ]
    });

    const content = response.content[0].text;

    let plan;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/```\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      plan = JSON.parse(jsonStr);
    } catch (err) {
      console.error('[Coordinator] Failed to parse plan:', err.message);
      throw new Error('Failed to generate build plan');
    }

    // Offset all coordinates to world position
    for (const role of Object.keys(plan.assignments)) {
      plan.assignments[role].blocks = plan.assignments[role].blocks.map(block => ({
        ...block,
        x: block.x + originX,
        y: block.y + originY,
        z: block.z + originZ
      }));
    }

    plan.origin = { x: originX, y: originY, z: originZ };

    const totalBlocks = Object.values(plan.assignments)
      .reduce((sum, a) => sum + a.blocks.length, 0);

    console.log(`[Coordinator] Plan ready: "${plan.name}" - ${totalBlocks} total blocks`);
    for (const [role, assignment] of Object.entries(plan.assignments)) {
      console.log(`  - ${role}: ${assignment.blocks.length} blocks (${assignment.task})`);
    }

    return plan;
  }

  async generateBanter(context) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'Generate short, funny Minecraft builder banter. One line, under 80 chars.',
      messages: [{ role: 'user', content: context }]
    });
    return response.content[0].text;
  }
}
