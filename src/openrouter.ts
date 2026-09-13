const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export interface GeneratedStory {
  title: string;
  content: string;
}

/** Minimal shape needed from a world_entities row - kept local so this module doesn't depend on db.ts. */
export interface EntityLike {
  type: string;
  name: string;
  description: string;
}

export interface ExtractedEntity {
  type: "location" | "actor" | "event";
  name: string;
  description: string;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  location: "Locations",
  actor: "Characters",
  event: "Past events",
};

function summarizeEntities(entities: EntityLike[]): string {
  if (!entities.length) return "";

  const byType = new Map<string, EntityLike[]>();
  for (const entity of entities) {
    const list = byType.get(entity.type) ?? [];
    list.push(entity);
    byType.set(entity.type, list);
  }

  return [...byType.entries()]
    .map(([type, items]) => {
      const label = ENTITY_TYPE_LABELS[type] || type;
      const lines = items.map((item) => `- ${item.name}: ${item.description}`).join("\n");
      return `${label}:\n${lines}`;
    })
    .join("\n\n");
}

async function chatComplete(
  messages: { role: string; content: string }[],
  temperature: number
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost",
      "X-Title": "World Building Good Night Stories",
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 404 && /no endpoints/i.test(text)) {
      throw new Error(
        `OpenRouter has no active endpoints for model "${model}". It may have been retired — ` +
          `pick a current model at https://openrouter.ai/models and set OPENROUTER_MODEL in your .env.`
      );
    }
    throw new Error(
      `OpenRouter request failed (${response.status}): ${text || response.statusText}`
    );
  }

  const data = await response.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return raw;
}

function extractJsonObject(raw: string): any {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to grabbing the first {...} block in the text.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildStoryPrompt(
  worldName: string,
  theme: string,
  note: string | undefined,
  knownEntities: EntityLike[]
) {
  const extra = note?.trim()
    ? `The reader also asked for this specifically: "${note.trim()}".`
    : "";

  const known = summarizeEntities(knownEntities);
  const continuity = known
    ? `This world already has established locations, characters, and past events. Reuse them by name where it fits naturally, and keep the story consistent with them, rather than contradicting them or inventing unnecessary replacements. It's fine to introduce new elements too.\n\n${known}`
    : "";

  const system = [
    "You are a gentle bedtime story writer.",
    "You write short, soothing 'good night' stories meant to be read aloud by a calm narrator right before sleep.",
    "Stories should be warm, cozy, low-conflict, and end on a peaceful, sleepy note. Avoid anything scary, violent, or overstimulating.",
    "Keep the story between 250 and 450 words.",
    'Respond with ONLY a JSON object of the exact shape {"title": string, "story": string} and nothing else - no markdown fences, no commentary.',
  ].join(" ");

  const user = [
    `World name: ${worldName}`,
    `World theme / description: ${theme}`,
    continuity,
    extra,
    "Write one good night story set in this world.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export async function generateStory(
  worldName: string,
  theme: string,
  note?: string,
  knownEntities: EntityLike[] = []
): Promise<GeneratedStory> {
  const { system, user } = buildStoryPrompt(worldName, theme, note, knownEntities);

  const raw = await chatComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.9
  );

  const parsed = extractJsonObject(raw);
  if (typeof parsed?.title === "string" && typeof parsed?.story === "string") {
    return { title: parsed.title.trim(), content: parsed.story.trim() };
  }

  // Fall back: use the raw text as the story body with a generic title.
  return {
    title: `A Good Night in ${worldName}`,
    content: raw.trim(),
  };
}

function buildExtractionPrompt(
  worldName: string,
  theme: string,
  knownEntities: EntityLike[],
  title: string,
  content: string
) {
  const known = summarizeEntities(knownEntities);

  const system = [
    "You extract reusable world-building elements from a bedtime story so they can be remembered for future stories set in the same fictional world.",
    "Identify notable locations, characters (\"actors\"), and events that the story introduced or meaningfully used.",
    "Only return elements that are NEW - do not repeat anything already listed as known below.",
    "Write each description as a short, standalone fact about the world (one sentence), not a recap of this story's plot.",
    'Respond with ONLY a JSON object of the exact shape {"entities": [{"type": "location" | "actor" | "event", "name": string, "description": string}]} and nothing else - no markdown fences, no commentary. Return an empty array if there is nothing new worth remembering.',
  ].join(" ");

  const user = [
    `World name: ${worldName}`,
    `World theme / description: ${theme}`,
    known ? `Already known elements (do not repeat these):\n${known}` : "No elements are known yet.",
    `Story title: ${title}`,
    `Story text:\n${content}`,
  ].join("\n\n");

  return { system, user };
}

/**
 * Asks the model to pull out any new locations, characters, and events from a
 * just-generated story, so they can be saved to the world and reused (or
 * edited/discarded by the user) in future stories. Best-effort: callers
 * should treat a failure here as non-fatal to story creation.
 */
export async function extractEntities(
  worldName: string,
  theme: string,
  knownEntities: EntityLike[],
  title: string,
  content: string
): Promise<ExtractedEntity[]> {
  const { system, user } = buildExtractionPrompt(worldName, theme, knownEntities, title, content);

  const raw = await chatComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.3
  );

  const parsed = extractJsonObject(raw);
  const entities = Array.isArray(parsed?.entities) ? parsed.entities : [];

  return entities
    .filter(
      (entity: any) =>
        entity &&
        ["location", "actor", "event"].includes(entity.type) &&
        typeof entity.name === "string" &&
        typeof entity.description === "string" &&
        entity.name.trim() &&
        entity.description.trim()
    )
    .map(
      (entity: any): ExtractedEntity => ({
        type: entity.type,
        name: entity.name.trim(),
        description: entity.description.trim(),
      })
    );
}
