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

// Gemini's free tier takes models away without warning, and the failure is per-MODEL, not
// per-key: on 2026-07-14 our pinned default (gemini-flash-latest) 503'd "high demand" for
// hours while the same key answered instantly on other models; gemini-2.5-flash had been
// closed to new keys entirely ("no longer available to new users"); gemini-2.0-flash carried
// a free quota of 0. One dead name must not take the whole feature down, so a Gemini call
// walks this chain until something answers. Order: the configured model first (a name the
// user pinned is a name they meant), then a known-good fallback, then the cheapest option.
export const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest'];

// The model that last answered. Sticky for the life of the process so we pay the dead-model
// probe once, not on every build - and cleared implicitly if it too starts failing, because
// it is only ever the FIRST link of the chain, never the whole chain.
let geminiWorking = null;

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

/**
 * True if the active provider can be shown a PICTURE of the world (see src/critic.js).
 * The three hosted defaults are all vision models. Ollama is not - `llama3.1` has no eyes -
 * so it only counts once the user names a multimodal model (e.g. OLLAMA_VISION_MODEL=llava).
 */
export function supportsVision(name = detectProvider()) {
  if (name === 'ollama') return present(process.env.OLLAMA_VISION_MODEL);
  return ['claude', 'gemini', 'openai'].includes(name);
}

/** Human label for the active backend, e.g. "Gemini (gemini-2.0-flash)". */
export function providerLabel(name = detectProvider()) {
  const nice = { claude: 'Claude', gemini: 'Gemini', openai: 'OpenAI', ollama: 'Ollama (local)', library: 'built-in library' };
  const label = nice[name] || name;
  // Name the model actually answering, not the one we asked for first - once the chain has
  // fallen through, the configured name is the one model we know does NOT work.
  const model = name === 'gemini' ? geminiWorking || DEFAULT_MODELS.gemini : DEFAULT_MODELS[name];
  return isLiveProvider(name) ? `${label} (${model})` : label;
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

/**
 * Same as complete(), but the model is also SHOWN the build.
 *
 * This is what makes the visual critic possible (src/critic.js): the model gets screenshots of
 * the finished structure alongside the blueprint, which is the one thing a coordinate list can
 * never tell it - what the thing actually looks like.
 *
 * @param {{ system: string, user: string, images: Array<{data: string, mediaType: string}>,
 *           maxTokens?: number }} opts  `images[].data` is base64, no data: prefix.
 * @returns {Promise<string>}
 */
export async function completeVision({ system, user, images = [], maxTokens = 4096 }) {
  const name = detectProvider();
  if (!supportsVision(name)) {
    throw new Error(
      `${providerLabel(name)} cannot look at pictures. Use claude/gemini/openai, or set ` +
      `OLLAMA_VISION_MODEL to a multimodal local model (e.g. llava).`
    );
  }
  switch (name) {
    case 'claude': return completeClaude({ system, user, maxTokens, images });
    case 'gemini': return completeGemini({ system, user, maxTokens, images });
    case 'openai': return completeOpenAI({ system, user, maxTokens, images });
    case 'ollama': return completeOllama({ system, user, maxTokens, images });
    default: throw new Error(`No vision path for provider "${name}".`);
  }
}

async function completeClaude({ system, user, maxTokens, images = [] }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  // Images before the text: Claude reads a prompt that describes pictures it has already
  // been shown better than one that promises pictures further down.
  const content = images.length
    ? [
        ...images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })),
        { type: 'text', text: user },
      ]
    : user;
  const res = await client.messages.create({
    model: DEFAULT_MODELS.claude,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });
  return res.content[0].text;
}

/**
 * Is this Gemini failure about the MODEL rather than about us? Overloaded (503), retired
 * (404 "no longer available"), or a per-model free quota of 0 (429) all mean "ask a
 * different model" - the key, the prompt and the images are fine. A malformed request or a
 * bad key is ours to fix and must surface immediately, not be retried three times.
 */
