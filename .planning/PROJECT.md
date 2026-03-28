# VoiceApp

## What This Is

VoiceApp is a voice-native AI companion for visually impaired and hands-occupied users in South Africa. It uses WhatsApp as the social backbone — preserving existing contacts and conversation history — while a Claude agent handles composition, reading, ambient queries, and episodic memory. Everything is delivered through audio; no screen interaction is required after initial setup.

## Core Value

A visually impaired South African can independently send and receive WhatsApp messages entirely by voice, with full contact name resolution and a confirmation loop before sending.

## Requirements

### Validated

**Validated in Phase 1: Foundation**
- Supabase schema with RLS user isolation across all tables (INFRA-01, INFRA-02, INFRA-03)
- Bun/Hono backend with env validation, CORS, Bearer auth, health endpoint, WebSocket scaffold (INFRA-04, INFRA-05, ISO-03)
- Session state machine with explicit transition guards — 5 states, pure TypeScript (INFRA-06)
- E.164 phone normalisation for SA numbers (ISO-02)
- Fast-path regex intent classifier — 10 patterns, < 0.005ms/call, no LLM (ISO-01, AGENT-02 partial)

**Validated in Phase 3: Agent Intelligence**
- Markdown sanitiser for spoken-natural LLM output — strips formatting before TTS (AGENT-04)
- 9 tool handler functions with explicit `user_id` filtering across all Supabase queries (AGENT-03, AGENT-05, AGENT-06, AGENT-07, AGENT-08)
- Contact name resolution via `.ilike('name', name)` — case-insensitive, no RPC dependency (CONTACT-02 through CONTACT-05)
- Claude orchestrator with manual tool-use agentic loop — `POST /api/voice/command` wired (AGENT-01, AGENT-02)

**Validated in Phase 4: Voice Pipeline + Cron**
- ElevenLabs TTS streaming wrapper — `eleven_flash_v2_5` (EN) / `eleven_multilingual_v2` (AF), `opus_48000_32` format, audio_start/audio_end framing (VOICE-03, VOICE-04)
- Per-user WebSocket registry with `pushInterrupt` as sole audio delivery entry point (VOICE-04)
- STT path: `POST /api/voice/command` accepts multipart audioBlob → Whisper `whisper-1` with SA language hint (VOICE-02)
- Twilio voice note playback: `POST /api/voice/playback` streams CDN media to WebSocket with Basic auth (VOICE-05)
- CONTACT-01 interrupt now delivers real TTS audio via `connections.pushInterrupt` — JSON stub removed (CONTACT-01)
- BullMQ `upsertJobScheduler` for morning briefing (Mon–Fri 07:00) and evening digest (daily 18:00) (CRON-01, CRON-04)
- Double-fire guard (55s window) in morning briefing processor (CRON-02)
- Briefing spoken order: greeting → load shedding → weather → digest; priority contacts first (CRON-03)

### Active

**P0 — Hackathon v0.1 must-haves**
- [ ] Voice compose + send WhatsApp messages with approval loop before sending
- [ ] Read incoming messages aloud with resolved contact names
- [ ] Save new contacts entirely by voice (unknown number flow + proactive save)
- [ ] Priority contact flagging — interrupt vs batch surface decisions
- [ ] Morning briefing cron (load shedding + weather + overnight message digest)
- [ ] Heartbeat engine — event-driven surface decision gate (interrupt/batch/silent/skip)
- [ ] Supabase schema with RLS user isolation across all tables
- [ ] WhatsApp webhook handler with HMAC signature verification and user upsert
- [ ] Bun/Hono backend with session state machine

**P1 — Hackathon v0.1 nice-to-haves**
- [ ] Ambient queries: load shedding (EskomSePush) and weather (OpenWeather)
- [ ] Ambient web search via Tavily
- [ ] Voice note playback for received audio messages
- [ ] Episodic memory store via pgvector (OpenAI text-embedding-3-small)
- [ ] Cron scheduler for user routines (morning briefing, evening digest, custom reminders)
- [ ] Caregiver dashboard — Vite + React frontend (mission control aesthetic)
- [ ] English + Afrikaans TTS via ElevenLabs
- [ ] 85+ test cases across 11 suites (bun test)

