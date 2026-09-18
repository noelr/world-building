const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export interface GeneratedStory {
  title: string;
  content: string;
  /** Up to 3 model-suggested directions for what the next story could do. */
  continuations: string[];
}

/** Minimal shape needed from the previous story in a world, for continuity. */
export interface PreviousStoryLike {
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

/** An EntityLike with its id, needed so chat actions can reference existing entities. */
export interface EntityWithId extends EntityLike {
  id: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatAction =
  | { kind: "create"; type: "location" | "actor" | "event"; name: string; description: string; reason: string }
  | { kind: "update"; entity_id: number; name?: string; description?: string; reason: string }
  | { kind: "delete"; entity_id: number; reason: string }
  | { kind: "merge"; entity_ids: number[]; name: string; description: string; reason: string };

export interface ChatResult {
  reply: string;
  actions: ChatAction[];
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
  knownEntities: EntityLike[],
  previousStory: PreviousStoryLike | undefined,
  chosenContinuation: string | undefined
) {
  const known = summarizeEntities(knownEntities);
  const continuity = known
    ? `This world already has established locations, characters, and past events. Reuse them by name where it fits naturally, and keep the story consistent with them, rather than contradicting them or inventing unnecessary replacements. It's fine to introduce new elements too.\n\n${known}`
    : "";

  // Stories in a world form an ongoing series rather than one-offs: hand the
  // model the previous story so tonight's picks up from it, and let the
  // reader steer the direction either by picking one of that story's
  // suggested continuations, typing their own request, or both together.
  const previous = previousStory
    ? `This is an ongoing series of good night stories set in this world. Here is the most recent previous story, titled "${previousStory.title}":\n\n${previousStory.content}\n\nWrite the NEXT story in this series - a new episode that picks up from there (a new night, not a retelling of the same events), staying consistent with its characters, locations, and events.`
    : "";

  const direction = chosenContinuation?.trim()
    ? `The reader picked this suggested direction for tonight's continuation: "${chosenContinuation.trim()}". Shape tonight's story around it.`
    : "";

  const extra = note?.trim()
    ? `The reader also asked for this specifically: "${note.trim()}".`
    : "";

  const system = [
    "You are a gentle bedtime story writer.",
    "You write short, soothing 'good night' stories meant to be read aloud by a calm narrator right before sleep.",
    "Stories should be warm, cozy, low-conflict, and end on a peaceful, sleepy note. Avoid anything scary, violent, or overstimulating.",
    "Keep the story between 250 and 450 words.",
    "After writing the story, also suggest three different possible directions for what the NEXT story in this series could do: short, one-sentence, cozy story hooks the reader could pick from. Make them distinct from each other and calm rather than cliffhangers - this is a bedtime series, not a thriller.",
    'Respond with ONLY a JSON object of the exact shape {"title": string, "story": string, "continuations": [string, string, string]} and nothing else - no markdown fences, no commentary.',
  ].join(" ");

  const user = [
    `World name: ${worldName}`,
    `World theme / description: ${theme}`,
    continuity,
    previous,
    direction,
    extra,
    previousStory ? "Write the next good night story in this series." : "Write one good night story set in this world.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

function parseContinuations(parsed: any): string[] {
  if (!Array.isArray(parsed?.continuations)) return [];
  return parsed.continuations
    .filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c: string) => c.trim())
    .slice(0, 3);
}

export async function generateStory(
  worldName: string,
  theme: string,
  note?: string,
  knownEntities: EntityLike[] = [],
  previousStory?: PreviousStoryLike,
  chosenContinuation?: string
): Promise<GeneratedStory> {
  const { system, user } = buildStoryPrompt(
    worldName,
    theme,
    note,
    knownEntities,
    previousStory,
    chosenContinuation
  );

  const raw = await chatComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.9
  );

  const parsed = extractJsonObject(raw);
  const continuations = parseContinuations(parsed);

  if (typeof parsed?.title === "string" && typeof parsed?.story === "string") {
    return { title: parsed.title.trim(), content: parsed.story.trim(), continuations };
  }

