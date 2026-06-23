export type CommandType = 'cut' | 'subtitle' | 'zoom';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  command?: CommandType;
  createdAt: Date;
}

export interface TimelineEvent {
  id: string;
  type: CommandType;
  label: string;
  timestamp: number;
  color: string;
}

export interface Subtitle {
  id: string;
  text: string;
}

export interface CommandResult {
  message: string;
  command: CommandType | null;
  timelineEvent?: Omit<TimelineEvent, 'id'>;
  subtitles?: Subtitle[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function detectCommand(input: string): CommandType | null {
  const lower = input.toLowerCase().trim();
  if (lower.includes('cut')) return 'cut';
  if (lower.includes('subtitle') || lower.includes('sub')) return 'subtitle';
  if (lower.includes('zoom')) return 'zoom';
  return null;
}

const COMMAND_RESPONSES: Record<CommandType, (ts: number) => CommandResult> = {
  cut: (ts) => ({
    message: `Video cut applied at ${formatTime(ts)}. The clip has been trimmed cleanly at this point.`,
    command: 'cut',
    timelineEvent: {
      type: 'cut',
      label: 'Video cut applied',
      timestamp: ts,
      color: '#ef4444',
    },
  }),
  subtitle: (ts) => ({
    message: `Subtitles generated at ${formatTime(ts)}. Two caption blocks have been overlaid on the video.`,
    command: 'subtitle',
    timelineEvent: {
      type: 'subtitle',
      label: 'Subtitles generated',
      timestamp: ts,
      color: '#06b6d4',
    },
    subtitles: [
      { id: crypto.randomUUID(), text: 'Hello World 🔥' },
      { id: crypto.randomUUID(), text: 'AI Editing 😎' },
    ],
  }),
  zoom: (ts) => ({
    message: `Zoom effect added at ${formatTime(ts)}. A smooth zoom-in transition has been applied to the clip.`,
    command: 'zoom',
    timelineEvent: {
      type: 'zoom',
      label: 'Zoom effect added',
      timestamp: ts,
      color: '#8b5cf6',
    },
  }),
};

export function processCommand(input: string, timestamp: number): CommandResult {
  const cmd = detectCommand(input);
  if (!cmd) {
    return {
      message: 'Command not recognized. Try: cut, subtitle, or zoom.',
      command: null,
    };
  }
  return COMMAND_RESPONSES[cmd](timestamp);
}

export const COMMAND_COLORS: Record<CommandType, string> = {
  cut: 'bg-red-500/10 text-red-400 border-red-500/20',
  subtitle: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  zoom: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
};
