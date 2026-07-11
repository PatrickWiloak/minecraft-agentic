// Preflight checks - run before we try to connect or call Claude, so a new user
// who cloned the repo gets a clear, actionable message instead of a raw stack trace.
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectProvider, isLiveProvider } from './providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function fail(lines) {
  console.error('\n\x1b[31m✖ Setup problem\x1b[0m\n');
  for (const l of lines) console.error('  ' + l);
  console.error('\n  Full setup guide: docs/SETUP.md\n');
  process.exit(1);
}

/** True if a .env exists and looks configured. Warns (doesn't fail) on missing .env. */
function checkEnvFile() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('\n\x1b[33m! No .env file found.\x1b[0m Copy the example and add a key:');
    console.warn('    cp .env.example .env      # then set ONE provider key (GEMINI is free)\n');
  }
}

/**
 * Fail early if no live LLM provider is configured (only on paths that need a model
 * to design a custom build). ANY of Gemini/Claude/OpenAI/Ollama satisfies this - it is
 * NOT Anthropic-specific. With no key the caller should use the library instead.
 */
export function requireApiKey() {
  checkEnvFile();
  if (isLiveProvider(detectProvider())) return; // gemini / claude / openai / ollama configured
  fail([
    'No AI provider is configured for custom (typed-prompt) builds.',
    '',
    '  Set ONE key in .env - it is auto-detected:',
    '    GEMINI_API_KEY=...     free tier   https://aistudio.google.com/apikey',
    '    ANTHROPIC_API_KEY=...  paid        https://console.anthropic.com/',
    '    OPENAI_API_KEY=...     paid        https://platform.openai.com/',
    '  ...or run a local model:  LLM_PROVIDER=ollama  (needs Ollama running).',
    '',
    '  No key? You do not need one - the free built-in library builds without it:',
    '    npm run play      # menu of curated builds (no key)',
    '    npm run offline   # no server or key - prints a sample plan',
  ]);
}

/** Resolve TCP-reachability of the Minecraft server. Returns a boolean. */
function isPortOpen(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Fail early with server-start instructions if nothing is listening on MC_HOST:MC_PORT. */
export async function requireMinecraftServer() {
  const host = process.env.MC_HOST || 'localhost';
  const port = parseInt(process.env.MC_PORT || '25565', 10);

  const open = await isPortOpen(host, port);
  if (!open) {
    fail([
      `No Minecraft server reachable at ${host}:${port}.`,
      '',
      '  Start one with Docker (recommended):',
      '    npm run server        # starts a version-pinned 1.20.1 server',
      '    npm run server:logs   # wait for "Done!" then run your build',
      '',
      `  Already have a server? Make sure it's on ${host}:${port},`,
      '  running Java Edition 1.20.1 with online-mode=false.',
    ]);
  }
}
