import { createBot, waitForSpawn } from './bot.js';
import { Builder } from './builder.js';

const PERSONALITIES = {
  architect: {
    name: 'Archie',
    role: 'Architect',
    color: 'gold',
    phrases: [
      "According to my blueprints...",
      "The structural integrity looks good!",
      "I've designed this to perfection.",
      "Trust the process, team!",
      "Form follows function!"
    ]
  },
  mason: {
    name: 'Rocky',
    role: 'Mason',
    color: 'gray',
    phrases: [
      "Stone by stone, we build greatness.",
      "These walls will stand for centuries!",
      "Nothing beats solid craftsmanship.",
      "I love the smell of cobblestone.",
      "Foundation work is done!"
    ]
  },
  carpenter: {
    name: 'Woody',
    role: 'Carpenter',
    color: 'yellow',
    phrases: [
      "Wood you look at that!",
      "Measure twice, place once!",
      "Oak is my favorite.",
      "These planks are premium quality.",
      "The roof is coming together!"
    ]
  },
  decorator: {
    name: 'Fancy',
    role: 'Decorator',
    color: 'light_purple',
    phrases: [
      "This needs more pizzazz!",
      "Interior design is my passion.",
      "A torch here, a flower there...",
      "It's all about the details!",
      "Chef's kiss on this decor!"
    ]
  },
  landscaper: {
    name: 'Bloom',
    role: 'Landscaper',
    color: 'green',
    phrases: [
      "Let me add some greenery!",
      "Nature makes everything better.",
      "A garden really ties it together.",
      "Flowers incoming!",
      "The outdoors is my canvas."
    ]
  }
};

export class Worker {
  constructor(personality = 'mason', options = {}) {
    const config = PERSONALITIES[personality] || PERSONALITIES.mason;

    this.personality = personality;
    this.name = options.name || config.name;
    this.role = config.role;
    this.color = config.color;
    this.phrases = config.phrases;

    this.bot = null;
    this.builder = null;
    this.busy = false;
    this.blocksPlaced = 0;
  }

  async connect(serverOptions = {}) {
    this.bot = createBot({
      ...serverOptions,
      username: this.name
    });

    await waitForSpawn(this.bot);
    this.builder = new Builder(this.bot);
    await this.builder.init();

    // Creative mode (bots are opped): no fall/suffocation damage while they hop
    // around the site following their work.
    this.bot.chat('/gamemode creative');

    console.log(`[${this.name}] ${this.role} ready for work!`);
    this.say(`${this.role} reporting for duty!`);

    return this;
  }

  say(message) {
    if (this.bot) {
      this.bot.chat(message);
    }
  }

  randomPhrase() {
    return this.phrases[Math.floor(Math.random() * this.phrases.length)];
  }

  async buildBlocks(blocks, options = {}) {
    // groundY: pass the build site's ground level to make the worker WORK THE SITE
    // like a real builder - hop over to stand beside each stretch of blocks it's
    // placing (at ground level, so nobody floats) and look at the block being set.
    const { delay = 250, narrate = true, groundY } = options;

    this.busy = true;
    const narrateEvery = Math.floor(blocks.length / 3) || 1;
    let sinceMove = Infinity;   // force a hop to the first block

    for (let i = 0; i < blocks.length; i++) {
      if (!this.busy) break;

      const block = blocks[i];

      if (groundY !== undefined && this.bot.entity) {
        const p = this.bot.entity.position;
        const far = Math.abs(p.x - block.x) + Math.abs(p.z - block.z) > 10;
        if (sinceMove >= 8 || far) {
          const dx = Math.random() < 0.5 ? -2 : 3;
          const dz = Math.random() < 0.5 ? -2 : 3;
          this.bot.chat(`/tp ${this.name} ${block.x + dx} ${groundY} ${block.z + dz}`);
          sinceMove = 0;
        }
        sinceMove++;
        const pos = this.bot.entity.position;
        this.bot.lookAt(pos.offset(block.x + 0.5 - pos.x, block.y + 0.5 - pos.y, block.z + 0.5 - pos.z)).catch(() => {});
      }

      this.bot.chat(`/setblock ${block.x} ${block.y} ${block.z} minecraft:${block.type}`);
      this.blocksPlaced++;

      if (narrate && i > 0 && i % narrateEvery === 0) {
        this.say(this.randomPhrase());
      }

      await this.sleep(delay);
    }

    this.busy = false;
    return this.blocksPlaced;
  }

  async teleportTo(x, y, z) {
    this.bot.chat(`/tp ${this.name} ${x} ${y} ${z}`);
    await this.sleep(500);
  }

  stop() {
    this.busy = false;
  }

  disconnect() {
    if (this.bot) {
      this.bot.quit();
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { PERSONALITIES };
