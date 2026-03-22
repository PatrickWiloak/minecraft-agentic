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
    const { delay = 250, narrate = true } = options;

    this.busy = true;
    const narrateEvery = Math.floor(blocks.length / 3) || 1;

    for (let i = 0; i < blocks.length; i++) {
      if (!this.busy) break;

      const block = blocks[i];
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
