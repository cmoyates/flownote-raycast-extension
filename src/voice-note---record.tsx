import { Action, ActionPanel, Detail, Icon, Toast, showToast } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { usePrefs } from "./lib/prefs";
import { startRecording, stopRecording } from "./lib/recording/ffmpeg";
import { FilePath, RecordingProcess } from "./lib/types";
import { cleanTranscript, transcribeAudio } from "./services/openai";
import { createNotionPageFromMarkdown } from "./services/notion";

export default function Command() {
  const { ffmpegPath, micDeviceIndex, openaiApiKey, notionToken, notionDatabaseId } = usePrefs();
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const procRef = useRef<RecordingProcess | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  useEffect(
    () => () => {
      try {
        const p = procRef.current as RecordingProcess | null;
        if (p) {
          try {
            p.stdin?.write("q");
            p.stdin?.end();
          } catch {
            // ignore
          }
          p.kill("SIGINT");
        }
      } catch {
        // ignore
      }
    },
    [],
  );

  const markdown = useMemo(() => {
    const secs = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
    const parts = [
      "# Voice Recorder",
      "",
      `**Status:** ${isRecording ? (isStopping ? "Stopping…" : `Recording… (${secs}s)`) : "Idle"}`,
      audioPath ? `\n**Last file:** \`${audioPath}\`` : "",
      log.length ? ["\n## Log", "```text", ...log.slice(-30), "```"].join("\n") : "",
      "\n_Tip: Use “List Input Devices” to find the correct index (e.g. :0, :1)._",
    ];
    return parts.filter(Boolean).join("\n");
  }, [isRecording, isStopping, startedAt, tick, log, audioPath]);

  const transcribeAudioFile = async (openaiApiKey: string) => {
    // Transcribe with OpenAI
    await showToast({ style: Toast.Style.Animated, title: "Transcribing audio…" });
    const transcriptionText = await transcribeAudio(audioPath as FilePath, openaiApiKey, {
      model: "gpt-4o-mini-transcribe", // or "whisper-1"
      language: "en",
      timeoutMs: 90000,
    });

    // Delete audio file after transcription
    try {
      if (audioPath) {
        await unlink(audioPath);
        setLog((l) => [...l, `Deleted audio file: ${audioPath}`]);
        setAudioPath(null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLog((l) => [...l, `Failed to delete audio file: ${msg}`]);
    }

    if (transcriptionText) {
      await showToast({ style: Toast.Style.Success, title: "Transcription complete", message: transcriptionText });
      setLog((l) => [...l, "Transcription:", transcriptionText]);

      return transcriptionText;
    } else {
      await showToast({ style: Toast.Style.Failure, title: "No transcription text received" });
      return null;
    }
  };

  const cleanTranscribedText = async (transcriptionText: string, openaiApiKey: string) => {
    await showToast({ style: Toast.Style.Animated, title: "Cleaning transcription…" });
    const cleanedMarkdown = await cleanTranscript({
      apiKey: openaiApiKey,
      text: transcriptionText,
      model: "gpt-4.1-mini",
      temperature: 0.2,
    });

    if (cleanedMarkdown) {
      await showToast({ style: Toast.Style.Success, title: "Cleaning complete", message: cleanedMarkdown });
      setLog((l) => [...l, "Cleaned Transcript:", cleanedMarkdown]);
      return cleanedMarkdown;
    } else {
      await showToast({ style: Toast.Style.Failure, title: "No cleaned text received" });
      return null;
    }
  };

  const createNotionPage = async (markdown: string, notionToken: string, notionDatabaseId: string) => {
    await showToast({ style: Toast.Style.Animated, title: "Creating Notion page…" });
    const result = await createNotionPageFromMarkdown({
      notionToken,
      databaseId: notionDatabaseId,
      markdown: markdown, // from your cleanup step
      explicitTitle: undefined, // or pass a title string if you have one
    });

    if (result?.pageId) {
      await showToast({
        style: Toast.Style.Success,
        title: "Notion page created",
        message: result.title,
      });
      setLog((l) => [...l, `Notion page created: ${result.title} (${result.pageId})`, result.url || ""]);
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Failed to create Notion page" });
      setLog((l) => [...l, "Failed to create Notion page."]);
    }
  };

  const onStart = async () => {
    if (isRecording || isStopping) return;
    try {
      const { child, wavPath } = startRecording({ ffmpegPath, device: micDeviceIndex });
      procRef.current = child;
      setAudioPath(wavPath);
      setIsRecording(true);
      setStartedAt(Date.now());
      setTick(0);

      const onOut = (d: Buffer) => {
        if (!isStopping) setLog((l) => [...l, d.toString().trim()]);
      };
      child.stdout.on("data", onOut);
      child.stderr.on("data", onOut);
      child.on("close", (code) => setLog((l) => [...l, `ffmpeg exited (code ${code})`]));

      await showToast({ style: Toast.Style.Animated, title: "Recording started" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setLog((l) => [...l, `Failed to start ffmpeg: ${e?.message || e}`]);
      await showToast({ style: Toast.Style.Failure, title: "Failed to start recording" });
    }
  };

  const onStop = async () => {
    const child = procRef.current as RecordingProcess | null;
    if (!isRecording || !child) return;

    setIsStopping(true);
    await showToast({ style: Toast.Style.Animated, title: "Stopping…" });

    try {
      await stopRecording(child);
    } catch {
      // ignore
    }
    procRef.current = null;
    setIsRecording(false);
    setIsStopping(false);
    setTick(0);

    await new Promise((r) => setTimeout(r, 200));
    if (!audioPath || !existsSync(audioPath) || statSync(audioPath).size === 0) {
      setLog((l) => [...l, "No audio file written. Check micDeviceIndex & permissions."]);
      await showToast({ style: Toast.Style.Failure, title: "No audio captured" });
      return;
    }
    await showToast({ style: Toast.Style.Success, title: "Recording saved" });

    if (!openaiApiKey?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "No OpenAI API key configured" });
      setLog((l) => [...l, "No OpenAI API key configured."]);
      return;
    }

    // Transcribe the audio
    const transcriptionText = await transcribeAudioFile(openaiApiKey);
    if (!transcriptionText) return;

    // Clean transcription
    const cleanedMarkdown = await cleanTranscribedText(transcriptionText, openaiApiKey);
    if (!cleanedMarkdown) return;

    if (!notionToken?.trim() || !notionDatabaseId?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "No Notion token or database ID configured" });
      setLog((l) => [...l, "No Notion token or database ID configured."]);
      return;
    }

    // Create the Notion page
    await createNotionPage(cleanedMarkdown, notionToken, notionDatabaseId);
  };

  const listDevices = async () => {
    const args = ["-f", "avfoundation", "-list_devices", "true", "-i", ""];
    setLog((l) => [...l, `$ ${ffmpegPath} ${args.join(" ")}`]);
    const { spawn } = await import("node:child_process");
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => setLog((l) => [...l, d.toString().trim()]));
    p.stderr.on("data", (d) => setLog((l) => [...l, d.toString().trim()]));
    p.on("close", () => showToast({ style: Toast.Style.Success, title: "Listed devices (see Log)" }));
  };

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          {!isRecording ? (
            <Action
              title="Start Recording"
              icon={Icon.Microphone}
              shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
              onAction={onStart}
            />
          ) : (
            <Action
              title="Stop Recording"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
              onAction={onStop}
            />
          )}
          <Action title="List Input Devices (Log)" icon={Icon.MagnifyingGlass} onAction={listDevices} />
        </ActionPanel>
      }
    />
  );
}
