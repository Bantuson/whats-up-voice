---
phase: 02-webhook-heartbeat
verified: 2026-03-28T00:09:03Z
status: gaps_found
score: 11/12 must-haves verified
re_verification: false
gaps:
  - truth: "batch decision adds messages to an in-memory digest queue"
    status: partial
    reason: "HB-04 requires adding to an in-memory digest queue but the Phase 2 gate only logs to heartbeat_log. The in-memory queue is explicitly deferred to Phase 4 in 02-03-PLAN.md (Notes section, line 435). The decision classification and logging works correctly; only the downstream consumer (digest queue) is absent by design."
    artifacts:
      - path: "src/queue/worker.ts"
        issue: "batch path calls logDecision() only — no in-memory digest queue populated"
    missing:
      - "In-memory digest queue structure (Phase 4 morning briefing worker will wire this)"
      - "REQUIREMENTS.md traceability update to reflect CONTACT-01 is partially satisfied in Phase 2 (unknown number interrupt implemented here) rather than purely in Phase 3"
human_verification:
  - test: "Send a real WhatsApp message from an unknown number (not in user_contacts)"
    expected: "heartbeat_log row with decision='interrupt', reason='unknown number'; WebSocket frame { type: 'interrupt', spoken: 'You have a message from an unknown number: ...' } delivered if client connected"
    why_human: "Requires live WhatsApp Cloud API credentials and a real inbound webhook delivery; cannot mock the full pipeline in offline tests"
  - test: "Send a real WhatsApp message from a priority contact"
    expected: "heartbeat_log row with decision='interrupt', reason='priority contact'"
    why_human: "Requires live Supabase with user_contacts row having is_priority=true and live webhook"
  - test: "Set quiet hours in user_profile to cover the current time, then send a WhatsApp message"
    expected: "heartbeat_log row with decision='silent', reason='quiet hours active'"
    why_human: "Requires live Supabase with user_profile row and live webhook"
  - test: "Send duplicate WhatsApp message ID (simulate retry)"
    expected: "Only one row in message_log for the wa_message_id; Redis key msg:{waMessageId} exists with TTL <= 7200"
    why_human: "Requires live Redis and ability to replay a webhook with identical wa_message_id"
---

# Phase 2: Webhook + Heartbeat Verification Report

**Phase Goal:** Real WhatsApp messages arrive, are HMAC-verified, persisted, and enqueued — and the heartbeat worker correctly classifies each event as interrupt, batch, silent, or skip.
**Verified:** 2026-03-28T00:09:03Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                 | Status      | Evidence                                                       |
|----|-----------------------------------------------------------------------|-------------|----------------------------------------------------------------|
| 1  | GET /webhook/whatsapp returns hub.challenge on valid token            | VERIFIED    | webhook.ts:13-22 — mode + token check, c.text(challenge, 200) |
| 2  | POST /webhook/whatsapp verifies HMAC before any parsing               | VERIFIED    | webhook.ts:30-43 — verifyWhatsAppHmac() called before JSON.parse; 5 HMAC unit tests pass |
| 3  | Inbound sender upserted to users table with E.164 phone               | VERIFIED    | webhook.ts:80-91 — supabase.from('users').upsert({phone}, {onConflict:'phone'}).select('id') |
| 4  | Status callbacks (value.statuses) discarded, never enqueued           | VERIFIED    | webhook.ts:62-64 — early return with 200; payload parsing test confirms structure |
| 5  | Inbound messages persisted to message_log before heartbeat processing  | VERIFIED    | webhook.ts:99-119 — insert with direction='in', from_phone, body, media_type, media_id |
| 6  | Redis dedup gate prevents duplicate enqueue for same wa_message_id    | VERIFIED    | heartbeat.ts:51-57 — SET NX EX 7200 returns null on duplicate; enqueueHeartbeat returns false |
| 7  | BullMQ job enqueued and worker boots at server startup                 | VERIFIED    | server.ts:24 — import './queue/worker'; heartbeatWorker registered with concurrency=5 |
| 8  | Worker classifies silent (quiet hours) correctly with overnight range  | VERIFIED    | worker.ts:41-44; quietHours.ts isQuietHours() — 15 tests pass covering overnight + daytime ranges |
| 9  | Worker classifies interrupt for priority contact                       | VERIFIED    | worker.ts:58-63 — is_priority===true triggers pushInterrupt + logDecision('interrupt') |
| 10 | Worker classifies interrupt for unknown number with spoken phone       | VERIFIED    | worker.ts:67-73 — contact===null triggers formatPhoneForSpeech + pushInterrupt; CONTACT-01 tests pass |
| 11 | Worker classifies skip when session is composing/awaiting_approval     | VERIFIED    | worker.ts:79-83 — getPhase() check; heartbeat gate tests confirm skip state classification |
| 12 | batch decision logs to heartbeat_log; in-memory digest queue populated | PARTIAL     | worker.ts:100 — logDecision('batch') implemented; in-memory digest queue NOT implemented (deferred to Phase 4 per plan) |

