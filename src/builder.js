import pkg from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

const { goals } = pkg;

export class Builder {
  constructor(bot) {
    this.bot = bot;
    this.mcData = null;
    this.building = false;
  }

  async init() {
    this.mcData = minecraftData(this.bot.version);
  }

  async goTo(x, y, z) {
    const goal = new goals.GoalNear(x, y, z, 2);
    await this.bot.pathfinder.goto(goal);
  }

  async placeBlock(x, y, z, blockName) {
    const blockId = this.mcData.blocksByName[blockName];
    if (!blockId) {
      console.log(`Unknown block: ${blockName}`);
      return false;
    }

    // Find the block in inventory or use creative mode
    const item = this.bot.inventory.items().find(i => i.name === blockName);

    if (!item) {
      // In creative mode, just use chat command
      this.bot.chat(`/setblock ${x} ${y} ${z} ${blockName}`);
      await this.sleep(100);
      return true;
    }

    // Equip and place
    await this.bot.equip(item, 'hand');
    const referenceBlock = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (referenceBlock) {
      try {
        await this.bot.placeBlock(referenceBlock, { x: 0, y: 1, z: 0 });
        return true;
      } catch (err) {
        console.log(`Failed to place ${blockName}:`, err.message);
        return false;
      }
    }
    return false;
  }

  async buildStructure(blocks) {
    this.building = true;
    console.log(`Building structure with ${blocks.length} blocks...`);

    for (const block of blocks) {
      if (!this.building) break;

      const { x, y, z, type } = block;
      this.bot.chat(`/setblock ${x} ${y} ${z} minecraft:${type}`);
      await this.sleep(50); // Slight delay for visual effect
    }

    this.building = false;
    console.log('Build complete!');
  }

  async buildWall(startX, startY, startZ, width, height, blockType = 'stone_bricks') {
    const blocks = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        blocks.push({ x: startX + x, y: startY + y, z: startZ, type: blockType });
      }
    }
    await this.buildStructure(blocks);
  }

  async buildBox(startX, startY, startZ, width, height, depth, blockType = 'stone_bricks') {
    const blocks = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
          // Only place blocks on edges (hollow box)
          const isEdge = x === 0 || x === width - 1 ||
                         y === 0 || y === height - 1 ||
                         z === 0 || z === depth - 1;
          if (isEdge) {
            blocks.push({ x: startX + x, y: startY + y, z: startZ + z, type: blockType });
          }
        }
      }
    }
    await this.buildStructure(blocks);
  }

  async buildFloor(startX, startY, startZ, width, depth, blockType = 'oak_planks') {
    const blocks = [];
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        blocks.push({ x: startX + x, y: startY, z: startZ + z, type: blockType });
      }
    }
    await this.buildStructure(blocks);
  }

  async clearArea(startX, startY, startZ, width, height, depth) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
          this.bot.chat(`/setblock ${startX + x} ${startY + y} ${startZ + z} minecraft:air`);
          await this.sleep(20);
        }
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.building = false;
  }
}
