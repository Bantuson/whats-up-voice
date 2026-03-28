---
phase: 04-voice-pipeline-cron
plan: "01"
subsystem: tts
tags: [elevenlabs, websocket, tts, audio-streaming, opus]

# Dependency graph
requires:
  - phase: 03-agent-intelligence
    provides: Claude agent tools and voice command route that call pushInterrupt
  - phase: 02-webhook-heartbeat
    provides: WebSocket session scaffold in server.ts and ws/manager.ts stub
provides:
  - ElevenLabsClient TTS wrapper (streamSpeech) that streams opus audio over WebSocket
  - Per-user WebSocket registry with registerConnection, getConnection, removeConnection, pushInterrupt
  - audio_start / audio_end control frame framing around binary chunks
  - Language-aware model selection (eleven_flash_v2_5 for en, eleven_multilingual_v2 for af)
affects:
  - 04-02-voice-command (calls pushInterrupt to deliver TTS audio to user)
  - 04-03-cron-briefing (calls pushInterrupt for morning briefing audio)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy singleton ElevenLabsClient — created on first use so tests override env vars before instantiation"
    - "Dynamic import inside pushInterrupt breaks circular dependency between ws/connections and tts/elevenlabs"
    - "Try/catch in streamSpeech swallows all errors — audio failure must never crash process"
    - "audio_start JSON frame sent before first binary chunk; audio_end sent after last chunk"

key-files:
  created:
    - src/ws/connections.ts
    - src/tts/elevenlabs.ts
    - tests/tts.test.ts
  modified:
    - src/env.ts
    - src/server.ts

key-decisions:
  - "Dynamic import in pushInterrupt breaks ws/connections <-> tts/elevenlabs circular dependency — tts imports getConnection statically, connections imports streamSpeech dynamically"
  - "outputFormat locked to opus_48000_32 on every call — never mp3_44100_128 or SDK default"
  - "ElevenLabsClient used exclusively — ElevenLabs constructor throws TypeError at runtime"
  - "Lazy singleton _client pattern matches src/tools/ambient.ts — enables Bun mock.module test interception"
  - "ws/manager.ts kept intact — queue/worker.ts Phase 2 heartbeat stub still imports from it; Plan 04-02 will migrate"

patterns-established:
  - "pushInterrupt(userId, text) is the sole public entry point for audio delivery — no direct ws.send() from callers"
  - "No-throw audio: streamSpeech wraps entire operation in try/catch and logs errors"

requirements-completed: [VOICE-03, VOICE-04, CONTACT-01]

# Metrics
duration: 4min
completed: 2026-03-28
---

# Phase 4 Plan 01: ElevenLabs TTS + WebSocket Audio Push Summary

**ElevenLabsClient streaming TTS wrapper with per-user WebSocket registry, opus_48000_32 framing, and language-aware model selection for English and Afrikaans**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-28T11:32:51Z
- **Completed:** 2026-03-28T11:36:12Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments

- Created `src/ws/connections.ts` with registerConnection, getConnection, removeConnection, pushInterrupt — the single point of entry for audio delivery to any user
- Created `src/tts/elevenlabs.ts` with lazy ElevenLabsClient singleton, language-driven model selection, and proper audio_start / binary chunks / audio_end framing over WebSocket
- Wired `src/server.ts` to use `registerConnection`/`removeConnection` from connections.ts, replacing the old wsConnections Map usage
- Added `ELEVENLABS_VOICE_ID_EN` and `ELEVENLABS_VOICE_ID_AF` to startup env validation in `src/env.ts`
- All 6 behavioral tests in `tests/tts.test.ts` pass (framing order, binary chunks, model selection, pushInterrupt delegation)

## Task Commits

1. **Task 1: Create src/ws/connections.ts** - `ee98fa2` (feat)
2. **Task 2: Create src/tts/elevenlabs.ts** - `7f6f5ad` (feat)
3. **Task 3: Extend env.ts and update server.ts** - `2539c74` (feat)
4. **Task 4: Write tests/tts.test.ts** - `0865b90` (test)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `src/ws/connections.ts` — Per-user WebSocket registry; pushInterrupt dynamically imports streamSpeech to avoid circular dep
- `src/tts/elevenlabs.ts` — ElevenLabsClient streaming wrapper; selectModel/selectVoiceId for en/af; full try/catch
- `src/env.ts` — Added ELEVENLABS_VOICE_ID_EN, ELEVENLABS_VOICE_ID_AF to REQUIRED_ENV_VARS
- `src/server.ts` — Replaced wsConnections import with registerConnection/removeConnection from ws/connections
- `tests/tts.test.ts` — 6 tests: audio_start frame, binary chunks, audio_end frame, af/en model selection, pushInterrupt delegation

## Decisions Made

- Dynamic import inside `pushInterrupt` breaks the circular dependency: `tts/elevenlabs` imports `getConnection` statically from `ws/connections`, and `ws/connections` imports `streamSpeech` dynamically inside `pushInterrupt` — static/dynamic asymmetry resolves the cycle cleanly
- `opus_48000_32` output format is hardcoded at every call site — never the SDK default (MP3)
- `ElevenLabsClient` class used (not the `ElevenLabs` constructor) — plan specifies the constructor throws TypeError at runtime
- Lazy `_client` singleton initialized on first call to `getClient()` — mirrors the pattern in `src/tools/ambient.ts` to allow Bun mock.module to override the env var before the constructor fires
- `ws/manager.ts` left untouched — `queue/worker.ts` still imports it; Plan 04-02 will replace that reference with `pushInterrupt`

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The pre-existing `tsconfig.json` rootDir vs tests/ conflict (TS6059 errors) is unrelated to this plan and affects the entire project.

## User Setup Required

Two new environment variables must be added to `.env` before starting the server:

```
ELEVENLABS_VOICE_ID_EN=<your-en-voice-id>
ELEVENLABS_VOICE_ID_AF=<your-af-voice-id>
```

These are validated at startup — server will refuse to start if missing.

## Next Phase Readiness

- `pushInterrupt(userId, text)` is wired and tested — Plans 04-02 and 04-03 can call it immediately
- `registerConnection`/`removeConnection` replace the old wsConnections Map in server.ts — WebSocket lifecycle is fully managed
- No blockers for 04-02 (voice command audio delivery) or 04-03 (morning briefing cron)

## Self-Check: PASSED

- FOUND: src/ws/connections.ts
- FOUND: src/tts/elevenlabs.ts
- FOUND: tests/tts.test.ts
- FOUND commit: ee98fa2 (Task 1)
- FOUND commit: 7f6f5ad (Task 2)
- FOUND commit: 2539c74 (Task 3)
- FOUND commit: 0865b90 (Task 4)
- Tests: 6 pass, 0 fail

---
*Phase: 04-voice-pipeline-cron*
*Completed: 2026-03-28*
