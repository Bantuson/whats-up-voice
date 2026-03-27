---
phase: 02-webhook-heartbeat
plan: "02"
subsystem: infra
tags: [bullmq, ioredis, redis, queue, worker, dedup]

requires:
  - phase: 01-foundation
    provides: server.ts skeleton with validateEnv(), REDIS_URL env var validated at startup

provides:
  - ioredis singleton exported as `redis` from src/queue/heartbeat.ts (maxRetriesPerRequest=null)
  - BullMQ heartbeatQueue bound to shared redis connection
  - HeartbeatJobData interface (shared type for webhook + worker plans)
  - enqueueHeartbeat() with SET NX EX 7200 dedup gate — returns false on duplicate
  - heartbeatWorker stub (concurrency=5) registered at server startup via side-effect import
  - scripts/test-queue.ts for validating end-to-end queue flow without real webhook traffic

affects: [02-01, 02-03, phase-3-agent-intelligence]

tech-stack:
  added: []
  patterns:
    - "Shared ioredis singleton pattern: export const redis from heartbeat.ts, imported by worker.ts — ensures Queue + Worker share identical connection config"
    - "Side-effect import pattern: import './queue/worker' in server.ts boots worker as module load side effect"
    - "Dedup gate: SET key 1 EX 7200 NX before enqueue — idempotent against WhatsApp retry delivery"
    - "Separate queue/heartbeat.ts from queue/worker.ts — heartbeat.ts is test-importable without spawning a real worker"

key-files:
  created:
    - src/queue/heartbeat.ts
    - src/queue/worker.ts
    - scripts/test-queue.ts
  modified:
    - src/server.ts

key-decisions:
  - "Shared redis singleton exported from heartbeat.ts and imported by worker.ts — BullMQ requires Queue and Worker to use the same ioredis connection config (maxRetriesPerRequest=null); a single export guarantees this"
  - "Worker split into worker.ts separate from heartbeat.ts — keeps heartbeat.ts importable in tests without spawning live ioredis connections or BullMQ workers"
  - "timeout: 15_000 included in job options — BullMQ v5 accepts timeout in JobsOptions; confirmed no type error"

patterns-established:
  - "Queue/Worker separation: queue module (heartbeat.ts) is importable without side effects; worker module (worker.ts) has connection side effects and is always boot-time imported"

requirements-completed: [HB-01]

duration: 2min
completed: 2026-03-27
---

# Phase 2 Plan 02: BullMQ + ioredis Setup Summary

**ioredis singleton + BullMQ heartbeatQueue + dedup-gated enqueueHeartbeat() with stub worker wired into server startup**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-27T21:57:11Z
- **Completed:** 2026-03-27T21:58:50Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `src/queue/heartbeat.ts` with IORedis singleton (maxRetriesPerRequest=null constraint enforced), BullMQ Queue, HeartbeatJobData interface, and dedup-gated enqueueHeartbeat() using SET NX EX 7200
- Created `src/queue/worker.ts` with stub processHeartbeat processor and heartbeatWorker (concurrency=5) with completed/failed event listeners
- Wired worker into server.ts via side-effect import so it boots before the server accepts requests
- Created scripts/test-queue.ts to validate full flow (enqueue, dedup block, worker process) without needing a live webhook

## Task Commits

Each task was committed atomically:

1. **Task 1: ioredis singleton + BullMQ Queue + enqueueHeartbeat** - `07c3c02` (feat)
2. **Task 2: BullMQ worker stub + server.ts wiring + synthetic test script** - `fadf76a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/queue/heartbeat.ts` - IORedis singleton, BullMQ Queue, HeartbeatJobData type, enqueueHeartbeat() with dedup
- `src/queue/worker.ts` - BullMQ Worker stub with event listeners; Plan 02-03 replaces processHeartbeat body
- `src/server.ts` - Added `import './queue/worker'` side-effect import after wsConnections
- `scripts/test-queue.ts` - One-shot script: enqueue synthetic job, verify dedup, wait for worker, exit

## Decisions Made
- Shared redis singleton exported from heartbeat.ts imported by worker.ts — guarantees both use identical ioredis config (maxRetriesPerRequest=null required by BullMQ)
- worker.ts separated from heartbeat.ts — heartbeat.ts is importable in unit tests without spawning live connections
- timeout: 15_000 included in job add() options — BullMQ v5 JobsOptions accepts it; no type errors in queue files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing tsconfig issues (bun-types not installed, rootDir/tests mismatch) produce unrelated tsc errors — out of scope for this plan. No queue-related type errors detected.

## User Setup Required

Redis connection required. Set `REDIS_URL` environment variable (Upstash `rediss://` URL or local `redis://localhost:6379`). ioredis handles TLS automatically when `rediss://` scheme is used.

## Next Phase Readiness
- Plan 02-01 can now import `enqueueHeartbeat` and `HeartbeatJobData` from `src/queue/heartbeat.ts`
- Plan 02-03 can import `processHeartbeat` from `src/queue/worker.ts` to replace the stub with the real surface decision gate
- Worker boots at server startup — ready to process jobs immediately after Redis connects

## Self-Check: PASSED

- FOUND: src/queue/heartbeat.ts
- FOUND: src/queue/worker.ts
- FOUND: scripts/test-queue.ts
- FOUND: .planning/phases/02-webhook-heartbeat/02-02-SUMMARY.md
- FOUND commit: 07c3c02
- FOUND commit: fadf76a

---
*Phase: 02-webhook-heartbeat*
*Completed: 2026-03-27*
