import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const router = Router();

// ─── Gladia v2 API ────────────────────────────────────────────────────────────
const GLADIA_UPLOAD     = "https://api.gladia.io/v2/upload";
const GLADIA_TRANSCRIBE = "https://api.gladia.io/v2/pre-recorded";
const POLL_INTERVAL_MS  = 2500;
const MAX_POLLS         = 240; // 10 minutes max

// ─── CapCut-style subtitle card settings ─────────────────────────────────────
const MAX_WORDS_PER_CARD = 3;    // max words before forced break
const PAUSE_BREAK_S      = 0.40; // start a new card if silence gap > 400 ms

// ─── Multer (disk storage — avoids loading video into RAM) ───────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Gladia types ─────────────────────────────────────────────────────────────

interface GladiaWord {
  word:        string;
  start:       number; // seconds
  end:         number; // seconds
  confidence?: number;
}

interface GladiaUtterance {
  words?:      GladiaWord[];
  text?:       string;
  start?:      number;
  end?:        number;
}

interface GladiaTranscribeResp {
  id:         string;
  result_url: string;
}

interface GladiaPollResp {
  status:          string; // "queued" | "processing" | "done" | "error"
  error_message?:  string;
  result?: {
    transcription?: {
      utterances?: GladiaUtterance[];
    };
  };
}

// ─── Word → subtitle-card grouping (CapCut style) ────────────────────────────
function groupIntoCards(
  words: GladiaWord[]
): Array<{ text: string; start: number; end: number }> {
  const cards: Array<{ text: string; start: number; end: number }> = [];
  let group: GladiaWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const w    = words[i];
    const prev = words[i - 1];

    const pauseS      = prev ? w.start - prev.end : 0;
    const breakPause  = prev && pauseS > PAUSE_BREAK_S;
    const breakLength = group.length >= MAX_WORDS_PER_CARD;

    if ((breakPause || breakLength) && group.length > 0) {
      cards.push({
        text:  group.map((x) => x.word).join(" ").trim(),
        start: group[0].start,
        end:   group[group.length - 1].end,
      });
      group = [];
    }
    group.push(w);
  }

  if (group.length > 0) {
    cards.push({
      text:  group.map((x) => x.word).join(" ").trim(),
      start: group[0].start,
      end:   group[group.length - 1].end,
    });
  }

  return cards;
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post(
  "/editor/transcribe",
  upload.single("video"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const apiKey = process.env.GLADIA_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "GLADIA_API_KEY is not configured on the server" });
      return;
    }

    const videoPath = req.file.path;
    const id        = crypto.randomUUID();
    const audioPath = path.join(os.tmpdir(), `hs-audio-${id}.mp3`);
    const tempFiles: string[] = [videoPath, audioPath];

    // ── Read optional language hint ───────────────────────────────────────────
    // Multer populates req.body for non-file fields in multipart uploads
    const language = typeof req.body?.language === "string" && req.body.language.trim()
      ? req.body.language.trim()
      : null;

    try {
      // ── 1. Extract audio ──────────────────────────────────────────────────
      // 16 kHz mono is optimal for ASR; 96 kbps gives cleaner signal than 64 kbps
      await runFfmpeg([
        "-i",  videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "96k",
        audioPath,
      ]);

      // ── 2. Upload audio to Gladia ─────────────────────────────────────────
      const audioBuf = await fs.readFile(audioPath);
      const formData = new FormData();
      formData.append(
        "audio",
        new Blob([audioBuf], { type: "audio/mpeg" }),
        "audio.mp3"
      );

      const uploadResp = await fetch(GLADIA_UPLOAD, {
        method:  "POST",
        headers: { "x-gladia-key": apiKey },
        body:    formData,
      });

      if (!uploadResp.ok) {
        const body = await uploadResp.text();
        throw new Error(`Gladia upload failed (${uploadResp.status}): ${body}`);
      }

      const { audio_url } = (await uploadResp.json()) as { audio_url: string };

      // ── 3. Start transcription job ────────────────────────────────────────
      const txResp = await fetch(GLADIA_TRANSCRIBE, {
        method:  "POST",
        headers: { "x-gladia-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url,
          diarization: false,
          // When language is specified, locking it in dramatically improves accuracy.
          // Without it, Gladia auto-detects but may switch mid-video.
          language_config: language
            ? { languages: [language] }
            : { languages: [], code_switching: true },
        }),
      });

      if (!txResp.ok) {
        const body = await txResp.text();
        throw new Error(`Gladia transcription request failed (${txResp.status}): ${body}`);
      }

      const { result_url } = (await txResp.json()) as GladiaTranscribeResp;

      // ── 4. Poll until done ────────────────────────────────────────────────
      let pollResult: GladiaPollResp | null = null;

      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

        const pollResp = await fetch(result_url, {
          headers: { "x-gladia-key": apiKey },
        });

        if (!pollResp.ok) {
          throw new Error(`Gladia poll failed (${pollResp.status})`);
        }

        pollResult = (await pollResp.json()) as GladiaPollResp;

        req.log.debug({ status: pollResult.status, attempt }, "Gladia poll");

        if (pollResult.status === "done")  break;
        if (pollResult.status === "error") {
          throw new Error(
            `Gladia transcription error: ${pollResult.error_message ?? "unknown"}`
          );
        }
      }

      if (!pollResult || pollResult.status !== "done") {
        throw new Error("Gladia transcription timed out after 10 minutes");
      }

      // ── 5. Extract word-level timestamps ──────────────────────────────────
      const utterances = pollResult.result?.transcription?.utterances ?? [];
      const allWords: GladiaWord[] = utterances.flatMap((u) => u.words ?? []);

      if (allWords.length === 0) {
        req.log.warn("Gladia returned no words — no speech detected");
        res.json({ subtitles: [] });
        return;
      }

      // ── 6. Group words into CapCut-style subtitle cards ───────────────────
      const cards     = groupIntoCards(allWords);
      const subtitles = cards.map((card, i) => ({
        id:    `sub-${Date.now()}-${i}`,
        text:  card.text,
        start: card.start,
        end:   card.end,
      }));

      req.log.info(
        { words: allWords.length, cards: subtitles.length },
        "Gladia transcription complete"
      );
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
