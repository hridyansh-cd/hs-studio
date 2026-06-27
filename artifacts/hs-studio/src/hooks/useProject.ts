import { useState, useEffect, useCallback, useRef } from "react";
import type {
  Project,
  Subtitle,
  Effect,
  TrimState,
  ChatMessage,
} from "@/types";
import { saveProject, loadProject, DEFAULT_PROJECT } from "@/lib/project";

type HistoryEntry = Pick<Project, "cuts" | "effects" | "subtitles" | "trim">;

function getEditable(p: Project): HistoryEntry {
  return {
    cuts:      p.cuts ?? [],
    effects:   p.effects,
    subtitles: p.subtitles,
    trim:      p.trim,
  };
}

const MAX_HISTORY = 50;

/**
 * Central project state hook — owns all edit history, autosave, and
 * typed mutators so App.tsx only orchestrates UI, not data logic.
 */
export function useProject() {
  const [project, setProject] = useState<Project>(() => {
    const saved = loadProject();
    // Merge with defaults so newly-added fields (e.g. `name`) are never undefined
    return saved ? { ...DEFAULT_PROJECT, ...saved } : DEFAULT_PROJECT;
  });

  // Undo / redo stacks
  const [past,   setPast]   = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);

  // Ref so checkpoint() always reads the latest project without being a dep
  const projectRef = useRef(project);
  projectRef.current = project;

  // Debounced auto-save on every change
  useEffect(() => {
    const t = setTimeout(() => saveProject(project), 1000);
    return () => clearTimeout(t);
  }, [project]);

  // ── History ─────────────────────────────────────────────────────────────
  /** Call BEFORE applying any undoable edit. */
  const checkpoint = useCallback(() => {
    setPast((h) => [...h.slice(-(MAX_HISTORY - 1)), getEditable(projectRef.current)]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [getEditable(projectRef.current), ...f.slice(0, MAX_HISTORY - 1)]);
      setProject((p) => ({ ...p, ...prev }));
      return h.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((h) => [...h.slice(-(MAX_HISTORY - 1)), getEditable(projectRef.current)]);
      setProject((p) => ({ ...p, ...next }));
      return f.slice(1);
    });
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // ── General ─────────────────────────────────────────────────────────────
  const updateProject = useCallback((patch: Partial<Project>) => {
    setProject((p) => ({ ...p, ...patch }));
  }, []);

  // ── Subtitles ───────────────────────────────────────────────────────────
  const addSubtitles = useCallback((subs: Omit<Subtitle, "id">[]) => {
    setProject((p) => ({
      ...p,
      subtitles: [
        ...p.subtitles,
        ...subs.map((s) => ({ ...s, id: crypto.randomUUID() })),
      ],
    }));
  }, []);

  const updateSubtitle = useCallback((updated: Subtitle) => {
    setProject((p) => ({
      ...p,
      subtitles: p.subtitles.map((s) => (s.id === updated.id ? updated : s)),
    }));
  }, []);

  const deleteSubtitle = useCallback((id: string) => {
    setProject((p) => ({
      ...p,
      subtitles: p.subtitles.filter((s) => s.id !== id),
    }));
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────────
  const addEffect = useCallback((effect: Omit<Effect, "id">) => {
    setProject((p) => ({
      ...p,
      effects: [...p.effects, { ...effect, id: crypto.randomUUID() }],
    }));
  }, []);

  const updateEffect = useCallback((updated: Effect) => {
    setProject((p) => ({
      ...p,
      effects: p.effects.map((e) => (e.id === updated.id ? updated : e)),
    }));
  }, []);

  const deleteEffect = useCallback((id: string) => {
    setProject((p) => ({
      ...p,
      effects: p.effects.filter((e) => e.id !== id),
    }));
  }, []);

  // ── Messages ────────────────────────────────────────────────────────────
  const addMessage = useCallback((msg: ChatMessage) => {
    setProject((p) => ({ ...p, messages: [...p.messages, msg] }));
  }, []);

  const spendCredits = useCallback((amount: number) => {
    setProject((p) => ({
      ...p,
      credits: Math.max(0, p.credits - amount),
    }));
  }, []);

  // ── Timeline ────────────────────────────────────────────────────────────
  const setTrim = useCallback((trim: TrimState) => updateProject({ trim }), [updateProject]);
  const setZoom = useCallback(
    (timelineZoom: number) => updateProject({ timelineZoom }),
    [updateProject]
  );

  // ── Persistence ─────────────────────────────────────────────────────────
  const manualSave = useCallback(() => {
    setProject((p) => {
      const saved = { ...p, savedAt: Date.now() };
      saveProject(saved);
      return saved;
    });
  }, []);

  const loadSaved = useCallback((): boolean => {
    const p = loadProject();
    if (p) {
      setProject({ ...DEFAULT_PROJECT, ...p });
      return true;
    }
    return false;
  }, []);

  return {
    project,
    setProject,
    updateProject,
    addSubtitles,
    updateSubtitle,
    deleteSubtitle,
    addEffect,
    updateEffect,
    deleteEffect,
    addMessage,
    spendCredits,
    setTrim,
    setZoom,
    manualSave,
    loadSaved,
    checkpoint,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
