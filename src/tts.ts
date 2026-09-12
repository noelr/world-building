const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TTS_MODEL = "openai/gpt-4o-mini-audio-preview";
const DEFAULT_TTS_VOICE = "alloy";
const AUDIO_FORMAT = "mp3";

export interface GeneratedNarration {
  data: string; // base64-encoded audio
  format: string;
}

/**
 * Turns story text into spoken-word audio via an OpenRouter audio-output model,
 * instead of relying on whatever text-to-speech voices happen to be installed
 * on the listener's device.
 */
export async function generateNarration(
  title: string,
  content: string
): Promise<GeneratedNarration> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }

  const model = process.env.OPENROUTER_TTS_MODEL || DEFAULT_TTS_MODEL;
  const voice = process.env.OPENROUTER_TTS_VOICE || DEFAULT_TTS_VOICE;
  const text = `${title}.\n\n${content}`;

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
      modalities: ["text", "audio"],
      audio: { voice, format: AUDIO_FORMAT },
      messages: [
        {
          role: "system",
          content:
            "Read the user's message aloud exactly as written, in a warm, slow, calming bedtime-story narrator voice. Do not add commentary, do not summarize or paraphrase - just narrate the text as given.",
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    if (response.status === 404 && /no endpoints/i.test(errText)) {
      throw new Error(
        `OpenRouter has no active endpoints for narration model "${model}". It may have been ` +
          `retired - pick a current audio-output model at https://openrouter.ai/models and set ` +
          `OPENROUTER_TTS_MODEL in your .env.`
      );
    }
    throw new Error(
      `OpenRouter narration request failed (${response.status}): ${errText || response.statusText}`
    );
  }

  const data = await response.json();
  const audio = data?.choices?.[0]?.message?.audio;
  if (!audio?.data) {
    throw new Error("OpenRouter returned no audio for the narration.");
  }

  return { data: audio.data, format: AUDIO_FORMAT };
}
