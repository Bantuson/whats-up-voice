---
phase: 02-webhook-heartbeat
plan: "03"
subsystem: queue
tags: [bullmq, ioredis, redis, heartbeat, bun-test, quiet-hours, websocket, supabase]

requires:
  - phase: 01-foundation
    provides: session/machine.ts (getPhase), ws/manager.ts (wsConnections), db/client.ts (supabase), lib/phone.ts (formatPhoneForSpeech)
  - phase: 02-webhook-heartbeat plan 02-02
    provides: src/queue/heartbeat.ts (HeartbeatJobData, redis singleton, enqueueHeartbeat)

provides:
  - Pure isQuietHours() + parseTimeHour() with overnight range support (HB-06)
  - Full six-priority surface decision gate replacing BullMQ worker stub (HB-02, HB-03, HB-04, HB-05)
  - Unknown number interrupt with digit-by-digit phone speech (CONTACT-01)
  - WebSocket JSON text frame stub for interrupt delivery (Phase 4 TTS drop-in)
  - logDecision() writing all decisions to heartbeat_log
  - 25 unit tests covering gate logic without requiring live Redis or Supabase

affects: [03-agent-intelligence, 04-voice-pipeline-cron, 05-tests-frontend-demo]

tech-stack:
  added: [bullmq, ioredis]
  patterns:
    - Pure functions extracted for I/O-free testability (quietHours.ts)
    - All Supabase queries include .eq('user_id', userId) — service_role bypasses RLS
    - pushInterrupt() signature locked for Phase 4 drop-in replacement
    - Gate priorities encoded as numbered STEP comments in processHeartbeat()

key-files:
  created:
    - src/lib/quietHours.ts
    - src/queue/heartbeat.ts
    - src/queue/worker.ts
    - tests/quietHours.test.ts
    - tests/heartbeat.test.ts
  modified: []

key-decisions:
  - "isQuietHours() receives currentHour as parameter — enables deterministic testing without wall-clock mocking"
  - "parseTimeHour() returns null for null/malformed — gate skips quiet hours if profile missing (safe default: allow)"
  - "supabase .single() on user_contacts returns data=null for unknown phone (PGRST116) — gate treats null as unknown number without re-throwing"
  - "pushInterrupt() logs only when no WebSocket connected — never throws, never blocks gate"
  - "heartbeat.ts created in this plan to provide full BullMQ implementation (Plan 02-02 ran in parallel worktree)"
  - "batch decision = log only in Phase 2 — in-memory digest wired in Phase 4 morning briefing worker"

patterns-established:
  - "Pattern 1: Extract I/O-free logic to lib/ for pure testability — avoids Supabase/Redis mocking in unit tests"
  - "Pattern 2: Gate priority as numbered STEP comments — readable decision flow without nested if-else pyramid"
  - "Pattern 3: logDecision() + pushInterrupt() as private helpers — single responsibility in processHeartbeat()"

requirements-completed: [HB-02, HB-03, HB-04, HB-05, HB-06, CONTACT-01]

duration: 8min
completed: 2026-03-28
---

# Phase 2 Plan 03: Heartbeat Surface Decision Gate Summary

**Six-priority heartbeat gate with pure quiet-hours logic, WebSocket interrupt stub, and 25 unit tests — all six decision paths implemented (quiet hours, priority contact, unknown number, session skip, voice note, batch)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-27T21:58:20Z
- **Completed:** 2026-03-28T00:08:00Z
- **Tasks:** 3
- **Files modified:** 5 created

## Accomplishments

- Pure `isQuietHours()` function handles overnight ranges (22:00–07:00) correctly — 15 tests
- Full `processHeartbeat()` gate replaces stub with all six HB-02 priority decisions
- Unknown number flow (CONTACT-01) uses `formatPhoneForSpeech()` for digit-by-digit speech
- `pushInterrupt()` sends `{ type: 'interrupt', spoken }` JSON frame — Phase 4 drop-in ready
- `logDecision()` writes every decision to `heartbeat_log` (HB-05)
- 10 heartbeat gate logic tests verify decision classification without live Redis/Supabase

