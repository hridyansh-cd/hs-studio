import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  X,
  Scissors,
  Type,
  Sparkles,
  ChevronLeft,
} from "lucide-react";
import type { Subtitle, Effect, TrimState } from "@/types";
import { cn } from "@/lib/utils";

const RULER_H = 22;
const TRACK_H = 34;

const EFFECT_TYPES: { type: Effect["type"]; label: string }[] = [
  { type: "zoom-in", label: "Zoom In" },
  { type: "zoom-out", label: "Zoom Out" },
  { type: "fade-in", label: "Fade In" },
  { type: "fade-out", label: "Fade Out" },
];

const EFFECT_STYLE: Record<string, string> = {
  "zoom-in": "bg-violet-500/25 border-violet-500/50 text-violet-300",
  "zoom-out": "bg-violet-400/25 border-violet-400/50 text-violet-200",
  "fade-in": "bg-amber-500/25 border-amber-500/50 text-amber-300",
  "fade-out": "bg-amber-400/25 border-amber-400/50 text-amber-200",
};

const EFFECT_PILL: Record<string, string> = {
  "zoom-in": "bg-violet-500/20 text-violet-300 border-violet-500/40",
  "zoom-out": "bg-violet-400/20 text-violet-200 border-violet-400/40",
  "fade-in": "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "fade-out": "bg-amber-400/20 text-amber-200 border-amber-400/40",
};

