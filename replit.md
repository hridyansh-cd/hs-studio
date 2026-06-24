# HS Studio

A premium dark-themed video editor with a 3-panel layout, AI chat assistant, multi-track timeline, real trim tool, effects system, and project persistence.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/hs-studio run dev` — run the frontend (port 22223)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React 19, Vite, Tailwind CSS, shadcn/ui

## Where things live

```
artifacts/hs-studio/src/
  App.tsx                   — 3-panel layout orchestrator
  types/index.ts            — all TypeScript types (Subtitle, Effect, Project, …)
  lib/
    commands.ts             — processCommand() — AI command parsing + result
    project.ts              — localStorage save/load + DEFAULT_PROJECT
    utils.ts                — cn() utility
  hooks/
    useProject.ts           — project state + autosave + typed mutators
    useEffectPreview.ts     — computes live CSS style from active effect at currentTime
  components/
    Timeline.tsx            — multi-track timeline (VID/SUB/FX, trim handles, effect editing)
    ui/                     — shadcn components
```

API server:
```
artifacts/api-server/src/
  routes/editor/sessions.ts — GET/POST /api/editor/sessions, GET /api/editor/sessions/:id
  db/schema/sessions.ts     — sessions table (id, name, createdAt)
```

## Architecture decisions

- **Project state lives in localStorage** (`hs-studio-project`), auto-saved on a 1s debounce via `useProject`. The backend session is used only for project name display.
- **Effect live preview** uses `useEffectPreview` — a pure `useMemo` hook that maps `(effects, currentTime)` → CSS `{ transform, opacity }`. Applied to the video wrapper div so effects are visible during playback without touching the video element.
- **Timeline is pixel-based** — `totalPx = containerWidth * zoom`. At 1× the video fills the container; at higher zoom it becomes scrollable. `timeToX` and `clientXToTime` both account for `scrollLeft`.
- **Credits** are pure frontend state (50 starting, 5 per AI command). OpenAI/Whisper subtitle generation is deferred until `OPENAI_API_KEY` is provided.
- **Trim handles** use global `mousemove`/`mouseup` listeners attached when drag starts, detached on mouseup — prevents stale closures.

## Product

**Phase 1 complete:**
1. Multi-track timeline — VIDEO (with drag trim handles), SUBTITLE, EFFECTS tracks; time ruler; playhead; zoom 1×–16×; track visibility toggles
2. Real trim tool — drag start/end handles on the video track; trim region highlighted; stored in project
3. Video metadata panel — name, duration, resolution, aspect ratio, file size, format
4. Effects system — zoom-in, zoom-out, fade-in, fade-out; created via AI "zoom" command; click to select + change type; delete; live CSS preview on video
5. AI chat — cut/subtitle/zoom commands; unknown commands show guidance; 50 CR credit system
6. Project persistence — localStorage auto-save + manual Save/Load with timestamp
7. Playback — Play/Pause, Skip ±5s, frame-accurate scrubber, subtitle overlay

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use `restart_workflow` or per-package `--filter` commands.
- `tsc -p tsconfig.json --noEmit` (typecheck) is the correct verification command for leaf packages, not `build`.
- The frontend uses path alias `@/` → `src/`. All new imports should use this alias.
- Whisper subtitle generation requires `OPENAI_API_KEY` env secret — not yet provided.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