### Out of Scope

- isiZulu TTS — deferred to v0.2 (Google Cloud TTS), complexity not justified for hackathon
- iOS native integration — Android first, background audio restrictions make iOS harder
- Group message creation — reading groups only in v0.1, send flow adds significant complexity
- Research-to-podcast synthesis — v0.2 feature, requires multi-step research agent
- Multi-device session management — single device per user for v0.1
- Payments integration — not relevant to hackathon scope
- Proactive load shedding push alerts — deferred to v0.2
- WhatsApp device contact list sync — API doesn't expose it; voice-populated contacts only

## Context

- **Hackathon build:** Target 6–7 hours for a complete working demo. Build order: Supabase schema → backend skeleton → webhook → agent tools → heartbeat engine → cron → voice command route → tests → frontend → demo polish.
- **South African context:** Load shedding is a daily reality. EskomSePush API provides per-area schedules. Morning briefing must lead with load shedding times.
- **WhatsApp Cloud API constraint:** Server-side webhook only — no native app-level message interception. All messages pass through the backend.
- **Identity anchor:** WhatsApp phone number (E.164 format) is the user identity — no separate auth system. Backend operates as Supabase `service_role`.
- **Contact model:** The `user_contacts` table is entirely this product's construct. WhatsApp Business API provides sender phone but not device contacts. Contacts are added only via voice flows.
- **Agent SDK:** Claude Agents SDK (`@anthropic-ai/sdk`) with orchestrator + sub-agents pattern. Fast-path regex intent classification before LLM invocation to keep latency under 500ms for common commands.
- **TTS language:** ElevenLabs for English and Afrikaans in v0.1. Agent responses must be spoken-first — no markdown, no lists, no formatting.
- **Company:** Mzansi Agentive (Pty) Ltd — Enterprise No. 2026/179878/07

## Constraints

- **Tech stack:** Bun v1.x + Hono v4 (backend), Vite + React 18 (frontend), Supabase PostgreSQL 15 + pgvector, BullMQ + Redis for job queue — fixed, no substitutions
- **Timeline:** Hackathon build — ~7 hours total, demo-ready on 27 March 2026
- **Performance:** Ambient queries (load shedding, weather, search) must return spoken response in under 3 seconds
- **Security:** HMAC `x-hub-signature-256` verification on every webhook POST; RLS enforced at DB layer for all tables; Bearer token auth on `/api/*` routes
- **Language:** All agent spoken responses must be conversation-natural — no markdown, no bullet points, one question at a time
- **Model:** `claude-sonnet-4-6` for agent intelligence

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WhatsApp Cloud API (not Baileys/WA Web) | Official Meta API — no ban risk, supports Business accounts, HMAC webhook security | ✓ Phase 1 (HMAC middleware in place) |
| Bun runtime over Node.js | Faster startup, built-in test runner (`bun test`), TypeScript native | ✓ Phase 1 (bun init, bun test passing) |
| Supabase RLS over application-layer auth | DB-layer isolation means bugs can't leak cross-user data even if app code is wrong | ✓ Phase 1 (schema+RLS deployed, isolation tests written) |
| Fast-path regex intent classification | Keeps common commands under 500ms without LLM invocation | ✓ Phase 1 (10 patterns at 0.005ms/call measured) |
| BullMQ for heartbeat event queue | Durable queue with retry — messages survive process restart | — Phase 2 |
| ElevenLabs over Google Cloud TTS for EN/AF | Better naturalness for Afrikaans, simpler API for hackathon | — Phase 4 |
| Voice-populated contacts only | Privacy-respecting — agent only knows contacts user has consciously introduced | — Phase 3 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 (Phase 4 complete — voice pipeline + cron, 25/25 must-haves verified)*