**Score:** 11/12 truths verified

---

### Required Artifacts

| Artifact                     | Expected                                      | Status      | Details                                                                            |
|------------------------------|-----------------------------------------------|-------------|------------------------------------------------------------------------------------|
| `src/routes/webhook.ts`      | GET hub verify + POST HMAC + message handler  | VERIFIED    | 144 lines — full implementation, no stubs; verifyWhatsAppHmac called              |
| `src/lib/hmac.ts`            | Pure HMAC-SHA256 helper                       | VERIFIED    | 27 lines — startsWith('sha256=') guard, timingSafeEqual, length check             |
| `src/queue/heartbeat.ts`     | ioredis singleton + BullMQ Queue + enqueueHeartbeat | VERIFIED | 68 lines — maxRetriesPerRequest:null, SET NX EX 7200, Queue, HeartbeatJobData interface |
| `src/queue/worker.ts`        | Six-priority surface decision gate            | VERIFIED    | 160 lines — all 6 priorities implemented: silent/interrupt(x3)/skip/batch        |
| `src/lib/quietHours.ts`      | Pure isQuietHours + parseTimeHour             | VERIFIED    | 47 lines — overnight range logic correct; injected currentHour for testability    |
| `tests/webhook.test.ts`      | HMAC + payload parsing tests                  | VERIFIED    | 7 tests passing — valid sig, tampered body, empty sig, wrong secret, bare hex, text event, status callback |
| `tests/quietHours.test.ts`   | Quiet hours logic tests                       | VERIFIED    | 15 tests passing — overnight/daytime ranges, boundaries, parseTimeHour            |
| `tests/heartbeat.test.ts`    | Gate logic tests                              | VERIFIED    | 10 tests passing — quiet hours (pure), phone formatting, decision enum, skip states |
| `scripts/test-queue.ts`      | Synthetic end-to-end queue validation script  | VERIFIED    | File exists; enqueue + dedup + worker flow documented                              |

---

### Key Link Verification

| From                        | To                            | Via                              | Status   | Details                                                             |
|-----------------------------|-------------------------------|----------------------------------|----------|---------------------------------------------------------------------|
| `webhook.ts` POST handler   | `src/lib/hmac.ts`             | import verifyWhatsAppHmac        | WIRED    | webhook.ts:7 import; :34 call with rawBody, signature, APP_SECRET  |
| `webhook.ts` POST handler   | `src/queue/heartbeat.ts`      | import enqueueHeartbeat          | WIRED    | webhook.ts:8 import; :125 call with full HeartbeatJobData           |
| `webhook.ts` POST handler   | `supabase` users table        | .upsert({phone}, {onConflict})   | WIRED    | webhook.ts:80-91 — result checked, userId extracted                 |
| `webhook.ts` POST handler   | `supabase` message_log table  | .insert({...}).select('id')      | WIRED    | webhook.ts:99-119 — result checked, messageLogId extracted          |
| `src/server.ts`             | `src/queue/worker.ts`         | side-effect import               | WIRED    | server.ts:24 — `import './queue/worker'` boots worker at startup    |
| `worker.ts` processHeartbeat| `src/lib/quietHours.ts`       | import isQuietHours, parseTimeHour | WIRED  | worker.ts:18 import; :38-44 used in Priority 1                     |
| `worker.ts` processHeartbeat| `src/session/machine.ts`      | import getPhase                  | WIRED    | worker.ts:16 import; :79 call to check composing/awaiting_approval  |
| `worker.ts` processHeartbeat| `src/ws/manager.ts`           | import wsConnections             | WIRED    | worker.ts:19 import; :135 wsConnections.get(userId)                 |
| `worker.ts` processHeartbeat| `supabase` heartbeat_log      | logDecision() .insert()          | WIRED    | worker.ts:117-125 — all 4 decision paths call logDecision()         |
| `heartbeat.ts` redis        | BullMQ Queue                  | shared ioredis connection        | WIRED    | heartbeat.ts:16-24 — redis exported, passed to Queue as connection  |
| `worker.ts` heartbeatWorker | `heartbeat.ts` redis          | import redis                     | WIRED    | worker.ts:14 import; :147 passed as connection to Worker            |

