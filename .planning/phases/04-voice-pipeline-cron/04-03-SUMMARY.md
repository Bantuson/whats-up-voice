---
phase: 04-voice-pipeline-cron
plan: 04-03
subsystem: cron
tags: [bullmq, cron, morning-briefing, tts, double-fire-guard]
dependency_graph:
  requires: [04-01]
  provides: [syncUserRoutines, processMorningBriefing, getCronQueue]
  affects: [src/server.ts, src/cron/routines.ts, src/cron/morningBriefing.ts]
tech_stack:
  added: [src/cron/routines.ts, src/cron/morningBriefing.ts, src/ws/connections.ts, src/tts/elevenlabs.ts]
  patterns: [lazy-singleton-queue, dynamic-import-heartbeat, bullmq-upsertJobScheduler]
key_files:
  created:
    - src/cron/routines.ts
    - src/cron/morningBriefing.ts
    - src/ws/connections.ts
    - src/tts/elevenlabs.ts
    - tests/cron.test.ts
  modified:
    - src/server.ts
decisions:
  - "[04-03] cronQueue uses lazy getCronQueue() async factory — same pattern as orchestrator.ts — so Bun test mock.module('bullmq') intercepts Queue constructor before first use"
  - "[04-03] src/ws/connections.ts stub created (04-01 dependency) — exports registerConnection/getConnection/removeConnection/pushInterrupt as required by morningBriefing.ts"
  - "[04-03] src/tts/elevenlabs.ts stub created — ElevenLabsClient with audio_start/audio_end framing, language-based model selection (eleven_flash_v2_5/eleven_multilingual_v2)"
metrics:
  duration: "~12 minutes"
  completed: "2026-03-28"
  tasks: 4
  files: 6
---

# Phase 4 Plan 3: BullMQ Cron + Morning Briefing Worker Summary

BullMQ scheduled cron routines with morning briefing processor: greeting, load shedding, weather, overnight message digest with priority-contact sorting, double-fire guard (55s window), and TTS delivery via pushInterrupt.

## What Was Built

**src/cron/routines.ts** — `syncUserRoutines()` fetches all users from `user_profile`, calls `queue.upsertJobScheduler()` for `morning_briefing` (pattern: `0 7 * * 1-5`) and `evening_digest` (pattern: `0 18 * * *`) per user, and registers custom reminders from the `routines` table. Queue is initialized lazily via `getCronQueue()` (async factory, dynamic import of heartbeat redis) so Bun test mocks intercept BullMQ before first queue creation.

**src/cron/morningBriefing.ts** — `processMorningBriefing()` implements: (1) double-fire guard checking `routines.last_run` within 55 seconds; (2) parallel fetch of `toolGetLoadShedding`, `toolGetWeather`, and overnight digest from `message_log`; (3) spoken order: greeting → load shedding → weather → digest; (4) priority contact sorting in digest (is_priority contacts appear first); (5) delivery via `pushInterrupt(userId, briefingText)`; (6) upsert of `last_run` timestamp.

**src/ws/connections.ts** — Per-user WebSocket connection registry (dependency stub for 04-01): exports `registerConnection`, `getConnection`, `removeConnection`, `pushInterrupt`. Uses lazy import of `streamSpeech` from `../tts/elevenlabs`.

**src/tts/elevenlabs.ts** — ElevenLabsClient wrapper stub: `streamSpeech(text, userId)` fetches user language, selects `eleven_flash_v2_5` (en) or `eleven_multilingual_v2` (af), streams with `opus_48000_32` format, sends `audio_start`/`audio_end` JSON control frames.

**src/server.ts** — `CronWorker` registered on `'cron'` queue; `syncUserRoutines()` called at startup after worker creation.

**tests/cron.test.ts** — 8 tests: 3 for `syncUserRoutines()` (scheduler IDs, morning pattern, evening pattern), 2 for double-fire guard (skip within 55s, run after 55s), 3 for briefing content (load shedding before weather, priority contacts first, pushInterrupt called with assembled text).

## Verification Results

```
bun test tests/cron.test.ts
8 pass, 0 fail
```

TypeScript: no errors in src/cron/routines.ts, src/cron/morningBriefing.ts, src/server.ts (pre-existing rootDir config errors in test files only, not introduced by this plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Eager Queue initialization prevented test mocking**
- **Found during:** Task 4 (test execution)
- **Issue:** `export const cronQueue = new Queue('cron', { connection: redis })` at module level caused BullMQ Queue to be instantiated with the real redis before `mock.module('bullmq')` could intercept it. Tests timed out at 5s waiting for Redis operations.
- **Fix:** Converted to lazy `getCronQueue(): Promise<Queue>` async factory with `_cronQueue` singleton, using `await import('../queue/heartbeat')` for dynamic redis access. Same pattern as `src/agent/orchestrator.ts` lazy Anthropic singleton (documented in STATE.md).
- **Files modified:** `src/cron/routines.ts`
- **Commit:** 64a68eb

**2. [Rule 3 - Blocking] src/ws/connections.ts did not exist (04-01 dependency not executed)**
- **Found during:** Task 2 (creating morningBriefing.ts imports)
- **Issue:** `morningBriefing.ts` imports `pushInterrupt` from `../ws/connections` but Plan 04-01 had not been executed in this worktree.
- **Fix:** Created `src/ws/connections.ts` with correct exports (`registerConnection`, `getConnection`, `removeConnection`, `pushInterrupt`) and `src/tts/elevenlabs.ts` stub with ElevenLabsClient implementation. Plan 04-01 can overwrite with full implementation.
- **Files modified:** `src/ws/connections.ts`, `src/tts/elevenlabs.ts` (new files)
- **Commit:** 59d0f1f

## Known Stubs

- `src/tts/elevenlabs.ts` — `streamSpeech()` implementation is functional but Plan 04-01 may override with improved lazy-singleton ElevenLabsClient pattern. Current implementation queries user_profile for language selection on every call (not cached).
- `src/ws/connections.ts` — Plan 04-01 defines this file as its primary output. The stub here fulfills the interface contract but Plan 04-01 may add additional behavior.

## Self-Check: PASSED

All created files exist on disk. All task commits verified in git log:
- 04927cb: src/cron/routines.ts
- 59d0f1f: src/cron/morningBriefing.ts, src/ws/connections.ts, src/tts/elevenlabs.ts
- 96a7b0b: src/server.ts (cron wiring)
- 64a68eb: tests/cron.test.ts + lazy Queue fix
