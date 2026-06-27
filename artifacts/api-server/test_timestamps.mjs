import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "fs";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("No GEMINI_API_KEY"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey });
const b64 = readFileSync("./test_audio.mp3").toString("base64");

// TEST 1: word-level timestamps
console.log("=== TEST 1: Word-level timestamps ===");
const r1 = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: `This is a 15-second audio clip. Transcribe word by word. For each word or short phrase (1-3 words), provide the EXACT start and end timestamp in seconds.
Return ONLY valid JSON: { "segments": [ { "text": "word", "start": 0.0, "end": 0.5 } ] }
Be as precise as possible — these will drive subtitle sync.` },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.0 }
});
console.log(r1.text);

// TEST 2: sentence-level timestamps
console.log("\n=== TEST 2: Sentence-level timestamps ===");
const r2 = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: `Transcribe this audio. Return each spoken phrase with start/end in seconds.
Return ONLY valid JSON: { "segments": [ { "text": "phrase", "start": 0.0, "end": 3.5 } ] }` },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.0 }
});
console.log(r2.text);

// TEST 3: free-form — what does Gemini actually say about this audio?
console.log("\n=== TEST 3: Free-form description with timing ===");
const r3 = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { text: "Describe exactly what you hear in this audio, including when each sound starts and ends (in seconds)." },
    { inlineData: { mimeType: "audio/mpeg", data: b64 } }
  ]}],
  config: { maxOutputTokens: 1024, temperature: 0.0 }
});
console.log(r3.text);
