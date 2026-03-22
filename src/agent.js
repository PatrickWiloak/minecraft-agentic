import Anthropic from '@anthropic-ai/sdk';

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

Rules:
- Use relative coordinates starting from 0,0,0 (the build origin)
- Use valid Minecraft block names (oak_planks, stone_bricks, glass, oak_door, torch, etc.)
- Keep builds reasonable size (under 500 blocks for quick demos)
- Include 3-5 narration messages the bot can say while building
- Build from bottom to top (lower Y values first)
- Be creative but structurally sound

Common block types: stone, cobblestone, stone_bricks, oak_planks, oak_log, glass, glass_pane, oak_door, oak_stairs, torch, lantern, chest, crafting_table, furnace, bookshelf, wool (white_wool, red_wool, etc.), concrete, terracotta`;

export class BuilderAgent {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
    this.buildHistory = [];
  }

  async generateBuildPlan(prompt, context = {}) {
    const { originX = 0, originY = 64, originZ = 0 } = context;

    console.log(`[Agent] Generating build plan for: "${prompt}"`);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Build this: ${prompt}\n\nBuild origin will be at X=${originX}, Y=${originY}, Z=${originZ}. Output only valid JSON.`
        }
      ]
    });

    const content = response.content[0].text;

    // Parse JSON from response
    let plan;
    try {
      // Try to extract JSON if wrapped in markdown
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/```\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      plan = JSON.parse(jsonStr);
    } catch (err) {
      console.error('[Agent] Failed to parse build plan:', err.message);
      console.error('[Agent] Raw response:', content);
      throw new Error('Failed to generate valid build plan');
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

    console.log(`[Agent] Plan generated: ${plan.name} (${plan.blocks.length} blocks)`);
    return plan;
  }

  async chat(message) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: 'You are a friendly Minecraft builder bot. Keep responses short and fun (under 100 chars). Use Minecraft humor.',
      messages: [{ role: 'user', content: message }]
    });
    return response.content[0].text;
  }
}
