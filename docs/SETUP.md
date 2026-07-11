# Setup Guide

## The short version

```bash
npm install
npm run play          # starts the server + runs the crew - open http://localhost:3000
```

`npm run play` does everything: starts the Docker Minecraft server (first run downloads it and
generates the world, ~1 min), waits for it, then shows a menu of curated builds - a castle, a
wizard tower, a cottage, a lighthouse, or "surprise me" - **no API key needed**. Add a key
(below - Gemini is free) and the same menu also accepts any prompt you type, e.g.
`npm run play "a haunted mansion"`.

You do **not** need to own Minecraft to watch in the browser, and you don't need the Docker
Compose plugin - `npm run play` uses plain `docker`.

The rest of this guide explains what's happening under the hood and how to fix things if a
step breaks.

## What you need

| Requirement | Why | Check |
|-------------|-----|-------|
| **Node.js 18+** | Runs the bots and the viewer | `node --version` |
| **Docker** | Runs the Minecraft server | `docker info` |
| **An AI key** | Only for custom prompts (not the built-in library) | see below - Gemini is free |

---

## Choosing an AI backend (for custom builds)

With **no key**, `npm run play` builds from the free built-in library. To design your own
prompts, add **one** key. The provider is auto-detected from whichever key you set:

| Backend | Env var | Cost | Where to get it |
|---------|---------|------|-----------------|
| **Gemini** (recommended) | `GEMINI_API_KEY` | Free tier | https://aistudio.google.com/apikey |
| **Claude** | `ANTHROPIC_API_KEY` | Paid (credits) | https://console.anthropic.com/ |
| **OpenAI** | `OPENAI_API_KEY` | Paid (credits) | https://platform.openai.com/ |
| **Ollama** (local) | none (`LLM_PROVIDER=ollama`) | Free | https://ollama.com - needs a real GPU |

```bash
npm run setup                 # creates .env from the example
# edit .env and set ONE key (see the step-by-step for each provider below)
npm run play                  # it asks what to build
```

Force a specific backend with `LLM_PROVIDER=gemini|claude|openai|ollama|library`. Better models
produce better builds; Ollama is fully offline but lower quality and needs a strong GPU.

> **Never commit `.env`** - it's gitignored on purpose. Only `.env.example` belongs in git.
> Paste keys with **no quotes** and no trailing spaces (the app trims stray whitespace, but keep it clean).

---

### Get a Google Gemini key (free - recommended)

Gemini has a genuinely free tier, so custom builds can cost nothing. You only need a Google account.

1. Go to **https://aistudio.google.com/apikey** and sign in with your Google account.
2. Click **"Create API key"** (choose "Create API key in new project" if it asks).
3. Copy the key (it looks like `AIza...`).
4. Put it in `.env`:
   ```bash
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=AIzaYOURKEYHERE
   ```
5. `npm run play` - it should print `Backend: Gemini (gemini-2.0-flash)`.

> **"Prepayment credits are depleted" / 429 errors?** Your key is valid but that Google project
> has no available quota. Free-tier limits reset over time; if the project has billing enabled but
> no credit, either wait for the quota window or create a key in a fresh project at the link above.
> Model is set with `GEMINI_MODEL` (default `gemini-2.0-flash`).

### Get an Anthropic Claude key (paid - highest quality)

