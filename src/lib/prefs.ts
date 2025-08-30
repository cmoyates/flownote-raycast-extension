import { getPreferenceValues } from "@raycast/api";
import { Prefs } from "./types";

export function usePrefs(): Required<Pick<Prefs, "ffmpegPath" | "micDeviceIndex">> & Prefs {
  const p = getPreferenceValues<Prefs>();
  return {
    ffmpegPath: (p.ffmpegPath || "ffmpeg").trim(),
    micDeviceIndex: (p.micDeviceIndex || ":1").trim(),
    openaiApiKey: p.openaiApiKey?.trim(),
    notionToken: p.notionToken?.trim(),
    notionDatabaseId: p.notionDatabaseId?.trim(),
  };
}
