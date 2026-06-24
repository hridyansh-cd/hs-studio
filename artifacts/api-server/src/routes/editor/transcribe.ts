import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — Whisper API hard limit
});

router.post(
  "/editor/transcribe",
  upload.single("video"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server" });
      return;
    }

    const openai = new OpenAI({ apiKey });

    try {
      const file = await toFile(req.file.buffer, req.file.originalname, {
        type: req.file.mimetype,
      });

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      const subtitles = (transcription.segments ?? []).map((seg, i) => ({
        id: `sub-${Date.now()}-${i}`,
        text: seg.text.trim(),
        start: seg.start,
        end: seg.end,
      }));

      req.log.info({ count: subtitles.length }, "Transcription complete");
      res.json({ subtitles });
    } catch (err: unknown) {
      req.log.error({ err }, "Transcription failed");
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Transcription failed — unknown error",
      });
    }
  }
);

export default router;
