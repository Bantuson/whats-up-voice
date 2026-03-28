# VoiceApp — Phased Execution Roadmap

**Project:** VoiceApp — Voice-native AI companion for visually impaired South Africans
**Build target:** Hackathon demo-ready, ~7 hours total
**Granularity:** Standard (5 phases)
**Coverage:** 47/47 v0.1 requirements mapped
**Generated:** 2026-03-27

---

## Phases

- [ ] **Phase 1: Foundation** — Supabase schema, RLS policies, Hono server skeleton, session state machine, env validation
- [x] **Phase 2: Webhook + Heartbeat** — WhatsApp message ingestion, HMAC verification, BullMQ queue, surface decision gate
- [x] **Phase 3: Agent Intelligence** — Claude orchestrator + sub-agents, intent classification, contact management flows (completed 2026-03-28)
- [ ] **Phase 4: Voice Pipeline + Cron** — Full audio round-trip (STT → TTS → WebSocket), morning briefing scheduler
- [ ] **Phase 5: Tests + Frontend + Demo** — 85+ test cases, caregiver dashboard, episodic memory, demo polish

---

## Phase Details

### Phase 1: Foundation

**Goal:** A running Hono server with validated environment, a deployed Supabase schema with RLS, and pure-logic session/classification modules — the bedrock everything else writes to and reads from.

**Depends on:** Nothing (first phase — build this before anything else writes to the database)

**Requirements covered:** INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, ISO-01, ISO-02, ISO-03

**Success Criteria** (what must be TRUE):
1. `GET /health` returns 200 and the server refuses to start if any of the 11 required env vars are absent
2. All 8 Supabase tables exist with RLS enabled; a query using a fabricated `user_id` via the backend returns zero rows (app-layer isolation confirmed)
3. `pgvector` extension is enabled; `match_memories` and `resolve_contact_name` SQL functions are deployed and callable via `supabase.rpc()`
4. Session state machine rejects invalid transitions (e.g. `idle → awaiting_approval` throws) and accepts valid ones
5. Fast-path regex classifier returns the correct intent string for all 8 covered patterns without invoking any LLM

### Plans
1. **[DONE] Supabase schema + RLS** — Deploy all 8 tables (`users`, `user_profile`, `user_contacts`, `sessions`, `message_log`, `memory_store`, `routines`, `heartbeat_log`) with RLS user policies + service_role bypass; enable `pgvector`; create HNSW index on `memory_store.embedding`; deploy `match_memories` and `resolve_contact_name` SQL functions — **SUMMARY: 01-01-SUMMARY.md**
2. **[DONE] Hono server skeleton** — Bun/Hono server on port 3000 with `validateEnv()` startup guard (throws on missing vars), raw-body capture middleware on `/webhook/*` (must precede all route registration), CORS for frontend origin, Bearer token auth middleware on `/api/*`, health check endpoint, WebSocket scaffold — **SUMMARY: 01-02-SUMMARY.md**
3. **Session state machine + intent classifier** — Pure-logic `Map<userId, SessionState>` with explicit transition guard for 5 states (idle/listening/composing/awaiting_approval/playing); fast-path regex classifier for 8 intents; `spokenError()` fallback utility; `formatPhoneForSpeech()` utility; phone E.164 normalisation helper

**Verification:** `bun run src/server.ts` starts cleanly; removing one env var causes a clear startup error; `supabase.rpc('match_memories', ...)` executes without error; unit tests for session transitions and regex classifier all pass.

**Dependencies:** None — this is the foundation everything else depends on.

---

### Phase 2: Webhook + Heartbeat

**Goal:** Real WhatsApp messages arrive, are HMAC-verified, persisted, and enqueued — and the heartbeat worker correctly classifies each event as interrupt, batch, silent, or skip.

**Depends on:** Phase 1 (Supabase schema must exist for user upsert and message_log writes; raw-body middleware must be in place before webhook routes are registered)

**Requirements covered:** WA-01, WA-02, WA-03, WA-04, WA-05, HB-01, HB-02, HB-03, HB-04, HB-05, HB-06

