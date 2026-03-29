---
phase: 3
slug: agent-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | package.json (`"test"` script) |
| **Quick run command** | `bun test --bail` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --bail`
- **After every plan wave:** Run `bun test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | AGENT-07, AGENT-08 | unit | `bun test tests/sanitiser.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | AGENT-06, CONTACT-05 | unit | `bun test tests/whatsapp.test.ts tests/contacts.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | AGENT-06 | unit | `bun test tests/ambient.test.ts` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | AGENT-01, AGENT-02, AGENT-03, AGENT-04 | unit | `bun test tests/orchestrator.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 3 | AGENT-05 | unit | `bun test tests/voiceCommand.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 3 | CONTACT-02, CONTACT-03, CONTACT-04 | unit | `bun test tests/voiceCommand.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/sanitiser.test.ts` — stubs for AGENT-07, AGENT-08 (no `*`, `#`, backtick, blockquote in output)
- [ ] `tests/whatsapp.test.ts` — stubs for toolReadMessages, toolSendMessage (queued/no-fetch), toolResolveContact
- [ ] `tests/contacts.test.ts` — stubs for toolGetContact, toolSaveContact, toolListContacts, toolSetPriority; CONTACT-05 name substitution
- [ ] `tests/ambient.test.ts` — stubs for toolGetLoadShedding, toolGetWeather, toolWebSearch (AGENT-06)
- [ ] `tests/orchestrator.test.ts` — stubs for AGENT-01 (fast-path bypass), AGENT-02 (Claude routing), AGENT-03 (agentic loop cap), AGENT-04 (tool dispatch)
- [ ] `tests/voiceCommand.test.ts` — stubs for AGENT-05 (confirm/cancel/three-strike), CONTACT-02/03/04 (orchestrator tool wire)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end WhatsApp send via live API | AGENT-02 | Requires live Meta credentials and real phone | Send "send a message to Naledi" via WhatsApp; verify `message_log` row direction=`out` |
| EskomSePush live area lookup | AGENT-06 | Live API rate-limited; exact area ID needed for Johannesburg | Query "load shedding today"; verify spoken response with no markdown in under 3s |
| Multi-turn voice contact save | CONTACT-03 | Requires real WhatsApp session and mic input | Say an unknown number arrives; trigger save flow; verify `user_contacts` row inserted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
