// LLM provider abstraction. The crew doesn't care which model designs the build -
// it just needs a JSON plan. This routes a single `complete()` call to whichever
// backend the user configured, so we support Claude, Gemini, OpenAI, and a local
// Ollama model, plus a "library" mode that needs no LLM at all.
//
// Selection (env LLM_PROVIDER, else auto-detected from whichever key is present):
//   claude   -> ANTHROPIC_API_KEY   (@anthropic-ai/sdk)
//   gemini   -> GEMINI_API_KEY / GOOGLE_API_KEY   (@google/generative-ai)  [free tier!]
//   openai   -> OPENAI_API_KEY      (openai)
//   ollama   -> local, no key       (http://localhost:11434)  [needs a real GPU]
//   library  -> built-in procedural builds, no LLM (default when no key is set)
import 'dotenv/config';

const DEFAULT_MODELS = {
  claude: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  // gemini-flash-latest tracks the current free-tier flash model. Pinned names like
  // gemini-2.0-flash can carry a free-tier quota of 0 for some accounts/regions (429
  // "limit: 0"); the -latest alias is the reliably-free default. Override with GEMINI_MODEL.
  gemini: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  openai: process.env.OPENAI_MODEL || 'gpt-4o',
  ollama: process.env.OLLAMA_MODEL || 'llama3.1',
};

function present(v) {
  return v && v.trim() && v.trim() !== 'your-api-key-here';
}

// Read an env var and strip stray whitespace (users often paste a key with a
// leading space or trailing newline). Returns '' if unset.
const env = (name) => (process.env[name] || '').trim();

// Does the key-based provider have its credential set? (ollama/library need none.)
function hasCredential(name) {
  switch (name) {
    case 'claude': return present(process.env.ANTHROPIC_API_KEY);
    case 'gemini': return present(process.env.GEMINI_API_KEY) || present(process.env.GOOGLE_API_KEY);
    case 'openai': return present(process.env.OPENAI_API_KEY);
    case 'ollama': case 'library': return true;
    default: return false;
  }
}

/** Resolve the active provider name from LLM_PROVIDER, else from whichever key exists. */
export function detectProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (explicit) {
    // Explicit choice wins - UNLESS it's a key-based provider with no key yet
    // (e.g. LLM_PROVIDER=gemini before pasting the key). Degrade to the library so
    // `npm run play` still works instead of crashing inside the SDK.
    if (isLiveProvider(explicit) && !hasCredential(explicit)) return 'library';
    return explicit;
  }
  if (present(process.env.ANTHROPIC_API_KEY)) return 'claude';
  if (present(process.env.GEMINI_API_KEY) || present(process.env.GOOGLE_API_KEY)) return 'gemini';
  if (present(process.env.OPENAI_API_KEY)) return 'openai';
  return 'library'; // no key configured -> use the built-in library (no LLM)
}

/** True if the active provider generates builds from a prompt (vs. the static library). */
export function isLiveProvider(name = detectProvider()) {
  return ['claude', 'gemini', 'openai', 'ollama'].includes(name);
}

/** Human label for the active backend, e.g. "Gemini (gemini-2.0-flash)". */
export function providerLabel(name = detectProvider()) {
  const nice = { claude: 'Claude', gemini: 'Gemini', openai: 'OpenAI', ollama: 'Ollama (local)', library: 'built-in library' };
  const label = nice[name] || name;
  return isLiveProvider(name) ? `${label} (${DEFAULT_MODELS[name]})` : label;
}

/**
 * Generate a completion from the active provider.
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string>} the raw text response
 */
export async function complete({ system, user, maxTokens = 8192 }) {
  const name = detectProvider();
  switch (name) {
    case 'claude': return completeClaude({ system, user, maxTokens });
    case 'gemini': return completeGemini({ system, user, maxTokens });
    case 'openai': return completeOpenAI({ system, user, maxTokens });
    case 'ollama': return completeOllama({ system, user, maxTokens });
    default:
      throw new Error(
        `LLM_PROVIDER="${name}" cannot generate builds. Set a provider with a key ` +
        `(claude/gemini/openai) or run a local model with LLM_PROVIDER=ollama.`
      );
  }
}

async function completeClaude({ system, user, maxTokens }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  const res = await client.messages.create({
    model: DEFAULT_MODELS.claude,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content[0].text;
}

async function completeGemini({ system, user, maxTokens }) {
  const mod = await import('@google/generative-ai').catch(() => {
    throw new Error('Gemini support needs the @google/generative-ai package. Run: npm install');
  });
  const key = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
  const genAI = new mod.GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODELS.gemini,
    systemInstruction: system,
    generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(user);
  return result.response.text();
}

async function completeOpenAI({ system, user, maxTokens }) {
  const mod = await import('openai').catch(() => {
    throw new Error('OpenAI support needs the openai package. Run: npm install');
  });
  const client = new mod.default({ apiKey: env('OPENAI_API_KEY') });
  const res = await client.chat.completions.create({
    model: DEFAULT_MODELS.openai,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return res.choices[0].message.content;
}

async function completeOllama({ system, user, maxTokens }) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODELS.ollama,
        stream: false,
        format: 'json',
        options: { num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${host}. Is it running? (ollama serve). ${err.message}`);
  }
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.message?.content ?? '';
}
