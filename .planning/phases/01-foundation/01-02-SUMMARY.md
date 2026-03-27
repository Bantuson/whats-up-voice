---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [bun, hono, typescript, supabase, bullmq, ioredis, websocket, bearer-auth, cors]

# Dependency graph
requires:
  - phase: none
    provides: no upstream dependencies — Wave 1 standalone
provides:
  - Bun/Hono server process on port 3000 with validated env startup guard
  - CORS middleware configured for frontend origin
  - Bearer token auth on /api/* routes
  - Raw body capture middleware on /webhook/* (HMAC-ready for Phase 2)
  - Health check endpoint GET /health
  - WebSocket upgrade route /ws/session/:userId with per-user Map registry
  - Singleton service_role Supabase client
  - All Phase 1–4 dependencies installed in package.json
  - Test suite for health + auth behavior
affects: [02-webhook-heartbeat, 03-agent-intelligence, 04-voice-pipeline-cron]

# Tech tracking
tech-stack:
  added:
    - hono@4.12.9 (HTTP framework with Bun adapter)
    - "@supabase/supabase-js@2.100.1 (DB client)"
    - zod@4.3.6 (schema validation)
    - bullmq@5.71.1 (job queue)
    - ioredis@5.10.1 (Redis client for BullMQ)
    - "@anthropic-ai/sdk@0.80.0 (Claude agent SDK)"
    - openai@6.33.0 (Whisper STT + embeddings)
    - "@elevenlabs/elevenlabs-js@2.40.0 (TTS)"
  patterns:
    - validateEnv() called as first statement in server.ts before any imports that use process.env
    - Raw body capture middleware registered BEFORE all app.route() calls (HMAC correctness constraint)
    - service_role Supabase client never calls auth.setSession() or accepts request headers
    - wsConnections Map<userId, WSContext> cleared on close — no stale entries

key-files:
  created:
    - src/server.ts
    - src/env.ts
    - src/db/client.ts
    - src/ws/manager.ts
    - src/routes/health.ts
    - src/routes/webhook.ts
    - src/routes/api.ts
    - tests/health.test.ts
    - .env.example
    - package.json
    - tsconfig.json
  modified: []

key-decisions:
  - "Raw body capture middleware registered before all routes — correctness constraint for Phase 2 HMAC"
  - "All Phase 1-4 packages installed in single bun add — keeps package.json stable across phases"
  - "Bearer auth scoped to /api/* only — /health and /webhook/* intentionally unprotected"
  - "WebSocket route stores connection in wsConnections Map by userId — per-user isolation (ISO-03)"
  - "validateEnv() called before any route module imports to prevent access to undefined process.env values"

patterns-established:
  - "Pattern: HMAC middleware ordering — app.use('/webhook/*') must be first middleware in server.ts"
  - "Pattern: Env validation at process start — validateEnv() before Bun.serve() and before route imports"
  - "Pattern: Supabase singleton — never create new client per request, always import from src/db/client.ts"

requirements-completed: [INFRA-04, INFRA-05, ISO-03]

# Metrics
duration: 13min
completed: 2026-03-27
---

# Phase 1 Plan 2: Hono Server Skeleton Summary

**Bun/Hono server skeleton with validateEnv() startup guard, HMAC-ready raw body middleware, Bearer auth on /api/*, per-user WebSocket registry, and all Phase 1-4 dependencies installed**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-27T19:59:17Z
- **Completed:** 2026-03-27T20:12:30Z
- **Tasks:** 3
- **Files modified:** 11 created + 2 modified (package.json, tsconfig.json)

## Accomplishments

- Full Bun/Hono server skeleton with correct middleware registration order (critical for Phase 2 HMAC)
- Environment validation throws immediately on missing any of 11 required vars — server exits non-zero
- All packages for Phases 1–4 installed in a single bun add — no mid-phase package.json changes needed
- 4 tests passing: health endpoint, Bearer auth rejection, Bearer auth acceptance, unprotected health route

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project, install all dependencies, configure TypeScript** - `5e8f878` (chore)
2. **Task 2: Create src/env.ts, src/db/client.ts, src/ws/manager.ts, src/routes/*.ts, src/server.ts** - `188d5b1` (feat)
3. **Task 3: Write tests/health.test.ts** - `64a611b` (test)
4. **Chore: Add .gitignore and README** - `78170f8` (chore)

## Files Created/Modified

- `src/server.ts` — Entry point: validateEnv(), raw body capture, CORS, Bearer auth, routes, WebSocket
- `src/env.ts` — validateEnv() throws on missing any of 11 required env vars
- `src/db/client.ts` — Singleton service_role Supabase client (autoRefreshToken: false, persistSession: false)
- `src/ws/manager.ts` — Map<userId, WSContext> for per-user WebSocket connection registry
- `src/routes/health.ts` — GET /health → {status: 'ok', timestamp: ISO}
- `src/routes/webhook.ts` — Scaffold for Phase 2 HMAC handler (GET/POST /webhook/whatsapp)
- `src/routes/api.ts` — Scaffold for Phase 4 voice command route (POST /api/voice/command → 501)
- `tests/health.test.ts` — 4 tests: health 200, auth 401, auth non-401, health no-token
- `.env.example` — All 11 required vars documented with comments
- `package.json` — All dependencies + start/dev/test scripts
- `tsconfig.json` — ES2022, bundler moduleResolution, strict, bun-types

## Decisions Made

- Raw body capture middleware registered before all routes — this is a correctness constraint, not style. If registered after any route, Hono's body stream may be consumed before Phase 2's HMAC middleware runs.
- Bearer auth scoped to `/api/*` only — `/health` is intentionally open (uptime monitors), `/webhook/*` is secured by HMAC (Phase 2).
- All 8 packages for Phases 1–4 installed now — avoids package resolution surprises mid-phase.

## Deviations from Plan

None — plan executed exactly as written. The `.gitignore` and `README.md` generated by `bun init` were updated/committed as a chore task not in the plan but necessary for clean git state.

## Known Stubs

- `src/routes/webhook.ts` — GET and POST handlers return scaffold responses. Phase 2 replaces these with HMAC verification and message handling.
- `src/routes/api.ts` — POST /api/voice/command returns 501. Phase 4 implements the voice pipeline.
- `src/ws/manager.ts` — WebSocket Map registered and populated, but message handling is a no-op log. Phase 4 handles inbound audio frames.

These stubs are intentional scaffolds — they do not prevent Plan 2's goal (server starts, routes respond correctly, auth works). They are the extension points for subsequent phases.

## Issues Encountered

No `.env` file existed in the project — created a test `.env` with placeholder values so `bun test` can run the integration test (which calls `validateEnv()`). The `.env` is gitignored and not committed. `.env.example` documents all required variables.

## Next Phase Readiness

- Phase 2 (Webhook + Heartbeat): Webhook scaffold and raw body capture are in place. Phase 2 adds HMAC verification logic to `src/routes/webhook.ts`.
- Phase 3 (Agent Intelligence): `@anthropic-ai/sdk` installed. `src/agent/` directory ready.
- Phase 4 (Voice Pipeline): `@elevenlabs/elevenlabs-js` and `openai` installed. `src/ws/manager.ts` ready for audio frame delivery.
- Plan 3 (Session Machine + Classifier): Can run in parallel — `src/session/` and `src/agent/` directories created.

---
*Phase: 01-foundation*
*Completed: 2026-03-27*
