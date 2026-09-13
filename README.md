# World Building — Good Night Stories

A small Bun app for building fictional worlds and generating calming, voice-narrated
good night stories set in them.

- **Runtime:** [Bun](https://bun.sh) only — no npm packages, no external dependencies.
- **Storage:** SQLite, via Bun's built-in `bun:sqlite` module (a single `data.db` file).
- **Story generation:** [OpenRouter](https://openrouter.ai) chat completions.
- **Voice narration:** a real AI voice, generated once per story via
  [OpenRouter's text-to-speech endpoint](https://openrouter.ai/docs/guides/overview/multimodal/tts)
  (default `mistralai/voxtral-mini-tts-2603`) and stored alongside the story, so
  playback is instant afterwards. If narration generation fails for a story, the
  reader shows why and playback is disabled for that story.

## How it works

1. Create a **world**: a name plus a short theme/description
   (e.g. *"The Whispering Isles — floating islands connected by rope bridges, home to
   gentle cloud-whales and lantern-lit villages."*).
2. Click **Generate a good night story** (optionally add a specific request, like a
   character's name). The server asks OpenRouter for a short, cozy, low-conflict
   bedtime story set in that world, then sends the text to OpenRouter's
   text-to-speech endpoint to narrate it in a calm voice, and saves both.
3. Open any generated story and press **Play** to hear the AI narration.

All worlds and stories are persisted in SQLite, so they're still there next time you
open the app.

### World memory

After each story is generated, the model is asked to pick out any new **locations**,
**characters**, and **events** it introduced and saves them to that world's "World
memory" section. They're fed back in as context the next time a story is generated for
the same world, so places and characters can recur and the world stays consistent
instead of every story reinventing everything from scratch.

These are just a starting point, not a strict canon: edit a description, rename
something, or delete anything you don't like directly in the World memory section, and
you can add your own locations/characters/events by hand too — future stories will pick
up whatever's there.

## Setup

```bash
cp .env.example .env
# then edit .env and set OPENROUTER_API_KEY
```

## Run

```bash
bun run start
# or, to auto-restart on file changes:
bun run dev
```

Then open http://localhost:3000.

### Changing the narrator model or voice

If OpenRouter ever reports that the configured narrator model has no active
endpoints, list what's currently available and pick a replacement:

```bash
curl -s "https://openrouter.ai/api/v1/models?output_modalities=speech" | \
  jq '.data[] | {id, supported_voices}'
```

Then set both `OPENROUTER_TTS_MODEL` and `OPENROUTER_TTS_VOICE` in `.env` to a
matching pair from that model's `supported_voices` — voices are namespaced per
provider (an OpenAI voice name won't work on a Voxtral or Kokoro model, etc.).

## Configuration

All configuration is via environment variables (loaded automatically by Bun from `.env`):

| Variable               | Required | Default                        | Description                                   |
| ----------------------- | -------- | ------------------------------- | ---------------------------------------------- |
| `OPENROUTER_API_KEY`    | yes      | —                                | API key from https://openrouter.ai/keys        |
| `OPENROUTER_MODEL`      | no       | `anthropic/claude-haiku-4.5`    | Any model id available on OpenRouter (check it has active endpoints at https://openrouter.ai/models) |
| `OPENROUTER_TTS_MODEL`  | no       | `mistralai/voxtral-mini-tts-2603` | A text-to-speech model id from OpenRouter's `/api/v1/audio/speech` endpoint |
| `OPENROUTER_TTS_VOICE`  | no       | `en_paul_neutral`               | A voice supported by `OPENROUTER_TTS_MODEL` — voices are provider-namespaced, so model and voice must be changed together (see below) |
| `OPENROUTER_SITE_URL`   | no       | `http://localhost`              | Sent as the `HTTP-Referer` header to OpenRouter|
| `PORT`                  | no       | `3000`                          | HTTP port for the app                          |
| `DB_PATH`               | no       | `data.db`                       | Path to the SQLite database file               |

## Project structure

```
src/
  server.ts      Bun.serve HTTP server + JSON API routes
  db.ts          SQLite schema and prepared queries (bun:sqlite)
  openrouter.ts  OpenRouter chat-completion client for story generation
  tts.ts         OpenRouter text-to-speech client for AI voice narration
public/
  index.html     Single-page UI
  app.js         Frontend logic (worlds/stories CRUD + AI narration playback)
  styles.css     Styling
```

## API

- `GET /api/worlds` — list worlds
- `POST /api/worlds` `{ name, theme }` — create a world
- `GET /api/worlds/:id` — get a world with its stories and world memory entities
- `DELETE /api/worlds/:id` — delete a world (and its stories)
- `POST /api/worlds/:id/stories` `{ note? }` — generate a new story via OpenRouter
- `GET /api/stories/:id` — get a single story
- `DELETE /api/stories/:id` — delete a story
- `POST /api/worlds/:id/entities` `{ type, name, description }` — manually add a
  world memory element (`type` is `location`, `actor`, or `event`)
- `PATCH /api/entities/:id` `{ name?, description? }` — edit a world memory element
- `DELETE /api/entities/:id` — forget a world memory element
