import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const b64 = readFileSync("./speech_test.mp3").toString("base64");
const durationSecs = 3.24;

// ── Test A: Word-level timestamps ──────────────────────────────────────────
console.log("=== TEST A: Prompt asking for word-level timestamps ===");
const rA = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: `Transcribe this ${durationSecs}s audio. For EACH WORD individually, give its exact start and end time in seconds.
Return ONLY valid JSON:
{"segments":[{"text":"word","start":0.0,"end":0.5}]}` },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.0 }
});
const segA = JSON.parse(rA.text ?? "{}");
console.log("Segments returned:", segA?.segments?.length ?? 0);
console.log("Raw:", rA.text?.slice(0, 600));

// ── Test B: Ask Gemini to describe timing freely ───────────────────────────
console.log("\n=== TEST B: Free-form timing description ===");
const rB = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: `Listen carefully to this ${durationSecs}-second audio clip. Tell me:
1. Exactly what words are spoken
2. Approximately when (in seconds) each word starts
Be honest if you cannot determine precise word timing.` },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { maxOutputTokens: 1024, temperature: 0.0 }
});
console.log(rB.text);

// ── Test C: Does Gemini acknowledge timestamp limitations? ─────────────────
console.log("\n=== TEST C: Explicit capability probe ===");
const rC = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: `For this audio, I need subtitle synchronization accurate to within 0.1 seconds per word. Can you provide that level of timestamp precision? If yes, do it. If no, explain the limitation.
Audio transcription with word timestamps:
{"segments":[{"text":"word","start":0.0,"end":0.5}]}` },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { maxOutputTokens: 1024, temperature: 0.0 }
});
console.log(rC.text);
