import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import type { DirPath, FilePath } from "./types";

/**
 * Returns a new temp directory under the OS temp root, namespaced by prefix.
 * Example result: /var/folders/.../T/raycast-voice-abc123/
 */
export function makeTempDir(prefix = "raycast-voice-"): DirPath {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir as DirPath; // brand as DirPath
}

/** Create a timestamped WAV filename inside a directory. */
export function wavIn(dir: DirPath, stem = "note"): FilePath {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `${stem}-${ts}.wav`) as FilePath;
}

/** Convenience for showing just the file name in logs/UI. */
export function fileName(p: FilePath): string {
  return basename(p);
}
