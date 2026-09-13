import { Database } from "bun:sqlite";

export const DB_PATH = process.env.DB_PATH || "data.db";

export const db = new Database(DB_PATH, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    theme TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    prompt_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Added after the initial release: base64 AI narration audio for a story,
// generated via OpenRouter (see src/tts.ts) instead of the browser's local
// text-to-speech voices. Guarded so it's safe to run against an existing db.
function ensureColumn(table: string, column: string, ddl: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) {
      throw err;
    }
  }
}

ensureColumn("stories", "audio_data", "TEXT");
ensureColumn("stories", "audio_format", "TEXT");
ensureColumn("stories", "audio_error", "TEXT");

// Added to make stories a continuing series rather than one-offs: each story
// suggests a few directions for what could happen next (JSON-encoded array),
// and records which one (if any) the reader picked when generating it. See
// buildStoryPrompt in src/openrouter.ts.
ensureColumn("stories", "continuations", "TEXT");
ensureColumn("stories", "continued_from", "TEXT");

// World-building memory: locations, characters ("actors"), and events that a
// generated story introduced, so future stories in the same world can reuse
// and stay consistent with them. The model extracts these automatically
// after each story is generated (see extractEntities in src/openrouter.ts),
// but they live independently of any single story - the user can edit or
// delete them, and they survive that story being deleted.
db.exec(`
  CREATE TABLE IF NOT EXISTS world_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('location', 'actor', 'event')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    source_story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface World {
  id: number;
  name: string;
  theme: string;
  created_at: string;
}

export interface Story {
  id: number;
  world_id: number;
  title: string;
  content: string;
  prompt_note: string | null;
  created_at: string;
  /** Base64-encoded narration audio generated via OpenRouter, if any. */
  audio_data: string | null;
  /** Audio container format for audio_data, e.g. "mp3". */
  audio_format: string | null;
  /** Set when AI narration generation failed for this story. */
  audio_error: string | null;
  /** JSON-encoded array of up to 3 suggested directions for the next story. */
  continuations: string | null;
  /** The suggested continuation the reader picked to generate this story, if any. */
  continued_from: string | null;
}

// Lightweight variant of Story for list views (the world detail panel,
// the continuation picker): everything except `content` and `audio_data`,
// which can each be tens to hundreds of KB (a full narration's base64
// audio, easily 100KB-1MB+) and aren't needed until a story is actually
// opened. Fetching these for every story in a world up front is what made
// the UI slow on worlds with more than a few stories - see listStorySummariesForWorld.
export interface StorySummary {
  id: number;
  world_id: number;
  title: string;
  prompt_note: string | null;
  created_at: string;
  audio_format: string | null;
  audio_error: string | null;
  /** Whether narration audio exists for this story, without loading it. */
  has_audio: 0 | 1;
  continuations: string | null;
  continued_from: string | null;
}

export type EntityType = "location" | "actor" | "event";

export interface WorldEntity {
  id: number;
  world_id: number;
  type: EntityType;
  name: string;
  description: string;
  /** The story this was extracted from, if any. Survives that story's deletion. */
  source_story_id: number | null;
  created_at: string;
}

export const queries = {
  listWorlds: db.query<World, []>(
    "SELECT * FROM worlds ORDER BY created_at DESC, id DESC"
  ),
  getWorld: db.query<World, [number]>("SELECT * FROM worlds WHERE id = ?"),
  insertWorld: db.query<World, [string, string]>(
    "INSERT INTO worlds (name, theme) VALUES (?, ?) RETURNING *"
  ),
  deleteWorld: db.query<null, [number]>("DELETE FROM worlds WHERE id = ?"),

  // Ordered so the most recently created story is always first - callers
  // (the continuation picker, "continue from the last story") rely on that.
  // created_at alone isn't enough: it has only second resolution, so two
  // stories created in the same second would tie; id DESC breaks the tie
  // deterministically since ids are inserted in order.
  listStoriesForWorld: db.query<Story, [number]>(
    "SELECT * FROM stories WHERE world_id = ? ORDER BY created_at DESC, id DESC"
  ),
  // Same ordering as listStoriesForWorld, but leaves out `content` and
  // `audio_data` so listing a world's stories doesn't pull every story's
  // full text and base64 audio into memory just to show a title list.
  listStorySummariesForWorld: db.query<StorySummary, [number]>(
    `SELECT id, world_id, title, prompt_note, created_at, audio_format, audio_error,
            (audio_data IS NOT NULL) AS has_audio, continuations, continued_from
     FROM stories WHERE world_id = ? ORDER BY created_at DESC, id DESC`
  ),
  getStory: db.query<Story, [number]>("SELECT * FROM stories WHERE id = ?"),
  // Audio only, for the dedicated /api/stories/:id/audio route - avoids
  // loading title/content when all that's needed is the narration bytes.
  getStoryAudio: db.query<Pick<Story, "audio_data" | "audio_format">, [number]>(
    "SELECT audio_data, audio_format FROM stories WHERE id = ?"
  ),
  insertStory: db.query<
    Story,
    [number, string, string, string | null, string | null, string]
  >(
    "INSERT INTO stories (world_id, title, content, prompt_note, continued_from, continuations) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
  ),
  deleteStory: db.query<null, [number]>("DELETE FROM stories WHERE id = ?"),
  setStoryAudio: db.query<
    Story,
    [string | null, string | null, string | null, number]
  >(
    "UPDATE stories SET audio_data = ?, audio_format = ?, audio_error = ? WHERE id = ? RETURNING *"
  ),

  listEntitiesForWorld: db.query<WorldEntity, [number]>(
    "SELECT * FROM world_entities WHERE world_id = ? ORDER BY type, name COLLATE NOCASE"
  ),
  getEntity: db.query<WorldEntity, [number]>(
    "SELECT * FROM world_entities WHERE id = ?"
  ),
  insertEntity: db.query<
    WorldEntity,
    [number, EntityType, string, string, number | null]
  >(
    "INSERT INTO world_entities (world_id, type, name, description, source_story_id) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ),
  updateEntity: db.query<WorldEntity, [string, string, number]>(
    "UPDATE world_entities SET name = ?, description = ? WHERE id = ? RETURNING *"
  ),
  deleteEntity: db.query<null, [number]>(
    "DELETE FROM world_entities WHERE id = ?"
  ),
};
