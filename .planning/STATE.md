---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: milestone
status: unknown
stopped_at: Completed 02-webhook-heartbeat-02-02-PLAN.md
last_updated: "2026-03-27T22:00:00.696Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 6
  completed_plans: 4
  percent: 0
---

# VoiceApp — Project State

**Last updated:** 2026-03-27T20:08:32Z
**Project:** VoiceApp
**Milestone:** v0.1 Hackathon Build

---

## Project Reference

**Core value:** A visually impaired South African can independently send and receive WhatsApp messages entirely by voice, with full contact name resolution and a confirmation loop before sending.

**Current focus:** Phase 02 — webhook-heartbeat

---

## Current Position

Phase: 02 (webhook-heartbeat) — EXECUTING
Plan: 2 of 3
| Field | Value |
|-------|-------|
| Phase | 1 — Foundation |
| Plan | 3 of 3 complete (all Phase 1 plans done) |
| Status | Phase 1 complete — awaiting verification |
| Progress | 0/5 phases complete, 3/3 Phase 1 plans done |

```
Progress: [░░░░░░░░░░] 0%
Phase 1: ░░░  Phase 2: ░░░  Phase 3: ░░░  Phase 4: ░░░  Phase 5: ░░░
```

---

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 1 | Foundation | INFRA-01–06, ISO-01–03 | Not started |
| 2 | Webhook + Heartbeat | WA-01–05, HB-01–06 | Not started |
| 3 | Agent Intelligence | AGENT-01–08, CONTACT-01–05 | Not started |
| 4 | Voice Pipeline + Cron | VOICE-01–05, CRON-01–04 | Not started |
| 5 | Tests + Frontend + Demo | TEST-01, FE-01–08, MEM-01–03 | Not started |

---

## Accumulated Context

### Key Decisions Made

- [P1-02] Raw body capture middleware registered before all routes — correctness constraint for Phase 2 HMAC (app.use('/webhook/*') must be first middleware)
- [P1-02] All Phase 1–4 packages installed in single `bun add` — keeps package.json stable across phases
- [P1-02] Bearer auth scoped to /api/* only — /health and /webhook/* intentionally unprotected by Bearer
- [P1-02] validateEnv() called as first statement in server.ts — before route module imports that access process.env
- Session state machine: plain `Map<userId, SessionState>` — no XState (50KB overhead for 5 states not justified for hackathon)
- BullMQ `upsertJobScheduler` for cron — not `node-cron` (durable across restarts)
- ElevenLabs `eleven_flash_v2_5` model locked — `eleven_turbo_v2_5` is deprecated
- `ioredis` with `maxRetriesPerRequest: null` — never `Bun.redis` for BullMQ
- OGG/Opus (`opus_48000_32`) locked as ElevenLabs output format for WhatsApp voice notes
- pgvector similarity queries always via `supabase.rpc('match_memories', ...)` — PostgREST cannot use `<=>` operator
- Every backend query includes `.eq('user_id', userId)` — `service_role` bypasses RLS
- [01-01] Two policies per table: auth.uid() user policy + service_role bypass — defense-in-depth RLS strategy
- [01-01] HNSW index in 002_functions.sql — runs after 001_schema.sql creates memory_store table (dependency order)
- [01-01] match_memories caps at LEAST(match_count, 20) — prevents unbounded RPC result sets
- [01-01] resolve_contact_name returns NULL for unknown phone — callers synthesize display from raw phone number
- [P1-03] web_search FAST_PATH entries placed before load_shedding/weather — prevents loadshed keyword in "find out about X" hijacking web_search intent
- [P1-03] normaliseE164 always returns `+${digits}` — never raw input; strips dashes/spaces even when + prefix present
- [P1-03] Removed `what is ` from web_search classifier — too broad; weather pattern covers temperature/forecast keywords
- [02-02] Shared redis singleton from heartbeat.ts imported by worker.ts — guarantees BullMQ Queue + Worker use identical ioredis config (maxRetriesPerRequest=null)
- [02-02] worker.ts separated from heartbeat.ts — heartbeat.ts importable in tests without spawning live connections

### Critical Build Order Rules

1. Supabase schema deploys before any code writes to the database
2. Raw-body capture middleware on `/webhook/*` registered before any routes — HMAC check reads this, never `c.req.json()` first
3. BullMQ worker validated with a test job before agent wiring begins
4. Fast-path regex classifier built in Phase 1, wired to agent in Phase 3
5. ElevenLabs client wrapper sets `output_format: 'opus_48000_32'` from day one

### Open Questions (from research)

- Which ElevenLabs voice IDs for English SA + Afrikaans? (Benchmark 3–5 pre-made voices before Phase 4)
- EskomSePush area ID for demo user? (Hardcode Johannesburg as fallback)
- Redis hosting? (Decide between Upstash free tier or Railway before Phase 2)
- WhatsApp WABA Business Verification complete? (Check before demo day)

### Blockers

None currently.

### Todos

- [ ] Decide Redis hosting provider before Phase 2
- [ ] Benchmark ElevenLabs voice IDs before Phase 4
- [ ] Confirm WABA tier status in Meta Business Manager before Phase 5 demo prep

---

## Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Webhook response time | < 200ms | TBD |
| First audio chunk (WebSocket) | < 500ms | TBD |
| Ambient query spoken response | < 3 seconds | TBD |
| Fast-path intent classification | < 1ms | 0.005ms (measured) |
| Test suite | 85+ passing | 36 passing (Phase 1 Plan 3) |

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01-foundation P03 | 12min | 3 tasks | 9 files |

---
| Phase 01 P02 | 13 | 3 tasks | 11 files |
| Phase 02-webhook-heartbeat P02 | 2min | 2 tasks | 4 files |

## Session Continuity

**To resume work:** Read ROADMAP.md for phase structure and success criteria. Read REQUIREMENTS.md for requirement IDs. Current phase is Phase 1 — Plans 01-01 (schema) and 01-02 (server skeleton) are complete. Next: Plan 01-03 (session state machine + intent classifier).

**Last session:** 2026-03-27T22:00:00.680Z
**Stopped at:** Completed 02-webhook-heartbeat-02-02-PLAN.md

**Context for next session:**

- All architectural constraints are embedded in ROADMAP.md "Architectural Constraints" table
- Research detail: `.planning/research/ARCHITECTURE.md` and `.planning/research/SUMMARY.md`
- Stack versions pinned: Bun 1.3.11, Hono 4.12.9, BullMQ 5.45.0, @anthropic-ai/sdk 0.80.0, @elevenlabs/elevenlabs-js 2.39.0
- Schema foundation complete: `supabase/migrations/001_schema.sql` and `002_functions.sql` ready to deploy
- Integration tests in `tests/schema.test.ts` and `tests/isolation.test.ts` require real Supabase credentials

---

*State initialized: 2026-03-27 after roadmap creation*
