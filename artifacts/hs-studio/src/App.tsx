import { useState, useRef, useEffect, useCallback } from "react";
import {
  UploadCloud, Video, Play, Pause, X, Download,
  Scissors, Type, ZoomIn, Send, CheckCircle, Sparkles,
  ChevronDown,
} from "lucide-react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useListSessions,
  useCreateSession,
  useGetSession,
  getGetSessionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  type ChatMessage,
  type TimelineEvent,
  type Subtitle,
  type CommandType,
  processCommand,
  COMMAND_COLORS,
} from "@/lib/commands";

const queryClient = new QueryClient();

const CREDIT_COST = 5;
const STARTING_CREDITS = 50;
const EXPORT_RESOLUTIONS = ['720p', '1080p', '4K'] as const;
type Resolution = typeof EXPORT_RESOLUTIONS[number];

// ─── Shared state types ────────────────────────────────────────────────────────

interface AppState {
  credits: number;
  videoUrl: string | null;
  videoName: string | null;
  currentTimestamp: number;
  duration: number;
  messages: ChatMessage[];
  timelineEvents: TimelineEvent[];
  subtitles: Subtitle[];
}

// ─── Session hook ──────────────────────────────────────────────────────────────

function useActiveSession() {
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const { data: sessions, isLoading } = useListSessions();
  const createSession = useCreateSession();

  useEffect(() => {
    if (isLoading) return;
    if (sessions && sessions.length > 0) {
      if (!activeSessionId) setActiveSessionId(sessions[0].id);
    } else {
      createSession.mutate(
        { data: { name: "My Project" } },
        { onSuccess: (s) => setActiveSessionId(s.id) }
      );
    }
  }, [sessions, isLoading, activeSessionId, createSession]);

  return activeSessionId;
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-2xl rounded-xl px-5 py-3 text-sm font-medium animate-in fade-in slide-in-from-bottom-4 duration-300">
      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="text-foreground">{message}</span>
    </div>
  );
}

// ─── Left Panel ────────────────────────────────────────────────────────────────