**Success Criteria** (what must be TRUE):
1. `GET /webhook/whatsapp` echoes `hub.challenge` and Meta field subscription verification passes (confirmed via curl, not just console)
2. A real WhatsApp message from a real phone triggers `POST /webhook/whatsapp`, passes HMAC verification, upserts the sender to `users`, and writes to `message_log` — the whole path completes in under 200ms and returns HTTP 200
3. A WhatsApp status callback (`value.statuses`) is discarded at the top of the handler and never enqueued
4. BullMQ worker processes a synthetic test job end-to-end before any agent code is wired (the worker is proven functional in isolation)
5. Quiet hours logic correctly suppresses interrupts across overnight ranges (e.g. 22:00–07:00 next day)
6. Redis deduplication key (`SET msg:{id} 1 EX 7200 NX`) prevents the same message ID from being enqueued twice

### Plans
1. **WhatsApp webhook handler** — `GET /webhook/whatsapp` hub.challenge verification; `POST /webhook/whatsapp` with HMAC `x-hub-signature-256` verification using `crypto.timingSafeEqual` against raw body captured in Phase 1 middleware (never call `c.req.json()` before HMAC check); event type branching (`value.statuses` → discard, `value.messages` → continue); sender phone E.164 extraction; user upsert to `users`; message persistence to `message_log` (direction = `in`); Redis dedup gate; BullMQ enqueue; return 200 immediately
2. **BullMQ + ioredis setup** — `new IORedis(REDIS_URL, { maxRetriesPerRequest: null })` (never `Bun.redis`); heartbeat Queue and Worker instantiated at server startup; validate worker processes a test job before wiring agent; `{ attempts: 1, timeout: 15000 }` job options
3. **Heartbeat surface decision gate** — Worker evaluates in priority order: quiet hours (overnight range support) → priority contact flag → unknown number → session state → message type → default; `interrupt` pushes spoken text via WebSocket stub (real push wired in Phase 4); `batch` adds to digest queue; `skip`/`silent` log to `heartbeat_log` only; `CONTACT-01` unknown-number interrupt triggered here (spoken digit-by-digit phone format)

**Verification:** Send a real WhatsApp message from a phone; confirm it appears in `message_log` within 5 seconds; send the same message twice and confirm `message_log` has only one entry; confirm a status callback generates no `heartbeat_log` row; `bun test` heartbeat gate and HMAC verification test suites pass.

**Dependencies:** Phase 1 complete — Supabase schema deployed, raw-body middleware active, ioredis/BullMQ packages installed.

---

### Phase 3: Agent Intelligence

**Goal:** A voice transcript enters the orchestrator, fast-path regex or Claude agent produces a spoken-natural response, contact flows work end-to-end, and all agent tool queries explicitly filter by `user_id`.

**Depends on:** Phase 2 (user records exist in `users` table; messages exist in `message_log` for the ReadMessages tool; heartbeat worker can invoke agent after processing)

**Requirements covered:** AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-08, CONTACT-01, CONTACT-02, CONTACT-03, CONTACT-04, CONTACT-05

**Success Criteria** (what must be TRUE):
1. A transcript like "read my messages" resolves via fast-path regex in under 1ms and returns a spoken response without invoking the LLM
2. A transcript like "send a message to Naledi" routes through the Claude orchestrator, resolves "Naledi" to a phone number via `user_contacts`, drafts a message, and sets session state to `awaiting_approval` — all contact queries include `.eq('user_id', userId)`
3. Saying "yes" confirms and queues the send; saying "no" cancels and returns to `idle`; three consecutive no-match inputs trigger `spokenError()` and reset state
4. Ambient queries (load shedding, weather, web search) return a spoken response in under 3 seconds with no markdown characters in the output string
5. A contact name save flow completes in multi-turn: agent asks for name, user confirms, contact is inserted to `user_contacts`; phone numbers are always read as digit-spaced format, never raw digits

**Plans:** 3/3 plans complete

Plans:
- [x] 03-01-PLAN.md — Sanitiser + tool handlers (sanitiseForSpeech, WhatsApp/contacts/ambient tools, TDD)
- [x] 03-02-PLAN.md — Claude orchestrator with manual tool-use loop and ALL_TOOLS definitions (TDD)
- [x] 03-03-PLAN.md — Wire POST /api/voice/command + env vars + approval loop integration

