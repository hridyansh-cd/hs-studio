---
name: HS Studio workflow setup
description: How HS Studio and API Server workflows are configured and why.
---

Two manual workflows run the app:
- "HS Studio": `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/hs-studio run dev` (port 3000, webview)
- "API Server": `PORT=8080 pnpm --filter @workspace/api-server run dev` (port 8080, console)

The artifact-registered workflows (`artifacts/hs-studio: web`, `artifacts/api-server: API Server`) exist but are NOT_STARTED — that's expected; the manual ones handle serving.

**Why:** The artifact.toml for hs-studio had `PORT=22223` which is not in Replit's supported port list (3000, 3001, 3002, 3003, 4200, 5000, 5173, 6000, 6800, 8000, 8008, 8080, 8099, 9000). Updated artifact.toml to PORT=3000 and run manually.

**API proxy:** vite.config.ts now has `proxy: { "/api": { target: "http://localhost:8080" } }` so frontend fetch("/api/...") calls route to the API server.

**How to apply:** If workflows need to be restarted, use the exact commands above with explicit PORT and BASE_PATH env vars.
