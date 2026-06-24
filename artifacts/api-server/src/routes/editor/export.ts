import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { EventEmitter } from "events";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ── In-memory job store ───────────────────────────────────────────────────────

interface Job {
  emitter: EventEmitter;
  progress: number;
  done: boolean;
  error?: string;
}

const jobs = new Map<string, Job>();

function createJob(jobId: string): Job {
  const job: Job = { emitter: new EventEmitter(), progress: 0, done: false };
  job.emitter.setMaxListeners(20);
  jobs.set(jobId, job);
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000); // cleanup after 10 min
  return job;
}

function emitProgress(jobId: string, pct: number) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = pct;
  job.emitter.emit("progress", pct);
}

function emitDone(jobId: string, error?: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  job.error = error;
  job.emitter.emit("done", { error });
}

// ── SSE progress stream ───────────────────────────────────────────────────────

router.get("/editor/export/progress/:jobId", (req, res): void => {
  const { jobId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Poll until job appears (handles race between SSE open and POST start)
  const MAX_WAIT = 10_000;
  const POLL_MS  = 100;
  let waited = 0;

  const tryConnect = () => {
    const job = jobs.get(jobId);
    if (job) {
      send({ progress: job.progress });
      if (job.done) { send({ done: true, error: job.error }); res.end(); return; }

      const onProgress = (pct: number) => send({ progress: pct });
      const onDone     = (d: { error?: string }) => { send({ done: true, ...d }); res.end(); };

      job.emitter.on("progress", onProgress);
      job.emitter.on("done",     onDone);
      req.on("close", () => {
        job.emitter.off("progress", onProgress);
        job.emitter.off("done",     onDone);
      });
    } else if (waited < MAX_WAIT) {
      waited += POLL_MS;
      setTimeout(tryConnect, POLL_MS);
    } else {
      send({ done: true, error: "Job not found" });
      res.end();
    }
  };

  tryConnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SubtitleSegment { id: string; text: string; start: number; end: number; }

function formatSrtTime(s: number): string {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}:${ss.toString().padStart(2,"0")},${ms.toString().padStart(3,"0")}`;
}

function buildSrt(subs: SubtitleSegment[]): string {
  return subs
    .filter((s) => s.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${s.text.trim()}\n`)
    .join("\n");
}

const SCALE: Record<string, string> = {
  "720p":  "-2:720",
  "1080p": "-2:1080",
  "4K":    "-2:2160",
};

function parseTimecode(s: string): number {
  const m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

// ── Export endpoint ───────────────────────────────────────────────────────────

router.post(
  "/editor/export",
  upload.single("video"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const jobId       = (req.body.jobId as string | undefined) || crypto.randomUUID();
    const job         = createJob(jobId);
    const totalDur    = parseFloat(req.body.duration ?? "0") || 0;
    const trimStart   = Math.max(0, parseFloat(req.body.trimStart ?? "0") || 0);
    const trimEnd     = Math.max(0, parseFloat(req.body.trimEnd   ?? "0") || 0);
    const resolution  = (req.body.resolution as string) ?? "1080p";
    const scale       = SCALE[resolution] ?? SCALE["1080p"];
    const burnSubs    = req.body.burnSubtitles !== "false"; // default true

    let subtitles: SubtitleSegment[] = [];
    try { subtitles = JSON.parse(req.body.subtitles ?? "[]"); } catch { /* ignore */ }

    const id         = crypto.randomUUID();
    const ext        = path.extname(req.file.originalname) || ".mp4";
    const inputPath  = path.join(os.tmpdir(), `hs-in-${id}${ext}`);
    const outputPath = path.join(os.tmpdir(), `hs-out-${id}.mp4`);
    let srtPath: string | null = null;

    try {
      await fs.writeFile(inputPath, req.file.buffer);
      emitProgress(jobId, 2);

      const args: string[] = ["-y"];
      if (trimStart > 0) args.push("-ss", String(trimStart));
      args.push("-i", inputPath);
      if (trimEnd > trimStart) args.push("-t", String(trimEnd - trimStart));

      const vfParts: string[] = [];
      if (burnSubs && subtitles.length > 0) {
        const srt = buildSrt(subtitles);
        srtPath = path.join(os.tmpdir(), `hs-subs-${id}.srt`);
        await fs.writeFile(srtPath, srt, "utf-8");
        vfParts.push(
          `subtitles='${srtPath}':force_style='FontSize=26,FontName=Arial,PrimaryColour=&Hffffff&,BackColour=&H80000000&,BorderStyle=4,Outline=0,Shadow=0,Alignment=2'`
        );
      }
      vfParts.push(`scale=${scale}`);
      args.push("-vf", vfParts.join(","));
      args.push("-c:v", "libx264", "-preset", "fast", "-crf", "22");
      args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart");
      args.push(outputPath);

      req.log.info({ args: args.join(" ") }, "Starting FFmpeg export");

      await new Promise<void>((resolve, reject) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderrBuf = "";
        let fullStderr = "";

        ff.stderr.on("data", (d: Buffer) => {
          const chunk = d.toString();
          fullStderr += chunk;
          stderrBuf += chunk;
          const lines = stderrBuf.split("\r");
          stderrBuf = lines[lines.length - 1] ?? "";
          for (const line of lines.slice(0, -1)) {
            const timeMatch = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
            if (timeMatch && totalDur > 0) {
              const elapsed = parseTimecode(timeMatch[1]);
              const pct = Math.min(98, Math.round((elapsed / totalDur) * 96) + 2);
              emitProgress(jobId, pct);
            }
          }
        });

        ff.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed (code ${code}): ${fullStderr.slice(-800)}`));
        });
        ff.on("error", (err) => reject(new Error(`spawn ffmpeg: ${err.message}`)));
      });

      emitProgress(jobId, 99);
      emitDone(jobId);

      const baseName    = path.basename(req.file.originalname, ext);
      const outputBuf   = await fs.readFile(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(baseName + "-export.mp4")}"`);
      res.setHeader("Content-Length", String(outputBuf.length));
      res.send(outputBuf);
    } catch (err: unknown) {
      req.log.error({ err }, "Export failed");
      const msg = err instanceof Error ? err.message : "Export failed";
      emitDone(jobId, msg);
      if (!res.headersSent) res.status(500).json({ error: msg });
    } finally {
      await Promise.allSettled([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {}),
        srtPath ? fs.unlink(srtPath).catch(() => {}) : Promise.resolve(),
      ]);
    }
  }
);

export default router;
