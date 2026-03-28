---
phase: 02
slug: webhook-heartbeat
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-28
---

# Phase 02 — Validation Strategy

> Per-phase validation contract — reconstructed from SUMMARY files (State B).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (Bun built-in) |
| **Config file** | none — Bun auto-discovers `tests/**/*.test.ts` |
| **Quick run command** | `bun test tests/webhook.test.ts tests/quietHours.test.ts tests/heartbeat.test.ts` |
| **Full suite command** | `bun test tests/webhook.test.ts tests/quietHours.test.ts tests/heartbeat.test.ts tests/hubVerification.test.ts tests/webhookHandler.test.ts tests/enqueueDedup.test.ts` |
| **Estimated runtime** | ~2–3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test tests/webhook.test.ts tests/quietHours.test.ts tests/heartbeat.test.ts`
- **After every plan wave:** Run full suite command above
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | WA-01: Hub GET verification | integration | `bun test tests/hubVerification.test.ts` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | WA-02: HMAC-SHA256 signature validation | unit | `bun test tests/webhook.test.ts` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | WA-03: User upsert on inbound message | manual | see Manual-Only | — | manual |
| 02-01-02 | 01 | 1 | WA-04: Status callback discard (handler level) | integration | `bun test tests/webhookHandler.test.ts` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | WA-05: message_log persistence | manual | see Manual-Only | — | manual |
| 02-02-01 | 02 | 1 | HB-01: enqueueHeartbeat dedup gate (SET NX) | unit | `bun test tests/enqueueDedup.test.ts` | ✅ | ✅ green |
| 02-03-01 | 03 | 1 | HB-06: Quiet hours overnight range logic | unit | `bun test tests/quietHours.test.ts` | ✅ | ✅ green |
| 02-03-02 | 03 | 1 | HB-02: Gate skip states (composing/awaiting) | unit | `bun test tests/heartbeat.test.ts` | ✅ | ✅ green |
| 02-03-02 | 03 | 1 | HB-03: WebSocket interrupt push | manual | see Manual-Only | — | manual |
| 02-03-02 | 03 | 1 | HB-04: Batch decision path | unit | `bun test tests/heartbeat.test.ts` | ✅ | ✅ green |
| 02-03-02 | 03 | 1 | HB-05: logDecision writes to heartbeat_log | manual | see Manual-Only | — | manual |
| 02-03-02 | 03 | 1 | CONTACT-01: Unknown number phone formatting | unit | `bun test tests/heartbeat.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — bun:test is built-in, no install step needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| User upsert on inbound message | WA-03 | Requires live Supabase service_role credentials; integration test deferred to Phase 5 (TEST-01) | Send a real WhatsApp message; query `SELECT id, phone FROM users ORDER BY created_at DESC LIMIT 1` in Supabase |
| message_log persistence | WA-05 | Requires live Supabase; same reason | After real message: `SELECT id, wa_message_id, direction, from_phone, body FROM message_log ORDER BY created_at DESC LIMIT 1` |
| WebSocket interrupt push | HB-03 | Requires live WebSocket connection + Phase 4 TTS pipeline; Phase 2 is a JSON stub | Start server, connect a WS client, trigger interrupt path, verify `{ type: 'interrupt', spoken: '...' }` frame received |
| logDecision writes to heartbeat_log | HB-05 | Requires live Supabase | After real message: `SELECT decision, reason FROM heartbeat_log ORDER BY created_at DESC LIMIT 1` |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Manual-Only reason documented
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0: no missing test infrastructure (bun:test built-in)
- [x] No watch-mode flags
- [x] Feedback latency < 3s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-28

---

## Validation Audit 2026-03-28

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated (manual-only) | 4 |

**New test files added:**
- `tests/hubVerification.test.ts` — WA-01 hub GET handler via Hono test client (3 tests)
- `tests/webhookHandler.test.ts` — WA-04 status discard at handler level with mocked supabase + heartbeat (2 tests)
- `tests/enqueueDedup.test.ts` — HB-01 enqueueHeartbeat dedup logic with controlled SET NX mock (3 tests)

**Total Phase 2 automated tests:** 46 passing, 0 failing
