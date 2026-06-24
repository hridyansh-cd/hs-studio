import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const router = Router();

// Accept large videos — we extract + compress audio server-side before Whisper
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const WHISPER_LIMIT = 24 * 1024 * 1024; // 24 MB safe margin
const CHUNK_SECS = 3600; // 1-hour chunks (≈ 14 MB at 32 kbps mono)

async function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    ff.on("close", (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-600)}`))
    );
    ff.on("error", reject);
  });
}

async function transcribeAudio(
  openai: OpenAI,
  filePath: string
): Promise<Array<{ text: string; start: number; end: number }>> {
  const buf = await fs.readFile(filePath);
  const file = await toFile(buf, path.basename(filePath), { type: "audio/mpeg" });
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  return (result.segments ?? []).map((s) => ({
    text: s.text.trim(),
    start: s.start,
    end: s.end,
  }));
}

router.post(
  "/editor/transcribe",
  upload.single("video"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server" });
      return;
    }

    const id = crypto.randomUUID();
    const ext = path.extname(req.file.originalname) || ".mp4";
    const videoPath = path.join(os.tmpdir(), `hs-vid-${id}${ext}`);
    const audioPath = path.join(os.tmpdir(), `hs-audio-${id}.mp3`);
    const chunkDir  = path.join(os.tmpdir(), `hs-chunks-${id}`);
    const tempFiles: string[] = [videoPath, audioPath];

    try {
      await fs.writeFile(videoPath, req.file.buffer);

      // Extract compact mono audio — 32 kbps ≈ 14 MB / hour
      await runFfmpeg([
        "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        audioPath,
      ]);

      const openai = new OpenAI({ apiKey });
      const { size: audioSize } = await fs.stat(audioPath);

      let allSegs: Array<{ text: string; start: number; end: number }> = [];

      if (audioSize <= WHISPER_LIMIT) {
        // ── Single-pass transcription ────────────────────────────────────
        allSegs = await transcribeAudio(openai, audioPath);
      } else {
        // ── Chunked transcription for very long audio ────────────────────
        req.log.info({ audioSize }, "Audio too large for Whisper — chunking");
        await fs.mkdir(chunkDir, { recursive: true });
        await runFfmpeg([
          "-i", audioPath,
          "-f", "segment",
          "-segment_time", String(CHUNK_SECS),
          "-c", "copy",
          path.join(chunkDir, "chunk_%03d.mp3"),
        ]);

        const chunkFiles = (await fs.readdir(chunkDir))
          .filter((f) => f.endsWith(".mp3"))
          .sort();

        for (let i = 0; i < chunkFiles.length; i++) {
          const chunkPath = path.join(chunkDir, chunkFiles[i]);
          const offset = i * CHUNK_SECS;
          const segs = await transcribeAudio(openai, chunkPath);
          for (const seg of segs) {
            allSegs.push({ text: seg.text, start: seg.start + offset, end: seg.end + offset });
          }
          tempFiles.push(chunkPath);
        }

        await fs.rm(chunkDir, { recursive: true, force: true }).catch(() => {});
      }

      const subtitles = allSegs.map((seg, i) => ({
        id: `sub-${Date.now()}-${i}`,
        text: seg.text,
        start: seg.start,
        end: seg.end,
      }));

      req.log.info({ count: subtitles.length }, "Transcription complete");
      res.json({ subtitles });
    } catch (err: unknown) {
      req.log.error({ err }, "Transcription failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Transcription failed — unknown error",
      });
    } finally {
      await Promise.allSettled(tempFiles.map((f) => fs.unlink(f).catch(() => {})));
    }
  }
);

export default router;