---

### Data-Flow Trace (Level 4)

| Artifact        | Data Variable   | Source                                    | Produces Real Data | Status     |
|-----------------|-----------------|-------------------------------------------|--------------------|------------|
| `webhook.ts`    | userRow         | supabase.from('users').upsert().select()  | DB write+read      | FLOWING    |
| `webhook.ts`    | logRow          | supabase.from('message_log').insert()     | DB write+read      | FLOWING    |
| `worker.ts`     | profile         | supabase.from('user_profile').select()    | DB read (nullable) | FLOWING    |
| `worker.ts`     | contact         | supabase.from('user_contacts').select()   | DB read (nullable) | FLOWING    |
| `worker.ts`     | heartbeat_log   | logDecision() supabase.insert()           | DB write           | FLOWING    |
| `heartbeat.ts`  | dedup key       | redis.set(NX EX 7200)                     | Redis write        | FLOWING    |
| `heartbeat.ts`  | BullMQ job      | heartbeatQueue.add('process', data)       | Queue write        | FLOWING    |

---

### Behavioral Spot-Checks

| Behavior                                   | Command                                                             | Result       | Status  |
|--------------------------------------------|---------------------------------------------------------------------|--------------|---------|
| 7 webhook HMAC + payload tests pass        | `bun test tests/webhook.test.ts`                                    | 7 pass 0 fail | PASS   |
| 15 quiet hours tests pass                  | `bun test tests/quietHours.test.ts`                                 | 15 pass 0 fail | PASS  |
| 10 heartbeat gate logic tests pass         | `bun test tests/heartbeat.test.ts`                                  | 10 pass 0 fail | PASS  |
| All 32 Phase 2 tests combined pass         | `bun test tests/webhook.test.ts tests/quietHours.test.ts tests/heartbeat.test.ts` | 32 pass 0 fail | PASS |
| Live Redis + BullMQ queue                  | Requires `REDIS_URL` env var — not testable offline                 | SKIP         | SKIP    |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                 | Status          | Evidence                                                         |
|-------------|------------|-----------------------------------------------------------------------------|-----------------|------------------------------------------------------------------|
| WA-01       | 02-01      | GET hub.challenge verification handshake                                    | SATISFIED       | webhook.ts:13-22 — mode + token check returns challenge          |
| WA-02       | 02-01      | POST HMAC x-hub-signature-256 on raw body before parsing                    | SATISFIED       | webhook.ts:30-43 — verifyWhatsAppHmac before JSON.parse; 5 tests |
| WA-03       | 02-01      | E.164 sender upserted to users on first contact                             | SATISFIED       | webhook.ts:76-91 — normaliseE164 + supabase upsert              |
| WA-04       | 02-01      | Status callbacks filtered, never enqueued                                   | SATISFIED       | webhook.ts:62-64 — value.statuses early return 200               |
| WA-05       | 02-01      | Inbound messages logged to message_log (direction=in)                       | SATISFIED       | webhook.ts:99-119 — full insert with all fields                  |
| HB-01       | 02-02      | BullMQ heartbeat queue with ioredis maxRetriesPerRequest:null               | SATISFIED       | heartbeat.ts:16-24 — IORedis + Queue, constraint enforced        |
| HB-02       | 02-03      | Six-priority surface decision gate                                          | SATISFIED       | worker.ts:21-101 — all 6 priorities in correct order             |
| HB-03       | 02-03      | interrupt pushes spoken text via WebSocket immediately                      | SATISFIED       | worker.ts:134-142 — pushInterrupt() sends { type:'interrupt', spoken } JSON frame |
| HB-04       | 02-03      | batch adds to in-memory digest queue                                        | PARTIAL         | worker.ts:100 — logDecision('batch') only; in-memory digest deferred to Phase 4 per plan |
| HB-05       | 02-03      | skip and silent log to heartbeat_log without TTS                            | SATISFIED       | worker.ts:42,81 — logDecision() called; no pushInterrupt() for these paths |
| HB-06       | 02-03      | Quiet hours supports overnight ranges (22:00–07:00)                         | SATISFIED       | quietHours.ts:29-35 — overnight branch; 6 tests covering midnight crossover |
| CONTACT-01  | 02-03      | Unknown number triggers interrupt with digit-by-digit spoken phone          | SATISFIED       | worker.ts:67-73 — formatPhoneForSpeech(phone) used in spoken text; 2 tests pass |

