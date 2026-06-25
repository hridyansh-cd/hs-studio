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
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
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
interface Seg { start: number; end: number; }
interface EffInput { type: string; start: number; end: number; }

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

// ── Segment computation ───────────────────────────────────────────────────────

/**
 * Given a trim window [trimStart, trimEnd] and an array of cut regions,
 * returns the list of kept segments in original-video time.
 */
function computeSegments(trimStart: number, trimEnd: number, cuts: Seg[]): Seg[] {
  const validCuts = cuts
    .filter((c) => c.end > trimStart && c.start < trimEnd)
    .map((c) => ({ start: Math.max(c.start, trimStart), end: Math.min(c.end, trimEnd) }))
    .sort((a, b) => a.start - b.start);

  const segs: Seg[] = [];
  let pos = trimStart;
  for (const cut of validCuts) {
    if (cut.start > pos) segs.push({ start: pos, end: cut.start });
    pos = Math.max(pos, cut.end);
  }
  if (pos < trimEnd) segs.push({ start: pos, end: trimEnd });
  return segs.length > 0 ? segs : [{ start: trimStart, end: trimEnd }];
}

/**
 * Maps an original-video timestamp to its equivalent position in the
 * output video (after trim + cuts have been applied).
 */
function toOutputTime(origT: number, segs: Seg[]): number {
  let out = 0;
  for (const seg of segs) {
    if (origT <= seg.start) return out;
    if (origT < seg.end)    return out + (origT - seg.start);
    out += seg.end - seg.start;
  }
  return out;
}

// ── FFmpeg args builder ───────────────────────────────────────────────────────

