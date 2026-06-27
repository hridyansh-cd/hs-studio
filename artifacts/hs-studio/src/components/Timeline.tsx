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
  Volume2,
} from "lucide-react";
import type { Subtitle, Effect, TrimState, Cut } from "@/types";
import { cn } from "@/lib/utils";

const RULER_H = 22;
const TRACK_H = 34;

const EFFECT_TYPES: { type: Effect["type"]; label: string }[] = [
  { type: "zoom-in",   label: "Zoom In"   },
  { type: "zoom-out",  label: "Zoom Out"  },
  { type: "fade-in",   label: "Fade In"   },
  { type: "fade-out",  label: "Fade Out"  },
];

const EFFECT_STYLE: Record<string, string> = {
  "zoom-in":  "bg-violet-500/25 border-violet-500/50 text-violet-300",
  "zoom-out": "bg-violet-400/25 border-violet-400/50 text-violet-200",
  "fade-in":  "bg-amber-500/25 border-amber-500/50 text-amber-300",
  "fade-out": "bg-amber-400/25 border-amber-400/50 text-amber-200",
};

const EFFECT_PILL: Record<string, string> = {
  "zoom-in":  "bg-violet-500/20 text-violet-300 border-violet-500/40",
  "zoom-out": "bg-violet-400/20 text-violet-200 border-violet-400/40",
  "fade-in":  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "fade-out": "bg-amber-400/20 text-amber-200 border-amber-400/40",
};

interface SegDrag {
  id: string;
  type: "sub" | "fx";
  initStart: number;
  initEnd: number;
  initX: number;
  moved: boolean;
}

interface TimelineProps {
  duration: number;
  currentTime: number;
  subtitles: Subtitle[];
  effects: Effect[];
  cuts: Cut[];
  trim: TrimState;
  zoom: number;
  waveformBars?: number[];
  waveformLoading?: boolean;
  onSeek: (t: number) => void;
  onTrimChange: (trim: TrimState) => void;
  onEffectDelete: (id: string) => void;
  onEffectUpdate: (effect: Effect) => void;
  onSubtitleClick: (sub: Subtitle) => void;
  onZoomChange: (z: number) => void;
  onSubtitleMove?: (id: string, newStart: number, newEnd: number) => void;
  onEffectMove?: (id: string, newStart: number, newEnd: number) => void;
  onCutDelete?: (index: number) => void;
  onCheckpoint?: () => void;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function niceInterval(duration: number, targetTicks: number): number {
  const raw  = duration / Math.max(1, targetTicks);
  const nice = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return nice.find((n) => n >= raw) ?? 600;
}

export function Timeline({
  duration,
  currentTime,
  subtitles,
  effects,
  cuts,
  trim,
  zoom,
  waveformBars = [],
  waveformLoading = false,
  onSeek,
  onTrimChange,
  onEffectDelete,
  onEffectUpdate,
  onSubtitleClick,
  onZoomChange,
  onSubtitleMove,
  onEffectMove,
  onCutDelete,
  onCheckpoint,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [trimDrag, setTrimDrag] = useState<"start" | "end" | null>(null);
  const [segDrag,  setSegDrag]  = useState<SegDrag | null>(null);
  const [showSubs, setShowSubs] = useState(true);
  const [showFx,   setShowFx]   = useState(true);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [containerW, setContainerW] = useState(800);
  const [hoveredCutIdx, setHoveredCutIdx] = useState<number | null>(null);

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

  // ── Trim handle dragging ─────────────────────────────────────────────────
  useEffect(() => {
    if (!trimDrag) return;
    const getX = (e: MouseEvent | TouchEvent) =>
      "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) e.preventDefault();
      const t = clientXToTime(getX(e));
      if (trimDrag === "start") {
        onTrimChange({ start: Math.min(t, trim.end - 0.25), end: trim.end });
      } else {
        onTrimChange({ start: trim.start, end: Math.max(t, trim.start + 0.25) });
      }
    };
    const onUp = () => setTrimDrag(null);
    window.addEventListener("mousemove", onMove as EventListener);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchmove", onMove as EventListener, { passive: false });
    window.addEventListener("touchend",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove as EventListener);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("touchend",  onUp);
    };
  }, [trimDrag, clientXToTime, onTrimChange, trim]);

