// Type-only imports keep runtime bundles minimal.
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** Branded string types to avoid mixing file & dir paths with arbitrary strings. */
export type FilePath = string & { readonly __brand: "FilePath" };
export type DirPath = string & { readonly __brand: "DirPath" };

/** Preferences shared across modules. Add more as you grow (Notion, etc.). */
export type Prefs = {
  ffmpegPath?: string; // e.g. "/opt/homebrew/bin/ffmpeg"
  micDeviceIndex?: string; // e.g. ":0" or ":1"
  openaiApiKey?: string;
  notionToken?: string;
  notionDatabaseId?: string;
};

/** Narrow type for the recording child process shape we use. */
export type RecordingProcess = ChildProcessByStdio<Writable, Readable, Readable>;

/** Small Result helper for async ops (optional, but handy). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
