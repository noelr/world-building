import { queries } from "./db";
import { generateStory } from "./openrouter";
import { generateNarration } from "./tts";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = new URL("../public/", import.meta.url);

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 });
}

function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
};

async function serveStatic(pathname: string): Promise<Response | null> {
  const fileName = STATIC_FILES[pathname];
  if (!fileName) return null;
  const file = Bun.file(new URL(fileName, PUBLIC_DIR));
  if (!(await file.exists())) return null;
  return new Response(file);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    // Static assets / SPA shell
    if (method === "GET") {
      const staticResponse = await serveStatic(pathname);
      if (staticResponse) return staticResponse;
    }

    // GET /api/worlds - list all worlds
    if (method === "GET" && pathname === "/api/worlds") {
      const worlds = queries.listWorlds.all();
      return json(worlds);
    }

    // POST /api/worlds - create a world { name, theme }
    if (method === "POST" && pathname === "/api/worlds") {
      const body = await req.json().catch(() => null);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const theme = typeof body?.theme === "string" ? body.theme.trim() : "";
      if (!name || !theme) {
        return badRequest("Both 'name' and 'theme' are required.");
      }
      const world = queries.insertWorld.get(name, theme);
      return json(world, { status: 201 });
    }

    // /api/worlds/:id
    const worldMatch = pathname.match(/^\/api\/worlds\/(\d+)$/);
    if (worldMatch) {
      const worldId = Number(worldMatch[1]);

      if (method === "GET") {
        const world = queries.getWorld.get(worldId);
        if (!world) return notFound("World not found.");
        const stories = queries.listStoriesForWorld.all(worldId);
        return json({ ...world, stories });
      }

      if (method === "DELETE") {
        const world = queries.getWorld.get(worldId);
        if (!world) return notFound("World not found.");
        queries.deleteWorld.run(worldId);
        return json({ ok: true });
      }
    }

    // POST /api/worlds/:id/stories - generate a new story for a world
    const genMatch = pathname.match(/^\/api\/worlds\/(\d+)\/stories$/);
    if (genMatch && method === "POST") {
      const worldId = Number(genMatch[1]);
      const world = queries.getWorld.get(worldId);
      if (!world) return notFound("World not found.");

      const body = await req.json().catch(() => ({}));
      const note = typeof body?.note === "string" ? body.note : undefined;

      try {
        const generated = await generateStory(world.name, world.theme, note);
        let story = queries.insertStory.get(
          worldId,
          generated.title,
          generated.content,
          note || null
        );

        // Pre-generate the AI voice narration once, up front, so playback is
        // instant later. A narration failure doesn't fail story creation -
        // the client falls back to the device's built-in voices for it.
        try {
          const narration = await generateNarration(generated.title, generated.content);
          story = queries.setStoryAudio.get(narration.data, narration.format, null, story.id);
        } catch (narrationErr) {
          const message =
            narrationErr instanceof Error
              ? narrationErr.message
              : "Narration generation failed.";
          story = queries.setStoryAudio.get(null, null, message, story.id);
        }

        return json(story, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Story generation failed.";
        return json({ error: message }, { status: 502 });
      }
    }

    // /api/stories/:id
    const storyMatch = pathname.match(/^\/api\/stories\/(\d+)$/);
    if (storyMatch) {
      const storyId = Number(storyMatch[1]);

      if (method === "GET") {
        const story = queries.getStory.get(storyId);
        if (!story) return notFound("Story not found.");
        return json(story);
      }

      if (method === "DELETE") {
        const story = queries.getStory.get(storyId);
        if (!story) return notFound("Story not found.");
        queries.deleteStory.run(storyId);
        return json({ ok: true });
      }
    }

    if (pathname.startsWith("/api/")) {
      return notFound("Unknown API route.");
    }

    return notFound();
  },
});

console.log(`World Building server running at http://localhost:${PORT}`);
if (!process.env.OPENROUTER_API_KEY) {
  console.warn(
    "Warning: OPENROUTER_API_KEY is not set. Story generation will fail until it is configured (see .env.example)."
  );
}
