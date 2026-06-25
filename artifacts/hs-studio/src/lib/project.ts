import type { Project } from "@/types";

const PROJECT_KEY = "hs-studio-project";

export const DEFAULT_PROJECT: Project = {
  name: "My Project",
  subtitles: [],
  effects: [],
  trim: { start: 0, end: 0 },
  cuts: [],
  messages: [],
  credits: 50,
  timelineZoom: 1,
  savedAt: 0,
};

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(
      PROJECT_KEY,
      JSON.stringify({ ...project, savedAt: Date.now() })
    );
  } catch {
    // quota exceeded or private mode
  }
}

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    // Validate shape minimally
    if (!Array.isArray(parsed.subtitles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearProject(): void {
  localStorage.removeItem(PROJECT_KEY);
}
