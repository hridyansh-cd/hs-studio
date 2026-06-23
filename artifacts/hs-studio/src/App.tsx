import { useState, useRef, useEffect } from "react";
import { UploadCloud, Video, Play, Pause, X } from "lucide-react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useListSessions,
  useCreateSession,
  useGetSession,
  useListSessionEvents,
  useDeleteTimelineEvent,
  useListChatMessages,
  useSendChatMessage,
  getGetSessionQueryKey,
  getListSessionEventsQueryKey,
  getListChatMessagesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient();

// --- Custom Hooks ---

function useActiveSession() {
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  
  const { data: sessions, isLoading: sessionsLoading } = useListSessions();
  const createSession = useCreateSession();

  useEffect(() => {
    if (sessionsLoading) return;

    if (sessions && sessions.length > 0) {
      if (!activeSessionId) {
        setActiveSessionId(sessions[0].id);
      }
    } else {
      createSession.mutate(
        { data: { name: "My Project" } },
        {
          onSuccess: (session) => setActiveSessionId(session.id),
        }
      );
    }
  }, [sessions, sessionsLoading, activeSessionId, createSession]);

  return activeSessionId;
}

// --- Components ---

function LeftPanel({ sessionId, videoUrl, setVideoUrl }: { sessionId: number | null, videoUrl: string | null, setVideoUrl: (url: string) => void }) {
  const { data: session, isLoading } = useGetSession(sessionId || 0, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId || 0) },
  });

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  const credits = session?.credits ?? 100;
  let progressColor = "bg-primary";
  if (credits <= 10) progressColor = "bg-destructive";
  else if (credits <= 50) progressColor = "bg-yellow-500";

  return (
    <div className="w-[280px] h-full flex flex-col border-r border-border bg-card p-6 gap-6">
      <div className="flex items-center gap-2">
        <Video className="w-5 h-5 text-primary" />
        <h1 className="font-bold text-lg tracking-tight">HS Studio</h1>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Upload Video</h2>
        <div 
          className={cn(
            "border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center text-center gap-3 transition-colors",
            "hover:bg-muted/50 cursor-pointer",
            videoUrl ? "border-primary bg-primary/5" : ""
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById('video-upload')?.click()}
          data-testid="upload-zone"
        >
          <input 
            id="video-upload"
            type="file" 
            accept="video/*" 
            className="hidden" 
            onChange={handleFileSelect}
            data-testid="input-video-upload"
          />
          <UploadCloud className="w-8 h-8 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Drag & drop or click</p>
            <p className="text-muted-foreground text-xs mt-1">MP4, WebM, MOV</p>
          </div>
          {videoUrl && <p className="text-xs text-primary font-medium mt-2">Video loaded</p>}
        </div>
      </div>

      <div className="mt-auto space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : session ? (
          <div className="space-y-3 bg-muted/40 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-muted-foreground truncate">{session.name}</span>
              <span className="text-xs font-mono bg-background px-2 py-1 rounded-md text-foreground">{credits} CR</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-medium">
                <span>AI Credits</span>
                <span>{credits}/100</span>
              </div>
              <Progress value={credits} className={cn("h-1.5", progressColor)} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CenterPanel({ sessionId, videoUrl, currentTimestamp, setCurrentTimestamp }: { sessionId: number | null, videoUrl: string | null, currentTimestamp: number, setCurrentTimestamp: (time: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);

  const { data: events, isLoading: eventsLoading } = useListSessionEvents(sessionId || 0, {
    query: { enabled: !!sessionId, queryKey: getListSessionEventsQueryKey(sessionId || 0) },
  });
  const deleteEvent = useDeleteTimelineEvent();
  const queryClient = useQueryClient();

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTimestamp(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTimestamp(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const seekTo = (time: number) => {
    setCurrentTimestamp(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleDeleteEvent = (eventId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessionId) {
      deleteEvent.mutate(
        { id: sessionId, eventId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSessionEventsQueryKey(sessionId) });
          }
        }
      );
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-background">
      <div className="flex-1 p-6 flex flex-col justify-center items-center relative overflow-hidden">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="max-w-full max-h-full rounded-md shadow-2xl object-contain bg-black"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            onClick={togglePlay}
          />
        ) : (
          <div className="flex flex-col items-center text-muted-foreground gap-4">
            <div className="w-24 h-24 rounded-full bg-muted/20 flex items-center justify-center">
              <Video className="w-10 h-10 opacity-50" />
            </div>
            <p className="text-sm font-medium tracking-wide">Drop a video to begin editing</p>
          </div>
        )}
      </div>

      <div className="h-48 border-t border-border bg-card flex flex-col px-6 py-4">
        {/* Controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={togglePlay} disabled={!videoUrl} data-testid="button-play-pause">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <div className="text-xs font-mono text-muted-foreground">
              {formatTime(currentTimestamp)} / {formatTime(duration)}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="relative flex-1 bg-background/50 rounded-md border border-border/50 overflow-hidden group">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTimestamp}
            onChange={handleSeek}
            disabled={!videoUrl}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            data-testid="input-timeline-seek"
          />
          
          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-[2px] bg-primary z-20 pointer-events-none"
            style={{ left: `${duration ? (currentTimestamp / duration) * 100 : 0}%` }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary" />
          </div>

          {/* Events */}
          {events?.map(event => {
            const left = duration ? (event.timestamp / duration) * 100 : 0;
            const eventWidth = event.duration && duration ? (event.duration / duration) * 100 : 0;
            
            return (
              <div
                key={event.id}
                className="absolute z-10 cursor-pointer group/marker"
                style={{ 
                  left: `${left}%`, 
                  top: event.type === 'subtitle' ? '60%' : event.type === 'zoom' ? '20%' : '0',
                  height: event.type === 'cut' ? '100%' : '8px',
                  width: eventWidth > 0 ? `${eventWidth}%` : '2px',
                }}
                onClick={() => seekTo(event.timestamp)}
                data-testid={`timeline-event-${event.id}`}
              >
                {event.type === 'cut' && (
                  <div className="w-[2px] h-full bg-destructive/80 hover:bg-destructive shadow-[0_0_8px_rgba(255,0,0,0.5)] transition-colors"></div>
                )}
                {event.type === 'subtitle' && (
                  <div className="h-2 w-16 bg-cyan-500/80 hover:bg-cyan-500 rounded-full shadow-[0_0_8px_rgba(0,255,255,0.5)] transition-colors"></div>
                )}
                {event.type === 'zoom' && (
                  <div className="h-2 bg-violet-500/80 hover:bg-violet-500 rounded-full shadow-[0_0_8px_rgba(138,43,226,0.5)] transition-colors" style={{ width: '100%' }}></div>
                )}

                <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/marker:opacity-100 transition-opacity bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded whitespace-nowrap shadow-md border border-border flex items-center gap-2 pointer-events-none">
                  {event.type.toUpperCase()}
                  <button 
                    className="hover:text-destructive transition-colors pointer-events-auto"
                    onClick={(e) => handleDeleteEvent(event.id, e)}
                    data-testid={`button-delete-event-${event.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RightPanel({ sessionId, currentTimestamp }: { sessionId: number | null, currentTimestamp: number }) {
  const { data: messages, isLoading: messagesLoading } = useListChatMessages(sessionId || 0, {
    query: { enabled: !!sessionId, queryKey: getListChatMessagesQueryKey(sessionId || 0) },
  });
  const sendMessage = useSendChatMessage();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMessage.isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !sessionId || sendMessage.isPending) return;

    sendMessage.mutate(
      { id: sessionId, data: { content, currentTimestamp } },
      {
        onSuccess: () => {
          setContent("");
          queryClient.invalidateQueries({ queryKey: getListChatMessagesQueryKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: getListSessionEventsQueryKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        }
      }
    );
  };

  const getCommandColor = (cmd: string | null) => {
    switch(cmd) {
      case 'cut': return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'subtitle': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
      case 'zoom': return 'bg-violet-500/10 text-violet-500 border-violet-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="w-[320px] h-full flex flex-col border-l border-border bg-card">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-sm">AI Assistant</h2>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {messagesLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-[80%] rounded-lg" />
              <Skeleton className="h-16 w-[80%] rounded-lg ml-auto" />
            </div>
          ) : messages?.map(msg => (
            <div 
              key={msg.id} 
              className={cn(
                "flex flex-col max-w-[85%] rounded-xl p-3 text-sm",
                msg.role === 'user' 
                  ? "ml-auto bg-primary text-primary-foreground rounded-br-none" 
                  : "bg-muted text-foreground rounded-bl-none border border-border"
              )}
            >
              {msg.role === 'assistant' && msg.command && (
                <div className="mb-2">
                  <span className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                    getCommandColor(msg.command)
                  )}>
                    {msg.command.toUpperCase()}
                  </span>
                </div>
              )}
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          ))}

          {sendMessage.isPending && (
            <div className="bg-muted text-foreground rounded-xl rounded-bl-none border border-border p-3 text-sm max-w-[85%] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]" />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-background/50 border-t border-border mt-auto">
        <form onSubmit={handleSubmit} className="relative">
          <Input
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Ask AI to edit..."
            className="pr-10 bg-background border-border focus-visible:ring-primary/50 text-sm"
            disabled={sendMessage.isPending || !sessionId}
            data-testid="input-chat-message"
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-1 top-1 w-8 h-8 text-primary hover:text-primary hover:bg-primary/10"
            disabled={!content.trim() || sendMessage.isPending || !sessionId}
            data-testid="button-send-chat"
          >
            <Play className="w-4 h-4 fill-current" />
          </Button>
        </form>
        <div className="mt-2 text-center">
          <p className="text-[10px] text-muted-foreground">Try: cut, subtitle, zoom</p>
        </div>
      </div>
    </div>
  );
}

// --- Main App Inner (must be inside QueryClientProvider) ---

function AppInner() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const sessionId = useActiveSession();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground selection:bg-primary/30">
      <LeftPanel sessionId={sessionId} videoUrl={videoUrl} setVideoUrl={setVideoUrl} />
      <CenterPanel sessionId={sessionId} videoUrl={videoUrl} currentTimestamp={currentTimestamp} setCurrentTimestamp={setCurrentTimestamp} />
      <RightPanel sessionId={sessionId} currentTimestamp={currentTimestamp} />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
