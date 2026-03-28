---
phase: 04-voice-pipeline-cron
verified: 2026-03-28T10:45:00Z
status: passed
score: 25/25 must-haves verified
re_verification: false
human_verification:
  - test: "ElevenLabs TTS delivers audio to a live WebSocket client"
    expected: "Client receives { type: 'audio_start' }, then binary Opus chunks, then { type: 'audio_end' }"
    why_human: "Requires a running server with valid ELEVENLABS_API_KEY, a live WebSocket client (e.g. wscat), and a test user record in Supabase"
  - test: "Morning briefing fires at 07:00 Mon–Fri via BullMQ scheduler"
    expected: "Server logs show '[Cron Worker] Job completed' at 07:00, WebSocket client receives audio briefing"
    why_human: "Requires a running Redis instance, at least one user_profile row, and waiting for the cron window — cannot be verified without live infrastructure"
  - test: "Afrikaans user receives eleven_multilingual_v2 TTS audio"
    expected: "User with language='af' in user_profile hears audio spoken in Afrikaans via correct model"
    why_human: "Requires live ElevenLabs credentials and a user_profile row with language='af'"
---

# Phase 4: Voice Pipeline + Cron Verification Report

**Phase Goal:** Full voice pipeline — ElevenLabs TTS streaming, STT via Whisper, Twilio voice note playback, BullMQ scheduled cron routines (morning briefing + evening digest), and CONTACT-01 interrupt delivering real audio

**Verified:** 2026-03-28T10:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/tts/elevenlabs.ts` exports `streamSpeech(text, userId)` that streams Uint8Array chunks to the user's WebSocket | ✓ VERIFIED | Lines 27-75: full implementation with chunk loop |
| 2 | `streamSpeech` selects `eleven_flash_v2_5` for `language='en'` and `eleven_multilingual_v2` for `language='af'` | ✓ VERIFIED | Lines 17-19: `selectModel()` — exact branch logic present |
| 3 | `streamSpeech` uses `outputFormat: 'opus_48000_32'` on every call | ✓ VERIFIED | Line 56: hardcoded `outputFormat: 'opus_48000_32'` |
| 4 | `ElevenLabsClient` is used — never the `ElevenLabs` constructor | ✓ VERIFIED | Line 5: `import { ElevenLabsClient }` |
| 5 | Voice IDs read from `ELEVENLABS_VOICE_ID_EN` and `ELEVENLABS_VOICE_ID_AF` env vars | ✓ VERIFIED | Lines 23-24: `process.env.ELEVENLABS_VOICE_ID_AF!` / `...EN!` |
| 6 | `src/ws/connections.ts` exports `registerConnection`, `getConnection`, `removeConnection`, `pushInterrupt` | ✓ VERIFIED | Lines 9-28: all four exports present |
| 7 | `pushInterrupt(userId, text)` calls `streamSpeech` via dynamic import — no JSON stub | ✓ VERIFIED | Lines 26-27: `const { streamSpeech } = await import('../tts/elevenlabs'); await streamSpeech(text, userId)` |
| 8 | `{ type: 'audio_start' }` sent before first binary chunk | ✓ VERIFIED | Line 50: `ws.send(JSON.stringify({ type: 'audio_start' }))` before chunk loop |
| 9 | `{ type: 'audio_end' }` sent after last binary chunk | ✓ VERIFIED | Line 70: `ws.send(JSON.stringify({ type: 'audio_end' }))` after loop |
| 10 | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_AF` validated in `src/env.ts` at startup | ✓ VERIFIED | Lines 8-10 of env.ts: all three in `REQUIRED_ENV_VARS` |
| 11 | `src/server.ts` `/ws/session/:userId` uses `registerConnection` / `removeConnection` from `ws/connections` | ✓ VERIFIED | Line 23: import; lines 86/90: `registerConnection(userId, ws)` / `removeConnection(userId)` |
| 12 | `POST /api/voice/command` accepts multipart with `audioBlob`; calls Whisper `whisper-1` | ✓ VERIFIED | Lines 77-109 of api.ts: full multipart branch with Whisper call |
| 13 | Whisper called with user's profile language code via `toFile()` helper | ✓ VERIFIED | Lines 88-104: language fetched from `user_profile`, passed as `language: lang` |
| 14 | After agent response, `streamSpeech(spoken, userId)` called via TTS module (non-blocking) | ✓ VERIFIED | Lines 52-54: `streamSpeech(spoken, userId).catch(...)` in `deliverSpoken()` helper |
| 15 | Session transitions to `'playing'` before TTS call, `'idle'` after | ✓ VERIFIED | Lines 44/58: two `transition()` calls in `deliverSpoken()` |
| 16 | JSON text path (VOICE-01) fully preserved — `{ userId, transcript }` still works | ✓ VERIFIED | Lines 110-118: `else` branch preserves original JSON path |
| 17 | `POST /api/voice/playback` accepts `{ userId, mediaUrl }`, fetches Twilio CDN with Basic auth, streams binary frames | ✓ VERIFIED | Lines 237-283 of api.ts: full implementation |
| 18 | Twilio media fetch auth uses `Authorization: Basic base64(SID:TOKEN)` | ✓ VERIFIED | Lines 256-258: exact header construction |
| 19 | Playback route sends `audio_start` / `audio_end` control frames | ✓ VERIFIED | Lines 269/278: both control frames present |
| 20 | `src/queue/worker.ts` `pushInterrupt` calls `connections.pushInterrupt` — no JSON stub | ✓ VERIFIED | Lines 132-136: dynamic import of `connections.pushInterrupt` |
| 21 | `src/cron/routines.ts` exports `syncUserRoutines()` using `upsertJobScheduler` with correct scheduler IDs | ✓ VERIFIED | Lines 29-74: `morning_briefing:${userId}`, `evening_digest:${userId}`, `reminder:${userId}:${id}` |
| 22 | `morning_briefing` uses pattern `'0 7 * * 1-5'`; `evening_digest` uses `'0 18 * * *'` | ✓ VERIFIED | Lines 26-27: constants present; lines 44/51: used in `upsertJobScheduler` |
| 23 | `src/cron/morningBriefing.ts` double-fire guard skips within 55s, runs after | ✓ VERIFIED | Lines 14-19: `wasRecentlyRun()` with `55_000ms` window; lines 90-93: guard check |
| 24 | Morning briefing spoken order: greeting → load shedding → weather → digest | ✓ VERIFIED | Line 109: `[greeting, loadSheddingText, weatherText, digestText].join(' ')` |
| 25 | Priority contacts appear before non-priority in digest | ✓ VERIFIED | Lines 52-56: sort with `is_priority ? 0 : 1` weight |

