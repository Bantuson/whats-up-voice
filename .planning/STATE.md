# VoiceApp — Project State

**Last updated:** 2026-03-27T20:08:32Z
**Project:** VoiceApp
**Milestone:** v0.1 Hackathon Build

---

## Project Reference

**Core value:** A visually impaired South African can independently send and receive WhatsApp messages entirely by voice, with full contact name resolution and a confirmation loop before sending.

**Current focus:** Phase 1 — Foundation (Supabase schema, Hono skeleton, session state machine)

---

## Current Position

| Field | Value |
|-------|-------|
| Phase | 1 — Foundation |
| Plan | 1 of 3 complete (Plan 01: Supabase Schema + RLS) |
| Status | In progress |
| Progress | 0/5 phases complete |

```
Progress: [░░░░░░░░░░░░░░░░░░░░] 0%
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
| Fast-path intent classification | < 1ms | TBD |
| Test suite | 85+ passing | TBD |

---

## Session Continuity

**To resume work:** Read ROADMAP.md for phase structure and success criteria. Read REQUIREMENTS.md for requirement IDs. Current phase is Phase 1 — Plans 02 (Hono server skeleton) and 03 (session state machine + classifier) remain.

**Last session:** 2026-03-27T20:08:32Z — Completed Plan 01-01 (Supabase Schema + RLS)
**Stopped at:** Completed 01-01-PLAN.md (Supabase Schema + RLS)

**Context for next session:**
- All architectural constraints are embedded in ROADMAP.md "Architectural Constraints" table
- Research detail: `.planning/research/ARCHITECTURE.md` and `.planning/research/SUMMARY.md`
- Stack versions pinned: Bun 1.3.11, Hono 4.12.9, BullMQ 5.45.0, @anthropic-ai/sdk 0.80.0, @elevenlabs/elevenlabs-js 2.39.0
- Schema foundation complete: `supabase/migrations/001_schema.sql` and `002_functions.sql` ready to deploy
- Integration tests in `tests/schema.test.ts` and `tests/isolation.test.ts` require real Supabase credentials

---

*State initialized: 2026-03-27 after roadmap creation*
