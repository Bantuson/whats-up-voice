---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, no install needed) |
| **Config file** | None required — `bun test` discovers `*.test.ts` files automatically |
| **Quick run command** | `bun test tests/session.test.ts tests/classifier.test.ts tests/phone.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test tests/session.test.ts tests/classifier.test.ts tests/phone.test.ts`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-01 | integration | `bun test tests/schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-02 | integration | `bun test tests/isolation.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | INFRA-03 | integration | `bun test tests/schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-04 | integration | `bun test tests/health.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | INFRA-04 | smoke | Manual: remove one env var, run `bun run src/server.ts` | manual | ⬜ pending |
| 1-02-03 | 02 | 1 | INFRA-05 | integration | `bun test tests/health.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | INFRA-06 | unit | `bun test tests/session.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | AGENT-02 | unit | `bun test tests/classifier.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-03 | 03 | 2 | ISO-02 | unit | `bun test tests/phone.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-04 | 03 | 2 | ISO-01 | integration | `bun test tests/isolation.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/session.test.ts` — stubs for INFRA-06: valid transitions, invalid transitions throw, all 5 states, `pendingMessage` storage/retrieval
- [ ] `tests/classifier.test.ts` — stubs for AGENT-02: all 8 intent patterns, confirm/cancel, null fallthrough, case-insensitive matching
- [ ] `tests/phone.test.ts` — stubs for ISO-02: E.164 normalisation for +27, 0xx, bare digits; `formatPhoneForSpeech` output
- [ ] `tests/health.test.ts` — stubs for INFRA-04/05: `GET /health` returns 200 with valid env, Bearer auth on `/api/*`
- [ ] `tests/schema.test.ts` — stubs for INFRA-01/03: table existence, `match_memories` rpc callable, `resolve_contact_name` callable
- [ ] `tests/isolation.test.ts` — stubs for ISO-01: app-layer query with fabricated `user_id` returns zero rows

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Server refuses to start when env var missing | INFRA-04 | Requires process exit observation | Remove one var from `.env`, run `bun run src/server.ts`, verify clear error message and non-zero exit |
| All 8 tables exist in Supabase dashboard | INFRA-01 | Visual confirmation in Supabase Studio | Open Supabase project → Table Editor → confirm all 8 tables present with expected columns |
| RLS enabled on all tables | INFRA-02 | Supabase Studio UI check | Open each table → Authentication tab → confirm RLS toggle is ON |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