**Score:** 25/25 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tts/elevenlabs.ts` | ElevenLabs streaming TTS wrapper | ✓ VERIFIED | 75 lines; full implementation with lazy singleton, model selection, chunk streaming |
| `src/ws/connections.ts` | Per-user WS registry + pushInterrupt | ✓ VERIFIED | 28 lines; all 4 exports present; dynamic import breaks circular dependency |
| `src/cron/routines.ts` | BullMQ scheduler sync | ✓ VERIFIED | 74 lines; lazy cronQueue, correct scheduler IDs and patterns |
| `src/cron/morningBriefing.ts` | Morning briefing processor | ✓ VERIFIED | 123 lines; double-fire guard, parallel fetch, priority sort, pushInterrupt delivery |
| `src/routes/api.ts` | Voice command + STT + playback routes | ✓ VERIFIED | 350 lines; multipart branch, deliverSpoken helper, /voice/playback route |
| `src/queue/worker.ts` | Upgraded pushInterrupt (real TTS) | ✓ VERIFIED | Lines 132-136: dynamic import pattern replacing JSON stub |
| `src/server.ts` | Startup wiring: cron worker + syncUserRoutines | ✓ VERIFIED | Lines 25-53: CronWorker registered, syncUserRoutines() called at startup |
| `src/env.ts` | ElevenLabs voice ID vars validated | ✓ VERIFIED | Lines 9-10: both vars in REQUIRED_ENV_VARS |
| `tests/tts.test.ts` | 6 TTS behavioral tests | ✓ VERIFIED | 6 tests pass: framing, model selection, pushInterrupt delegation |
| `tests/voiceCommand.test.ts` | 18 voice command tests (13 original + 5 new) | ✓ VERIFIED | 18 tests pass; STT path, TTS wiring, session transitions, CONTACT-01, playback |
| `tests/cron.test.ts` | 7+ cron behavioral tests | ✓ VERIFIED | 8 tests pass (1 extra): scheduler IDs, patterns, double-fire guard, briefing order, priority sort |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `api.ts` POST /voice/command | `src/tts/elevenlabs.ts` | `streamSpeech(spoken, userId)` in `deliverSpoken()` | ✓ WIRED | Line 15: import; line 52: non-blocking call |
| `api.ts` POST /voice/playback | `ws/connections.ts` | `getConnection(userId)` + `ws.send()` | ✓ WIRED | Line 251: dynamic import; lines 269-278: send calls |
| `ws/connections.ts` pushInterrupt | `tts/elevenlabs.ts` streamSpeech | Dynamic import to break cycle | ✓ WIRED | Line 26: `await import('../tts/elevenlabs')` |
| `tts/elevenlabs.ts` streamSpeech | `ws/connections.ts` getConnection | Static import | ✓ WIRED | Line 7: static import; line 43: `getConnection(userId)` |
| `queue/worker.ts` pushInterrupt | `ws/connections.ts` pushInterrupt | Dynamic import | ✓ WIRED | Line 133: `await import('../ws/connections')` |
| `server.ts` | `cron/routines.ts` syncUserRoutines | Import + startup call | ✓ WIRED | Line 25: import; line 53: `syncUserRoutines().catch(...)` |
| `server.ts` | `cron/morningBriefing.ts` processMorningBriefing | CronWorker job handler | ✓ WIRED | Line 26: import; lines 35-39: job dispatch |
| `cron/morningBriefing.ts` | `ws/connections.ts` pushInterrupt | Static import | ✓ WIRED | Line 7: import; line 112: `await pushInterrupt(userId, briefingText)` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `tts/elevenlabs.ts` | `stream` (ReadableStream) | `ElevenLabsClient.textToSpeech.stream()` | Yes — live API call | ✓ FLOWING |
| `cron/morningBriefing.ts` | `briefingText` | `toolGetLoadShedding`, `toolGetWeather`, `getOvernightDigest` | Yes — DB + external APIs | ✓ FLOWING |
| `routes/api.ts` multipart | `transcript` | `OpenAI.audio.transcriptions.create()` | Yes — live Whisper call | ✓ FLOWING |
| `routes/api.ts` playback | binary chunks | `fetch(mediaUrl)` with Basic auth | Yes — streamed from Twilio CDN | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 6 TTS tests pass | `bun test tests/tts.test.ts` | 6 pass, 0 fail | ✓ PASS |
| 18 voiceCommand tests pass | `bun test tests/voiceCommand.test.ts` | 18 pass, 0 fail | ✓ PASS |
| 8 cron tests pass | `bun test tests/cron.test.ts` | 8 pass, 0 fail | ✓ PASS |
| No regressions in full suite | `bun test` | 183 pass, 11 fail (pre-existing infra/DB failures only) | ✓ PASS |

Note: 11 pre-existing failures are in `tests/schema.test.ts` (INFRA-03, INFRA-04) and `tests/security.test.ts` (ISO-01, INFRA-05) — these require live Supabase and a running server respectively. They existed before phase 04 and are unrelated to this phase's code.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VOICE-01 | 04-02 | POST /api/voice/command accepts `{ userId, transcript }` | ✓ SATISFIED | Lines 110-118 api.ts: JSON path preserved; 2 tests cover 400 + happy path |
| VOICE-02 | 04-02 | Whisper STT with language hint for EN/AF | ✓ SATISFIED | Lines 77-109 api.ts: multipart branch; test 14 passes |
| VOICE-03 | 04-01 | ElevenLabs TTS with eleven_flash_v2_5 / eleven_multilingual_v2 | ✓ SATISFIED | elevenlabs.ts lines 17-19; tests 4+5 of tts.test.ts |
| VOICE-04 | 04-01, 04-02 | TTS output streamed via WebSocket with audio_start/audio_end frames | ✓ SATISFIED | connections.ts + elevenlabs.ts; tts.test.ts tests 1-3 |
| VOICE-05 | 04-02 | Voice notes fetched from Twilio media URL, streamed to device | ✓ SATISFIED | api.ts lines 237-283; test 18 (playback describe block) |
| CRON-01 | 04-03 | BullMQ job scheduler polls routines table; fires morning_briefing at 0 7 * * 1-5 | ✓ SATISFIED | routines.ts; cron tests 1-3 verify scheduler IDs and patterns |
| CRON-02 | 04-03 | Double-fire protection: skip if last_run within 55 seconds | ✓ SATISFIED | morningBriefing.ts lines 14-19, 90-93; cron tests 4-5 |
| CRON-03 | 04-03 | Briefing order: greeting → load shedding → weather → digest; priority contacts first | ✓ SATISFIED | morningBriefing.ts line 109 + sort; cron tests 6-8 |
| CRON-04 | 04-03 | Evening digest (0 18 * * *) and custom reminders via routines table | ✓ SATISFIED | routines.ts lines 51-70; cron test 3 verifies evening pattern |
| CONTACT-01 | 04-01, 04-02 | Unknown number interrupt delivers TTS audio via pushInterrupt — no JSON stub | ✓ SATISFIED | worker.ts lines 66-72 call pushInterrupt; worker pushInterrupt dynamically imports connections.pushInterrupt; test 17 (voiceCommand) |

**Note on REQUIREMENTS.md checkbox state:** VOICE-01, VOICE-02, VOICE-05 checkboxes remain `[ ]` in `.planning/REQUIREMENTS.md`. The code fully implements all three; the document was not updated after phase completion. This is a documentation housekeeping gap only — not a code gap.

---

### Anti-Patterns Found

None. All phase 04 files scanned for TODOs, FIXMEs, placeholder comments, empty return values, and hardcoded stubs. Clean.

Notable design patterns confirmed correct:
- Lazy singletons (`getClient()`, `getOpenAI()`, `getCronQueue()`) prevent test-mock-order issues
- Dynamic import in `pushInterrupt` (`await import('../tts/elevenlabs')`) correctly breaks circular dependency
- `streamSpeech` wrapped in try/catch with no rethrow — audio failure cannot crash the server process

---

### Human Verification Required

#### 1. ElevenLabs TTS Live Audio Delivery

**Test:** Connect `wscat -c ws://localhost:3000/ws/session/test-user-001`, then call `bun -e "const { pushInterrupt } = await import('./src/ws/connections'); await pushInterrupt('test-user-001', 'Hello from TTS')"` in a second terminal.
**Expected:** wscat receives `{"type":"audio_start"}`, followed by binary Opus audio frames, then `{"type":"audio_end"}`. Audio plays correctly on device.
**Why human:** Requires running server with valid ELEVENLABS_API_KEY and a Supabase user_profile row.

