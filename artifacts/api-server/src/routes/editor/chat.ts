import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const SYSTEM_PROMPT = `You are an AI video editing assistant inside HS Studio, a professional browser-based video editor.

The user is editing a video on a multi-track timeline. You can understand natural-language editing requests and respond with both a helpful message AND an optional structured action to apply to the timeline.

## Available actions
- **cut**: remove a section of the video. Requires a start and end time in seconds.
- **zoom**: add a zoom-in or zoom-out effect. Requires a start/end time and effect type.
- **subtitle**: trigger speech-to-text transcription of the video's audio using Whisper AI.
- **null**: no action needed — just answer the question conversationally.

## Context you receive
- currentTime: playhead position in seconds
- duration: total video duration in seconds  
- hasVideo: whether a video is loaded
- effects: existing effects on the timeline
- cuts: existing cut regions
- subtitleCount: number of existing subtitles

## Response format
Always respond with ONLY valid JSON (no markdown, no backticks):
{
  "message": "string — friendly, helpful reply shown to the user (max 2 sentences)",
  "command": "cut" | "zoom" | "subtitle" | null,
  "cut": { "start": number, "end": number } | null,
  "effect": { "type": "zoom-in" | "zoom-out" | "fade-in" | "fade-out", "label": string, "start": number, "end": number } | null
}

## Rules
- If no video is loaded and the user requests an edit, set command to null and explain they need to upload a video first.
- For cuts: infer start/end from context. If user says "cut the next 5 seconds" use currentTime as start. If they say "cut from 0:10 to 0:20" parse those times. Default cut duration is 5 seconds.
- For zoom: default duration is 4 seconds starting at currentTime. Infer zoom-in vs zoom-out from the request.
- For subtitle: always set command to "subtitle" and set cut/effect to null.
- "cut" in "cut" field must never overlap with existing cuts if possible.
- Times must be within [0, duration].
- Be concise and encouraging in your message. Don't repeat what you just did — describe the outcome.`;

interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  currentTime: number;
  duration: number;
  hasVideo: boolean;
  effects?: Array<{ type: string; start: number; end: number }>;
  cuts?: Array<{ start: number; end: number }>;
  subtitleCount?: number;
}

interface ChatAction {
  message: string;
  command: "cut" | "zoom" | "subtitle" | null;
  cut: { start: number; end: number } | null;
  effect: { type: string; label: string; start: number; end: number } | null;
}

router.post("/editor/chat", async (req, res): Promise<void> => {
  const body = req.body as ChatRequest;
  const { messages, currentTime, duration, hasVideo, effects = [], cuts = [], subtitleCount = 0 } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }

  const client = new OpenAI({ apiKey });

  const contextNote = `[Video context: currentTime=${currentTime.toFixed(1)}s, duration=${duration.toFixed(1)}s, hasVideo=${hasVideo}, existingEffects=${effects.length}, existingCuts=${cuts.length}, subtitleCount=${subtitleCount}]`;

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.slice(-12).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.role === "user" ? `${contextNote}\n${m.content}` : m.content,
    })),
  ];

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: openaiMessages,
      temperature: 0.4,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let action: ChatAction;
    try {
      action = JSON.parse(raw) as ChatAction;
    } catch {
      action = {
        message: raw,
        command: null,
        cut: null,
        effect: null,
      };
    }

    if (!action.message) action.message = "Done!";
    if (!["cut", "zoom", "subtitle"].includes(action.command as string)) action.command = null;
    if (action.command !== "cut")   action.cut    = null;
    if (action.command !== "zoom")  action.effect = null;

    res.json(action);
  } catch (err: unknown) {
    req.log.error({ err }, "GPT chat failed");
    const msg = err instanceof Error ? err.message : "AI request failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
