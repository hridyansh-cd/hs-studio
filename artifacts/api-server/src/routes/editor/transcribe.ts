import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `hs-upload-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Gemini inline data limit: 8 MB — chunk audio conservatively
const GEMINI_INLINE_LIMIT = 7 * 1024 * 1024; // 7 MB
const CHUNK_SECS = 600; // 10-minute chunks at 32 kbps ≈ ~2.4 MB

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-600)}`))
    );
    ff.on("error", reject);
  });
}

async function transcribeChunk(
  ai: GoogleGenAI,
  filePath: string,
  offsetSecs: number
): Promise<Array<{ text: string; start: number; end: number }>> {
  const buf = await fs.readFile(filePath);
  const b64 = buf.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Transcribe this audio accurately. Return ONLY valid JSON — no markdown, no backticks:
{
  "segments": [
    { "text": "spoken words", "start": 0.0, "end": 2.5 }
  ]
}
All timestamps are in seconds relative to the start of this audio clip.`,
          },
          {
            inlineData: {
              mimeType: "audio/mpeg",
              data: b64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });

  const raw = response.text ?? '{"segments":[]}';
  let parsed: { segments: Array<{ text: string; start: number; end: number }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    parsed = { segments: [] };
  }

  return (parsed.segments ?? []).map((s) => ({
    text: s.text?.trim() ?? "",
    start: (s.start ?? 0) + offsetSecs,
    end: (s.end ?? 0) + offsetSecs,
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "GEMINI_API_KEY is not configured on the server" });
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const videoPath = req.file.path;
    const id        = crypto.randomUUID();
    const audioPath = path.join(os.tmpdir(), `hs-audio-${id}.mp3`);
    const chunkDir  = path.join(os.tmpdir(), `hs-chunks-${id}`);
    const tempFiles: string[] = [videoPath, audioPath];

    try {
      // Extract compact mono audio — 32 kbps ≈ 2.4 MB / 10 min
      await runFfmpeg([
        "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        audioPath,
      ]);

      const { size: audioSize } = await fs.stat(audioPath);
      let allSegs: Array<{ text: string; start: number; end: number }> = [];

      if (audioSize <= GEMINI_INLINE_LIMIT) {
        allSegs = await transcribeChunk(ai, audioPath, 0);
      } else {
        req.log.info({ audioSize }, "Audio too large for single Gemini call — chunking");
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
          tempFiles.push(chunkPath);
          const segs = await transcribeChunk(ai, chunkPath, i * CHUNK_SECS);
          allSegs.push(...segs);
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