**Verification:** Send transcript "send a message to Naledi, tell her I'll be late"; confirm session enters `awaiting_approval`; say "yes", confirm `message_log` gets a direction=`out` row; query agent with "load shedding today", confirm spoken response arrives in under 3 seconds with no markdown; run `bun test` intent classification and contact save flow suites.

**Dependencies:** Phase 2 complete — user records exist, message_log is populated, BullMQ worker can call agent after surface decision.

---

### Phase 4: Voice Pipeline + Cron

**Goal:** Full audio round-trip works — user voice note in, spoken audio out via WebSocket — and the morning briefing fires on schedule with load shedding first.

**Depends on:** Phase 3 (agent layer must produce spoken text before TTS can consume it; contact resolution must work for read-aloud flows)

**Requirements covered:** VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, CRON-01, CRON-02, CRON-03, CRON-04

**Success Criteria** (what must be TRUE):
1. `POST /api/voice/command` with a real audio blob returns a spoken response and the first audio chunk arrives at the WebSocket client in under 500ms
2. ElevenLabs TTS output uses `eleven_flash_v2_5` (not deprecated `eleven_turbo_v2_5`) and audio sent as WhatsApp voice notes is OGG/Opus (`output_format: 'opus_48000_32'`), not MP3
3. A received WhatsApp voice note is fetched from the Media URL and played back to the device via WebSocket
4. Morning briefing fires at `0 7 * * 1-5` per user (durable via BullMQ `upsertJobScheduler`); content order is load shedding → weather → overnight message digest (priority contacts first); double-fire protection skips if `last_run` within 55 seconds
5. Evening digest (`0 18 * * *`) and custom reminders defined in `routines` are registered on startup; Afrikaans TTS uses correct voice for users with `language = 'af'`

**UI hint**: yes

### Plans
1. **ElevenLabs TTS + WebSocket audio push** — ElevenLabs WebSocket streaming module using `eleven_flash_v2_5`; `output_format: 'opus_48000_32'` constant set in client wrapper for WhatsApp voice notes (not default MP3); per-user WebSocket connection Map with `upgradeWebSocket`/`websocket` from `hono/bun`; binary audio frame push; JSON control frames (`audio_start`, `audio_end`); Afrikaans voice selection from user preference; Hono exports both `fetch` and `websocket` together
2. **Voice command route + STT** — `POST /api/voice/command` accepting `{ userId, transcript, sessionId }` returning `{ spoken, action, requiresConfirmation, pendingAction }`; OpenAI Whisper (`whisper-1`) STT with `language` hint from user profile; full pipeline: STT → fast-path classify → agent → markdown sanitise → TTS → WebSocket push; session state transitions wired throughout; received voice note playback (fetch from WhatsApp Media URL, stream to device)
3. **BullMQ cron + morning briefing worker** — `syncUserRoutines()` called at startup reads `routines` table and calls `upsertJobScheduler` for each enabled routine (never `node-cron`); morning briefing worker: parallel fetch of EskomSePush + OpenWeather + overnight `message_log` digest; spoken briefing built in order: greeting → load shedding → weather → digest (priority contacts first); double-fire protection via `last_run` check; evening digest and custom reminder slots wired

**Verification:** Record a voice note saying "what is the weather today", send to `POST /api/voice/command`, confirm spoken audio plays via WebSocket within 500ms; inspect ElevenLabs request to confirm model is `eleven_flash_v2_5` and OGG/Opus format is set; trigger morning briefing manually via BullMQ, confirm load shedding appears before weather in spoken output; trigger the same job twice within 55 seconds, confirm second run is skipped.

**Dependencies:** Phase 3 complete — agent layer producing spoken text; Phase 1 server skeleton (WebSocket route registration); Redis running (BullMQ scheduler).

---

### Phase 5: Tests + Frontend + Demo

**Goal:** 85+ test cases pass, the caregiver dashboard renders live agent state and heartbeat feed, episodic memory recalls relevant context, and the demo can be run end-to-end without a script.