Claude produces the best builds but is **pay-as-you-go** (there's no free tier for the API - and a
Claude Pro/Max chat subscription does **not** include API access; that's separate billing).

1. Go to **https://console.anthropic.com/** and sign in / sign up.
2. Add a payment method and some credit under **Billing** (a few dollars goes a long way here).
3. Open **API Keys -> Create Key**, name it, and copy it (it looks like `sk-ant-...`).
4. Put it in `.env`:
   ```bash
   LLM_PROVIDER=claude
   ANTHROPIC_API_KEY=sk-ant-YOURKEYHERE
   ```
5. Optionally pin a model with `ANTHROPIC_MODEL=` (default is set in `src/providers.js`).

### Get an OpenAI key (paid)

1. Go to **https://platform.openai.com/** and sign in / sign up.
2. Add credit under **Settings -> Billing** (the API is prepaid, separate from ChatGPT Plus).
3. Open **https://platform.openai.com/api-keys -> Create new secret key** and copy it (`sk-...`).
   You only see it once - copy it now.
4. Put it in `.env`:
   ```bash
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-YOURKEYHERE
   ```
5. Model defaults to `gpt-4o`; override with `OPENAI_MODEL=`.

### Run a local model with Ollama (free, no key, needs a GPU)

No key or account - the model runs on **your** machine. Best on a discrete GPU; small models on
CPU are slow and lower quality.

1. Install Ollama from **https://ollama.com** (macOS/Windows/Linux).
2. Pull a model and start the server:
   ```bash
   ollama pull llama3.1        # or mistral, qwen2.5, etc.
   ollama serve                # runs the local API on http://localhost:11434
   ```
3. Tell this app to use it (no key needed):
   ```bash
   LLM_PROVIDER=ollama
   # OLLAMA_MODEL=llama3.1          # optional, this is the default
   # OLLAMA_HOST=http://localhost:11434   # optional, if you moved the port
   ```
4. `npm run play`. If it can't connect, make sure `ollama serve` is running.

> Whatever you pick, if the model returns malformed JSON the build falls back with an error - retry,
> or use a stronger model. **No key at all just uses the free built-in library**, which always works.

---

## Under the hood: the Minecraft server

`npm run play` starts the server for you. If you'd rather manage it yourself (or `play` can't),
here's exactly what it sets up and how to do it by hand.

## Step 1 - Start a Minecraft server

The bots need a server to connect to. It must be **Java Edition 1.20.1**, with **online-mode
off** (so the bots can log in without paid accounts), **command blocks on**, and the **bot
usernames opped** (the bots build with `/setblock`, which needs operator permission).

### Option A - Docker (recommended)

The repo ships a `docker-compose.yml` that sets all of that up for you (pinned to 1.20.1,
online-mode off, and every default bot username auto-opped). Just:

```bash
npm run server        # = docker compose up -d
npm run server:logs   # wait for: "Done (12.345s)! For help, type help"  - then Ctrl+C
```

Manage it with `npm run server:stop` (stop) and `npm run server:reset` (stop + wipe the world).

Prefer a raw `docker run`? This is the equivalent. Note `VERSION` (must be 1.20.1) and the
mounted `ops.json` (ops the bots - see the notes below). Run it from the repo root so the
volume path resolves:

```bash
docker run -d -p 25565:25565 \
  -e EULA=TRUE -e ONLINE_MODE=FALSE -e ENABLE_COMMAND_BLOCK=TRUE \
  -e VERSION=1.20.1 \
  -v "$PWD/docker/ops.json:/data/ops.json" \
  itzg/minecraft-server:java21
```

> Use a **normal** world (the default), not superflat: superflat ground sits at y=-60, and the
> browser viewer only frames the build when the bot is at a positive Y.

> Don't use the itzg `OPS` env var here - it does an online PlayerDB lookup that **fails** for
> offline (`online-mode=false`) usernames and stops the server from starting. The mounted
> `ops.json` (offline UUIDs) is the working approach.

### Option B - Official server jar (no Docker)

