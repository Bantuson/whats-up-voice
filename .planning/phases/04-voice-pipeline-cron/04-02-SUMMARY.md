---
phase: 04-voice-pipeline-cron
plan: "02"
subsystem: api
tags: [whisper, elevenlabs, tts, stt, websocket, twilio, openai, hono]

# Dependency graph
requires:
  - phase: 04-01
    provides: streamSpeech, pushInterrupt, getConnection from ws/connections and tts/elevenlabs

provides:
  - POST /api/voice/command multipart/form-data path for Whisper STT (VOICE-02)
  - TTS delivery via streamSpeech after every agent spoken response (VOICE-04)
  - Session transitions playing/idle around TTS delivery
  - POST /api/voice/playback Twilio CDN media streaming endpoint (VOICE-05)
  - pushInterrupt replaced — worker delivers real TTS audio not JSON stub (CONTACT-01)

affects:
  - 04-03-morning-briefing-cron
  - 05-tests-frontend-demo

# Tech tracking
tech-stack:
  added:
    - openai (Whisper whisper-1 STT via audio.transcriptions.create)
    - toFile() helper for File → OpenAI File conversion
  patterns:
    - Lazy OpenAI singleton (getOpenAI()) — same pattern as getAnthropic() in orchestrator
    - deliverSpoken() helper — non-blocking TTS fire-and-forget with session transitions
    - multipart/form-data content-type branch for audio input vs JSON text input
    - dynamic import inside playback route (../ws/connections) for tree-shaking

key-files:
  created:
    - src/ws/connections.ts (dependency: per-user WSContext registry + pushInterrupt)
    - src/tts/elevenlabs.ts (dependency: ElevenLabsClient streaming wrapper)
  modified:
    - src/routes/api.ts (STT path, TTS wiring, deliverSpoken helper, playback route)
    - src/queue/worker.ts (replaced pushInterrupt stub with real TTS delivery)
    - src/env.ts (added ELEVENLABS_VOICE_ID_EN, ELEVENLABS_VOICE_ID_AF)
    - tests/voiceCommand.test.ts (18 tests total — 5 new + 13 original)
    - tests/setup.ts (added all missing env vars for integration test compatibility)

key-decisions:
  - "deliverSpoken fires streamSpeech non-blocking (fire-and-forget) — JSON response returns immediately, audio arrives via WebSocket independently"
  - "STT path uses supabase user_profile language for Whisper language hint before transcription"
  - "Playback route uses dynamic import for ws/connections to avoid circular dependency at module load"
  - "worker.ts pushInterrupt uses dynamic import for ws/connections — same circular-safe pattern"
  - "src/ws/connections.ts and src/tts/elevenlabs.ts created in this plan as 04-01 parallel worktree dependency files"
  - "tests/setup.ts extended with all REQUIRED_ENV_VARS — health.test.ts was failing due to missing env vars"

patterns-established:
  - "deliverSpoken(c, userId, spoken, action, rest) pattern for all spoken response paths"
  - "transition(playing) → fire streamSpeech → transition(idle) sequence for session state around TTS"

requirements-completed: [VOICE-01, VOICE-02, VOICE-04, VOICE-05, CONTACT-01]

# Metrics
duration: 28min
completed: "2026-03-28"
---

# Phase 4 Plan 02: Voice Command Route + STT + Twilio Playback Summary

**Whisper STT audio input, ElevenLabs TTS delivery after every agent response, Twilio media streaming endpoint, and CONTACT-01 real audio interrupt — full voice round-trip live**

## Performance

- **Duration:** 28 min
- **Started:** 2026-03-28T11:33:18Z
- **Completed:** 2026-03-28T12:01:37Z
- **Tasks:** 4 (+ 1 Rule 3 auto-fix for dependency files)
- **Files modified:** 7

## Accomplishments

- Extended `POST /api/voice/command` to accept multipart/form-data with `audioBlob` field, calling Whisper whisper-1 with user's profile language for SA-native transcription
- Wired `streamSpeech` after every spoken response via non-blocking `deliverSpoken()` helper with explicit `playing → idle` session transitions
- Added `POST /api/voice/playback` endpoint that fetches Twilio CDN media with Basic auth and streams binary audio chunks to the user's WebSocket
- Replaced the Phase 2 JSON stub in `worker.ts pushInterrupt` with real TTS delivery via `connections.pushInterrupt`

