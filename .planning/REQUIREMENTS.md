# Requirements: VoiceApp

**Defined:** 2026-03-27
**Core Value:** A visually impaired South African can independently send and receive WhatsApp messages entirely by voice, with full contact name resolution and a confirmation loop before sending.

---

## v0.1 Requirements (Hackathon Build)

### Foundation & Infrastructure

- [ ] **INFRA-01**: Supabase PostgreSQL schema deployed with all 8 tables (`users`, `user_profile`, `user_contacts`, `sessions`, `message_log`, `memory_store`, `routines`, `heartbeat_log`)
- [ ] **INFRA-02**: Row Level Security enforced on all tables with user policy + service_role bypass policy
- [ ] **INFRA-03**: `pgvector` extension enabled; `match_memories` and `resolve_contact_name` SQL helper functions deployed
- [x] **INFRA-04**: Bun/Hono server running on port 3000 with health check endpoint and environment variable validation at startup
- [x] **INFRA-05**: CORS configured for frontend origin; Bearer token auth middleware on all `/api/*` routes
- [x] **INFRA-06**: Session state machine enforced: valid states `idle → listening → composing → awaiting_approval → playing`

### WhatsApp Integration

- [ ] **WA-01**: `GET /webhook/whatsapp` handles Meta verification handshake (hub.challenge response)
- [ ] **WA-02**: `POST /webhook/whatsapp` verifies HMAC `x-hub-signature-256` on raw body before any parsing
- [ ] **WA-03**: Inbound messages parsed: sender E.164 phone extracted, user upserted to `users` table on first contact
- [ ] **WA-04**: Status update callbacks (`value.statuses`) filtered out — do not enqueue to heartbeat
- [ ] **WA-05**: All inbound messages logged to `message_log` (direction = `in`) before heartbeat processing

### Heartbeat Engine

- [x] **HB-01**: Inbound messages enqueued to BullMQ heartbeat queue (using ioredis, `maxRetriesPerRequest: null`)
- [ ] **HB-02**: Surface decision gate evaluates in priority order: quiet hours → priority contact → unknown number → session state → message type → default
- [ ] **HB-03**: `interrupt` decision pushes spoken text via WebSocket to active device immediately
- [ ] **HB-04**: `batch` decision adds message to in-memory digest queue
- [ ] **HB-05**: `skip` and `silent` decisions log to `heartbeat_log` without TTS
- [ ] **HB-06**: Quiet hours logic supports overnight ranges (e.g. 22:00–07:00)

### AI Agent System

- [x] **AGENT-01**: Orchestrator receives STT transcript, classifies intent via fast-path regex before invoking LLM
- [x] **AGENT-02**: Intent classification covers: `send_message`, `read_messages`, `save_contact`, `set_priority`, `load_shedding`, `weather`, `web_search`, `message_digest`
- [x] **AGENT-03**: Messaging sub-agent resolves contact by name (e.g. "wife" → Naledi) via `user_contacts` lookup
- [x] **AGENT-04**: Messaging sub-agent drafts outbound message and enters `awaiting_approval` state with TTS read-back
- [x] **AGENT-05**: User can confirm ("yes/send") or cancel ("no/cancel") pending message — state returns to `idle`
- [x] **AGENT-06**: Ambient sub-agent handles load shedding (EskomSePush), weather (OpenWeather), web search (Tavily) — target latency under 3 seconds
- [x] **AGENT-07**: All agent spoken responses are plain conversational text — no markdown, no bullet points, one question at a time
- [x] **AGENT-08**: Markdown sanitiser applied at TTS call boundary (post-processing, not prompt-only)

### Voice Pipeline

- [ ] **VOICE-01**: `POST /api/voice/command` accepts `{ userId, transcript, sessionId }` and returns `{ spoken, action, requiresConfirmation, pendingAction }`
- [ ] **VOICE-02**: OpenAI Whisper (`whisper-1`) used for STT transcription with language hint for EN/AF
- [x] **VOICE-03**: ElevenLabs TTS using `eleven_flash_v2_5` (not deprecated `eleven_turbo_v2_5`) for English and Afrikaans
- [x] **VOICE-04**: TTS output streamed via WebSocket (`/ws/session/:userId`) — first audio chunk target under 500ms
- [ ] **VOICE-05**: Received voice notes fetched from WhatsApp Media URL and streamed to device for playback

### Contact Management

