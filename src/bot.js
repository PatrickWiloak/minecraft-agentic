import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

const { pathfinder, Movements, goals } = pkg;

export function createBot(options = {}) {
  const bot = mineflayer.createBot({
    host: options.host || process.env.MC_HOST || 'localhost',
    port: parseInt(options.port || process.env.MC_PORT || '25565'),
    username: options.username || process.env.MC_USERNAME || 'BuilderBot',
    version: options.version || '1.20.4',
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
