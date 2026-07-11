// Preflight checks - run before we try to connect or call Claude, so a new user
// who cloned the repo gets a clear, actionable message instead of a raw stack trace.
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    console.warn('\n\x1b[33m! No .env file found.\x1b[0m Copy the example and add your key:');
    console.warn('    cp .env.example .env      # then set ANTHROPIC_API_KEY\n');
  }
}

/** Fail early if the API key is missing (only when we actually need Claude). */
export function requireApiKey() {
  checkEnvFile();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'your-api-key-here' || !key.trim()) {
    fail([
      'ANTHROPIC_API_KEY is not set.',
      '',
      '  1. Get a key at https://console.anthropic.com/',
      '  2. cp .env.example .env',
      '  3. Put the key in .env:  ANTHROPIC_API_KEY=sk-ant-...',
      '',
      '  (No key yet? Try `npm run offline` - it needs no key or server.)',
    ]);
  }
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
