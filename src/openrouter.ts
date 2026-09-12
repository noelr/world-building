const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export interface GeneratedStory {
  title: string;
  content: string;
}

function buildPrompt(worldName: string, theme: string, note: string | undefined) {
  const extra = note?.trim()
    ? `The reader also asked for this specifically: "${note.trim()}".`
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
    extra,
    "Write one good night story set in this world.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

function extractJson(raw: string): { title?: string; story?: string } | null {
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

export async function generateStory(
  worldName: string,
  theme: string,
  note?: string
): Promise<GeneratedStory> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const { system, user } = buildPrompt(worldName, theme, note);

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost",
      "X-Title": "World Building Good Night Stories",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.9,
    }),
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

  const parsed = extractJson(raw);
  if (parsed?.title && parsed?.story) {
    return { title: parsed.title.trim(), content: parsed.story.trim() };
  }

  // Fall back: use the raw text as the story body with a generic title.
  return {
    title: `A Good Night in ${worldName}`,
    content: raw.trim(),
  };
}
