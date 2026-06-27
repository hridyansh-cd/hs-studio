---
name: HS Studio bug fixes
description: Bugs found and fixed during the deep code audit of hs-studio + api-server
---

## Touch events (Timeline.tsx)
Trim handles (`onMouseDown`) and segment drag initiation (`onMouseDown`) only fired on desktop. Fixed by adding `onTouchStart` to all handle divs and adding `touchmove`/`touchend` to every `window.addEventListener` block in the trim-drag and segment-drag `useEffect` hooks. Touch events use `e.touches[0].clientX`; `{passive: false}` is required on `touchmove` so `e.preventDefault()` can block page scroll during drag.

**Why:** Mobile browsers fire touch events, not mouse events, so drag was completely broken on phones.

## useAudioWaveform OOM (useAudioWaveform.ts)
`videoFile.arrayBuffer()` loads the entire video into RAM. Added an 80 MB size guard — files larger than 80 MB skip waveform generation (empty bars, setLoading(false)) without crashing.

**Why:** 100 MB+ videos on mobile would cause out-of-memory crashes before any AudioContext work began.

## useProject.loadSaved safety (useProject.ts)
`loadSaved()` was calling `setProject(p)` directly. Changed to `setProject({ ...DEFAULT_PROJECT, ...p })` so any field added to DEFAULT_PROJECT after a project was saved (e.g. `cuts`, `credits`, `timelineZoom`) is correctly back-filled when loading old saves.

**Why:** Old localStorage saves missing newer fields would silently render undefined throughout App.tsx, causing subtle runtime errors.

## API integrations
- Gemini 2.5 Flash: chat.ts and analyzeFrame.ts — reads GEMINI_API_KEY env var, uses @google/genai SDK.
- Gladia v2: transcribe.ts — reads GLADIA_API_KEY, extracts audio with ffmpeg, uploads to Gladia /v2/upload, polls /v2/pre-recorded, groups word timestamps into CapCut-style 3-word subtitle cards.
- All OpenAI/Whisper references removed from the codebase.

## TypeScript
`pnpm exec tsc --noEmit` in artifacts/hs-studio passes with zero errors after all fixes.