**Depends on:** Phase 4 complete (all backend routes stable and returning correct data; WebSocket audio push working; cron scheduler running)

**Requirements covered:** TEST-01, FE-01, FE-02, FE-03, FE-04, FE-05, FE-06, FE-07, FE-08, MEM-01, MEM-02, MEM-03

**Success Criteria** (what must be TRUE):
1. `bun test` reports 85+ passing test cases across all 11 suites (quiet hours, phone normalisation, HMAC verification, heartbeat gate, intent classification, session state machine, cron validation, message log helpers, morning briefing builder, contact save flow, WhatsApp payload parsing) with zero failures
2. Caregiver dashboard loads at the frontend URL, shows live agent state panel with 24-bar audio waveform SVG active when session is `listening` or `playing`, and heartbeat feed updates in real-time with correct colour coding (interrupt = green, batch = amber, skip = red)
3. Episodic memory: after a completed session, `memory_store` contains a new row with a non-null embedding; `match_memories` RPC returns relevant memories when queried with similar content; top-5 results are injected into the orchestrator system prompt
4. A complete demo run succeeds: real WhatsApp message received → heartbeat interrupt → spoken read-aloud → voice compose reply → approval loop → send confirmed → morning briefing triggered manually — all without error

**UI hint**: yes

### Plans
1. **Test suite — 85+ cases across 11 suites** — `bun test` suites: quiet hours (overnight range), phone normalisation (E.164 edge cases), HMAC verification (valid sig, tampered body, missing header), heartbeat gate (all 6 decision paths), intent classification (all 8 fast-path patterns + fallthrough), session state machine (valid and invalid transitions), cron validation (double-fire protection), message log helpers, morning briefing builder (order assertion), contact save flow (multi-turn), WhatsApp payload parsing (messages vs statuses vs unknown); assert no `*`, `#`, `` ` `` in any agent output
2. **Episodic memory (pgvector)** — OpenAI `text-embedding-3-small` embeddings on session summaries; insert to `memory_store` after each completed session; `match_memories` RPC called via `supabase.rpc()` with `p_threshold = 0.75`, top-5 results; inject into orchestrator system prompt on every invocation; all queries include `.eq('user_id', userId)`
3. **Caregiver dashboard (Vite + React 18)** — Dark `#0D0D0D` background, terminal green `#00FF88` accents, IBM Plex Mono for data, IBM Plex Sans for prose; pages: Login (phone number → userId context), Setup (language/location/quiet hours/briefing toggle), Dashboard (live agent state + 24-bar waveform SVG + voice command simulator), Heartbeat feed (SSE from Hono `streamSSE`, colour-coded), Contacts (address book + priority toggle + manual add), Routines (cron management with human-readable labels), Log (message history + heartbeat audit + memory schema viewer); Hono SSE push for read-only live data (no WebSocket needed for dashboard)
4. **Demo polish + pre-demo checklist** — Fresh Meta system user token generated within 1 hour of demo; WABA tier and 250-message cap verified in Business Manager; all env vars confirmed in demo environment; ElevenLabs voice IDs benchmarked and committed; EskomSePush area ID set for demo location (Johannesburg fallback hardcoded); real message exchange tested at least 24 hours before demo; demo script rehearsed end-to-end

**Verification:** `bun test` output shows 85+ passing, 0 failing; open dashboard URL, send a WhatsApp message, confirm heartbeat feed updates within 2 seconds; query agent for a topic discussed in a previous session, confirm memory snippet appears in the system prompt (log output); run full demo script once without intervention.

**Dependencies:** Phase 4 complete; Vite + React dev environment configured; all external API keys active and tested.

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/3 | Not started | - |
| 2. Webhook + Heartbeat | 1/3 | In Progress|  |
| 3. Agent Intelligence | 3/3 | Complete   | 2026-03-28 |
| 4. Voice Pipeline + Cron | 0/3 | Not started | - |
| 5. Tests + Frontend + Demo | 0/4 | Not started | - |

---

## Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 1 | Pending |
| INFRA-06 | Phase 1 | Pending |
| ISO-01 | Phase 1 | Pending |
| ISO-02 | Phase 1 | Pending |
| ISO-03 | Phase 1 | Pending |
| WA-01 | Phase 2 | Pending |
| WA-02 | Phase 2 | Pending |
| WA-03 | Phase 2 | Pending |
| WA-04 | Phase 2 | Pending |
| WA-05 | Phase 2 | Pending |
| HB-01 | Phase 2 | Pending |
| HB-02 | Phase 2 | Pending |
| HB-03 | Phase 2 | Pending |
| HB-04 | Phase 2 | Pending |
| HB-05 | Phase 2 | Pending |
| HB-06 | Phase 2 | Pending |
| AGENT-01 | Phase 3 | Pending |
| AGENT-02 | Phase 3 | Pending |
| AGENT-03 | Phase 3 | Pending |
| AGENT-04 | Phase 3 | Pending |
| AGENT-05 | Phase 3 | Pending |
| AGENT-06 | Phase 3 | Pending |
| AGENT-07 | Phase 3 | Pending |
| AGENT-08 | Phase 3 | Pending |
| CONTACT-01 | Phase 3 | Pending |
| CONTACT-02 | Phase 3 | Pending |
| CONTACT-03 | Phase 3 | Pending |
| CONTACT-04 | Phase 3 | Pending |
| CONTACT-05 | Phase 3 | Pending |
| VOICE-01 | Phase 4 | Pending |
| VOICE-02 | Phase 4 | Pending |
| VOICE-03 | Phase 4 | Pending |
| VOICE-04 | Phase 4 | Pending |
| VOICE-05 | Phase 4 | Pending |
| CRON-01 | Phase 4 | Pending |
| CRON-02 | Phase 4 | Pending |
| CRON-03 | Phase 4 | Pending |
| CRON-04 | Phase 4 | Pending |
| TEST-01 | Phase 5 | Pending |
| FE-01 | Phase 5 | Pending |
| FE-02 | Phase 5 | Pending |
| FE-03 | Phase 5 | Pending |
| FE-04 | Phase 5 | Pending |
| FE-05 | Phase 5 | Pending |
| FE-06 | Phase 5 | Pending |
| FE-07 | Phase 5 | Pending |
| FE-08 | Phase 5 | Pending |
| MEM-01 | Phase 5 | Pending |
| MEM-02 | Phase 5 | Pending |
| MEM-03 | Phase 5 | Pending |

**Total mapped:** 54/54 v0.1 requirements (including CONTACT-01-05 from heartbeat + agent layer) ✓
**Unmapped:** 0 ✓

---

## Architectural Constraints Embedded in Roadmap

The following constraints from research are explicitly encoded in phase plans and verification steps:

| Constraint | Phase | Where Encoded |
|-----------|-------|---------------|
| Supabase schema before all else | Phase 1, Plan 1 | "build this before anything else writes to the database" |
| HMAC raw-body middleware is first route written | Phase 1, Plan 2 + Phase 2, Plan 1 | "must precede all route registration"; "never call `c.req.json()` before HMAC check" |
| BullMQ `maxRetriesPerRequest: null` from day one | Phase 2, Plan 2 | Explicit in plan text |
| Fast-path regex before LLM wiring | Phase 1, Plan 3 + Phase 3 | Session/classifier in Phase 1; agent in Phase 3 |
| `eleven_flash_v2_5` not deprecated `eleven_turbo_v2_5` | Phase 4, Plan 1 | Explicit model name in plan; verification step checks it |
| pgvector via `.rpc()` — PostgREST cannot use `<=>` | Phase 1, Plan 1 + Phase 5, Plan 2 | SQL function deployed in Phase 1; `supabase.rpc()` enforced in Phase 5 |
| service_role bypasses RLS — explicit `user_id` filter required | Phase 1, Plan 3 + Phase 3, Plan 1 | Isolation helper in Phase 1; every tool query assertion in Phase 3 |
| ElevenLabs OGG/Opus for WhatsApp voice notes | Phase 4, Plan 1 | `output_format: 'opus_48000_32'` set in client wrapper |

---

*Roadmap generated: 2026-03-27*
*Next: `/gsd:plan-phase 1`*
