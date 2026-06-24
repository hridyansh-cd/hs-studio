import type { CommandType, Effect, Subtitle } from "@/types";

export type { CommandType };

export interface CommandResult {
  message: string;
  command: CommandType | null;
  effect?: Omit<Effect, "id">;
  subtitles?: Omit<Subtitle, "id">[];
  trimMarker?: number;
}

export function detectCommand(input: string): CommandType | null {
  const lower = input.toLowerCase().trim();
  if (lower.includes("cut")) return "cut";
  if (lower.includes("subtitle") || lower.includes("sub")) return "subtitle";
  if (lower.includes("zoom")) return "zoom";
  return null;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
}

export function processCommand(
  input: string,
  currentTime: number,
  duration: number
): CommandResult {
  const cmd = detectCommand(input);

  if (!cmd) {
    return {
      message:
        "Command not recognized. Available commands:\n• cut — add a trim marker\n• subtitle — generate subtitle segments\n• zoom — add a zoom effect",
      command: null,
    };
  }

  switch (cmd) {
    case "cut":
      return {
        message: `Trim marker added at ${fmt(currentTime)}. Drag the handles on the Video track to adjust the clip range.`,
        command: "cut",
        trimMarker: currentTime,
      };

    case "subtitle": {
      const segDuration = Math.min(3, duration / 4 || 3);
      const start1 = Math.max(0, currentTime);
      const end1 = Math.min(duration || 999, start1 + segDuration);
      const start2 = end1;
      const end2 = Math.min(duration || 999, start2 + segDuration);
      return {
        message: `Subtitle segments created at ${fmt(start1)}–${fmt(end1)} and ${fmt(start2)}–${fmt(end2)}. Click the Subtitles tab in the chat panel to edit the text. Speech-to-text transcription coming in Phase 2.`,
        command: "subtitle",
        subtitles: [
          { text: "Edit this subtitle", start: start1, end: end1 },
          { text: "Add your caption here", start: start2, end: end2 },
        ],
      };
    }

    case "zoom": {
      const effectDuration = Math.min(4, (duration || 10) / 3);
      return {
        message: `Zoom-in effect added from ${fmt(currentTime)} to ${fmt(currentTime + effectDuration)}. Visible on the FX track in the timeline.`,
        command: "zoom",
        effect: {
          type: "zoom-in",
          label: "Zoom In",
          start: currentTime,
          end: Math.min(duration || 999, currentTime + effectDuration),
        },
      };
    }
  }
}

export const COMMAND_COLORS: Record<CommandType, string> = {
  cut: "bg-red-500/10 text-red-400 border-red-500/20",
  subtitle: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  zoom: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};