## Task Commits

1. **Rule 3 auto-fix: dependency modules** - `8e119be` (feat)
2. **Task 1+2: STT, TTS wiring, playback route** - `137570a` (feat)
3. **Task 3: worker pushInterrupt replacement** - `4607d45` (feat)
4. **Task 4: 5 new tests + env setup fixes** - `b5dca94` (test)

## Files Created/Modified

- `src/ws/connections.ts` - Per-user WSContext registry with registerConnection, getConnection, removeConnection, pushInterrupt (dependency module created as Rule 3 auto-fix)
- `src/tts/elevenlabs.ts` - ElevenLabsClient streaming wrapper with audio_start/audio_end framing (dependency module created as Rule 3 auto-fix)
- `src/routes/api.ts` - STT multipart path, deliverSpoken() TTS helper, session transitions, POST /api/voice/playback route
- `src/queue/worker.ts` - pushInterrupt stub replaced with real connections.pushInterrupt delegation
- `src/env.ts` - Added ELEVENLABS_VOICE_ID_EN and ELEVENLABS_VOICE_ID_AF to required vars
- `tests/voiceCommand.test.ts` - 18 tests total (13 original + 5 new for STT, TTS, transitions, CONTACT-01, playback)
- `tests/setup.ts` - All REQUIRED_ENV_VARS now seeded for integration test compatibility

## Decisions Made

- `deliverSpoken` fires `streamSpeech` non-blocking — HTTP response returns immediately, audio delivered via WebSocket independently (latency-first design)
- STT language hint reads from `user_profile.language` — `af` for Afrikaans, `en` otherwise — giving Whisper a language hint for better SA transcription accuracy
- Playback route uses dynamic import for `ws/connections` (avoids module-load circular dependency)
- `worker.ts pushInterrupt` uses dynamic import for `ws/connections` — same circular-safe pattern as TTS module

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created missing dependency files src/ws/connections.ts and src/tts/elevenlabs.ts**
- **Found during:** Pre-execution analysis
- **Issue:** Plan 04-02 imports from `../tts/elevenlabs` and `../ws/connections` which are supposed to be created by plan 04-01, running in a separate parallel worktree. These files did not exist in this worktree.
- **Fix:** Created both files from the 04-01 plan spec (interfaces, implementation rules, and circular-safe import pattern all specified there).
- **Files modified:** src/ws/connections.ts (new), src/tts/elevenlabs.ts (new)
- **Verification:** TypeScript compiles without errors; all 18 tests pass.
- **Committed in:** 8e119be

**2. [Rule 2 - Missing Critical] Extended tests/setup.ts with all required env vars**
- **Found during:** Task 4 (test execution — `bun test --bail`)
- **Issue:** `health.test.ts` was crashing at import time because `validateEnv()` requires env vars (including newly added ELEVENLABS_VOICE_ID_EN/AF) that were not seeded in setup.ts. This caused the full suite to fail on import.
- **Fix:** Added all missing required vars (OPENAI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID_EN/AF, WHATSAPP_*, REDIS_URL, API_BEARER_TOKEN) to `tests/setup.ts`.
- **Files modified:** tests/setup.ts
- **Verification:** `bun test` now shows 169 pass (same as before my changes in non-integration tests); health.test.ts no longer crashes on validateEnv.
- **Committed in:** b5dca94

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary — dependency files needed for imports to work, env seeding needed for test runner not to crash.

## Issues Encountered

- `health.test.ts` INFRA-04 and INFRA-05 tests still fail (pre-existing, require a running server that connects successfully to the health endpoint). These failures existed before this plan and are out of scope.
- `schema.test.ts` and `isolation.test.ts` failures are pre-existing (require real Supabase credentials).

## Known Stubs

None — all data paths are wired. TTS calls are real (streamSpeech invokes ElevenLabs), Whisper calls are real, Twilio fetch is real. No hardcoded placeholders in the response path.

## Next Phase Readiness

- Full voice round-trip is now live: audio in (Whisper) → agent → audio out (ElevenLabs via WebSocket)
- Plan 04-03 (morning briefing cron) can use `pushInterrupt` from `ws/connections` directly
- Plan 04-01's work (when merged) will override the dependency modules created here — the interfaces match exactly

---
*Phase: 04-voice-pipeline-cron*
*Completed: 2026-03-28*
