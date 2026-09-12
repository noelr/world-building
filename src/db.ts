import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "data.db";

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
}

export const queries = {
  listWorlds: db.query<World, []>(
    "SELECT * FROM worlds ORDER BY created_at DESC"
  ),
  getWorld: db.query<World, [number]>("SELECT * FROM worlds WHERE id = ?"),
  insertWorld: db.query<World, [string, string]>(
    "INSERT INTO worlds (name, theme) VALUES (?, ?) RETURNING *"
  ),
  deleteWorld: db.query<null, [number]>("DELETE FROM worlds WHERE id = ?"),

  listStoriesForWorld: db.query<Story, [number]>(
    "SELECT * FROM stories WHERE world_id = ? ORDER BY created_at DESC"
  ),
  getStory: db.query<Story, [number]>("SELECT * FROM stories WHERE id = ?"),
  insertStory: db.query<Story, [number, string, string, string | null]>(
    "INSERT INTO stories (world_id, title, content, prompt_note) VALUES (?, ?, ?, ?) RETURNING *"
  ),
  deleteStory: db.query<null, [number]>("DELETE FROM stories WHERE id = ?"),
};