function LeftPanel({
  sessionId,
  videoUrl,
  videoName,
  credits,
  onFileSelect,
  onExport,
  isExporting,
}: {
  sessionId: number | null;
  videoUrl: string | null;
  videoName: string | null;
  credits: number;
  onFileSelect: (file: File) => void;
  onExport: (res: Resolution) => void;
  isExporting: boolean;
}) {
  const { data: session, isLoading } = useGetSession(sessionId || 0, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId || 0) },
  });
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [showResDropdown, setShowResDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("video/")) onFileSelect(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file?.type.startsWith("video/")) onFileSelect(file);
  };

  const pct = (credits / STARTING_CREDITS) * 100;
  const barColor = credits <= 5 ? "bg-red-500" : credits <= 20 ? "bg-yellow-500" : "bg-primary";

  return (
    <aside className="w-[260px] shrink-0 h-full flex flex-col border-r border-border bg-card/80 backdrop-blur-sm">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <Video className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-base tracking-tight">HS Studio</span>
      </div>

      <div className="flex-1 flex flex-col gap-5 p-4 overflow-y-auto">
        {/* Upload */}
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Upload Video</p>
          <div
            className={cn(
              "relative border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200 text-center group",
              videoUrl
                ? "border-primary/50 bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            )}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            data-testid="upload-zone"
          >
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} data-testid="input-video-upload" />
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center transition-colors", videoUrl ? "bg-primary/20" : "bg-muted/50 group-hover:bg-muted")}>
              <UploadCloud className={cn("w-5 h-5 transition-colors", videoUrl ? "text-primary" : "text-muted-foreground")} />
            </div>
            {videoUrl ? (
              <>
                <p className="text-xs font-semibold text-primary">Video loaded</p>
                <p className="text-[10px] text-muted-foreground truncate w-full px-1">{videoName}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-foreground">Drag & drop or click</p>
                <p className="text-[10px] text-muted-foreground">MP4, WebM, MOV</p>
              </>
            )}
          </div>
        </section>

        {/* Export */}
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Export</p>
          <div className="space-y-2">
            <div className="relative">
              <button
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border text-xs font-medium hover:border-primary/40 transition-colors"
                onClick={() => setShowResDropdown(v => !v)}
              >
                <span className="text-foreground">{resolution}</span>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", showResDropdown && "rotate-180")} />
              </button>
              {showResDropdown && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-xl z-20 overflow-hidden">
                  {EXPORT_RESOLUTIONS.map(r => (
                    <button
                      key={r}
                      className={cn("w-full px-3 py-2 text-xs text-left hover:bg-muted/50 transition-colors", r === resolution && "text-primary font-semibold bg-primary/5")}
                      onClick={() => { setResolution(r); setShowResDropdown(false); }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              className="w-full gap-2 text-xs font-semibold h-9"
              disabled={!videoUrl || isExporting}
              onClick={() => onExport(resolution)}
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Export {resolution}
                </>
              )}
            </Button>
          </div>
        </section>
      </div>

      {/* Session / Credits */}
      <div className="p-4 border-t border-border">
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : session ? (
          <div className="space-y-3 bg-muted/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground truncate">{session.name}</span>
              <span className={cn("text-[11px] font-mono font-bold px-2 py-0.5 rounded-md", credits <= 5 ? "bg-red-500/10 text-red-400" : credits <= 20 ? "bg-yellow-500/10 text-yellow-400" : "bg-primary/10 text-primary")}>
                {credits} CR
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>AI Credits</span>
                <span>{credits}/{STARTING_CREDITS}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-500", barColor)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// ─── Subtitle Overlay ──────────────────────────────────────────────────────────

function SubtitleOverlay({ subtitles }: { subtitles: Subtitle[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (subtitles.length === 0) return;
    setIdx(0);
    const t = setInterval(() => setIdx(i => (i + 1) % subtitles.length), 2500);
    return () => clearInterval(t);
  }, [subtitles]);

  if (subtitles.length === 0) return null;

  return (
    <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none px-4">
      <div className="bg-black/70 backdrop-blur-sm text-white text-lg font-bold px-6 py-2.5 rounded-2xl tracking-wide shadow-[0_4px_24px_rgba(0,0,0,0.6)] border border-white/10 max-w-[80%] text-center leading-tight">
        {subtitles[idx].text}
      </div>
    </div>
  );
}

// ─── Center Panel ──────────────────────────────────────────────────────────────

function CenterPanel({
  videoUrl,
  currentTimestamp,
  duration,
  timelineEvents,
  subtitles,
  onTimeUpdate,
  onDurationLoad,
  onSeek,
}: {
  videoUrl: string | null;
  currentTimestamp: number;
  duration: number;
  timelineEvents: TimelineEvent[];
  subtitles: Subtitle[];
  onTimeUpdate: (t: number) => void;
  onDurationLoad: (d: number) => void;
  onSeek: (t: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    onSeek(t);
  };

  const seekTo = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    onSeek(t);
  };

  const eventIcons: Record<CommandType, React.ReactNode> = {
    cut: <Scissors className="w-3 h-3" />,
    subtitle: <Type className="w-3 h-3" />,
    zoom: <ZoomIn className="w-3 h-3" />,
  };

  const eventBadgeColors: Record<CommandType, string> = {
    cut: "bg-red-500/15 text-red-400 border-red-500/20",
    subtitle: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    zoom: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  };

  return (
    <main className="flex-1 h-full flex flex-col bg-background min-w-0">
      {/* Video area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-black/30">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
              onTimeUpdate={() => { if (videoRef.current) onTimeUpdate(videoRef.current.currentTime); }}
              onLoadedMetadata={() => { if (videoRef.current) onDurationLoad(videoRef.current.duration); }}
              onEnded={() => setIsPlaying(false)}
              onClick={togglePlay}
              data-testid="video-player"
            />
            <SubtitleOverlay subtitles={subtitles} />
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 text-muted-foreground select-none">
            <div className="w-20 h-20 rounded-2xl bg-muted/20 flex items-center justify-center border border-border/50">
              <Video className="w-9 h-9 opacity-40" />
            </div>
            <p className="text-sm font-medium">Drop a video to begin editing</p>
          </div>
        )}
      </div>

      {/* Controls + Timeline */}
      <div className="border-t border-border bg-card/60 backdrop-blur-sm">
        {/* Playback controls */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={togglePlay}
            disabled={!videoUrl}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              videoUrl ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "bg-muted/30 text-muted-foreground cursor-not-allowed"
            )}
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-px" />}
          </button>
          <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
            {formatTime(currentTimestamp)} / {formatTime(duration)}
          </span>

          {/* Scrubber */}
          <div className="relative flex-1 h-5 flex items-center group">
            <div className="absolute inset-x-0 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${duration ? (currentTimestamp / duration) * 100 : 0}%` }}
              />
              {/* Timeline markers */}
              {timelineEvents.map(ev => (
                <div
                  key={ev.id}
                  className="absolute top-0 bottom-0 w-0.5 rounded-full opacity-90 cursor-pointer hover:opacity-100 transition-opacity"
                  style={{ left: `${duration ? (ev.timestamp / duration) * 100 : 0}%`, backgroundColor: ev.color }}
                  onClick={() => seekTo(ev.timestamp)}
                  title={ev.label}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTimestamp}
              onChange={handleSeekInput}
              disabled={!videoUrl}
              className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
              data-testid="input-timeline-seek"
            />
          </div>
        </div>

        {/* Timeline event blocks */}
        {timelineEvents.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {timelineEvents.map(ev => (
              <button
                key={ev.id}
                onClick={() => seekTo(ev.timestamp)}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all hover:scale-105",
                  eventBadgeColors[ev.type]
                )}
                data-testid={`timeline-event-${ev.id}`}
                title={`Jump to ${Math.floor(ev.timestamp / 60)}:${String(Math.floor(ev.timestamp % 60)).padStart(2, '0')}`}
              >
                {eventIcons[ev.type]}
                {ev.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Right Panel ───────────────────────────────────────────────────────────────

function RightPanel({
  credits,
  currentTimestamp,
  messages,
  isSending,
  onSend,
}: {
  credits: number;
  currentTimestamp: number;
  messages: ChatMessage[];
  isSending: boolean;
  onSend: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isSending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending || credits <= 0) return;
    onSend(trimmed);
    setInput("");
  };

  const commandHints: { cmd: CommandType; icon: React.ReactNode; label: string }[] = [
    { cmd: 'cut', icon: <Scissors className="w-3 h-3" />, label: 'cut' },
    { cmd: 'subtitle', icon: <Type className="w-3 h-3" />, label: 'subtitle' },
    { cmd: 'zoom', icon: <ZoomIn className="w-3 h-3" />, label: 'zoom' },
  ];

  return (
    <aside className="w-[300px] shrink-0 h-full flex flex-col border-l border-border bg-card/80 backdrop-blur-sm">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="font-semibold text-sm">AI Assistant</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary/60" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Ask AI to edit your video</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Try a command below to get started</p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center mt-1">
              {commandHints.map(({ cmd, icon, label }) => (
                <button
                  key={cmd}
                  onClick={() => { setInput(label); }}
                  className={cn("flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all hover:scale-105", COMMAND_COLORS[cmd])}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
              msg.role === 'user'
                ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted/60 text-foreground rounded-bl-sm border border-border/60"
            )}
          >
            {msg.role === 'assistant' && msg.command && (
              <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border mb-1.5 self-start", COMMAND_COLORS[msg.command])}>
                {msg.command === 'cut' && <Scissors className="w-2.5 h-2.5" />}
                {msg.command === 'subtitle' && <Type className="w-2.5 h-2.5" />}
                {msg.command === 'zoom' && <ZoomIn className="w-2.5 h-2.5" />}
                {msg.command.toUpperCase()}
              </span>
            )}
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        ))}

        {isSending && (
          <div className="bg-muted/60 border border-border/60 rounded-2xl rounded-bl-sm px-3.5 py-2.5 max-w-[88%] flex items-center gap-1.5">
            {[0, 0.15, 0.3].map((delay, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${delay}s` }} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-border bg-background/30 space-y-2">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={credits <= 0 ? "No credits remaining" : "Ask AI to edit…"}
            disabled={isSending || credits <= 0}
            className="flex-1 h-9 text-xs bg-background/80 border-border focus-visible:ring-primary/40"
            data-testid="input-chat-message"
          />
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={!input.trim() || isSending || credits <= 0}
            data-testid="button-send-chat"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
        <div className="flex items-center justify-between px-0.5">
          {credits <= 0 ? (
            <p className="text-[10px] text-red-400 font-medium">Out of credits</p>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {commandHints.map(({ cmd, icon, label }) => (
                <button
                  key={cmd}
                  onClick={() => setInput(label)}
                  className={cn("flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-all hover:scale-105", COMMAND_COLORS[cmd])}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          )}
          <span className={cn("text-[10px] font-mono shrink-0 ml-1", credits <= 5 ? "text-red-400" : "text-muted-foreground")}>
            {credits} CR
          </span>
        </div>
      </div>
    </aside>
  );
}

// ─── App Inner ─────────────────────────────────────────────────────────────────

function AppInner() {
  const sessionId = useActiveSession();

  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [duration, setDuration] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { document.documentElement.classList.add("dark"); }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    setCurrentTimestamp(0);
    setDuration(0);
  }, [videoUrl]);

  const handleSend = useCallback((text: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsSending(true);

    setTimeout(() => {
      const result = processCommand(text, currentTimestamp);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message,
        command: result.command ?? undefined,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (result.command) {
        setCredits(prev => Math.max(0, prev - CREDIT_COST));

        if (result.timelineEvent) {
          setTimelineEvents(prev => [...prev, { ...result.timelineEvent!, id: crypto.randomUUID() }]);
        }

        if (result.subtitles) {
          setSubtitles(result.subtitles);
        }
      }

      setIsSending(false);
    }, 800 + Math.random() * 400);
  }, [currentTimestamp]);

  const handleExport = useCallback((resolution: Resolution) => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setToast(`Exported successfully at ${resolution} ✓`);
    }, 2200);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <LeftPanel
        sessionId={sessionId}
        videoUrl={videoUrl}
        videoName={videoName}
        credits={credits}
        onFileSelect={handleFileSelect}
        onExport={handleExport}
        isExporting={isExporting}
      />
      <CenterPanel
        videoUrl={videoUrl}
        currentTimestamp={currentTimestamp}
        duration={duration}
        timelineEvents={timelineEvents}
        subtitles={subtitles}
        onTimeUpdate={setCurrentTimestamp}
        onDurationLoad={setDuration}
        onSeek={setCurrentTimestamp}
      />
      <RightPanel
        credits={credits}
        currentTimestamp={currentTimestamp}
        messages={messages}
        isSending={isSending}
        onSend={handleSend}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
