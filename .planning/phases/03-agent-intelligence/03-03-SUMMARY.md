---
phase: 03-agent-intelligence
plan: "03"
subsystem: api
tags: [hono, fast-path, intent-classifier, orchestrator, whatsapp, session, approval-loop, three-strike]

requires:
  - phase: 03-01
    provides: toolReadMessages, toolGetLoadShedding, toolGetWeather, toolWebSearch in src/tools/
  - phase: 03-02
    provides: runOrchestrator with 5-second AbortSignal in src/agent/orchestrator.ts
  - phase: 01
    provides: classifyIntent in src/agent/classifier.ts, getState/getPhase/clearSession in src/session/machine.ts

provides:
  - "POST /api/voice/command fully wired: fast-path routing, three-strike approval loop, LLM fallback, WhatsApp send on confirm"
  - "src/env.ts validates 14 env vars including ESKOMSEPUSH_API_KEY, OPENWEATHER_API_KEY, TAVILY_API_KEY"
  - "tests/voiceCommand.test.ts: 13 integration tests for all routing paths"

affects:
  - "phase-04-voice-pipeline (voice command route is the entry point for TTS pipeline)"
  - "phase-05-tests-frontend (voiceCommand integration tests extend here)"

tech-stack:
  added: []
  patterns:
    - "clearUserState() pairs clearSession() + noMatchCounts.delete() atomically — always call this, never bare clearSession() in the route"
    - "Fast-path intents checked before LLM to keep p50 latency < 1ms for covered patterns"
    - "Three-strike counter stored in module-level Map — cleared with session to prevent ghost counts"
    - "handleConfirmSend uses AbortSignal.timeout(5000) on WhatsApp fetch — prevents indefinite hang"
    - "LLM path uses new AbortController + setTimeout(5000) so timeout is cancellable via clearTimeout in finally"

key-files:
  created:
    - tests/voiceCommand.test.ts
  modified:
    - src/routes/api.ts
    - src/env.ts

key-decisions:
  - "noMatchCounts stored as module-level Map<string, number> — cleared atomically with clearSession to prevent ghost strike counts surviving session reset"
  - "clearUserState() wrapper pairs clearSession + noMatchCounts.delete — callers never call clearSession directly to avoid dangling strike count"
  - "web_search intent routes directly to toolWebSearch(transcript) not toolWebSearch(query) — transcript IS the query for fast-path; LLM path handles query extraction for send_message"
  - "handleConfirmSend checks state.phase !== awaiting_approval || !state.pendingMessage as single guard — either missing is an error state"

patterns-established:
  - "Route handler: classifyIntent() called as first statement, before any await, to catch fast-path without parsing session"
  - "TDD: RED commit (failing tests) before GREEN commit (implementation) — both committed separately for audit trail"

requirements-completed:
  - AGENT-05
  - CONTACT-02
  - CONTACT-03
  - CONTACT-04

duration: 5min
completed: 2026-03-28
---

# Phase 3 Plan 03: Voice Command Route Integration Summary

**POST /api/voice/command fully wired: fast-path intent routing, three-strike approval loop, WhatsApp send-on-confirm, and LLM fallback via Claude orchestrator**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-28T08:47:53Z
- **Completed:** 2026-03-28T08:52:24Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced 501 stub with complete voice command handler that routes all 10 intent types
- Implemented three-strike no-match reset (AGENT-05): three consecutive unrecognised inputs while awaiting_approval cancels the pending message and clears session
- Wired handleConfirmSend: fetches WhatsApp Cloud API, inserts message_log with direction=out, clears session atomically
- Added three env var guards (ESKOMSEPUSH_API_KEY, OPENWEATHER_API_KEY, TAVILY_API_KEY) to startup validation — server fails fast if any absent
- 13 integration tests covering all fast-path routes, approval loop edge cases, and orchestrator timeout handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Add new env vars to src/env.ts** - `44470c7` (feat)
2. **Task 2 RED: Add failing voiceCommand tests** - `e5d85c9` (test)
3. **Task 2 GREEN: Wire POST /api/voice/command** - `89c944d` (feat)

**Plan metadata:** see final docs commit

_Note: TDD tasks have separate RED (test) and GREEN (implementation) commits_

## Files Created/Modified

- `src/routes/api.ts` — complete POST /api/voice/command handler; replaces 501 stub; exports apiRouter
- `src/env.ts` — extended REQUIRED_ENV_VARS from 11 to 14 entries
- `tests/voiceCommand.test.ts` — 13 integration tests for all routing paths

## Decisions Made

- `noMatchCounts` stored as module-level `Map<string, number>` and cleared atomically with `clearSession` via `clearUserState()` wrapper — prevents ghost strike counts surviving session reset if caller uses bare `clearSession`
- `web_search` fast-path passes `transcript` (not a parsed query substring) to `toolWebSearch` — the whole transcript is the query string for fast-path; send_message flows where query extraction is needed go through the LLM
- `handleConfirmSend` uses a single combined guard (`phase !== awaiting_approval || !pendingMessage`) because both conditions are required — a session in awaiting_approval without pendingMessage is an invalid state and should return an error

## Deviations from Plan

None — plan executed exactly as written. The implementation matches the code in the plan `<action>` block precisely.

## Issues Encountered

Pre-existing test failures (20 of 172 tests fail before and after these changes) are:
- 7 Supabase integration tests requiring real credentials (schema.test.ts, isolation.test.ts)
- 1 health test requiring full env vars (health.test.ts)
- 12 whatsapp.test.ts + contacts.test.ts failures from mock contamination introduced in 03-01/03-02

None of these are caused by Plan 03-03 changes (confirmed via stash comparison: 33 fail before, 20 fail after, net gain of 13 new passes).

## User Setup Required

None — no new external service configuration required. The three new env vars (ESKOMSEPUSH_API_KEY, OPENWEATHER_API_KEY, TAVILY_API_KEY) are already handled by ambient tools from Plan 03-01.

## Next Phase Readiness

- Phase 3 is complete: classifier, orchestrator, tools, and voice command route all wired together
- Phase 4 (Voice Pipeline + Cron) can plug ElevenLabs TTS into POST /api/voice/command response `spoken` field — the `pushInterrupt(userId, spoken)` stub from Phase 2 is the injection point
- No blockers

## Self-Check: PASSED

- FOUND: src/routes/api.ts
- FOUND: src/env.ts
- FOUND: tests/voiceCommand.test.ts
- FOUND: .planning/phases/03-agent-intelligence/03-03-SUMMARY.md
- FOUND commit: 44470c7 (feat: env vars)
- FOUND commit: e5d85c9 (test: TDD RED)
- FOUND commit: 89c944d (feat: route implementation)

---
*Phase: 03-agent-intelligence*
*Completed: 2026-03-28*
