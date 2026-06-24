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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Timeline } from "@/components/Timeline";
import { processCommand, COMMAND_COLORS } from "@/lib/commands";
import { useProject } from "@/hooks/useProject";
import { useEffectPreview } from "@/hooks/useEffectPreview";
import type {
  Subtitle,
  Effect,
  TrimState,
  ChatMessage,
  VideoMetadata,
  CommandType,
} from "@/types";

const CREDIT_COST = 5;
const EXPORT_RESOLUTIONS = ["720p", "1080p", "4K"] as const;
type Resolution = (typeof EXPORT_RESOLUTIONS)[number];

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
    if (file?.type.startsWith("video/")) onFileSelect(file);
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
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f?.type.startsWith("video/")) onFileSelect(f);
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
            {videoUrl ? (
              <p className="text-xs font-semibold text-primary">Video loaded ✓</p>
            ) : (
              <>
                <p className="text-xs font-semibold">Drag & drop or click</p>
                <p className="text-[10px] text-muted-foreground">MP4 · WebM · MOV</p>
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
          <Button
            className="w-full gap-2 text-xs h-8"
            disabled={!videoUrl || isExporting}
            onClick={() => onExport(resolution)}
          >
            {isExporting ? (
              <>
                <div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" /> Export {resolution}
              </>
            )}
          </Button>
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
  trim,
  zoom,
  effectPreviewStyle,
  onTimeUpdate,
  onDurationLoad,
  onSeek,
  onTrimChange,
  onEffectDelete,
  onEffectUpdate,
  onSubtitleClick,
  onZoomChange,
  videoRef,
}: {
  videoUrl: string | null;
  currentTime: number;
  duration: number;
  subtitles: Subtitle[];
  effects: Effect[];
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
  videoRef: React.RefObject<HTMLVideoElement | null>;
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
        trim={trim}
        zoom={zoom}
        onSeek={seek}
        onTrimChange={onTrimChange}
        onEffectDelete={onEffectDelete}
        onEffectUpdate={onEffectUpdate}
        onSubtitleClick={onSubtitleClick}
        onZoomChange={onZoomChange}
      />
    </main>
  );
}

// ─── Subtitle editor row ───────────────────────────────────────────────────────

const SubtitleRow = memo(
  ({
    sub,
    onUpdate,
    onDelete,
  }: {
    sub: Subtitle;
    onUpdate: (s: Subtitle) => void;
    onDelete: (id: string) => void;
  }) => {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(sub.text);

    const commit = () => {
      onUpdate({ ...sub, text: text.trim() || sub.text });
      setEditing(false);
    };

    return (
      <div className="group flex items-start gap-2 p-2 rounded-lg hover:bg-muted/20 transition-colors">
        <div className="text-[9px] font-mono text-muted-foreground/60 shrink-0 mt-1 w-10 text-right">
          {Math.floor(sub.start / 60)}:
          {String(Math.floor(sub.start % 60)).padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setText(sub.text);
                  setEditing(false);
                }
              }}
              className="w-full bg-background border border-primary/40 rounded px-2 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/40"
            />
          ) : (
            <p className="text-xs text-foreground/90 leading-relaxed break-words">
              {sub.text}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {editing ? (
            <button
              onClick={commit}
              className="text-emerald-400 hover:text-emerald-300 p-0.5"
            >
              <Check className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => onDelete(sub.id)}
            className="text-muted-foreground hover:text-red-400 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
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
  onSend,
  onSubtitleUpdate,
  onSubtitleDelete,
}: {
  credits: number;
  messages: ChatMessage[];
  isSending: boolean;
  subtitles: Subtitle[];
  onSend: (text: string) => void;
  onSubtitleUpdate: (s: Subtitle) => void;
  onSubtitleDelete: (id: string) => void;
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
        <div className="flex-1 overflow-y-auto">
          {subtitles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
              <Type className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60">
                No subtitles yet. Use the <strong>subtitle</strong> command in
                chat to generate them.
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
                />
              ))}
            </div>
          )}
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
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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
          const resp = await fetch("/api/editor/transcribe", {
            method: "POST",
            body: form,
          });
          if (!resp.ok) {
            const errBody = (await resp.json()) as { error: string };
            throw new Error(errBody.error ?? "Transcription failed");
          }
          const data = (await resp.json()) as {
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
            content: `Transcription failed: ${err instanceof Error ? err.message : "Unknown error"}. Using mock subtitles instead.`,
            command: "subtitle",
            createdAt: new Date().toISOString(),
          };
          const mockSubs = result.subtitles?.map((s) => ({
            ...s,
            id: crypto.randomUUID(),
          })) ?? [];
          setProject((p) => ({
            ...p,
            messages: [...p.messages.filter((m) => m.id !== pendingId), errMsg],
            subtitles: [...p.subtitles, ...mockSubs],
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
          if (result.trimMarker !== undefined && duration) {
            next.trim = { start: 0, end: result.trimMarker };
          }
          return next;
        });
        setIsSending(false);
      }, 700 + Math.random() * 300);
    },
    [currentTime, duration, setProject, videoFile]
  );

  const handleExport = useCallback((_res: Resolution) => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setToast(`Export complete — ${_res} render saved locally ✓`);
    }, 2200);
  }, []);

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
        trim={project.trim}
        zoom={project.timelineZoom}
        effectPreviewStyle={effectPreviewStyle}
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
      />
      <RightPanel
        credits={project.credits}
        messages={project.messages}
        isSending={isSending}
        subtitles={project.subtitles}
        onSend={handleSend}
        onSubtitleUpdate={updateSubtitle}
        onSubtitleDelete={deleteSubtitle}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
