import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

interface SubtitleSegment {
  id: string;
  text: string;
  start: number;
  end: number;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

function buildSrt(subtitles: SubtitleSegment[]): string {
  return subtitles
    .filter((s) => s.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((s, i) =>
      `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${s.text.trim()}\n`
    )
    .join("\n");
}

const SCALE: Record<string, string> = {
  "720p":  "-2:720",
  "1080p": "-2:1080",
  "4K":    "-2:2160",
};

router.post(
  "/editor/export",
  upload.single("video"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const id = crypto.randomUUID();
    const ext = path.extname(req.file.originalname) || ".mp4";
    const inputPath  = path.join(os.tmpdir(), `hs-in-${id}${ext}`);
    const outputPath = path.join(os.tmpdir(), `hs-out-${id}.mp4`);
    let srtPath: string | null = null;

    try {
      await fs.writeFile(inputPath, req.file.buffer);

      const trimStart  = Math.max(0, parseFloat(req.body.trimStart ?? "0") || 0);
      const trimEnd    = Math.max(0, parseFloat(req.body.trimEnd   ?? "0") || 0);
      const resolution = (req.body.resolution as string) ?? "1080p";
      const scale      = SCALE[resolution] ?? SCALE["1080p"];

      let subtitles: SubtitleSegment[] = [];
      try { subtitles = JSON.parse(req.body.subtitles ?? "[]"); } catch { /* ignore */ }

      // ── Build FFmpeg command ──────────────────────────────────────────────
      const args: string[] = ["-y"];

      // Fast input seek (trim start)
      if (trimStart > 0) args.push("-ss", String(trimStart));
      args.push("-i", inputPath);
      // Trim duration
      if (trimEnd > trimStart) args.push("-t", String(trimEnd - trimStart));

      // Video filters
      const vfParts: string[] = [];

      if (subtitles.length > 0) {
        const srt = buildSrt(subtitles);
        srtPath = path.join(os.tmpdir(), `hs-subs-${id}.srt`);
        await fs.writeFile(srtPath, srt, "utf-8");
        vfParts.push(
          `subtitles='${srtPath}':force_style='FontSize=26,FontName=Arial,PrimaryColour=&Hffffff&,OutlineColour=&H00000000&,BackColour=&H80000000&,Outline=0,Shadow=0,BorderStyle=4,Alignment=2'`
        );
      }

      vfParts.push(`scale=${scale}`);
      args.push("-vf", vfParts.join(","));

      // Codec settings
      args.push(
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath
      );

      req.log.info({ args: args.join(" ") }, "Starting FFmpeg export");

      // ── Run FFmpeg ────────────────────────────────────────────────────────
      await new Promise<void>((resolve, reject) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        ff.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        ff.on("close", (code) => {
          if (code === 0) {
            req.log.info("FFmpeg export complete");
            resolve();
          } else {
            reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-800)}`));
          }
        });
        ff.on("error", (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
      });

      // ── Send output ───────────────────────────────────────────────────────
      const baseName = path.basename(req.file.originalname, ext);
      const outputBuffer = await fs.readFile(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(baseName + "-export.mp4")}"`
      );
      res.setHeader("Content-Length", String(outputBuffer.length));
      res.send(outputBuffer);
    } catch (err: unknown) {
      req.log.error({ err }, "Export failed");
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Export failed — unknown error",
        });
      }
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
