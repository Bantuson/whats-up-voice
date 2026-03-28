---
phase: "04"
slug: voice-pipeline-cron
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-28
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for the voice pipeline and cron phase.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (bun:test) |
| **Config file** | package.json (`"test": "bun test"`) |
| **Quick run command** | `bun test tests/tts.test.ts tests/cron.test.ts tests/voiceCommand.test.ts --bail` |
| **Full suite command** | `bun test --bail` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test tests/tts.test.ts --bail` or relevant file
- **After every plan wave:** Run `bun test tests/tts.test.ts tests/voiceCommand.test.ts tests/cron.test.ts --bail`
- **Before `/gsd:verify-work`:** Full suite must be green (unit tests; infra/DB tests pre-existing failures ignored)
- **Max feedback latency:** 7 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | VOICE-04 | unit | `bun test tests/tts.test.ts --bail` | ✅ | ✅ green |
| 04-01-02 | 01 | 1 | VOICE-03 | unit | `bun test tests/tts.test.ts --bail` | ✅ | ✅ green |
| 04-01-02b | 01 | 1 | VOICE-03 (outputFormat) | unit | `bun test tests/tts.test.ts --bail` | ✅ | ✅ green |
| 04-01-03 | 01 | 1 | VOICE-03, VOICE-04 | unit | `bun test tests/tts.test.ts --bail` | ✅ | ✅ green |
| 04-01-04 | 01 | 1 | VOICE-03, VOICE-04 | unit | `bun test tests/tts.test.ts --bail` | ✅ | ✅ green |
| 04-02-01 | 02 | 1 | VOICE-01, VOICE-02 | unit | `bun test tests/voiceCommand.test.ts --bail` | ✅ | ✅ green |
| 04-02-02 | 02 | 1 | VOICE-05 | unit | `bun test tests/voiceCommand.test.ts --bail` | ✅ | ✅ green |
| 04-02-03 | 02 | 1 | CONTACT-01 | unit | `bun test tests/voiceCommand.test.ts --bail` | ✅ | ✅ green |
| 04-02-04 | 02 | 1 | VOICE-01-05, CONTACT-01 | unit | `bun test tests/voiceCommand.test.ts --bail` | ✅ | ✅ green |
| 04-03-01 | 03 | 1 | CRON-01, CRON-04 | unit | `bun test tests/cron.test.ts --bail` | ✅ | ✅ green |
| 04-03-01b | 03 | 1 | CRON-01/CRON-04 (reminders) | unit | `bun test tests/cron.test.ts --bail` | ✅ | ✅ green |
| 04-03-02 | 03 | 1 | CRON-02, CRON-03 | unit | `bun test tests/cron.test.ts --bail` | ✅ | ✅ green |
| 04-03-03 | 03 | 1 | CRON-01, CRON-04 | unit | `bun test tests/cron.test.ts --bail` | ✅ | ✅ green |
| 04-03-04 | 03 | 1 | CRON-01-04 | unit | `bun test tests/cron.test.ts --bail` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements (Bun test runner + mock.module pattern).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live ElevenLabs audio delivery to connected WS client | VOICE-03, VOICE-04 | Requires real ElevenLabs API key + running server + wscat | `wscat -c ws://localhost:3000/ws/session/test-user-001` then call `pushInterrupt('test-user-001', 'Hello')` |
| Whisper transcription accuracy for Afrikaans speech | VOICE-02 | Requires real audio recording + OPENAI_API_KEY | Record af audio blob, POST to `/api/voice/command` multipart |
| Twilio voice note playback from real CDN URL | VOICE-05 | Requires real Twilio credentials + actual media URL | POST `{ userId, mediaUrl }` to `/api/voice/playback` with real Twilio URL |
| BullMQ morning briefing fires at 07:00 Mon-Fri | CRON-01 | Clock-dependent — cannot unit test the cron trigger | Set system time near 07:00, check server logs for `[Cron] Morning briefing delivered` |

---

## Validation Audit 2026-03-28

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

**Gaps resolved:**
1. VOICE-03 `outputFormat: 'opus_48000_32'` — added test 7 in `tests/tts.test.ts`
2. CRON-01/CRON-04 custom reminder registration — added test in `tests/cron.test.ts` `syncUserRoutines()` describe

---

## Validation Sign-Off

- [x] All tasks have automated verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0: existing infrastructure covers all requirements
- [x] No watch-mode flags
- [x] Feedback latency < 8s (measured 7s full phase suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-28
