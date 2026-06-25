import type { CommandType, Effect, Subtitle } from "@/types";

export type { CommandType };

export interface CommandResult {
  message: string;
  command: CommandType | null;
  effect?: Omit<Effect, "id">;
  subtitles?: Omit<Subtitle, "id">[];
  cut?: { start: number; end: number };
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
    case "cut": {
      const cutDur = Math.min(5, (duration || 10) / 4);
      const cutStart = Math.max(0, currentTime);
      const cutEnd = Math.min(cutStart + cutDur, duration || cutStart + cutDur);
      return {
        message: `Cut region added from ${fmt(cutStart)} to ${fmt(cutEnd)}. That section will be removed in the exported video.`,
        command: "cut",
        cut: { start: cutStart, end: cutEnd },
      };
    }

    case "subtitle": {
      return {
        message: `Please upload a video first — subtitles are generated from the video's audio using speech recognition (Whisper). Once a video is loaded, type "subtitle" again to start transcription.`,
        command: "subtitle",
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