**Traceability note:** CONTACT-01 maps to Phase 3 in REQUIREMENTS.md traceability table, but the partial behavior (unknown number interrupt) is implemented in Phase 2. The contact-save conversational flow (CONTACT-02) remains Phase 3 scope. REQUIREMENTS.md traceability should be updated to note Phase 2 delivers CONTACT-01 partially.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/queue/worker.ts` | 1-11 | Comment references "PHASE 2 STUB" in prior plan; current file is full implementation | Info | No impact — comment in plan was for the stub version; actual code is complete |

No TODO/FIXME/PLACEHOLDER/empty-return anti-patterns found in any Phase 2 source files.

---

### Human Verification Required

#### 1. End-to-End WhatsApp Message Ingest

**Test:** From a real phone, send a WhatsApp text message to the WABA number.
**Expected:**
- Row in `users` table with sender's E.164 phone
- Row in `message_log` with `direction='in'`, correct `from_phone`, `body`, `wa_message_id`
- Row in `heartbeat_log` with `decision` set per gate logic (likely 'interrupt' for unknown number first time)
**Why human:** Requires live WhatsApp Cloud API credentials, an ngrok tunnel or deployed URL registered as webhook, and real HMAC secrets.

#### 2. Hub Verification Handshake

**Test:** Register or re-register a webhook URL with Meta, triggering the GET hub challenge.
**Expected:** Server responds with the challenge value; Meta marks webhook as verified.
**Why human:** Requires Meta Business account, registered WABA, and access to Meta Developer console.

#### 3. Quiet Hours Gate (Silent Decision)

**Test:** Insert a user_profile row with quiet_hours_start and quiet_hours_end covering the current hour. Send a WhatsApp message from that user's number.
**Expected:** `heartbeat_log` row with `decision='silent'`, `reason='quiet hours active'`.
**Why human:** Requires live Supabase and live webhook.

#### 4. Redis Dedup Gate

**Test:** Replay the same webhook payload (identical `x-hub-signature-256`, identical `wa_message_id`) to the POST endpoint twice within 2 hours.
**Expected:** Second delivery returns 200 with `{received: true}` but produces no new `message_log` row.
**Why human:** Requires ability to replay signed webhook payloads with same waMessageId; needs live Redis.

---

### Gaps Summary

One gap identified: **HB-04 is partially satisfied.** The requirement states batch decisions should "add message to in-memory digest queue." The Phase 2 implementation logs the batch decision to `heartbeat_log` but does not populate an in-memory digest queue. This is an **intentional scope deferral** documented in 02-03-PLAN.md (Notes, line 435): "An in-memory digest queue (for morning briefing) is out of scope for Phase 2 — it is wired in Phase 4's morning briefing worker."

The gap is real against the requirements text but is a known, documented, and justified deferral. The batch classification logic is correct and complete — only the downstream consumer is absent. Phase 4 will wire the digest queue reader.

All other 11 truths are fully verified. 32 unit tests pass with 0 failures. All key artifacts exist at full implementation depth (not stubs). All critical wiring paths are confirmed. The HMAC verification, status discard, user upsert, message persistence, Redis dedup, BullMQ enqueueing, and six-priority gate logic are all correctly implemented and connected.

---

_Verified: 2026-03-28T00:09:03Z_
_Verifier: Claude (gsd-verifier)_
