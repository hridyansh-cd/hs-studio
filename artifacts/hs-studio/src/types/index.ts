export type CommandType = 'cut' | 'subtitle' | 'zoom';

export interface Subtitle {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface Effect {
  id: string;
  type: 'zoom-in' | 'zoom-out' | 'fade-in' | 'fade-out';
  label: string;
  start: number;
  end: number;
}

export interface Suggestion {
  title: string;
  description: string;
  command: 'cut' | 'zoom' | null;
  cut?: { start: number; end: number };
  effect?: { type: string; label: string; start: number; end: number };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  command?: CommandType;
  suggestions?: Suggestion[];
  createdAt: string;
}

export interface TrimState {
  start: number;
  end: number;
}

export interface Cut {
  start: number;
  end: number;
}

export interface VideoMetadata {
  name: string;
  sizeBytes: number;
  type: string;
  width: number;
  height: number;
  duration: number;
  frameRate?: number;
}

export interface Project {
  name: string;
  subtitles: Subtitle[];
  effects: Effect[];
  trim: TrimState;
  cuts: Cut[];
  messages: ChatMessage[];
  credits: number;
  timelineZoom: number;
  savedAt: number;
}
