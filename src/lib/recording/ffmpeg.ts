import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordingProcess } from "../types";

export type StartOpts = {
  ffmpegPath: string; // absolute or "ffmpeg"
  device: string; // e.g. ":0" or ":1"
  sampleRate?: number; // default 16000
  channels?: 1 | 2; // default 1
};

export type Started = {
  child: RecordingProcess;
  wavPath: string;
};

export function startRecording({ ffmpegPath, device, sampleRate = 16000, channels = 1 }: StartOpts): Started {
  const dir = mkdtempSync(join(tmpdir(), "raycast-voice-"));
  const wavPath = join(dir, "note.wav");

  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "avfoundation",
    "-i",
    device,
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
    "-c:a",
    "pcm_s16le",
    wavPath,
  ];

  const child = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] }) as RecordingProcess;
  return { child, wavPath };
}

export async function stopRecording(proc: RecordingProcess, timeouts = { q: 700, sigint: 1100 }): Promise<void> {
  // 1) Graceful quit via 'q' on stdin
  try {
    proc.stdin.write("q");
    proc.stdin.end();
  } catch {
    // ignore
  }

  const closed = new Promise<boolean>((resolve) => proc.once("close", () => resolve(true)));
  let done = await Promise.race([closed, delay(timeouts.q)]);

  if (!done) {
    try {
      proc.kill("SIGINT");
    } catch {
      // ignore
    }
  }
  done = done || (await Promise.race([closed, delay(timeouts.sigint)]));

  if (!done) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    await delay(200);
  }
}

function delay(ms: number) {
  return new Promise<boolean>((r) => setTimeout(() => r(false), ms));
}