interface TimelineProps {
  duration: number;
  currentTime: number;
  subtitles: Subtitle[];
  effects: Effect[];
  trim: TrimState;
  zoom: number;
  onSeek: (t: number) => void;
  onTrimChange: (trim: TrimState) => void;
  onEffectDelete: (id: string) => void;
  onEffectUpdate: (effect: Effect) => void;
  onSubtitleClick: (sub: Subtitle) => void;
  onZoomChange: (z: number) => void;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function niceInterval(duration: number, targetTicks: number): number {
  const raw = duration / Math.max(1, targetTicks);
  const nice = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return nice.find((n) => n >= raw) ?? 600;
}

export function Timeline({
  duration,
  currentTime,
  subtitles,
  effects,
  trim,
  zoom,
  onSeek,
  onTrimChange,
  onEffectDelete,
  onEffectUpdate,
  onSubtitleClick,
  onZoomChange,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [showSubs, setShowSubs] = useState(true);
  const [showFx, setShowFx] = useState(true);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [containerW, setContainerW] = useState(800);

  // Measure container width for responsive zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const totalPx = containerW * zoom;

  const timeToX = useCallback(
    (t: number) => (duration ? (t / duration) * totalPx : 0),
    [duration, totalPx]
  );

  const clientXToTime = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || !duration) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      return Math.max(0, Math.min(duration, (x / totalPx) * duration));
    },
    [duration, totalPx]
  );

  // Trim handle dragging
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const t = clientXToTime(e.clientX);
      if (dragging === "start") {
        onTrimChange({ start: Math.min(t, trim.end - 0.25), end: trim.end });
      } else {
        onTrimChange({ start: trim.start, end: Math.max(t, trim.start + 0.25) });
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, clientXToTime, onTrimChange, trim]);

  // Deselect effect if it was deleted
  useEffect(() => {
    if (selectedEffectId && !effects.find((e) => e.id === selectedEffectId)) {
      setSelectedEffectId(null);
    }
  }, [effects, selectedEffectId]);

  const selectedEffect = useMemo(
    () => effects.find((e) => e.id === selectedEffectId) ?? null,
    [effects, selectedEffectId]
  );

  // Ruler ticks
  const ticks = useMemo(() => {
    if (!duration) return [];
    const approxCount = Math.floor(totalPx / 72);
    const interval = niceInterval(duration, approxCount);
    const arr: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += interval) {
      arr.push(Math.min(t, duration));
    }
    return arr;
  }, [duration, totalPx]);

  if (!duration) {
    return (
      <div className="border-t border-border bg-card/40 flex items-center justify-center text-xs text-muted-foreground/60 h-14">
        Upload a video to see the timeline
      </div>
    );
  }

  const trackCount = 1 + (showSubs ? 1 : 0) + (showFx ? 1 : 0);
  const totalH = RULER_H + trackCount * TRACK_H + 6;
  const playheadX = timeToX(currentTime);
  const trimStartX = timeToX(trim.start);
  const trimEndX = timeToX(trim.end > 0 ? trim.end : duration);

  return (
    <div className="border-t border-border bg-card/40 flex-shrink-0">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      {selectedEffect ? (
        /* Effect edit toolbar */
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-card/60">
          <button
            onClick={() => setSelectedEffectId(null)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
          <div className="w-px h-4 bg-border/60" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Effect Type
          </span>
          <div className="flex items-center gap-1 ml-1">
            {EFFECT_TYPES.map(({ type, label }) => (
              <button
                key={type}
                onClick={() =>
                  onEffectUpdate({ ...selectedEffect, type, label })
                }
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border font-medium transition-all",
                  selectedEffect.type === type
                    ? EFFECT_PILL[type]
                    : "border-border/50 text-muted-foreground/60 hover:text-foreground hover:border-border"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-muted-foreground/50">
            {formatTime(selectedEffect.start)} – {formatTime(selectedEffect.end)}
          </span>
          <button
            onClick={() => {
              onEffectDelete(selectedEffect.id);
              setSelectedEffectId(null);
            }}
            className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2 py-0.5 rounded-full transition-colors"
          >
            <X className="w-2.5 h-2.5" /> Delete
          </button>
        </div>
      ) : (
        /* Default toolbar */
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40">
          <Scissors className="w-3 h-3 text-muted-foreground/60" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mr-1">
            Timeline
          </span>
          <button
            onClick={() => onZoomChange(Math.max(1, zoom / 2))}
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-muted-foreground w-5 text-center">
            {zoom}×
          </span>
          <button
            onClick={() => onZoomChange(Math.min(16, zoom * 2))}
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowSubs((v) => !v)}
            className={cn(
              "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              showSubs
                ? "border-cyan-500/30 text-cyan-400 bg-cyan-500/10"
                : "border-border/50 text-muted-foreground/50"
            )}
            title="Toggle subtitle track"
          >
            {showSubs ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            <Type className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={() => setShowFx((v) => !v)}
            className={cn(
              "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              showFx
                ? "border-violet-500/30 text-violet-400 bg-violet-500/10"
                : "border-border/50 text-muted-foreground/50"
            )}
            title="Toggle effects track"
          >
            {showFx ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            <Sparkles className="w-2.5 h-2.5" />
          </button>
          <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}

      {/* ── Track area ────────────────────────────────────────────────────── */}
      <div className="flex" style={{ height: totalH }}>
        {/* Labels column */}
        <div className="w-12 shrink-0 flex flex-col border-r border-border/30 text-[9px] font-bold uppercase tracking-widest select-none">
          <div style={{ height: RULER_H }} className="border-b border-border/20" />
          <div
            style={{ height: TRACK_H }}
            className="flex items-center justify-center text-muted-foreground/60 border-b border-border/20"
          >
            VID
          </div>
          {showSubs && (
            <div
              style={{ height: TRACK_H }}
              className="flex items-center justify-center text-cyan-500/60 border-b border-border/20"
            >
              SUB
            </div>
          )}
          {showFx && (
            <div
              style={{ height: TRACK_H }}
              className="flex items-center justify-center text-violet-500/60"
            >
              FX
            </div>
          )}
        </div>

        {/* Scrollable tracks */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          style={{ cursor: dragging ? "ew-resize" : "default" }}
        >
          <div style={{ width: totalPx, minWidth: "100%", position: "relative" }}>
            {/* ── Ruler ─────────────────────────────────────────────────── */}
            <div
              style={{ height: RULER_H }}
              className="relative border-b border-border/30 bg-background/20 select-none"
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute bottom-0 flex flex-col items-center"
                  style={{ left: timeToX(t), transform: "translateX(-50%)" }}
                >
                  <span className="text-[8px] font-mono text-muted-foreground/50 mb-0.5 whitespace-nowrap">
                    {formatTime(t)}
                  </span>
                  <div className="w-px h-2 bg-border/50" />
                </div>
              ))}
            </div>

            {/* ── Video Track ───────────────────────────────────────────── */}
            <div
              style={{ height: TRACK_H }}
              className="relative border-b border-border/20 cursor-pointer"
              onClick={(e) => {
                if (dragging) return;
                setSelectedEffectId(null);
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
              }}
            >
              {/* Full clip bar */}
              <div className="absolute inset-y-2.5 left-0 right-0 bg-muted/20 rounded" />
              {/* Active/trimmed region */}
              <div
                className="absolute inset-y-2.5 bg-primary/20 border-y border-primary/40 rounded"
                style={{ left: trimStartX, width: Math.max(0, trimEndX - trimStartX) }}
              />
              {/* Trim start handle */}
              <div
                className="absolute top-1 bottom-1 w-4 flex items-center justify-center cursor-ew-resize z-10 group/h"
                style={{ left: trimStartX - 8 }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragging("start");
                }}
              >
                <div className="w-1 h-full rounded-full bg-primary opacity-70 group-hover/h:opacity-100 transition-opacity" />
              </div>
              {/* Trim end handle */}
              <div
                className="absolute top-1 bottom-1 w-4 flex items-center justify-center cursor-ew-resize z-10 group/h"
                style={{ left: trimEndX - 8 }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragging("end");
                }}
              >
                <div className="w-1 h-full rounded-full bg-primary opacity-70 group-hover/h:opacity-100 transition-opacity" />
              </div>
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-white/70 z-20 pointer-events-none"
                style={{ left: playheadX }}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white/80" />
              </div>
            </div>

            {/* ── Subtitle Track ────────────────────────────────────────── */}
            {showSubs && (
              <div
                style={{ height: TRACK_H }}
                className="relative border-b border-border/20 cursor-pointer"
                onClick={(e) => {
                  if (dragging) return;
                  setSelectedEffectId(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                  onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
                }}
              >
                <div className="absolute inset-y-2.5 left-0 right-0 bg-cyan-950/20 rounded" />
                {subtitles.map((sub) => {
                  const left = timeToX(sub.start);
                  const width = Math.max(timeToX(sub.end) - left, 24);
                  return (
                    <div
                      key={sub.id}
                      className="absolute inset-y-2 bg-cyan-500/20 border border-cyan-500/40 rounded text-[9px] text-cyan-300 flex items-center px-1 overflow-hidden cursor-pointer hover:bg-cyan-500/30 transition-colors"
                      style={{ left, width }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSubtitleClick(sub);
                      }}
                      title={sub.text}
                    >
                      <span className="truncate">{sub.text}</span>
                    </div>
                  );
                })}
                <div
                  className="absolute top-0 bottom-0 w-px bg-white/40 z-10 pointer-events-none"
                  style={{ left: playheadX }}
                />
              </div>
            )}

            {/* ── Effects Track ─────────────────────────────────────────── */}
            {showFx && (
              <div
                style={{ height: TRACK_H }}
                className="relative cursor-pointer"
                onClick={(e) => {
                  if (dragging) return;
                  setSelectedEffectId(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                  onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
                }}
              >
                <div className="absolute inset-y-2.5 left-0 right-0 bg-violet-950/20 rounded" />
                {effects.map((fx) => {
                  const left = timeToX(fx.start);
                  const width = Math.max(timeToX(fx.end) - left, 30);
                  const isSelected = fx.id === selectedEffectId;
                  return (
                    <div
                      key={fx.id}
                      className={cn(
                        "absolute inset-y-2 border rounded text-[9px] flex items-center gap-1 px-1.5 overflow-hidden cursor-pointer transition-all",
                        EFFECT_STYLE[fx.type] ??
                          "bg-muted/30 border-border text-muted-foreground",
                        isSelected && "ring-1 ring-white/40 brightness-125"
                      )}
                      style={{ left, width }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEffectId((prev) =>
                          prev === fx.id ? null : fx.id
                        );
                      }}
                      title={`${fx.label} — click to edit`}
                    >
                      <span className="truncate flex-1 font-medium select-none">
                        {fx.label}
                      </span>
                    </div>
                  );
                })}
                <div
                  className="absolute top-0 bottom-0 w-px bg-white/40 z-10 pointer-events-none"
                  style={{ left: playheadX }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
