import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
} from "react";
import {
  UploadCloud,
  Video,
  Play,
  Pause,
  Download,
  Send,
  CheckCircle,
  Sparkles,
  SkipBack,
  SkipForward,
  Save,
  FolderOpen,
  Scissors,
  Type,
  ZoomIn as ZoomInIcon,
  X,
  ChevronDown,
  Pencil,
  Check,
  Plus,
  Clock,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Timeline } from "@/components/Timeline";
import { processCommand, COMMAND_COLORS } from "@/lib/commands";
import { useProject } from "@/hooks/useProject";
import { useEffectPreview } from "@/hooks/useEffectPreview";
import { useAudioWaveform } from "@/hooks/useAudioWaveform";
import type {
  Subtitle,
  Effect,
  TrimState,
  ChatMessage,
  VideoMetadata,
  CommandType,
  Cut,
} from "@/types";

const CREDIT_COST = 5;
const EXPORT_RESOLUTIONS = ["720p", "1080p", "4K"] as const;
type Resolution = (typeof EXPORT_RESOLUTIONS)[number];

// ─── Subtitle file generators ───────────────────────────────────────────────────

function fmtSrtTime(s: number): string {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function fmtVttTime(s: number): string {
  return fmtSrtTime(s).replace(",", ".");
}

function generateSrt(subs: Subtitle[]): string {
  return subs
    .filter((s) => s.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${s.text.trim()}\n`)
    .join("\n");
}

function generateVtt(subs: Subtitle[]): string {
  const body = subs
    .filter((s) => s.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${fmtVttTime(s.start)} --> ${fmtVttTime(s.end)}\n${s.text.trim()}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

const Toast = memo(
  ({ message, onDone }: { message: string; onDone: () => void }) => {
    useEffect(() => {
      const t = setTimeout(onDone, 3200);
      return () => clearTimeout(t);
    }, [onDone]);
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-2xl rounded-xl px-5 py-3 text-sm font-medium">
        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>{message}</span>
      </div>
    );
  }
);

// ─── Subtitle overlay ──────────────────────────────────────────────────────────

const SubtitleOverlay = memo(
  ({
    subtitles,
    currentTime,
  }: {
    subtitles: Subtitle[];
    currentTime: number;
  }) => {
    const active = subtitles.find(
      (s) => currentTime >= s.start && currentTime <= s.end
    );
    if (!active) return null;
    return (
      <div className="absolute bottom-6 inset-x-0 flex justify-center pointer-events-none px-4">
        <div className="bg-black/75 backdrop-blur-sm text-white text-lg font-bold px-6 py-2.5 rounded-2xl shadow-2xl border border-white/10 max-w-[80%] text-center leading-tight">
          {active.text}
        </div>
      </div>
    );
  }
);

// ─── Editable project name ─────────────────────────────────────────────────────

const EditableProjectName = memo(
  ({ name, onChange }: { name: string; onChange: (n: string) => void }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const commit = () => {
      const trimmed = draft.trim();
      onChange(trimmed || name);
      setEditing(false);
    };
    return editing ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="flex-1 min-w-0 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[11px] text-foreground outline-none"
      />
    ) : (
      <button
        onClick={() => { setDraft(name); setEditing(true); }}
        className="flex items-center gap-1.5 group flex-1 min-w-0 text-left"
        title="Click to rename project"
      >
        <span className="text-[11px] text-muted-foreground truncate">{name}</span>
        <Pencil className="w-2.5 h-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 transition-colors shrink-0" />
      </button>
    );
  }
);

// ─── Left Panel ────────────────────────────────────────────────────────────────

function LeftPanel({
  projectName,
  videoUrl,
  metadata,
  credits,
  onFileSelect,
  onExport,
  isExporting,
  burnSubs,
  onBurnSubsChange,
  exportProgress,
  exportPhaseLabel,
  isVideoLoading,
  onSave,
  onLoad,
  onProjectNameChange,
  lastSaved,
}: {
  projectName: string;
  videoUrl: string | null;
  metadata: VideoMetadata | null;
  credits: number;
  onFileSelect: (file: File) => void;
  onExport: (res: Resolution) => void;
  isExporting: boolean;
  burnSubs: boolean;
  onBurnSubsChange: (v: boolean) => void;
  exportProgress: number | null;
  exportPhaseLabel: string;
  isVideoLoading: boolean;
  onSave: () => void;
  onLoad: () => void;
  onProjectNameChange: (name: string) => void;
  lastSaved: number;
}) {
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [showResMenu, setShowResMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  };

  const formatBytes = (b: number) =>
    b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)} KB`
      : `${(b / 1024 / 1024).toFixed(1)} MB`;

  const formatAspect = (w: number, h: number) => {
    if (!w || !h) return "—";
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h);
    return `${w / d}:${h / d}`;
  };

  const pct = Math.min(100, (credits / 50) * 100);
  const barCls =
    credits <= 5 ? "bg-red-500" : credits <= 20 ? "bg-yellow-500" : "bg-primary";
  const crCls =
    credits <= 5
      ? "bg-red-500/10 text-red-400"
      : credits <= 20
      ? "bg-yellow-500/10 text-yellow-400"
      : "bg-primary/10 text-primary";

  return (
    <aside className="w-[256px] shrink-0 h-full flex flex-col border-r border-border bg-card/80">
      {/* Logo */}
      <div className="px-4 py-3.5 border-b border-border flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <Video className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-base tracking-tight">HS Studio</span>
      </div>

      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
        {/* Upload */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Upload Video
          </p>
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-2.5 cursor-pointer transition-all text-center",
              videoUrl
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:border-primary/30 hover:bg-muted/20"
            )}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileSelect(f);
              }}
            />
            <div
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center",
                videoUrl ? "bg-primary/20" : "bg-muted/40"
              )}
            >
              <UploadCloud
                className={cn(
                  "w-4.5 h-4.5",
                  videoUrl ? "text-primary" : "text-muted-foreground"
                )}
              />
            </div>
            {isVideoLoading ? (
              <p className="text-xs font-semibold text-muted-foreground animate-pulse">Loading video…</p>
            ) : videoUrl ? (
              <p className="text-xs font-semibold text-primary">Video loaded ✓</p>
            ) : (
              <>
                <p className="text-xs font-semibold">Drag & drop or click</p>
                <p className="text-[10px] text-muted-foreground">MP4 · MOV · WebM · AVI · MKV</p>
              </>
            )}
          </div>
        </section>

        {/* Video metadata */}
        {metadata && (
          <section className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Video Info
            </p>
            <div className="bg-muted/20 rounded-lg p-3 space-y-1.5 text-[11px]">
              {(
                [
                  [
                    "Name",
                    metadata.name.length > 22
                      ? metadata.name.slice(0, 20) + "…"
                      : metadata.name,
                  ],
                  [
                    "Duration",
                    `${Math.floor(metadata.duration / 60)}:${String(
                      Math.floor(metadata.duration % 60)
                    ).padStart(2, "0")}`,
                  ],
                  ["Resolution", `${metadata.width}×${metadata.height}`],
                  ["Frame Rate", metadata.frameRate ? `${metadata.frameRate} fps` : "—"],
                  ["Aspect", formatAspect(metadata.width, metadata.height)],
                  ["Size", formatBytes(metadata.sizeBytes)],
                  [
                    "Format",
                    metadata.type.replace("video/", "").toUpperCase() || "—",
                  ],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono text-foreground/90 text-right truncate">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Export */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Export
          </p>
          <div className="relative">
            <button
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border text-xs font-medium hover:border-primary/30 transition-colors"
              onClick={() => setShowResMenu((v) => !v)}
            >
              <span>{resolution}</span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-muted-foreground transition-transform",
                  showResMenu && "rotate-180"
                )}
              />
            </button>
            {showResMenu && (
              <div className="absolute top-full mt-1 inset-x-0 bg-card border border-border rounded-lg shadow-xl z-20 overflow-hidden">
                {EXPORT_RESOLUTIONS.map((r) => (
                  <button
                    key={r}
                    className={cn(
                      "w-full px-3 py-2 text-xs text-left hover:bg-muted/40 transition-colors",
                      r === resolution && "text-primary font-semibold bg-primary/5"
                    )}
                    onClick={() => {
                      setResolution(r);
                      setShowResMenu(false);
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Burn subtitles toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={burnSubs}
              onChange={(e) => onBurnSubsChange(e.target.checked)}
              className="w-3 h-3 accent-primary"
            />
            <span className="text-[10px] text-muted-foreground">Burn subtitles into video</span>
          </label>

          <Button
            className="w-full gap-2 text-xs h-8"
            disabled={!videoUrl || isExporting}
            onClick={() => onExport(resolution)}
          >
            {isExporting ? (
              <>
                <div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {exportProgress != null ? `${exportPhaseLabel} ${exportProgress}%` : exportPhaseLabel}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" /> Export {resolution}
              </>
            )}
          </Button>

          {/* Export progress bar */}
          {isExporting && exportProgress != null && (
            <div className="space-y-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground/60 text-center">
                FFmpeg rendering · {exportProgress}% complete
              </p>
            </div>
          )}
        </section>

        {/* Project */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Project
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs gap-1.5 h-8"
              onClick={onSave}
            >
              <Save className="w-3.5 h-3.5" /> Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs gap-1.5 h-8"
              onClick={onLoad}
            >
              <FolderOpen className="w-3.5 h-3.5" /> Load
            </Button>
          </div>
          {lastSaved > 0 && (
            <p className="text-[10px] text-muted-foreground/60 text-center">
              Auto-saved {new Date(lastSaved).toLocaleTimeString()}
            </p>
          )}
        </section>
      </div>

      {/* Credits */}
      <div className="p-3 border-t border-border">
        <div className="bg-muted/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <EditableProjectName
              name={projectName}
              onChange={onProjectNameChange}
            />
            <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded-md shrink-0", crCls)}>
              {credits} CR
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>AI Credits</span>
              <span>{credits}/50</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", barCls)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Center Panel ──────────────────────────────────────────────────────────────

function CenterPanel({
  videoUrl,
  currentTime,
  duration,
  subtitles,
  effects,
  cuts,
  trim,
  zoom,
  effectPreviewStyle,
  waveformBars,
  waveformLoading,
  onTimeUpdate,
  onDurationLoad,
  onSeek,
  onTrimChange,
  onEffectDelete,
  onEffectUpdate,
  onSubtitleClick,
  onZoomChange,
  onSubtitleMove,
  onEffectMove,
  onCutDelete,
  videoRef,
}: {
  videoUrl: string | null;
  currentTime: number;
  duration: number;
  subtitles: Subtitle[];
  effects: Effect[];
  cuts: Cut[];
  trim: TrimState;
  zoom: number;
  effectPreviewStyle: { transform: string; opacity: number };
  onTimeUpdate: (t: number) => void;
  onDurationLoad: (d: number) => void;
  onSeek: (t: number) => void;
  onTrimChange: (t: TrimState) => void;
  onEffectDelete: (id: string) => void;
  onEffectUpdate: (effect: Effect) => void;
  onSubtitleClick: (s: Subtitle) => void;
  onZoomChange: (z: number) => void;
  onSubtitleMove?: (id: string, s: number, e: number) => void;
  onEffectMove?: (id: string, s: number, e: number) => void;
  onCutDelete?: (index: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  waveformBars?: number[];
  waveformLoading?: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying, videoRef]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(duration, t));
      if (videoRef.current) videoRef.current.currentTime = clamped;
      onSeek(clamped);
    },
    [duration, onSeek, videoRef]
  );

  const fmt = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <main className="flex-1 h-full flex flex-col bg-background min-w-0">
      {/* Video area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-black/20">
        {videoUrl ? (
          <div
            className="relative max-w-full max-h-full"
            style={{
              transform: effectPreviewStyle.transform,
              opacity: effectPreviewStyle.opacity,
              transition: "transform 0.06s linear, opacity 0.06s linear",
              willChange: "transform, opacity",
            }}
          >
            <video
              ref={videoRef as React.RefObject<HTMLVideoElement>}
              src={videoUrl}
              className="max-w-full max-h-full object-contain rounded shadow-2xl block"
              style={{ maxHeight: "calc(100vh - 280px)" }}
              onTimeUpdate={() => {
                if (videoRef.current) onTimeUpdate(videoRef.current.currentTime);
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) onDurationLoad(videoRef.current.duration);
              }}
              onEnded={() => setIsPlaying(false)}
              onClick={togglePlay}
            />
            <SubtitleOverlay subtitles={subtitles} currentTime={currentTime} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-muted-foreground select-none">
            <div className="w-20 h-20 rounded-2xl bg-muted/20 border border-border/40 flex items-center justify-center">
              <Video className="w-9 h-9 opacity-30" />
            </div>
            <p className="text-sm font-medium opacity-60">
              Drop a video to begin editing
            </p>
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="border-t border-border/60 bg-card/40 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => seek(currentTime - 5)}
          disabled={!videoUrl}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
          title="Skip back 5s"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={togglePlay}
          disabled={!videoUrl}
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
            videoUrl
              ? "bg-primary hover:bg-primary/90 text-primary-foreground"
              : "bg-muted/30 text-muted-foreground cursor-not-allowed"
          )}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 translate-x-px" />
          )}
        </button>
        <button
          onClick={() => seek(currentTime + 5)}
          disabled={!videoUrl}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
          title="Skip forward 5s"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Scrubber */}
        <div className="relative flex-1 h-4 flex items-center">
          <div className="absolute inset-x-0 h-1.5 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full"
              style={{
                width: `${duration ? (currentTime / duration) * 100 : 0}%`,
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.05}
            value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            disabled={!videoUrl}
            className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
          />
        </div>

        <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      {/* Multi-track timeline */}
      <Timeline
        duration={duration}
        currentTime={currentTime}
        subtitles={subtitles}
        effects={effects}
        cuts={cuts}
        trim={trim}
        zoom={zoom}
        waveformBars={waveformBars}
        waveformLoading={waveformLoading}
        onSeek={seek}
        onTrimChange={onTrimChange}
        onEffectDelete={onEffectDelete}
        onEffectUpdate={onEffectUpdate}
        onSubtitleClick={onSubtitleClick}
        onZoomChange={onZoomChange}
        onSubtitleMove={onSubtitleMove}
        onEffectMove={onEffectMove}
        onCutDelete={onCutDelete}
      />
    </main>
  );
}

// ─── Subtitle editor row ───────────────────────────────────────────────────────

function parseTimeInput(val: string): number | null {
  const trimmed = val.trim();
  // Accept formats: "1:23", "1:23.4", "83", "83.4"
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})(\.\d+)?$/);
  if (colonMatch) {
    const m = parseInt(colonMatch[1], 10);
    const s = parseFloat(colonMatch[2] + (colonMatch[3] ?? ""));
    return m * 60 + s;
  }
  const plain = parseFloat(trimmed);
  if (!isNaN(plain) && plain >= 0) return plain;
  return null;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

const SubtitleRow = memo(
  ({
    sub,
    onUpdate,
    onDelete,
    onSeek,
  }: {
    sub: Subtitle;
    onUpdate: (s: Subtitle) => void;
    onDelete: (id: string) => void;
    onSeek?: (t: number) => void;
  }) => {
    const [mode, setMode] = useState<"view" | "editText" | "editTime">("view");
    const [text, setText] = useState(sub.text);
    const [startVal, setStartVal] = useState(fmtTime(sub.start));
    const [endVal, setEndVal] = useState(fmtTime(sub.end));

    const commitText = () => {
      onUpdate({ ...sub, text: text.trim() || sub.text });
      setMode("view");
    };

    const commitTime = () => {
      const s = parseTimeInput(startVal);
      const e = parseTimeInput(endVal);
      if (s !== null && e !== null && e > s) {
        onUpdate({ ...sub, start: s, end: e });
      } else {
        setStartVal(fmtTime(sub.start));
        setEndVal(fmtTime(sub.end));
      }
      setMode("view");
    };

    return (
      <div className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-muted/20 transition-colors">
        {/* Time stamp row */}
        <div className="flex items-center gap-1">
          {mode === "editTime" ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                autoFocus
                value={startVal}
                onChange={(e) => setStartVal(e.target.value)}
                onBlur={commitTime}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTime();
                  if (e.key === "Escape") { setStartVal(fmtTime(sub.start)); setEndVal(fmtTime(sub.end)); setMode("view"); }
                  if (e.key === "Tab") { e.preventDefault(); (e.currentTarget.nextElementSibling?.nextElementSibling as HTMLInputElement)?.focus(); }
                }}
                className="w-16 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground outline-none"
                title="Start time (m:ss)"
              />
              <span className="text-[9px] text-muted-foreground/50">→</span>
              <input
                value={endVal}
                onChange={(e) => setEndVal(e.target.value)}
                onBlur={commitTime}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTime();
                  if (e.key === "Escape") { setStartVal(fmtTime(sub.start)); setEndVal(fmtTime(sub.end)); setMode("view"); }
                }}
                className="w-16 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground outline-none"
                title="End time (m:ss)"
              />
              <button onClick={commitTime} className="text-emerald-400 hover:text-emerald-300 p-0.5 ml-1">
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              className="text-[9px] font-mono text-muted-foreground/60 hover:text-primary/70 transition-colors flex items-center gap-0.5"
              onClick={() => { setStartVal(fmtTime(sub.start)); setEndVal(fmtTime(sub.end)); setMode("editTime"); }}
              title="Edit timing"
            >
              <Clock className="w-2.5 h-2.5" />
              {fmtTime(sub.start)}–{fmtTime(sub.end)}
            </button>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {mode === "editText" ? (
              <button onClick={commitText} className="text-emerald-400 hover:text-emerald-300 p-0.5">
                <Check className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => { setText(sub.text); setMode("editText"); }}
                className="text-muted-foreground hover:text-foreground p-0.5"
                title="Edit text"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => onSeek?.(sub.start)}
              className="text-muted-foreground hover:text-primary p-0.5"
              title="Seek to subtitle"
            >
              <Play className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDelete(sub.id)}
              className="text-muted-foreground hover:text-red-400 p-0.5"
              title="Delete subtitle"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Text row */}
        <div className="pl-0.5">
          {mode === "editText" ? (
            <textarea
              autoFocus
              value={text}
              rows={2}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                if (e.key === "Escape") { setText(sub.text); setMode("view"); }
              }}
              className="w-full bg-background border border-primary/40 rounded px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/40 resize-none"
            />
          ) : (
            <p
              className="text-xs text-foreground/90 leading-relaxed break-words cursor-text"
              onDoubleClick={() => { setText(sub.text); setMode("editText"); }}
              title="Double-click to edit"
            >
              {sub.text}
            </p>
          )}
        </div>
      </div>
    );
  }
);