- [x] **CONTACT-01**: Unknown number inbound triggers `interrupt` with spoken phone number (digit-by-digit format: "plus 2 7 8 3 1...") *(Deferred to Phase 4 — requires TTS/pushInterrupt wiring from Phase 4 Plan 2)*
- [x] **CONTACT-02**: User can save unknown number by voice: agent asks for name, confirms, inserts to `user_contacts`
- [x] **CONTACT-03**: User can proactively save a contact by speaking digits and a name
- [x] **CONTACT-04**: User can set/unset a contact as priority by voice ("make Bongani a priority contact")
- [x] **CONTACT-05**: Contact name resolution used in all read-aloud flows — phone numbers never spoken when name is known

### Cron & Morning Briefing

- [x] **CRON-01**: BullMQ job scheduler polls `routines` table; fires `morning_briefing` at `0 7 * * 1-5` per user
- [x] **CRON-02**: Double-fire protection: skip if `last_run` within 55 seconds of current time
- [x] **CRON-03**: Morning briefing composition order: greeting → load shedding → weather → overnight message digest (priority contacts first)
- [x] **CRON-04**: Evening digest (`0 18 * * *`) and custom reminders supported via `routines` table entries

### User Isolation

- [x] **ISO-01**: All agent tool queries explicitly filter by `user_id` (service_role bypasses RLS — app-layer isolation required)
- [x] **ISO-02**: Phone number normalised to E.164 on every inbound webhook before lookup/upsert
- [x] **ISO-03**: WebSocket sessions scoped per `userId` — no cross-user message delivery possible

### Test Suite

- [x] **TEST-01**: `bun test` passes 85+ test cases across 11 suites: quiet hours, phone normalisation, HMAC verification, heartbeat gate, intent classification, session state machine, cron validation, message log helpers, morning briefing builder, contact save flow, WhatsApp payload parsing

### Frontend (Caregiver Dashboard — P1)

- [x] **FE-01**: Login page: phone number entry sets userId context
- [x] **FE-02**: Setup page: language, location, quiet hours, morning briefing toggle
- [x] **FE-03**: Dashboard: live agent state panel, 24-bar audio waveform SVG (active when `listening`/`playing`), voice command simulator (text input → backend)
- [x] **FE-04**: Heartbeat feed: live log with colour coding (`interrupt` = green, `batch` = amber, `skip` = red)
- [x] **FE-05**: Contacts page: address book management, priority toggle, manual add
- [x] **FE-06**: Routines page: cron routine management with human-readable labels
- [x] **FE-07**: Log page: message history, heartbeat audit, memory schema viewer
- [x] **FE-08**: Design: dark `#0D0D0D` background, terminal green `#00FF88` accents, IBM Plex Mono for data, IBM Plex Sans for prose

### Episodic Memory (P1)

- [x] **MEM-01**: Interaction summaries written to `memory_store` after each completed session with OpenAI `text-embedding-3-small` embeddings
- [x] **MEM-02**: `match_memories` RPC called via `supabase.rpc()` — cosine similarity search over user's memory with `p_threshold = 0.75`
- [x] **MEM-03**: Top-5 memory snippets injected into orchestrator system prompt on every invocation

---

## v0.2 Requirements (Deferred)

- **V2-01**: isiZulu TTS via Google Cloud TTS
- **V2-02**: Proactive load shedding push alerts (schedule change detection)
- **V2-03**: Research-to-podcast synthesis (multi-step research agent + TTS stitching)
- **V2-04**: Group message creation (currently read-only)
- **V2-05**: Multi-device session management
- **V2-06**: Android native app integration (background audio, volume button trigger)

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| iOS native integration | Background audio restrictions; Android-first for hackathon |
| WhatsApp device contact sync | WhatsApp Business API does not expose device contacts |
| Payments integration | Not relevant to hackathon scope |
| Multi-device sessions | Adds significant complexity, not needed for demo |
| isiZulu TTS v0.1 | ElevenLabs quality not production-ready for isiZulu |
| Group message creation | Wrong-group send risk is severe for visually impaired users; read-only safer |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 – INFRA-06 | Phase 1 | Pending |
| WA-01 – WA-05 | Phase 2 | Pending |
| HB-01 – HB-06 | Phase 2 | Pending |
| AGENT-01 – AGENT-08 | Phase 3 | Pending |
| VOICE-01 – VOICE-05 | Phase 4 | Pending |
| CONTACT-02 – CONTACT-05 | Phase 3 | Pending |
| CONTACT-01              | Phase 4 | Complete |
| CRON-01 – CRON-04 | Phase 4 | Pending |
| ISO-01 – ISO-03 | Phase 1 | Pending |
| TEST-01 | Phase 5 | Complete |
| FE-01 – FE-08 | Phase 5 | Pending |
| MEM-01 – MEM-03 | Phase 5 | Pending |

**Coverage:**
- v0.1 requirements: 47 total
- Mapped to phases: 47
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after initialization*
