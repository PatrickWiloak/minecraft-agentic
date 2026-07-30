#!/usr/bin/env node
// The one command: `npm run play`
// Starts the server if needed, asks what to build, then runs the crew.
// Open http://localhost:3000 to watch.
//
//   npm run play                    # asks what to build (free text with a key, else a menu)
//   npm run play "a wizard tower"   # skip the question and build this (needs a key)
//   npm run play "a castle" --sequential   # flags pass through
import 'dotenv/config';
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureServerUp } from './server.js';
import { detectProvider, isLiveProvider, providerLabel } from '../src/providers.js';
import { listBuilds } from '../src/library/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const c = (s) => `\x1b[36m${s}\x1b[0m`;
const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
let prompt = args.find((a) => !a.startsWith('--'));

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function buildCustom(provider, idea) {
  console.log(b(`\n  ${providerLabel(provider)} is designing: "${idea}"`));
  console.log(b('  Watch here → http://localhost:3000\n'));
  return run('src/multi-demo.js', [idea, ...flags]);
}

function buildPreset(libraryId) {
  console.log(b(`\n  Building - watch here → http://localhost:3000\n`));
  return run('src/crew-replay.js', flags, { LIBRARY_BUILD: libraryId });
}

async function main() {
  console.log(b('\n  Minecraft Agentic Builder\n'));
  await ensureServerUp();

  const provider = detectProvider();
  const live = isLiveProvider(provider);
  const builds = listBuilds();

  // A prompt passed on the CLI skips the menu entirely.
  if (prompt) {
    if (live) return buildCustom(provider, prompt);
    // No model but they named something - try to match a preset, else random.
    const m = builds.find((bd) => prompt.toLowerCase().includes(bd.id.toLowerCase().replace('tower', '')));
    console.log(y('\n  No AI key set - building the closest free library preset.'));
    return buildPreset(m ? m.id : 'random');
  }

  // Interactive menu - the curated presets are ALWAYS listed (with or without a key).
  if (live) console.log(dim(`  Backend: ${providerLabel(provider)}`));
  console.log(b('\n  Curated builds (no AI needed - always free):'));
  builds.forEach((bld, i) => console.log(`    ${c(String(i + 1))}. ${bld.name}`));
  console.log(`    ${c(String(builds.length + 1))}. Surprise me (random)`);

  let answer;
  if (live) {
    console.log(dim(`\n  ...or type your OWN idea and ${providerLabel(provider)} will design it:`));
    console.log(dim('    e.g. "a haunted mansion with a graveyard", "a giant dragon statue"'));
    answer = await ask(c('\n  Pick a number, or describe your build:  '));
  } else {
    console.log(dim('\n  (no key set - add one to type your OWN builds. Gemini is free: npm run setup)'));
    answer = await ask(c('\n  Pick a number (or Enter for random):  '));
  }

  const trimmed = (answer || '').trim();
  const idx = parseInt(trimmed, 10);
  const isNumber = /^\d+$/.test(trimmed);

  // Free text + a live model => custom AI build. Anything else => a curated preset.
  if (live && trimmed && !isNumber) return buildCustom(provider, trimmed);

  if (!live && trimmed && !isNumber)
    console.log(y('\n  No AI key set - building a random preset instead (add a key for custom builds).'));
  const libraryId = (idx >= 1 && idx <= builds.length) ? builds[idx - 1].id : 'random';
  return buildPreset(libraryId);
}

function run(script, scriptArgs, extraEnv = {}) {
  const child = spawn('node', [path.join(ROOT, script), ...scriptArgs], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code) => process.exit(code || 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
