import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

router.post("/editor/analyze-frame", async (req, res): Promise<void> => {
  const {
    imageBase64,
    currentTime = 0,
    duration = 0,
    cuts = [],
    effects = [],
    subtitleCount = 0,
  } = req.body as {
    imageBase64: string;
    currentTime: number;
    duration: number;
    cuts: Array<{ start: number; end: number }>;
    effects: Array<{ type: string; start: number; end: number }>;
    subtitleCount: number;
  };

  if (!imageBase64) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an expert video editor. Analyze this single video frame and return exactly 2-3 specific, actionable edit suggestions.

Video context:
- Frame captured at: ${currentTime.toFixed(1)}s of ${duration.toFixed(1)}s total
- Existing effects on timeline: ${effects.length}
- Existing cut regions: ${cuts.length}
- Subtitle count: ${subtitleCount}

Look carefully at the frame: subject composition, lighting, motion blur, scene type (talking head, b-roll, action, title card, etc.), and suggest edits that would improve the video.

Return ONLY valid JSON with no markdown:
{
  "suggestions": [
    {
      "title": "3-5 word title",
      "description": "One sentence: what you see in the frame and why this edit improves it.",
      "command": "cut" | "zoom" | null,
      "cut": { "start": number, "end": number } | null,
      "effect": { "type": "zoom-in" | "zoom-out" | "fade-in" | "fade-out", "label": string, "start": number, "end": number } | null
    }
  ]
}

Rules:
- Return 2-3 suggestions total
- "command" must match: if command="cut" then cut must be non-null; if command="zoom" then effect must be non-null; if command=null both are null
- All timestamps must be within [0, ${duration.toFixed(1)}]
- For zoom-in: good for close-up faces, text on screen, key moments — use 3-4s duration from currentTime
- For zoom-out: good for wide establishing shots, transitions out — use 3-4s duration from currentTime
- For cut: suggest removing a section if the scene looks like dead air, repeated content, or has a natural break point — use a 3-5s window
- For null command: give a general observation about the scene (e.g. "Good lighting here", "Natural pause point")
- Be specific about what you see — mention visual elements like faces, text, background, brightness, blur`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 1024,
        temperature: 0.4,
      },
    });

    const raw = response.text ?? '{"suggestions":[]}';
    let parsed: { suggestions: unknown[] };
    try {
      parsed = JSON.parse(raw) as { suggestions: unknown[] };
    } catch {
      parsed = { suggestions: [] };
    }

    if (!Array.isArray(parsed.suggestions)) parsed.suggestions = [];
    res.json({ suggestions: parsed.suggestions.slice(0, 3) });
  } catch (err: unknown) {
    req.log.error({ err }, "Gemini frame analysis failed");
    const msg = err instanceof Error ? err.message : "Analysis failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