  // Fall back: use the raw text as the story body with a generic title.
  return {
    title: `A Good Night in ${worldName}`,
    content: raw.trim(),
    continuations,
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

function buildChatSystemPrompt(worldName: string, theme: string, entities: EntityWithId[]): string {
  const known = entities.length
    ? entities.map((e) => `- [${e.type} #${e.id}] ${e.name}: ${e.description}`).join("\n")
    : "(No locations, characters, or events recorded yet.)";

  return [
    "You are a collaborative world-building assistant helping curate a fictional world's memory of locations, characters (\"actors\"), and events for an ongoing bedtime story series.",
    "You chat naturally, but you never edit anything directly - instead you propose concrete actions that the user reviews and applies themselves.",
    "Propose actions when asked to clean things up (merge duplicates, drop stale or contradictory entries, tighten a vague description) or to steer a character (rewrite their description to reflect a requested personality, role, or relationship - it is reused verbatim as guidance for future stories, so write it as a short standalone fact, not a message to the user).",
    "Only reference the world's CURRENT known elements below by their exact id. Never invent an id, and never propose an action for an id that isn't listed.",
    "Only include actions when the user actually asked for a change or clearly agreed to one you suggested - answer plain questions or chit-chat with an empty actions array.",
    "",
    `World name: ${worldName}`,
    `World theme: ${theme}`,
    "Current world memory:",
    known,
    "",
    'Respond with ONLY a JSON object of the exact shape {"reply": string, "actions": Action[]} and nothing else - no markdown fences, no commentary.',
    "reply is a short, conversational message shown to the user - always include one, even if it's just acknowledging their question or explaining why you didn't propose anything.",
    "Each Action is one of:",
    '  {"kind": "create", "type": "location" | "actor" | "event", "name": string, "description": string, "reason": string}',
    '  {"kind": "update", "entity_id": number, "name"?: string, "description"?: string, "reason": string}',
    '  {"kind": "delete", "entity_id": number, "reason": string}',
    '  {"kind": "merge", "entity_ids": number[], "name": string, "description": string, "reason": string} - merges 2+ existing elements of the same type into one: the first id in entity_ids is kept and updated, the rest are removed',
    "reason is a short, one-sentence explanation of why you're proposing it, shown to the user alongside the action.",
  ].join("\n");
}

function parseChatActions(parsed: any, knownIds: Set<number>): ChatAction[] {
  if (!Array.isArray(parsed?.actions)) return [];
  const actions: ChatAction[] = [];

  for (const raw of parsed.actions) {
    if (!raw || typeof raw !== "object") continue;
    const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "";

    if (raw.kind === "create") {
      const type = raw.type;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      if (!["location", "actor", "event"].includes(type) || !name || !description) continue;
      actions.push({ kind: "create", type, name, description, reason });
    } else if (raw.kind === "update") {
      const entityId = Number(raw.entity_id);
      if (!knownIds.has(entityId)) continue;
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : undefined;
      const description =
        typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined;
      if (!name && !description) continue;
      actions.push({ kind: "update", entity_id: entityId, name, description, reason });
    } else if (raw.kind === "delete") {
      const entityId = Number(raw.entity_id);
      if (!knownIds.has(entityId)) continue;
      actions.push({ kind: "delete", entity_id: entityId, reason });
    } else if (raw.kind === "merge") {
      const entityIds = Array.isArray(raw.entity_ids)
        ? [...new Set(raw.entity_ids.map((id: unknown) => Number(id)).filter((id: number) => knownIds.has(id)))]
        : [];
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      if (entityIds.length < 2 || !name || !description) continue;
      actions.push({ kind: "merge", entity_ids: entityIds, name, description, reason });
    }
  }

  return actions;
}

/**
 * Chat with the model about a world's memory: it can answer questions and
 * propose actions (create/update/delete/merge) against the world's
 * locations, characters, and events - used both for cleanup suggestions
 * (merging duplicates, dropping stale entries) and for steering a
 * character's personality or role. Actions are only proposals; the caller
 * is responsible for applying whichever ones the user approves via the
 * existing entity endpoints.
 */
export async function chatAboutWorld(
  worldName: string,
  theme: string,
  entities: EntityWithId[],
  history: ChatMessage[],
  message: string
): Promise<ChatResult> {
  const system = buildChatSystemPrompt(worldName, theme, entities);
  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const raw = await chatComplete(messages, 0.6);
  const parsed = extractJsonObject(raw);
  const knownIds = new Set(entities.map((e) => e.id));
  const actions = parseChatActions(parsed, knownIds);
  const reply = typeof parsed?.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : raw.trim();

  return { reply, actions };
}