function buildFfmpegArgs(opts: {
  inputPath: string;
  outputPath: string;
  trimStart: number;
  trimEnd: number;
  cuts: Seg[];
  effects: EffInput[];
  scale: string;
  burnSubs: boolean;
  srtPath: string | null;
}): string[] {
  const { inputPath, outputPath, trimStart, trimEnd, cuts, effects, scale, burnSubs, srtPath } = opts;

  const subsFilter = burnSubs && srtPath
    ? `subtitles='${srtPath.replace(/\\/g, "/").replace(/'/g, "\\'")}':force_style='FontSize=26,FontName=Arial,PrimaryColour=&Hffffff&,BackColour=&H80000000&,BorderStyle=4,Outline=0,Shadow=0,Alignment=2'`
    : null;

  const validTrimEnd = trimEnd > trimStart ? trimEnd : trimStart + 86400;
  const zoomEffects  = effects.filter((e) => e.type === "zoom-in" || e.type === "zoom-out");
  const hasCuts      = cuts.length > 0;
  const hasZoom      = zoomEffects.length > 0;

  // ── Simple path: no cuts, no zoom ─────────────────────────────────────────
  if (!hasCuts && !hasZoom) {
    const args = ["-y"];
    if (trimStart > 0) args.push("-ss", String(trimStart));
    args.push("-i", inputPath);
    if (trimEnd > trimStart) args.push("-t", String(trimEnd - trimStart));
    const vf: string[] = [];
    if (subsFilter) vf.push(subsFilter);
    vf.push(`scale=${scale}`);
    args.push("-vf", vf.join(","));
    args.push("-c:v", "libx264", "-preset", "fast", "-crf", "22");
    args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart");
    args.push(outputPath);
    return args;
  }

  // ── Complex path: filter_complex for cuts and/or zoom ─────────────────────
  const segs = computeSegments(trimStart, validTrimEnd, cuts);
  const n    = segs.length;
  const fp: string[] = [];

  // 1. Trim kept segments; produce [vraw] and [aout]
  if (n === 1) {
    const seg = segs[0];
    fp.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[vraw]`);
    fp.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[aout]`);
  } else {
    for (let i = 0; i < n; i++) {
      const seg = segs[i];
      fp.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[vs${i}]`);
      fp.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[as${i}]`);
    }
    const concatIn = Array.from({ length: n }, (_, i) => `[vs${i}][as${i}]`).join("");
    fp.push(`${concatIn}concat=n=${n}:v=1:a=1[vraw][aout]`);
  }

  // 2. Apply zoom effects as crop+scale overlays at output-relative timestamps
  const validZooms = zoomEffects
    .map((e) => ({
      type: e.type,
      oS: toOutputTime(e.start, segs),
      oE: toOutputTime(e.end,   segs),
    }))
    .filter((z) => z.oE > z.oS + 0.05);  // must be at least 50 ms

  let vLabel = "vraw";
  if (validZooms.length > 0) {
    const nz = validZooms.length;
    // Split [vraw] into nz+1 streams: 1 base + nz effect sources
    const splitLabels = [`vbase0`, ...Array.from({ length: nz }, (_, i) => `vzs${i}`)];
    fp.push(`[${vLabel}]split=${nz + 1}${splitLabels.map((l) => `[${l}]`).join("")}`);

    let baseLabel = "vbase0";
    for (let i = 0; i < nz; i++) {
      const z = validZooms[i];
      const zoomLabel = `vzo${i}`;
      const nextBase  = `vbase${i + 1}`;

      // zoom-in: crop center 2/3 → scale back to full (1.5× magnification)
      // zoom-out: scale down to 2/3 → pad back to full with black bars
      const cropScale = z.type === "zoom-in"
        ? "crop=2*iw/3:2*ih/3:iw/6:ih/6,scale=3*iw/2:3*ih/2"
        : "scale=2*iw/3:2*ih/3,pad=3*iw/2:3*ih/2:iw/4:ih/4:black";

      // Trim effect frames, apply crop/scale, then shift PTS back to output time oS
      fp.push(
        `[vzs${i}]trim=start=${z.oS.toFixed(3)}:end=${z.oE.toFixed(3)},` +
        `${cropScale},` +
        `setpts=PTS-STARTPTS+${z.oS.toFixed(3)}/TB[${zoomLabel}]`
      );
      // Overlay the zoomed frames over the base stream during [oS, oE]
      fp.push(
        `[${baseLabel}][${zoomLabel}]overlay=0:0:enable='between(t,${z.oS.toFixed(3)},${z.oE.toFixed(3)})'[${nextBase}]`
      );
      baseLabel = nextBase;
    }
    vLabel = baseLabel;
  }

  // 3. Scale to target resolution (and optionally burn subtitles)
  const scaleSub = subsFilter ? `,${subsFilter}` : "";
  fp.push(`[${vLabel}]scale=${scale}${scaleSub}[vout]`);

  const args = ["-y", "-i", inputPath];
  args.push("-filter_complex", fp.join(";"));
  args.push("-map", "[vout]", "-map", "[aout]");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "22");
  args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart");
  args.push(outputPath);
  return args;
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

    const jobId      = (req.body.jobId as string | undefined) || crypto.randomUUID();
    const job        = createJob(jobId);
    const totalDur   = parseFloat(req.body.duration  ?? "0") || 0;
    const trimStart  = Math.max(0, parseFloat(req.body.trimStart ?? "0") || 0);
    const trimEnd    = Math.max(0, parseFloat(req.body.trimEnd   ?? "0") || 0);
    const resolution = (req.body.resolution as string) ?? "1080p";
    const scale      = SCALE[resolution] ?? SCALE["1080p"];
    const burnSubs   = req.body.burnSubtitles !== "false";

    let subtitles: SubtitleSegment[] = [];
    try { subtitles = JSON.parse(req.body.subtitles ?? "[]"); } catch { /* ignore */ }

    let cuts: Seg[] = [];
    try { cuts = JSON.parse(req.body.cuts ?? "[]"); } catch { /* ignore */ }

    let effects: EffInput[] = [];
    try { effects = JSON.parse(req.body.effects ?? "[]"); } catch { /* ignore */ }

    const id         = crypto.randomUUID();
    const ext        = path.extname(req.file.originalname) || ".mp4";
    const inputPath  = path.join(os.tmpdir(), `hs-in-${id}${ext}`);
    const outputPath = path.join(os.tmpdir(), `hs-out-${id}.mp4`);
    let srtPath: string | null = null;

    try {
      await fs.writeFile(inputPath, req.file.buffer);
      emitProgress(jobId, 2);

      if (burnSubs && subtitles.length > 0) {
        srtPath = path.join(os.tmpdir(), `hs-subs-${id}.srt`);
        await fs.writeFile(srtPath, buildSrt(subtitles), "utf-8");
      }

      const args = buildFfmpegArgs({
        inputPath, outputPath, trimStart, trimEnd,
        cuts, effects, scale, burnSubs, srtPath,
      });

      req.log.info({ args: args.join(" ") }, "Starting FFmpeg export");

      await new Promise<void>((resolve, reject) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderrBuf = "";
        let fullStderr = "";

        ff.stderr.on("data", (d: Buffer) => {
          const chunk = d.toString();
          fullStderr += chunk;
          stderrBuf  += chunk;
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

      const baseName  = path.basename(req.file.originalname, ext);
      const outputBuf = await fs.readFile(outputPath);
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
