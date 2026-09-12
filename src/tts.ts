const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

// Voices are provider-namespaced (an OpenAI voice name won't work on a
// Voxtral or Kokoro model), so the default model and voice below must be
// changed together. See .env.example for how to discover current options.
const DEFAULT_TTS_MODEL = "mistralai/voxtral-mini-tts-2603";
const DEFAULT_TTS_VOICE = "en_paul_neutral";
const AUDIO_FORMAT = "mp3";

export interface GeneratedNarration {
  data: string; // base64-encoded audio
  format: string;
}

/**
 * Turns story text into spoken-word audio via OpenRouter's dedicated
 * text-to-speech endpoint (POST /api/v1/audio/speech), instead of relying on
 * whatever text-to-speech voices happen to be installed on the listener's
 * device.
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

  const response = await fetch(OPENROUTER_SPEECH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost",
      "X-Title": "World Building Good Night Stories",
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: AUDIO_FORMAT,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    if (response.status === 404 || /no endpoints/i.test(errText) || /not found/i.test(errText)) {
      throw new Error(
        `OpenRouter has no active narrator model/voice for "${model}" (voice "${voice}"). ` +
          `Browse current text-to-speech models and their supported voices at ` +
          `https://openrouter.ai/api/v1/models?output_modalities=speech and set ` +
          `OPENROUTER_TTS_MODEL / OPENROUTER_TTS_VOICE in your .env.`
      );
    }
    throw new Error(
      `OpenRouter narration request failed (${response.status}): ${errText || response.statusText}`
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("OpenRouter returned no audio for the narration.");
  }

  return { data: Buffer.from(buffer).toString("base64"), format: AUDIO_FORMAT };
}