1. Download the 1.20.1 server jar from [minecraft.net/download/server](https://www.minecraft.net/en-us/download/server).
2. Run it once to generate files: `java -jar server.jar nogui` (it will stop asking you to accept the EULA).
3. In `eula.txt` set `eula=true`.
4. In `server.properties` set:
   ```
   online-mode=false
   enable-command-block=true
   ```
5. Start it again: `java -jar server.jar nogui`
6. **Op the bots** in the server console (this is required - without it the bots connect but
   can't place blocks):
   ```
   op BuilderBot
   op Rocky
   op Woody
   op Fancy
   op Bloom
   op Archie
   op DemoBuilder
   op AgentBuilder
   ```

> **Two things that will silently break builds if you skip them** (`npm run play` handles both
> for you - this matters only if you run your own server):
> - **Version must be 1.20.1.** The itzg image defaults to the *latest* Minecraft; the bots
>   target 1.20.1, so an unpinned server won't match. `scripts/server.js` pins it.
> - **The bots must be opped.** `/setblock`, `/fill`, and `/tp` require operator permission.
>   Without it the bots join but nothing appears. We op them by mounting `docker/ops.json`. If
>   you use a custom `MC_USERNAME`, run `npm run ops -- YourBotName` and restart the server.

---

## Commands

```bash
npm run play                           # server up + build menu (presets free, no key)
npm run play "a wizard tower"          # skip the menu - AI designs it (needs key)
npm run play "a castle" --sequential   # one bot at a time; --no-viewer also works

npm run server / server:stop / server:reset / server:logs   # manage the server yourself
npm run demo "a watchtower"            # single bot instead of the crew (needs key)
npm start                              # interactive - type prompts one by one
npm run offline                        # no Docker/server/key - just prints a sample plan
```

When a build runs you'll see a banner - open the URL and drag to orbit, scroll to zoom:

```
========================================================
  WATCH IN YOUR BROWSER:  http://localhost:3000
========================================================
```

---

## Browser viewer

The browser view is powered by [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer),
which depends on the native `canvas` module. It's listed as an **optional dependency**, so:

- If `canvas` installs cleanly (it does on most macOS / Windows / mainstream Linux via a
  prebuilt binary), the viewer just works.
- If it **can't** build on your platform, `npm install` still succeeds and the bots still
  build - you just won't get the browser view. You'll see a note in the console and can watch
  in the Minecraft game instead.

### If the viewer didn't start

Install `canvas`'s system libraries, then reinstall it:

```bash
# Debian/Ubuntu
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
# macOS (Homebrew)
brew install pkg-config cairo pango libpng jpeg giflib librsvg
# then:
npm install canvas
```

To turn the viewer off entirely (e.g. on a headless box): set `VIEWER=off` in `.env`, or pass
`--no-viewer` on the command line.

---

## Watching in the actual game (optional)

If you own Minecraft Java Edition, launch it (version **1.20.1**), go to **Multiplayer → Direct
Connect**, and enter `localhost`. You'll spawn in the same world the bots are building in and
can walk around, or even place blocks alongside them.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED` / bots won't connect | The server isn't up yet. Wait for "Done!" in the server logs (Step 1), confirm it's on port 25565. |
| Bots connect but nothing builds | The bots aren't opped. `/setblock` needs operator permission - `npm run server` mounts `docker/ops.json` to op them, or `op <botname>` in the server console. Custom `MC_USERNAME`? Run `npm run ops -- YourBotName` then restart the server. |
| Server won't start / "Could not resolve user from Playerdb" | You're using the `OPS` env var on an offline-mode server - it does an online lookup that fails. Remove it and use the mounted `docker/ops.json` instead (that's what compose does). |
| Bots connect but nothing builds (still) | Command blocks must be enabled (`ENABLE_COMMAND_BLOCK=TRUE` / `enable-command-block=true`). |
| `did not return valid JSON` / build plan fails | Your model returned malformed JSON. Check the key has credit, try again, or use a stronger model (Gemini/Claude/GPT beat small Ollama models at this). No key at all just uses the library. |
| Browser viewer won't load / "viewer unavailable" | `canvas` didn't build - see [Browser viewer](#browser-viewer) above, or just watch in-game. |
| Port 3000 already in use | Set `VIEWER_PORT=3001` (or any free port) in `.env`. |
| Version mismatch on connect | Use a **1.20.1** server. The bots target 1.20.1. |
| `EULA` errors from the server | Docker: keep `-e EULA=TRUE`. Jar: set `eula=true` in `eula.txt`. |

Still stuck? Open an issue with your OS, Node version (`node --version`), and the console
output.