#### 2. Morning Briefing Cron Fire

**Test:** With a seeded user_profile row and running Redis, wait for 07:00 Mon–Fri (or manually enqueue: `bun -e "const { getCronQueue } = await import('./src/cron/routines'); const q = await getCronQueue(); await q.add('morning_briefing', { userId: 'YOUR_USER_ID' })"`)
**Expected:** Server logs `[Cron Worker] Job completed: <id>` and `[Cron] Morning briefing delivered to YOUR_USER_ID`. WebSocket client receives full audio briefing.
**Why human:** Requires live Redis, Supabase user_profile, and ElevenLabs credentials.

#### 3. Afrikaans TTS Model Selection at Runtime

**Test:** Insert a user_profile row with `language='af'`, then trigger a voice command or briefing for that user.
**Expected:** ElevenLabs API called with `modelId: 'eleven_multilingual_v2'` and `ELEVENLABS_VOICE_ID_AF`. Audio is audibly different from English model.
**Why human:** Requires live credentials and database.

---

### Gaps Summary

No gaps. All 25 observable truths verified. All 10 requirement IDs (VOICE-01 through VOICE-05, CRON-01 through CRON-04, CONTACT-01) have implementation evidence in the codebase. All 32 phase-04 tests pass.

The only open item is that REQUIREMENTS.md checkboxes for VOICE-01, VOICE-02, and VOICE-05 were not updated from `[ ]` to `[x]` after implementation. This does not affect runtime behavior.

---

_Verified: 2026-03-28T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