  // ── Segment drag (subtitle / FX) ─────────────────────────────────────────
  useEffect(() => {
    if (!segDrag) return;
    const segLen = segDrag.initEnd - segDrag.initStart;
    const getX = (e: MouseEvent | TouchEvent) =>
      "touches" in e ? (e.touches[0]?.clientX ?? segDrag.initX) : e.clientX;

    const onMove = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) e.preventDefault();
      const dx = getX(e) - segDrag.initX;
      if (Math.abs(dx) > 3) {
        const dt       = (dx / totalPx) * duration;
        const newStart = Math.max(0, Math.min(duration - segLen, segDrag.initStart + dt));
        const newEnd   = newStart + segLen;
        if (!segDrag.moved) setSegDrag((s) => s && { ...s, moved: true });
        if (segDrag.type === "sub") onSubtitleMove?.(segDrag.id, newStart, newEnd);
        else                        onEffectMove?.(segDrag.id, newStart, newEnd);
      }
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!("touches" in e)) (e as MouseEvent).stopPropagation();
      setSegDrag(null);
    };

    window.addEventListener("mousemove", onMove as EventListener);
    window.addEventListener("mouseup",   onUp as EventListener, true);
    window.addEventListener("touchmove", onMove as EventListener, { passive: false });
    window.addEventListener("touchend",  onUp as EventListener);
    return () => {
      window.removeEventListener("mousemove", onMove as EventListener);
      window.removeEventListener("mouseup",   onUp as EventListener, true);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("touchend",  onUp as EventListener);
    };
  }, [segDrag, totalPx, duration, onSubtitleMove, onEffectMove]);

  // Deselect effect if deleted
  useEffect(() => {
    if (selectedEffectId && !effects.find((e) => e.id === selectedEffectId)) {
      setSelectedEffectId(null);
    }
  }, [effects, selectedEffectId]);

  const selectedEffect = useMemo(
    () => effects.find((e) => e.id === selectedEffectId) ?? null,
    [effects, selectedEffectId]
  );

  const ticks = useMemo(() => {
    if (!duration) return [];
    const approxCount = Math.floor(totalPx / 72);
    const interval    = niceInterval(duration, approxCount);
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

  const trackCount = 2 + (showSubs ? 1 : 0) + (showFx ? 1 : 0);
  const totalH     = RULER_H + trackCount * TRACK_H + 6;
  const playheadX  = timeToX(currentTime);
  const trimStartX = timeToX(trim.start);
  const trimEndX   = timeToX(trim.end > 0 ? trim.end : duration);

  return (
    <div className="border-t border-border bg-card/40 flex-shrink-0">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {selectedEffect ? (
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
                onClick={() => onEffectUpdate({ ...selectedEffect, type, label })}
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
            onClick={() => { onEffectDelete(selectedEffect.id); setSelectedEffectId(null); }}
            className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2 py-0.5 rounded-full transition-colors"
          >
            <X className="w-2.5 h-2.5" /> Delete
          </button>
        </div>
      ) : (
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
          {cuts.length > 0 && (
            <>
              <div className="w-px h-4 bg-border/40 mx-0.5" />
              <span className="text-[10px] text-red-400/70 font-medium">
                {cuts.length} cut{cuts.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
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

      {/* ── Track area ──────────────────────────────────────────────────── */}
      <div className="flex" style={{ height: totalH }}>
        {/* Labels column */}
        <div className="w-12 shrink-0 flex flex-col border-r border-border/30 text-[9px] font-bold uppercase tracking-widest select-none">
          <div style={{ height: RULER_H }} className="border-b border-border/20" />
          <div style={{ height: TRACK_H }} className="flex items-center justify-center text-muted-foreground/60 border-b border-border/20">
            VID
          </div>
          <div style={{ height: TRACK_H }} className="flex items-center justify-center text-emerald-500/60 border-b border-border/20">
            <Volume2 className="w-2.5 h-2.5" />
          </div>
          {showSubs && (
            <div style={{ height: TRACK_H }} className="flex items-center justify-center text-cyan-500/60 border-b border-border/20">
              SUB
            </div>
          )}
          {showFx && (
            <div style={{ height: TRACK_H }} className="flex items-center justify-center text-violet-500/60">
              FX
            </div>
          )}
        </div>

        {/* Scrollable tracks */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          style={{ cursor: trimDrag ? "ew-resize" : segDrag ? "grabbing" : "default" }}
        >
          <div style={{ width: totalPx, minWidth: "100%", position: "relative" }}>

            {/* ── Ruler ─────────────────────────────────────────────── */}
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

            {/* ── Video Track ───────────────────────────────────────── */}
            <div
              style={{ height: TRACK_H }}
              className="relative border-b border-border/20 cursor-pointer"
              onClick={(e) => {
                if (trimDrag || segDrag) return;
                setSelectedEffectId(null);
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
              }}
            >
              {/* Base track background */}
              <div className="absolute inset-y-2.5 left-0 right-0 bg-muted/20 rounded" />

              {/* Trim region highlight */}
              <div
                className="absolute inset-y-2.5 bg-primary/20 border-y border-primary/40 rounded"
                style={{ left: trimStartX, width: Math.max(0, trimEndX - trimStartX) }}
              />

              {/* ── Cut regions — rendered as red hatched overlays ── */}
              {cuts.map((cut, idx) => {
                const left  = timeToX(cut.start);
                const width = Math.max(timeToX(cut.end) - left, 4);
                const isHovered = hoveredCutIdx === idx;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "absolute inset-y-1 z-10 rounded transition-all group/cut",
                      isHovered
                        ? "bg-red-500/50 border border-red-400/80"
                        : "bg-red-500/30 border border-red-500/50"
                    )}
                    style={{ left, width }}
                    title={`Cut: ${formatTime(cut.start)} – ${formatTime(cut.end)}\nClick × to remove`}
                    onMouseEnter={(e) => { e.stopPropagation(); setHoveredCutIdx(idx); }}
                    onMouseLeave={() => setHoveredCutIdx(null)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Diagonal stripe pattern */}
                    <div
                      className="absolute inset-0 rounded overflow-hidden opacity-40"
                      style={{
                        backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(239,68,68,0.4) 3px, rgba(239,68,68,0.4) 5px)",
                      }}
                    />
                    {/* Delete button — shows on hover */}
                    {isHovered && onCutDelete && width > 14 && (
                      <button
                        className="absolute inset-0 flex items-center justify-center z-20"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCutDelete(idx);
                          setHoveredCutIdx(null);
                        }}
                        title="Remove cut"
                      >
                        <X className="w-3 h-3 text-red-200 drop-shadow" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Trim start handle */}
              <div
                className="absolute top-1 bottom-1 w-4 flex items-center justify-center cursor-ew-resize z-20 group/h"
                style={{ left: trimStartX - 8 }}
                onMouseDown={(e) => { e.stopPropagation(); onCheckpoint?.(); setTrimDrag("start"); }}
                onTouchStart={(e) => { e.stopPropagation(); onCheckpoint?.(); setTrimDrag("start"); }}
              >
                <div className="w-1 h-full rounded-full bg-primary opacity-70 group-hover/h:opacity-100 transition-opacity" />
              </div>
              {/* Trim end handle */}
              <div
                className="absolute top-1 bottom-1 w-4 flex items-center justify-center cursor-ew-resize z-20 group/h"
                style={{ left: trimEndX - 8 }}
                onMouseDown={(e) => { e.stopPropagation(); onCheckpoint?.(); setTrimDrag("end"); }}
                onTouchStart={(e) => { e.stopPropagation(); onCheckpoint?.(); setTrimDrag("end"); }}
              >
                <div className="w-1 h-full rounded-full bg-primary opacity-70 group-hover/h:opacity-100 transition-opacity" />
              </div>
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-white/70 z-30 pointer-events-none"
                style={{ left: playheadX }}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white/80" />
              </div>
            </div>

            {/* ── Audio Track ───────────────────────────────────────── */}
            <div
              style={{ height: TRACK_H }}
              className="relative border-b border-border/20 cursor-pointer overflow-hidden"
              onClick={(e) => {
                if (trimDrag || segDrag) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
              }}
            >
              <div className="absolute inset-y-1 left-0 right-0 rounded overflow-hidden bg-emerald-950/20">
                {waveformLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[8px] text-emerald-500/50 animate-pulse tracking-widest uppercase">
                      Analyzing…
                    </span>
                  </div>
                )}
                {waveformBars.length > 0 && (
                  <svg
                    className="absolute inset-0 w-full h-full"
                    preserveAspectRatio="none"
                    viewBox={`0 0 ${waveformBars.length} 100`}
                  >
                    {waveformBars.map((amp, i) => {
                      const barH = Math.max(1, amp * 90);
                      const y = (100 - barH) / 2;
                      return (
                        <rect
                          key={i}
                          x={i + 0.1}
                          y={y}
                          width={0.8}
                          height={barH}
                          fill={`rgba(34,197,94,${0.25 + amp * 0.55})`}
                          rx={0.3}
                        />
                      );
                    })}
                  </svg>
                )}
                {!waveformLoading && waveformBars.length === 0 && (
                  <div
                    className="absolute inset-0 opacity-30"
                    style={{
                      background:
                        "repeating-linear-gradient(90deg, " +
                        "rgba(34,197,94,0.08) 0px, rgba(34,197,94,0.22) 2px, " +
                        "rgba(34,197,94,0.04) 4px, rgba(34,197,94,0.18) 7px, " +
                        "rgba(34,197,94,0.06) 9px, rgba(34,197,94,0.14) 11px, " +
                        "rgba(34,197,94,0.10) 14px)",
                      maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,1) 70%, transparent 100%)",
                      WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,1) 70%, transparent 100%)",
                    }}
                  />
                )}
                <div
                  className="absolute top-0 bottom-0 w-px bg-emerald-400/60 z-10 pointer-events-none"
                  style={{ left: playheadX }}
                />
              </div>
            </div>

            {/* ── Subtitle Track ────────────────────────────────────── */}
            {showSubs && (
              <div
                style={{ height: TRACK_H }}
                className="relative border-b border-border/20 cursor-pointer"
                onClick={(e) => {
                  if (trimDrag || segDrag?.moved) return;
                  setSelectedEffectId(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                  onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
                }}
              >
                <div className="absolute inset-y-2.5 left-0 right-0 bg-cyan-950/20 rounded" />
                {subtitles.map((sub) => {
                  const left  = timeToX(sub.start);
                  const width = Math.max(timeToX(sub.end) - left, 24);
                  return (
                    <div
                      key={sub.id}
                      className="absolute inset-y-2 bg-cyan-500/20 border border-cyan-500/40 rounded text-[9px] text-cyan-300 flex items-center px-1 overflow-hidden cursor-grab active:cursor-grabbing hover:bg-cyan-500/30 transition-colors select-none"
                      style={{ left, width }}
                      title={`${sub.text} — drag to move`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onCheckpoint?.();
                        setSegDrag({ id: sub.id, type: "sub", initStart: sub.start, initEnd: sub.end, initX: e.clientX, moved: false });
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        onCheckpoint?.();
                        const touch = e.touches[0];
                        setSegDrag({ id: sub.id, type: "sub", initStart: sub.start, initEnd: sub.end, initX: touch.clientX, moved: false });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!segDrag?.moved) onSubtitleClick(sub);
                      }}
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

            {/* ── Effects Track ─────────────────────────────────────── */}
            {showFx && (
              <div
                style={{ height: TRACK_H }}
                className="relative cursor-pointer"
                onClick={(e) => {
                  if (trimDrag || segDrag?.moved) return;
                  setSelectedEffectId(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
                  onSeek(Math.max(0, Math.min(duration, (x / totalPx) * duration)));
                }}
              >
                <div className="absolute inset-y-2.5 left-0 right-0 bg-violet-950/20 rounded" />
                {effects.map((fx) => {
                  const left      = timeToX(fx.start);
                  const width     = Math.max(timeToX(fx.end) - left, 30);
                  const isSelected = fx.id === selectedEffectId;
                  return (
                    <div
                      key={fx.id}
                      className={cn(
                        "absolute inset-y-2 border rounded text-[9px] flex items-center gap-1 px-1.5 overflow-hidden cursor-grab active:cursor-grabbing transition-all select-none",
                        EFFECT_STYLE[fx.type] ?? "bg-muted/30 border-border text-muted-foreground",
                        isSelected && "ring-1 ring-white/40 brightness-125"
                      )}
                      style={{ left, width }}
                      title={`${fx.label} — drag to move, click to edit`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onCheckpoint?.();
                        setSegDrag({ id: fx.id, type: "fx", initStart: fx.start, initEnd: fx.end, initX: e.clientX, moved: false });
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        onCheckpoint?.();
                        const touch = e.touches[0];
                        setSegDrag({ id: fx.id, type: "fx", initStart: fx.start, initEnd: fx.end, initX: touch.clientX, moved: false });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!segDrag?.moved) {
                          setSelectedEffectId((prev) => prev === fx.id ? null : fx.id);
                        }
                      }}
                    >
                      <span className="truncate flex-1 font-medium">{fx.label}</span>
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
