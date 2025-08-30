import type { FilePath } from "../lib/types";
import { promises as fsp } from "node:fs";

export async function transcribeAudio(
  filePath: FilePath,
  apiKey: string,
  opts?: {
    model?: string;
    temperature?: number;
    prompt?: string;
    language?: string; // e.g., "en"
    response_format?: "json" | "text" | "verbose_json" | "srt" | "vtt";
    timeoutMs?: number;
  },
): Promise<string> {
  const model = (opts?.model ?? "gpt-4o-mini-transcribe").trim(); // fallback to "whisper-1" if needed
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 90_000);

  try {
    // Read file -> wrap as a File so FormData accepts it (Node fetch/undici expects Blob/File)
    const buf = await fsp.readFile(filePath);
    // global File/Blob are available in modern Node
    const file = new File([buf], "audio.wav", { type: "audio/wav" });

    const form = new FormData();
    form.append("file", file); // MUST be Blob/File for undici FormData
    form.append("model", model); // required by OpenAI
    if (opts?.temperature != null) form.append("temperature", String(opts.temperature));
    if (opts?.prompt) form.append("prompt", opts.prompt);
    if (opts?.language) form.append("language", opts.language);
    if (opts?.response_format) form.append("response_format", opts.response_format);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI transcription failed: ${res.status} ${errText}`);
    }
    const data = (await res.json()) as { text?: string };
    if (!data?.text) throw new Error("No text in transcription response");
    return data.text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Utility: quick capability probe to choose a default model at runtime.
 * Calls a super-light HEAD request to see if credentials look valid.
 * (Not required; you can skip this and just read from preferences.)
 */
export async function checkOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Clean up a raw transcript:
 * - remove fillers (um, uh, like...), stutters, false starts
 * - fix obvious punctuation/casing
 * - DO NOT add, invent, or reorder meaningfully
 */
export async function cleanTranscript(params: {
  apiKey: string;
  text: string;
  model?: string; // default: "gpt-4.1-mini"
  temperature?: number; // default: 0.2
  timeoutMs?: number; // default: 60s
}): Promise<string> {
  const { apiKey, text, model = "gpt-4.1-mini", temperature = 0.2, timeoutMs = 60_000 } = params;

  if (!apiKey) throw new Error("Missing OpenAI API key");
  if (!text?.trim()) return "";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      temperature,
      messages: [
        {
          role: "system",
          content: `
                You are a helpful assistant that cleans up transcriptions. 
                Please remove any unnecessary filler words, pauses, or repetitions from the transcription. 
                Your response should be in markdown format with an H1 at the top acting as the title of the transcription.
                The title should be concise and relevant to the content of the transcription.
                The content should be clear and easy to read, maintaining the original meaning while improving clarity.
            `,
        },
        { role: "user", content: `Please clean up the following transcription: ${text}` },
      ],
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Cleanup failed: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return data.choices?.[0]?.message?.content?.trim() ?? text;
  } finally {
    clearTimeout(t);
  }
}
