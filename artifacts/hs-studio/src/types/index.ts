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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  command?: CommandType;
  createdAt: string;
}

export interface TrimState {
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
}

export interface Project {
  name: string;
  subtitles: Subtitle[];
  effects: Effect[];
  trim: TrimState;
  messages: ChatMessage[];
  credits: number;
  timelineZoom: number;
  savedAt: number;
}
