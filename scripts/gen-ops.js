#!/usr/bin/env node
// Generate docker/ops.json so the bots are server operators (required for /setblock).
//   npm run ops                       # default bot roster
//   npm run ops -- MyBot AnotherBot   # add custom usernames (e.g. a custom MC_USERNAME)
//
// The server runs online-mode=false, so player UUIDs are the deterministic "offline"
// UUID: a v3 (MD5) UUID of the bytes "OfflinePlayer:<name>" - the same value Minecraft
// itself computes. The itzg image's `OPS` env can't be used here because it does an
// online PlayerDB lookup that fails for offline usernames.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_BOTS = [
  'BuilderBot', 'DemoBuilder', 'AgentBuilder', 'E2ETester',
  'Archie', 'Rocky', 'Woody', 'Fancy', 'Bloom',
];

function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80; // IETF variant
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const extra = process.argv.slice(2);
const names = [...new Set([...DEFAULT_BOTS, ...extra])];
const ops = names.map((name) => ({ uuid: offlineUUID(name), name, level: 4, bypassesPlayerLimit: false }));

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker', 'ops.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(ops, null, 2) + '\n');

console.log(`Wrote ${names.length} operators to docker/ops.json`);
for (const o of ops) console.log(`  ${o.name.padEnd(14)} ${o.uuid}`);
console.log('\nRestart the server for it to take effect:  npm run server:stop && npm run server');