export function geminiModelIsUnavailable(err) {
  const message = String(err?.message ?? err);
  // The SDK folds the HTTP status into the message ("[503 Service Unavailable] ...") rather
  // than exposing it, so match the status there - anchored to the SDK's bracket form, not to
  // any loose 3-digit number that happens to appear in the prose.
  if (/\[(404|429|500|502|503|504)\b/.test(message)) return true;
  if ([404, 429, 500, 502, 503, 504].includes(err?.status)) return true;
  return /high demand|overload|unavailable|no longer available|quota/i.test(message);
}

async function completeGemini({ system, user, maxTokens, images = [] }) {
  const mod = await import('@google/generative-ai').catch(() => {
    throw new Error('Gemini support needs the @google/generative-ai package. Run: npm install');
  });
  const key = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
  const genAI = new mod.GoogleGenerativeAI(key);
  const parts = [
    ...images.map((img) => ({ inlineData: { data: img.data, mimeType: img.mediaType } })),
    { text: user },
  ];

  // Whatever answered last, then the configured model, then the fallbacks - de-duplicated.
  const chain = [...new Set([geminiWorking, DEFAULT_MODELS.gemini, ...GEMINI_FALLBACKS].filter(Boolean))];
  let lastError;

  for (const name of chain) {
    try {
      const model = genAI.getGenerativeModel({
        model: name,
        systemInstruction: system,
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(parts);
      const text = result.response.text();
      const reason = result.response.candidates?.[0]?.finishReason;

      // A REASONING model (gemini-3-*) spends maxOutputTokens on thinking BEFORE it writes a
      // single character of the answer, so a budget that was ample for a one-shot model runs
      // out mid-JSON. The reply is then a 200 carrying half an object, and every JSON parser
      // downstream reports the same useless thing: "the model did not return valid JSON".
      // That is a truncation, not a refusal, and it must say so - the fix is more budget, not
      // a reworded prompt. (This is exactly how the repair + critic loops failed silently on
      // 4096 tokens while the coordinator, on 16384, sailed through. Found 2026-07-14.)
      if (reason === 'MAX_TOKENS') {
        throw new Error(
          `Gemini (${name}) ran out of output tokens (maxTokens=${maxTokens}) and its JSON is ` +
          `truncated. Reasoning models spend this budget on thinking before they answer - ` +
          `raise maxTokens for this call, or pin a non-reasoning model via GEMINI_MODEL.`
        );
      }
      if (!text || !text.trim()) {
        throw new Error(
          `Gemini (${name}) returned an empty response (finishReason=${reason || 'unknown'}). ` +
          `This is usually a safety filter - try rewording the prompt.`
        );
      }
      if (name !== geminiWorking) {
        if (geminiWorking || name !== DEFAULT_MODELS.gemini) {
          console.log(`   ℹ️  Gemini: using ${name}`);
        }
        geminiWorking = name;
      }
      return text;
    } catch (err) {
      lastError = err;
      if (!geminiModelIsUnavailable(err)) throw err; // our bug, not Google's - surface it now
      if (name === geminiWorking) geminiWorking = null; // the sticky choice just died too
      console.log(`   ⚠️  Gemini: ${name} is unavailable (${String(err.message).split('\n')[0].slice(0, 80)})`);
    }
  }
  throw new Error(
    `Every Gemini model we know is unavailable right now (tried: ${chain.join(', ')}). ` +
    `Last error: ${lastError?.message}`
  );
}

async function completeOpenAI({ system, user, maxTokens, images = [] }) {
  const mod = await import('openai').catch(() => {
    throw new Error('OpenAI support needs the openai package. Run: npm install');
  });
  const client = new mod.default({ apiKey: env('OPENAI_API_KEY') });
  const content = images.length
    ? [
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        })),
        { type: 'text', text: user },
      ]
    : user;
  const res = await client.chat.completions.create({
    model: DEFAULT_MODELS.openai,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  });
  return res.choices[0].message.content;
}

async function completeOllama({ system, user, maxTokens, images = [] }) {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  // A picture needs a multimodal model - the text default (llama3.1) has no eyes and would
  // silently ignore the images and answer from the prompt alone, which is worse than failing.
  const model = images.length
    ? (env('OLLAMA_VISION_MODEL') || DEFAULT_MODELS.ollama)
    : DEFAULT_MODELS.ollama;
  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user, ...(images.length ? { images: images.map((i) => i.data) } : {}) },
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
