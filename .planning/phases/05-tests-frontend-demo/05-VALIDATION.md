---
phase: 5
slug: tests-frontend-demo
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun 1.3.10 built-in test runner (`bun:test`) |
| **Config file** | None — Bun auto-discovers `tests/*.test.ts` |
| **Quick run command** | `bun test tests/quietHours.test.ts tests/phone.test.ts tests/classifier.test.ts tests/session.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~15 seconds (207+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `bun test tests/phone.test.ts tests/classifier.test.ts tests/session.test.ts` (fast, <5s)
- **After every plan wave:** Run `bun test` (full suite — all 207+ tests)
- **Before `/gsd:verify-work`:** Full suite must show 85+ passing, 0 failing
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | TEST-01 (phone normalisation) | unit | `bun test tests/phone.test.ts` | ✅ (fixes needed) | ⬜ pending |
| 05-01-02 | 01 | 1 | TEST-01 (HMAC verification) | unit | `bun test tests/webhookHandler.test.ts` | ✅ (1 fix needed) | ⬜ pending |
| 05-01-03 | 01 | 1 | TEST-01 (health) | unit | `bun test tests/health.test.ts` | ✅ (2 fixes needed) | ⬜ pending |
| 05-01-04 | 01 | 1 | TEST-01 (message log helpers) | unit | `bun test tests/messageLog.test.ts` | ❌ Wave 0 gap | ⬜ pending |
| 05-01-05 | 01 | 1 | TEST-01 (all 11 suites) | unit | `bun test` | ✅ partial | ⬜ pending |
| 05-02-01 | 02 | 1 | MEM-01 | unit (mocked) | `bun test tests/memory.test.ts` | ❌ Wave 0 gap | ⬜ pending |
| 05-02-02 | 02 | 1 | MEM-02 | unit (mocked) | `bun test tests/memory.test.ts` | ❌ Wave 0 gap | ⬜ pending |
| 05-02-03 | 02 | 1 | MEM-03 | unit (mocked) | `bun test tests/orchestrator.test.ts` | ✅ partial | ⬜ pending |
| 05-03-01 | 03 | 1 | FE-01–FE-08 | manual | `cd frontend && bun run dev` | ❌ no frontend | ⬜ pending |
| 05-04-01 | 04 | 1 | DEMO | manual e2e | Run demo script | ❌ no demo env | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/messageLog.test.ts` — covers TEST-01 "message log helpers" suite (~6–8 tests: insert shape, direction enum `in`/`out`, `to_phone` format `+${PHONEID}`)
- [ ] `tests/memory.test.ts` — covers MEM-01 (embedding generated and stored), MEM-02 (recall returns above-threshold results), MEM-03 (memories injected into system prompt); mock `openai.embeddings.create` and `supabase.rpc`
- [ ] Fix `src/lib/phone.ts` — `normaliseE164('0821234567')` → `+27821234567` (local SA `0x` → `+27x`); `formatPhoneForSpeech('+447700900000')` → digit-spaced string
- [ ] Fix `tests/health.test.ts` — 2 failing tests; start Hono server in test setup or mock the app directly
- [ ] Fix `tests/webhookHandler.test.ts` — 1 failing HMAC test; set `WHATSAPP_APP_SECRET` in test env or mock HMAC module
- [ ] Deploy Supabase schema — `isolation.test.ts` and `schema.test.ts` (9 tests) need live DB; run `supabase db push` and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.test`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Frontend pages render correctly | FE-01–FE-08 | No frontend unit test harness for hackathon scope | `cd frontend && bun run dev` → open http://localhost:5173, verify all 7 pages load |
| Heartbeat feed colour coding | FE-04 | Visual rendering | Send WhatsApp message → confirm interrupt=green, batch=amber, skip=red in heartbeat feed |
| 24-bar waveform SVG animates | FE-03 | Visual animation | Trigger voice command → confirm bars animate when session=`listening`/`playing` |
| SSE heartbeat updates in real-time | FE-04 | Real-time event | Send WhatsApp message → confirm heartbeat entry appears within 2 seconds |
| Episodic memory stored after session | MEM-01 | Requires live Supabase | After real session: `SELECT content, embedding IS NOT NULL FROM memory_store WHERE user_id='...' ORDER BY created_at DESC LIMIT 1` |
| `match_memories` RPC returns results | MEM-02 | Requires live Supabase | Call `supabase.rpc('match_memories', {...})` with similar query text — confirm top result returned |
| Full demo end-to-end | DEMO | Integration of all subsystems | Run demo script: WhatsApp → heartbeat → TTS → voice reply → approval → send → morning briefing |

---

## Per-Plan Sampling Strategy

### Plan 1 — Test Suite (85+ cases)

- **Per commit:** `bun test tests/phone.test.ts tests/hubVerification.test.ts tests/classifier.test.ts`
- **Wave gate:** `bun test` — full suite, 85+ pass, 0 fail
- **Manual:** Inspect `bun test` output for all 11 suite `describe` block names present

### Plan 2 — Episodic Memory

- **Per commit:** `bun test tests/memory.test.ts`
- **Wave gate:** `bun test` (includes memory tests)
- **Manual:** After real session, verify `memory_store` row + non-null embedding; test `match_memories` RPC directly

### Plan 3 — Caregiver Dashboard

- **Automated:** `bun test` (no frontend unit tests — scope constraint)
- **Wave gate:** Manual browser verification checklist:
  1. `cd frontend && bun run dev` starts on port 5173
  2. Login page accepts phone number, sets userId in localStorage
  3. Dashboard shows "idle" state
  4. WhatsApp message → heartbeat feed entry within 2 seconds with correct colour
  5. Voice command → waveform activates when `listening`, deactivates at `idle`
  6. Contacts page loads contact list
  7. Routines page shows human-readable cron labels

### Plan 4 — Demo Polish + Pre-Demo Checklist

- **Automated:** `bun test` (full suite green)
- **Manual:** Run complete demo script end-to-end:
  1. Real WhatsApp message received from test phone
  2. Heartbeat fires as `interrupt`
  3. TTS audio plays via WebSocket
  4. Voice compose reply recorded
  5. Approval loop: agent reads back message, user says "yes"
  6. Message sent — `message_log` has `direction=out` row
  7. Morning briefing triggered manually via BullMQ dashboard
  8. Briefing content: load shedding text before weather text
  9. Post-session: `memory_store` has new row with non-null embedding