## Task Commits

1. **Task 1: Pure quiet-hours logic + tests** - `e14b769` (feat)
2. **Task 2: Surface decision gate + queue infrastructure** - `288a484` (feat)
3. **Task 3: Heartbeat gate tests** - `1eb140c` (test)

## Files Created/Modified

- `src/lib/quietHours.ts` — Pure `isQuietHours()` + `parseTimeHour()` functions (HB-06 overnight range)
- `src/queue/heartbeat.ts` — BullMQ Queue + ioredis singleton + `HeartbeatJobData` type + `enqueueHeartbeat()` with 2-hour dedup
- `src/queue/worker.ts` — Full six-priority `processHeartbeat()` gate + `heartbeatWorker` BullMQ Worker registration
- `tests/quietHours.test.ts` — 15 tests: overnight/daytime ranges, boundaries, edge cases, parseTimeHour
- `tests/heartbeat.test.ts` — 10 tests: gate logic for quiet hours, phone formatting, decision validation, session skip states

## Decisions Made

- `isQuietHours()` receives `currentHour` as an injected parameter (default `new Date().getHours()`) — enables deterministic testing without wall-clock mocking
- `parseTimeHour()` returns `null` for null/malformed input — gate skips quiet hours when profile is missing (safe default: allow delivery)
- `supabase .single()` on `user_contacts` returns `{ data: null }` for unknown phone (PGRST116) — gate treats `data === null` as unknown number without re-throwing the error
- `pushInterrupt()` only logs when no WebSocket is connected — never throws, never blocks the gate decision
- `heartbeat.ts` created with full BullMQ implementation in this plan because Plan 02-02 ran in a parallel worktree
- `batch` decision = log to `heartbeat_log` only in Phase 2 — in-memory digest wired in Phase 4 morning briefing worker

## Deviations from Plan

### Auto-added Infrastructure

**1. [Rule 3 - Blocking] Created src/queue/heartbeat.ts with full BullMQ implementation**
- **Found during:** Task 2 (worker.ts imports from ./heartbeat)
- **Issue:** Plans 02-01 and 02-02 ran as parallel worktrees; heartbeat.ts was not present in this worktree
- **Fix:** Created full `src/queue/heartbeat.ts` from Plan 02-02 spec (ioredis singleton, BullMQ Queue, HeartbeatJobData type, enqueueHeartbeat with dedup)
- **Files modified:** src/queue/heartbeat.ts
- **Verification:** worker.ts imports resolve correctly; no new TypeScript errors
- **Committed in:** 288a484 (Task 2 commit)

---

**Total deviations:** 1 auto-added (Rule 3 blocking — parallel worktree dependency)
**Impact on plan:** Required for worker.ts to compile. Matches Plan 02-02 spec exactly — no scope creep.

## Issues Encountered

- Pre-existing tsconfig.json errors (rootDir/bun-types) exist from Phase 1 — not caused by this plan. No new type errors introduced.

## User Setup Required

None — no external service configuration required for this plan. Redis URL must be set in `.env` before server startup (carried over from Phase 2 infrastructure requirement).

## Next Phase Readiness

- Heartbeat gate complete — Plan 03-agent-intelligence can wire `enqueueHeartbeat()` calls through the full decision pipeline
- `pushInterrupt()` signature locked: `async function pushInterrupt(userId: string, spoken: string): Promise<void>` — Phase 4 replaces body with TTS audio push
- `batch` decision currently logs only — Phase 4 morning briefing worker reads `heartbeat_log` for digest
- 25 tests running in under 300ms (no live Redis/Supabase required)

---
*Phase: 02-webhook-heartbeat*
*Completed: 2026-03-28*
