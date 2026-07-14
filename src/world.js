// The build site is a film set, not a survival world.
//
// Left on vanilla defaults it does NOT stay pretty: the crew idles on the plot, which keeps
// its chunks loaded, which means the game keeps spawning hostile mobs there - and with
// mobGriefing on, mobs are demolition contractors. Creepers blow craters in the lawn (those
// dark pits that read as "caves" in the viewer), endermen carry grass/sand blocks out of the
// surface one at a time, and a wooden roof is the most exposed thing on the plot. Fire ticks
// finish the job: a campfire is part of the cottage, and doFireTick lets flame spread off it.
//
// So the first thing an opped bot does after connecting is switch all of that off, once, for
// the whole world. Idempotent - safe to call on every run.
export async function pacifyWorld(bot) {
  const rules = [
    'difficulty peaceful',              // despawns the hostiles already loaded
    'gamerule doMobSpawning false',     // ...and stops new ones
    'gamerule mobGriefing false',       // belt-and-braces: no creeper craters, no enderman theft
    'gamerule doFireTick false',        // the cottage's campfire can't spread to the roof
    'gamerule doInsomnia false',        // no phantoms over a crew that never sleeps
    'gamerule doPatrolSpawning false',
    'gamerule doTraderSpawning false',
    'gamerule doWeatherCycle false',    // no rain, no lightning strikes on the tallest build
    'weather clear',
    'gamerule doDaylightCycle false',   // hold the light steady for the viewer / time-lapse
    'time set noon',
    'gamerule sendCommandFeedback false', // the crew fires thousands of /setblock - don't echo each one
    'kill @e[type=item]',               // sweep dropped items (peaceful already despawns the mobs;
                                        // do NOT use @e[type=!player] here - it also kills villagers,
                                        // item frames and paintings anywhere near the build)
  ];
  for (const rule of rules) {
    bot.chat(`/${rule}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log('[World] Set to peaceful: no mob spawning, no griefing, no fire spread, permanent noon.');
}
