import { useState, useEffect, useCallback } from "react";
import type {
  Project,
  Subtitle,
  Effect,
  TrimState,
  ChatMessage,
} from "@/types";
import { saveProject, loadProject, DEFAULT_PROJECT } from "@/lib/project";

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

  // Debounced auto-save on every change
  useEffect(() => {
    const t = setTimeout(() => saveProject(project), 1000);
    return () => clearTimeout(t);
  }, [project]);

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
  };
}
