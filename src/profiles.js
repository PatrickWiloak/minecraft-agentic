// The crew, as data.
//
// Inspired by mindcraft (github.com/mindcraft-bots/mindcraft), where an agent is a JSON
// profile - name, backend, prompt, examples - rather than a class. The four roles used to be
// a hardcoded PERSONALITIES table in worker.js AND a hardcoded team paragraph in the
// coordinator's system prompt, which meant adding a fifth builder (a glazier, a smith) was a
// two-file edit and the two copies could disagree about what a role even does. Now a role is
// one JSON file in src/profiles/ and both the bot and the prompt are generated from it.
//
// Point PROFILES_DIR at another directory to run a different crew entirely.
//
// Two fields are load-bearing rather than cosmetic:
//   order   - the build order, and therefore the TIMELINE (see CLAUDE.md). The mason runs
//             first because support has to exist before the thing it supports; the landscaper
//             runs last because it only ever touches the ground around the build.
//   brief   - goes verbatim into the coordinator's system prompt. This is where a role's hard
//             rules live ("a window is a hole in someone else's wall"), so the rules that
//             govern a role and the bot that plays it can no longer drift apart.

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.PROFILES_DIR || path.join(HERE, 'profiles');

function load() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  const profiles = files.map((f) => {
    const raw = readFileSync(path.join(DIR, f), 'utf8');
    let p;
    try { p = JSON.parse(raw); } catch (e) {
      throw new Error(`Bad crew profile ${path.join(DIR, f)}: ${e.message}`);
    }
    p.key ||= path.basename(f, '.json');
    p.builder = p.builder !== false;
    p.order ??= 99;
    return p;
  });
  profiles.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return profiles;
}

const PROFILES = load();
const BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));

/** Every profile in the crew directory, in build order. */
export function allProfiles() {
  return PROFILES;
}

/** One profile by key, or undefined. */
export function profile(key) {
  return BY_KEY.get(key);
}

/**
 * The roles that actually place blocks, in build order. This IS the crew's build order and
 * the coordinator's default `buildOrder` - the two must be the same list or the timeline
 * (support before supported) stops holding.
 */
export function buildRoles() {
  return PROFILES.filter((p) => p.builder).map((p) => p.key);
}

/** The team + materials section of the coordinator's system prompt, generated from the profiles. */
export function teamBrief() {
  const lines = PROFILES.filter((p) => p.builder).map(
    (p) => `- ${p.key}: ${p.brief}\n  Blocks: ${p.materials.join(', ')}`
  );
  return lines.join('\n');
}