// ─── Right Panel ───────────────────────────────────────────────────────────────

function RightPanel({
  credits,
  messages,
  isSending,
  subtitles,
  currentTime,
  duration,
  onSend,
  onSubtitleUpdate,
  onSubtitleDelete,
  onSubtitleAdd,
  onSeek,
  onDownloadSrt,
  onDownloadVtt,
}: {
  credits: number;
  messages: ChatMessage[];
  isSending: boolean;
  subtitles: Subtitle[];
  currentTime: number;
  duration: number;
  onSend: (text: string) => void;
  onSubtitleUpdate: (s: Subtitle) => void;
  onSubtitleDelete: (id: string) => void;
  onSubtitleAdd: (sub: Omit<Subtitle, "id">) => void;
  onSeek: (t: number) => void;
  onDownloadSrt: () => void;
  onDownloadVtt: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "subtitles">("chat");

  useEffect(() => {
    if (tab === "chat" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending, tab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || isSending || credits <= 0) return;
    onSend(t);
    setInput("");
  };

  const hints: { cmd: CommandType; icon: React.ReactNode; label: string }[] = [
    { cmd: "cut", icon: <Scissors className="w-3 h-3" />, label: "cut" },
    { cmd: "subtitle", icon: <Type className="w-3 h-3" />, label: "subtitle" },
    { cmd: "zoom", icon: <ZoomInIcon className="w-3 h-3" />, label: "zoom" },
  ];

  return (
    <aside className="w-[288px] shrink-0 h-full flex flex-col border-l border-border bg-card/80">
      {/* Header + Tabs */}
      <div className="border-b border-border">
        <div className="px-4 py-3 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-semibold text-sm">AI Assistant</span>
        </div>
        <div className="flex border-t border-border/40">
          {(["chat", "subtitles"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 text-[11px] font-semibold py-2 capitalize transition-colors",
                tab === t
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "subtitles" ? `Subtitles (${subtitles.length})` : "Chat"}
            </button>
          ))}
        </div>
      </div>

      {tab === "chat" ? (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary/50" />
                </div>
                <p className="text-xs text-muted-foreground/70">
                  Ask AI to edit your video
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {hints.map(({ cmd, icon, label }) => (
                    <button
                      key={cmd}
                      onClick={() => setInput(label)}
                      className={cn(
                        "flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all hover:scale-105",
                        COMMAND_COLORS[cmd]
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted/50 text-foreground rounded-bl-sm border border-border/50"
                )}
              >
                {msg.role === "assistant" && msg.command && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border mb-1.5 self-start",
                      COMMAND_COLORS[msg.command]
                    )}
                  >
                    {msg.command === "cut" && <Scissors className="w-2.5 h-2.5" />}
                    {msg.command === "subtitle" && <Type className="w-2.5 h-2.5" />}
                    {msg.command === "zoom" && <ZoomInIcon className="w-2.5 h-2.5" />}
                    {msg.command.toUpperCase()}
                  </span>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            ))}
            {isSending && (
              <div className="bg-muted/50 border border-border/50 rounded-2xl rounded-bl-sm px-3.5 py-2.5 max-w-[90%] flex items-center gap-1.5">
                {[0, 0.15, 0.3].map((d, i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
                    style={{ animationDelay: `${d}s` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border space-y-2">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  credits <= 0 ? "No credits remaining" : "Ask AI to edit…"
                }
                disabled={isSending || credits <= 0}
                className="flex-1 h-9 text-xs bg-background/80"
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!input.trim() || isSending || credits <= 0}
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </form>
            <div className="flex items-center justify-between px-0.5">
              {credits <= 0 ? (
                <p className="text-[10px] text-red-400 font-medium">
                  Out of credits
                </p>
              ) : (
                <div className="flex gap-1 flex-wrap">
                  {hints.map(({ cmd, icon, label }) => (
                    <button
                      key={cmd}
                      onClick={() => setInput(label)}
                      className={cn(
                        "flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border hover:scale-105 transition-all",
                        COMMAND_COLORS[cmd]
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <span
                className={cn(
                  "text-[10px] font-mono shrink-0 ml-1",
                  credits <= 5 ? "text-red-400" : "text-muted-foreground"
                )}
              >
                {credits} CR
              </span>
            </div>
          </div>
        </>
      ) : (
        /* Subtitle Editor Tab */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {subtitles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
                <Type className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground/60">
                  No subtitles yet. Use the <strong>subtitle</strong> command in
                  chat to generate them, or add one manually below.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {subtitles.map((sub) => (
                  <SubtitleRow
                    key={sub.id}
                    sub={sub}
                    onUpdate={onSubtitleUpdate}
                    onDelete={onSubtitleDelete}
                    onSeek={onSeek}
                  />
                ))}
              </div>
            )}
          </div>
          {/* SRT / VTT download buttons */}
          <div className="px-2 pt-2 flex gap-1.5 shrink-0">
            <button
              onClick={onDownloadSrt}
              disabled={subtitles.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border/60 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText className="w-3 h-3" /> SRT
            </button>
            <button
              onClick={onDownloadVtt}
              disabled={subtitles.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border/60 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText className="w-3 h-3" /> VTT
            </button>
          </div>

          {/* Add subtitle button */}
          <div className="p-2 border-t border-border/40 shrink-0">
            <button
              onClick={() => {
                const start = Math.max(0, currentTime);
                const end = Math.min(start + 3, duration || start + 3);
                onSubtitleAdd({ text: "New subtitle", start, end });
              }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Add subtitle at {(() => { const m = Math.floor(currentTime/60); const s = Math.floor(currentTime%60); return `${m}:${s.toString().padStart(2,"0")}`; })()}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

// ─── App (no external dependencies required) ───────────────────────────────────

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    project,
    setProject,
    updateProject,
    updateEffect,
    deleteEffect,
    updateSubtitle,
    deleteSubtitle,
    setTrim,
    setZoom,
    manualSave,
    loadSaved,
  } = useProject();

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const { bars: waveformBars, loading: waveformLoading } = useAudioWaveform(videoFile);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportPhaseLabel, setExportPhaseLabel] = useState("Exporting…");
  const [burnSubs, setBurnSubs] = useState(true);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const effectPreviewStyle = useEffectPreview(project.effects, currentTime);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoFile(file);
      setCurrentTime(0);
      setDuration(0);
      setIsVideoLoading(true);
      setMetadata({
        name: file.name,
        sizeBytes: file.size,
        type: file.type,
        width: 0,
        height: 0,
        duration: 0,
      });
    },
    [videoUrl]
  );

  const handleDurationLoad = useCallback(
    (d: number) => {
      setIsVideoLoading(false);
      setDuration(d);
      if (videoRef.current) {
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        setMetadata((m) => (m ? { ...m, width: w, height: h, duration: d } : null));
      }
      setTrim({ start: 0, end: d });
    },
    [setTrim]
  );

  const handleSend = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      setProject((p) => ({ ...p, messages: [...p.messages, userMsg] }));
      setIsSending(true);

      const result = processCommand(text, currentTime, duration);

      // Subtitle command with no video — guide the user
      if (result.command === "subtitle" && !videoFile) {
        const noVideoMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Please upload a video first — subtitles are generated from the video's audio using Whisper speech recognition.",
          command: "subtitle",
          createdAt: new Date().toISOString(),
        };
        setProject((p) => ({ ...p, messages: [...p.messages, noVideoMsg] }));
        setIsSending(false);
        return;
      }

      // Real transcription via Whisper — only when video file is loaded
      if (result.command === "subtitle" && videoFile) {
        const pendingId = crypto.randomUUID();
        const pendingMsg: ChatMessage = {
          id: pendingId,
          role: "assistant",
          content: "Transcribing audio… this may take a moment.",
          command: "subtitle",
          createdAt: new Date().toISOString(),
        };
        setProject((p) => ({ ...p, messages: [...p.messages, pendingMsg] }));

        try {
          const form = new FormData();
          form.append("video", videoFile);

          // XHR upload so we can show progress while the file uploads
          const xhrResult = await new Promise<{ ok: boolean; json: unknown }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/editor/transcribe");
            xhr.responseType = "text";
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                setProject((p) => ({
                  ...p,
                  messages: p.messages.map((m) =>
                    m.id === pendingId
                      ? { ...m, content: pct < 100 ? `Uploading video… ${pct}%` : "Transcribing audio… this may take a moment." }
                      : m
                  ),
                }));
              }
            };
            xhr.onload = () => {
              const json = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
              resolve({ ok: xhr.status >= 200 && xhr.status < 300, json });
            };
            xhr.onerror = () => reject(new Error("Network error during upload"));
            xhr.send(form);
          });

          if (!xhrResult.ok) {
            const errBody = xhrResult.json as { error?: string };
            throw new Error(errBody.error ?? "Transcription failed");
          }
          const data = xhrResult.json as {
            subtitles: Array<{ id: string; text: string; start: number; end: number }>;
          };

          const doneMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Transcription complete — ${data.subtitles.length} subtitle${data.subtitles.length !== 1 ? "s" : ""} generated. Edit them in the Subtitles tab.`,
            command: "subtitle",
            createdAt: new Date().toISOString(),
          };
          setProject((p) => ({
            ...p,
            messages: [...p.messages.filter((m) => m.id !== pendingId), doneMsg],
            subtitles: [
              ...p.subtitles,
              ...data.subtitles.map((s) => ({ ...s, id: crypto.randomUUID() })),
            ],
            credits: Math.max(0, p.credits - CREDIT_COST),
          }));
        } catch (err: unknown) {
          const errMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Transcription failed: ${err instanceof Error ? err.message : "Unknown error"}. Check that OPENAI_API_KEY is configured on the server.`,
            command: "subtitle",
            createdAt: new Date().toISOString(),
          };
          setProject((p) => ({
            ...p,
            messages: [...p.messages.filter((m) => m.id !== pendingId), errMsg],
            credits: Math.max(0, p.credits - CREDIT_COST),
          }));
        } finally {
          setIsSending(false);
        }
        return;
      }

      // All other commands — client-side logic with a short artificial delay
      setTimeout(() => {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.message,
          command: result.command ?? undefined,
          createdAt: new Date().toISOString(),
        };
        setProject((p) => {
          const next = { ...p, messages: [...p.messages, assistantMsg] };
          if (result.command) next.credits = Math.max(0, p.credits - CREDIT_COST);
          if (result.effect) {
            next.effects = [...p.effects, { ...result.effect, id: crypto.randomUUID() }];
          }
          if (result.subtitles) {
            next.subtitles = [
              ...p.subtitles,
              ...result.subtitles.map((s) => ({ ...s, id: crypto.randomUUID() })),
            ];
          }
          if (result.cut) {
            next.cuts = [...(p.cuts ?? []), result.cut];
          }
          return next;
        });
        setIsSending(false);
      }, 700 + Math.random() * 300);
    },
    [currentTime, duration, setProject, videoFile]
  );

  const handleExport = useCallback(async (res: Resolution) => {
    if (!videoFile) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportPhaseLabel("Uploading…");

    const jobId = crypto.randomUUID();

    // SSE for FFmpeg render progress (polls up to 5 min for job creation after upload)
    const sse = new EventSource(`/api/editor/export/progress/${jobId}`);
    sse.onmessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as { progress?: number; done?: boolean };
        if (data.progress !== undefined) {
          setExportPhaseLabel("Rendering…");
          setExportProgress(data.progress);
        }
        if (data.done) sse.close();
      } catch { /* ignore parse errors */ }
    };

    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("jobId", jobId);
      form.append("trimStart", String(project.trim.start));
      form.append("trimEnd",   String(project.trim.end > 0 ? project.trim.end : duration));
      form.append("subtitles", burnSubs ? JSON.stringify(project.subtitles) : "[]");
      form.append("burnSubtitles", String(burnSubs));
      form.append("resolution", res);
      form.append("duration", String(duration));
      form.append("cuts", JSON.stringify(project.cuts ?? []));
      form.append("effects", JSON.stringify(project.effects ?? []));

      // XHR upload so we can show upload progress before FFmpeg begins
      const xhrResult = await new Promise<{ ok: boolean; blob?: Blob; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/editor/export");
        xhr.responseType = "blob";
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setExportProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.upload.onload = () => {
          setExportPhaseLabel("Rendering…");
          setExportProgress(0);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true, blob: xhr.response as Blob });
          } else {
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const body = JSON.parse(reader.result as string) as { error?: string };
                resolve({ ok: false, error: body.error ?? `Server error ${xhr.status}` });
              } catch {
                resolve({ ok: false, error: `Server error ${xhr.status}` });
              }
            };
            reader.readAsText(xhr.response as Blob);
          }
        };
        xhr.onerror = () => resolve({ ok: false, error: "Network error during upload" });
        xhr.send(form);
      });

      if (!xhrResult.ok) throw new Error(xhrResult.error ?? "Export failed");

      setExportProgress(100);
      const url = URL.createObjectURL(xhrResult.blob!);
      const a   = document.createElement("a");
      a.href    = url;
      a.download = `${project.name.replace(/[^a-z0-9_\-]/gi, "_")}-export.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast(`✓ Export complete — ${res} video downloaded`);
    } catch (err) {
      setToast(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      sse.close();
      setIsExporting(false);
      setExportProgress(null);
      setExportPhaseLabel("Exporting…");
    }
  }, [videoFile, project.trim, project.subtitles, project.cuts, project.effects, project.name, duration, burnSubs]);

  const handleSubtitleMove = useCallback(
    (id: string, newStart: number, newEnd: number) => {
      setProject((p) => ({
        ...p,
        subtitles: p.subtitles.map((s) =>
          s.id === id ? { ...s, start: newStart, end: newEnd } : s
        ),
      }));
    },
    [setProject]
  );

  const handleEffectMove = useCallback(
    (id: string, newStart: number, newEnd: number) => {
      setProject((p) => ({
        ...p,
        effects: p.effects.map((e) =>
          e.id === id ? { ...e, start: newStart, end: newEnd } : e
        ),
      }));
    },
    [setProject]
  );

  const handleCutDelete = useCallback(
    (index: number) => {
      setProject((p) => ({
        ...p,
        cuts: (p.cuts ?? []).filter((_, i) => i !== index),
      }));
    },
    [setProject]
  );

  const handleSave = useCallback(() => {
    manualSave();
    setToast("Project saved ✓");
  }, [manualSave]);

  const handleLoad = useCallback(() => {
    const ok = loadSaved();
    setToast(ok ? "Project loaded ✓" : "No saved project found");
  }, [loadSaved]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <LeftPanel
        projectName={project.name}
        videoUrl={videoUrl}
        metadata={metadata}
        credits={project.credits}
        onFileSelect={handleFileSelect}
        onExport={handleExport}
        isExporting={isExporting}
        burnSubs={burnSubs}
        onBurnSubsChange={setBurnSubs}
        exportProgress={exportProgress}
        exportPhaseLabel={exportPhaseLabel}
        isVideoLoading={isVideoLoading}
        onSave={handleSave}
        onLoad={handleLoad}
        onProjectNameChange={(name) => updateProject({ name })}
        lastSaved={project.savedAt}
      />
      <CenterPanel
        videoRef={videoRef}
        videoUrl={videoUrl}
        currentTime={currentTime}
        duration={duration}
        subtitles={project.subtitles}
        effects={project.effects}
        cuts={project.cuts ?? []}
        trim={project.trim}
        zoom={project.timelineZoom}
        effectPreviewStyle={effectPreviewStyle}
        waveformBars={waveformBars}
        waveformLoading={waveformLoading}
        onTimeUpdate={setCurrentTime}
        onDurationLoad={handleDurationLoad}
        onSeek={(t) => {
          setCurrentTime(t);
          if (videoRef.current) videoRef.current.currentTime = t;
        }}
        onTrimChange={setTrim}
        onEffectDelete={deleteEffect}
        onEffectUpdate={updateEffect}
        onSubtitleClick={(sub) => {
          if (videoRef.current) videoRef.current.currentTime = sub.start;
          setCurrentTime(sub.start);
        }}
        onZoomChange={setZoom}
        onSubtitleMove={handleSubtitleMove}
        onEffectMove={handleEffectMove}
        onCutDelete={handleCutDelete}
      />
      <RightPanel
        credits={project.credits}
        messages={project.messages}
        isSending={isSending}
        subtitles={project.subtitles}
        currentTime={currentTime}
        duration={duration}
        onSend={handleSend}
        onSubtitleUpdate={updateSubtitle}
        onSubtitleDelete={deleteSubtitle}
        onSubtitleAdd={(sub) => {
          setProject((p) => ({
            ...p,
            subtitles: [...p.subtitles, { ...sub, id: crypto.randomUUID() }],
          }));
        }}
        onSeek={(t) => {
          setCurrentTime(t);
          if (videoRef.current) videoRef.current.currentTime = t;
        }}
        onDownloadSrt={() => {
          downloadText(
            generateSrt(project.subtitles),
            `${project.name.replace(/[^a-z0-9_\-]/gi, "_")}-subtitles.srt`,
            "text/plain"
          );
        }}
        onDownloadVtt={() => {
          downloadText(
            generateVtt(project.subtitles),
            `${project.name.replace(/[^a-z0-9_\-]/gi, "_")}-subtitles.vtt`,
            "text/vtt"
          );
        }}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
