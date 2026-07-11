import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

const { pathfinder, Movements, goals } = pkg;

export function createBot(options = {}) {
  const bot = mineflayer.createBot({
    host: options.host || process.env.MC_HOST || 'localhost',
    port: parseInt(options.port || process.env.MC_PORT || '25565'),
    username: options.username || process.env.MC_USERNAME || 'BuilderBot',
    // 1.20.1 on purpose: it's a version prismarine-viewer supports EXACTLY, so the
    // browser viewer renders every block correctly. (1.20.4 shifts block-state IDs
    // vs the viewer's 1.20.1 assets - stone walls render as beehives. Ask us how we know.)
    version: options.version || process.env.MC_VERSION || '1.20.1',
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    const mcData = minecraftData(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);
    console.log(`[${bot.username}] Spawned at ${bot.entity.position}`);
  });

  bot.on('error', (err) => {
    console.error(`[${bot.username}] Error:`, err.message);
  });

  bot.on('kicked', (reason) => {
    console.log(`[${bot.username}] Kicked:`, reason);
  });

  return bot;
}

export async function waitForSpawn(bot) {
  return new Promise((resolve) => {
    if (bot.entity) {
      resolve();
    } else {
      bot.once('spawn', resolve);
    }
  });
}

export { goals, Movements };
