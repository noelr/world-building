# World Building — Good Night Stories

A small Bun app for building fictional worlds and generating calming, voice-narrated
good night stories set in them.

- **Runtime:** [Bun](https://bun.sh) only — no npm packages, no external dependencies.
- **Storage:** SQLite, via Bun's built-in `bun:sqlite` module (a single `data.db` file).
- **Story generation:** [OpenRouter](https://openrouter.ai) chat completions.
- **Voice narration:** the browser's built-in Web Speech API (`speechSynthesis`) —
  no TTS service or library required. Pick any voice installed on your system/browser
  and play, pause, or stop the reading.

## How it works

1. Create a **world**: a name plus a short theme/description
   (e.g. *"The Whispering Isles — floating islands connected by rope bridges, home to
   gentle cloud-whales and lantern-lit villages."*).
2. Click **Generate a good night story** (optionally add a specific request, like a
   character's name). The server asks OpenRouter for a short, cozy, low-conflict
   bedtime story set in that world and saves it.
3. Open any generated story and press **Play** to have it read aloud in the browser.

All worlds and stories are persisted in SQLite, so they're still there next time you
open the app.

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

## Configuration

All configuration is via environment variables (loaded automatically by Bun from `.env`):

| Variable               | Required | Default                        | Description                                   |
| ----------------------- | -------- | ------------------------------- | ---------------------------------------------- |
| `OPENROUTER_API_KEY`    | yes      | —                                | API key from https://openrouter.ai/keys        |
| `OPENROUTER_MODEL`      | no       | `anthropic/claude-haiku-4.5`    | Any model id available on OpenRouter (check it has active endpoints at https://openrouter.ai/models) |
| `OPENROUTER_SITE_URL`   | no       | `http://localhost`              | Sent as the `HTTP-Referer` header to OpenRouter|
| `PORT`                  | no       | `3000`                          | HTTP port for the app                          |
| `DB_PATH`               | no       | `data.db`                       | Path to the SQLite database file               |

## Project structure

```
src/
  server.ts      Bun.serve HTTP server + JSON API routes
  db.ts          SQLite schema and prepared queries (bun:sqlite)
  openrouter.ts  OpenRouter chat-completion client for story generation
public/
  index.html     Single-page UI
  app.js         Frontend logic (worlds/stories CRUD + Web Speech playback)
  styles.css     Styling
```

## API

- `GET /api/worlds` — list worlds
- `POST /api/worlds` `{ name, theme }` — create a world
- `GET /api/worlds/:id` — get a world with its stories
- `DELETE /api/worlds/:id` — delete a world (and its stories)
- `POST /api/worlds/:id/stories` `{ note? }` — generate a new story via OpenRouter
- `GET /api/stories/:id` — get a single story
- `DELETE /api/stories/:id` — delete a story
