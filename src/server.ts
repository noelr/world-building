import { queries, type EntityType, type Story } from "./db";
import { generateStory, extractEntities } from "./openrouter";
import { generateNarration } from "./tts";

const ENTITY_TYPES: EntityType[] = ["location", "actor", "event"];

// Stories store continuations as a JSON-encoded TEXT column; expose it to
// clients as a real array instead.
function serializeStory(story: Story) {
  let continuations: string[] = [];
  if (story.continuations) {
    try {
      const parsed = JSON.parse(story.continuations);
      if (Array.isArray(parsed)) {
        continuations = parsed.filter((c: unknown): c is string => typeof c === "string");
      }
    } catch {
      // Malformed JSON (shouldn't happen - we always write it ourselves) - no continuations.
    }
  }
  return { ...story, continuations };
}

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
        const stories = queries.listStoriesForWorld.all(worldId).map(serializeStory);
        const entities = queries.listEntitiesForWorld.all(worldId);
        return json({ ...world, stories, entities });
      }

      if (method === "DELETE") {
        const world = queries.getWorld.get(worldId);
        if (!world) return notFound("World not found.");
        queries.deleteWorld.run(worldId);
        return json({ ok: true });
      }
    }

    // POST /api/worlds/:id/entities - manually add a world-building element
    // (a location, character, or event) so it can be reused in future stories.
    const entityCreateMatch = pathname.match(/^\/api\/worlds\/(\d+)\/entities$/);
    if (entityCreateMatch && method === "POST") {
      const worldId = Number(entityCreateMatch[1]);
      const world = queries.getWorld.get(worldId);
      if (!world) return notFound("World not found.");

      const body = await req.json().catch(() => null);
      const type = body?.type;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const description =
        typeof body?.description === "string" ? body.description.trim() : "";

      if (!ENTITY_TYPES.includes(type) || !name || !description) {
        return badRequest(
          "'type' (location, actor, or event), 'name', and 'description' are required."
        );
      }

      const entity = queries.insertEntity.get(worldId, type, name, description, null);
      return json(entity, { status: 201 });
    }

    // /api/entities/:id - edit or forget a world-building element
    const entityMatch = pathname.match(/^\/api\/entities\/(\d+)$/);
    if (entityMatch) {
      const entityId = Number(entityMatch[1]);

      if (method === "PATCH") {
        const entity = queries.getEntity.get(entityId);
        if (!entity) return notFound("Entity not found.");

        const body = await req.json().catch(() => ({}));
        const name = typeof body?.name === "string" ? body.name.trim() : entity.name;
        const description =
          typeof body?.description === "string" ? body.description.trim() : entity.description;
        if (!name || !description) {
          return badRequest("'name' and 'description' cannot be empty.");
        }

        const updated = queries.updateEntity.get(name, description, entityId);
        return json(updated);
      }

      if (method === "DELETE") {
        const entity = queries.getEntity.get(entityId);
        if (!entity) return notFound("Entity not found.");
        queries.deleteEntity.run(entityId);
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
      const continuation =
        typeof body?.continuation === "string" ? body.continuation.trim() : undefined;

      try {
        const knownEntities = queries.listEntitiesForWorld.all(worldId);
        // Stories in a world form a continuing series: hand the model the
        // most recent one so tonight's story picks up from it, rather than
        // being a disconnected one-off.
        const previousStory = queries.listStoriesForWorld.all(worldId)[0];
        const generated = await generateStory(
          world.name,
          world.theme,
          note,
          knownEntities,
          previousStory ? { title: previousStory.title, content: previousStory.content } : undefined,
          continuation
        );
        let story = queries.insertStory.get(
          worldId,
          generated.title,
          generated.content,
          note || null,
          continuation || null,
          JSON.stringify(generated.continuations)
        );

        // Pre-generate the AI voice narration once, up front, so playback is
        // instant later. A narration failure doesn't fail story creation -
        // the story is saved with audio_error set, and playback is disabled
        // for it in the UI.
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

        // Pull out any new locations/characters/events this story introduced
        // and save them to the world's memory, so future stories can reuse
        // them and the user can review, edit, or discard them. Best-effort -
        // extraction failing doesn't affect the story that was just created.
        try {
          const extracted = await extractEntities(
            world.name,
            world.theme,
            knownEntities,
            generated.title,
            generated.content
          );
          const knownNames = new Set(knownEntities.map((e) => e.name.toLowerCase()));
          for (const entity of extracted) {
            if (knownNames.has(entity.name.toLowerCase())) continue;
            queries.insertEntity.get(
              worldId,
              entity.type,
              entity.name,
              entity.description,
              story.id
            );
            knownNames.add(entity.name.toLowerCase());
          }
        } catch (extractErr) {
          console.warn("World entity extraction failed:", extractErr);
        }

        return json(serializeStory(story), { status: 201 });
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
        return json(serializeStory(story));
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
