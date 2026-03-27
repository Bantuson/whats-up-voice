# Research Summary — VoiceApp

**Synthesized:** 2026-03-27
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall Confidence:** HIGH across all four domains

---

## Executive Summary

VoiceApp is a screenless AI messaging companion delivered entirely over WhatsApp, built for visually impaired and hands-occupied South African users. The core contract is simple: a user sends a voice note, the agent transcribes it, classifies intent, acts (reads messages, composes a reply, saves a contact, answers an ambient query), and responds with a spoken audio message — all without the user ever touching a screen after initial setup. The architecture is a single Bun/Hono process that handles inbound WhatsApp webhooks, a session state machine, a Claude agent orchestrator with sub-agents, a BullMQ event queue, and an ElevenLabs TTS pipeline. This is a well-trodden pattern: webhook → queue → worker → LLM → TTS → audio push. The novelty is in the South African context features (load shedding via EskomSePush, Afrikaans TTS), the voice-first accessibility design, and the heartbeat engine that gates which events surface as interrupts versus batched digests.

The recommended build strategy is strictly dependency-ordered. The Supabase schema and RLS policies must exist before anything else writes to the database. The WhatsApp webhook handler with HMAC verification must be working and returning 200 in under 200ms before the agent is wired in. The session state machine is pure logic with no dependencies and can be built in parallel. Fast-path regex intent classification runs before every LLM invocation, keeping common commands under 500ms. The agent orchestrator and sub-agents come after the infrastructure is validated end-to-end with a real WhatsApp message. TTS and audio push are the last backend pieces before tests and the caregiver frontend.

The primary risks are operational: HMAC webhook verification against the wrong body (causes spoofed injections or a permanently broken webhook), BullMQ worker stalls under Bun due to the ioredis/Bun.redis confusion, WhatsApp status-update floods triggering unnecessary agent invocations, and context window accumulation in multi-tool agent conversations. All four are well-understood and preventable with specific mitigations documented in PITFALLS.md. The demo-specific risks (WhatsApp access token expiry, missing environment variables, WABA message tier cap) must be addressed in a pre-demo checklist, not during the build.

---

## 1. Recommended Stack

All technology choices are fixed per PROJECT.md constraints. This section documents the authoritative versions and critical configuration details.

| Technology | Version | Role | Critical Notes |
|------------|---------|------|----------------|
| Bun | 1.3.x (1.3.11) | Runtime, test runner, package manager | Native TypeScript, built-in `bun test`, `Bun.cron` for OS-level scheduling |
| Hono | 4.x (4.12.9) | HTTP framework | Import `upgradeWebSocket`, `websocket` from `hono/bun`; `serveStatic` is also runtime-specific in v4 |
| Supabase (PostgreSQL 15) | Managed latest | Primary DB, RLS isolation | Service-role key only for backend; pgvector enabled via `create extension if not exists vector` |
| @supabase/supabase-js | 2.99.x (2.99.3) | DB client | pgvector queries must go through `supabase.rpc()` — PostgREST does not expose vector operators |
| @anthropic-ai/sdk | 0.80.x (0.80.0) | Claude agent intelligence | Model: `claude-sonnet-4-6`. Manual orchestrator + sub-agents pattern. NOT the `@anthropic-ai/claude-agent-sdk` |
| openai | 6.x (6.33.0) | Whisper STT + text-embedding-3-small | Explicitly supports Bun; use `gpt-4o-mini-transcribe` for STT; `text-embedding-3-small` at 1536 dims for embeddings |
| @elevenlabs/elevenlabs-js | 2.x (2.39.0) | TTS (EN + Afrikaans) | Use `eleven_flash_v2_5` for all real-time responses (~75ms first chunk); `eleven_multilingual_v2` for pre-generated only. Old `elevenlabs` package is deprecated. |
| BullMQ | 5.x (5.45.0) | Heartbeat event queue, cron scheduling | Requires `ioredis`, NOT `Bun.redis`. Set `maxRetriesPerRequest: null` on connection |
| ioredis | 5.x (5.10.1) | Redis client (BullMQ dependency) | Must be installed explicitly; Bun.redis is incompatible with BullMQ |
| Redis | 7.x | Queue backend | Configure `maxmemory-policy noeviction` + AOF persistence; Upstash or Railway for hackathon |
| zod | 3.x | Runtime schema validation | Validate webhook payloads and API request bodies at boundary points |
| Meta Graph API | v23.0 | WhatsApp send/receive | Raw `fetch` only — official Meta SDK archived June 2023 |
| Vite + React 18 | Latest | Caregiver dashboard (P1) | SSE (`streamSSE` from Hono) for server push; no WebSocket needed for read-only view |

**Environment variables required (all must be present at startup):**

```
ANTHROPIC_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY,
WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL
```

---

## 2. Table Stakes Features

Features without which the product does not function for its target audience. Build all of these in the P0 phase.

| Feature | Why Non-Negotiable | Key Design Constraint |
|---------|-------------------|----------------------|
| Voice compose + send WhatsApp messages | The entire value proposition is screenless messaging | Regex fast-path for common intents before LLM invocation |
| Pre-send approval confirmation loop | Users cannot undo a sent message; trust destroyed without it | Single yes/no turn only; cancel on third no-match; never auto-send on silence |
| Read incoming messages aloud with contact name resolution | Without name resolution, phone digits read aloud create cognitive overload | `user_contacts` lookup before every TTS output; unknown numbers read as digit-spaced format |
| Voice-only contact creation | Users cannot use a screen | Multi-turn: name → confirm → save; one question per turn |
| Unknown contact identification flow | Receiving a message from an unsaved number must be actionable | Offer to save after reading the message; do not block the read |
| HMAC webhook security (`x-hub-signature-256`) | Spoofed injections can trigger agent actions with fabricated data | Read raw body before any JSON parse; verify with `crypto.timingSafeEqual` |
| Session state machine | Voice interactions are stateful; pending approval must survive tool calls | Five states: idle / listening / composing / awaiting_approval / playing |
| Heartbeat engine — interrupt vs batch vs silent vs skip | Not every message should speak immediately; interruption has a 23-minute cognitive cost | Weighted scoring matrix; thresholds at 3 (interrupt), 1–2 (batch), ≤0 (silent), <-2 (skip) |
| Morning briefing cron | Replaces the screen-check habit | Load shedding first, then weather, then overnight message digest |
| Supabase schema with RLS + user identity via phone E.164 | DB-layer isolation; no separate auth system | Every backend query explicitly filters by `user_id`; service_role bypasses RLS |
| Natural spoken-first responses (no markdown) | Markdown read aloud is noise; asterisks and bullets are inaccessible | System prompt constraint + post-processing sanitiser before every TTS call |
| Error recovery and clarification prompts | STT misrecognition is common; system must not loop or fail silently | Max 3 no-match events; rephrase on each; generic `spokenError()` fallback after third |

---

## 3. Key Architectural Decisions

### Patterns to Use

**Single Bun process, single port.** One Hono server handles HTTP routes (webhook, API), WebSocket upgrades (audio push), and SSE (caregiver dashboard). Export `{ fetch: app.fetch, websocket }` from `hono/bun` together — Bun requires both.

**Enqueue-only webhook handler.** The WhatsApp webhook must return 200 in under 200ms. The handler's only job is HMAC verification, user upsert, message persistence, and BullMQ enqueue. All processing (agent invocation, TTS, audio push) lives in the worker.

**Regex fast-path before LLM.** A classified set of common intents (confirm_send, cancel, read_messages, load_shedding, weather) resolves in under 1ms via regex. Only genuinely ambiguous or novel intents reach the Claude agent. This keeps common commands under 500ms.

**BullMQ `upsertJobScheduler` for cron.** Morning briefing schedules are stored in the `routines` table and registered on startup via `upsertJobScheduler`. This is durable (survives restart), deduplicated (no double-registration), and uses the same worker path as event-driven jobs.

**pgvector similarity via Postgres RPC.** PostgREST does not expose pgvector operators. All similarity queries are wrapped in a `match_memories` Postgres function and called via `supabase.rpc()`. Include an HNSW index in the initial migration — not as a later optimisation.

**ElevenLabs WebSocket streaming.** Use the WebSocket streaming API (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`), not the REST endpoint. First audio chunk arrives in ~200ms versus 1–3 seconds for the non-streaming endpoint.

**In-process session state Map (hackathon scope).** `Map<userId, SessionState>` with an explicit transition guard covers all five states. No XState — adds ~50KB and serialization overhead for five states with six transitions. Post-hackathon upgrade path: Redis hash with TTL.

**Afrikaans TTS via ElevenLabs `eleven_flash_v2_5`.** ElevenLabs has better Afrikaans naturalness than Google Cloud TTS. Use `af-ZA` voice with `eleven_flash_v2_5` model. Pass `language: 'af'` hint to Whisper STT for Afrikaans sessions. Google Cloud TTS reserved for isiZulu in v0.2.

### Patterns to Avoid

| Anti-Pattern | Consequence | Correct Alternative |
|--------------|-------------|-------------------|
| Call `c.req.json()` before HMAC verification | Consumes body stream; HMAC check gets empty string | `c.req.text()` first in middleware, store as `rawBody`, parse after |
| Register a global JSON body-parsing middleware | Consumes body stream for all routes including webhook | Parse body explicitly per-route |
| Use `Bun.redis` as BullMQ connection | BullMQ requires ioredis internals; stalls immediately | `new IORedis(url, { maxRetriesPerRequest: null })` |
| Use `node-cron` for morning briefing | Timer lost on process restart; no retry, no dedup | BullMQ `upsertJobScheduler` |
| Route every command through the Agent SDK | Subprocess overhead adds 300–800ms minimum | Regex fast-path first; Agent SDK for multi-step flows only |
| Query pgvector via Supabase client filter | PostgREST does not support vector operators; silently fails | Wrap in Postgres function, call via `.rpc()` |
| Use `eleven_turbo_v2_5` or `eleven_turbo_v2` | Deprecated as of early 2026 | `eleven_flash_v2_5` for real-time |
| Call ElevenLabs REST (non-streaming) for TTS | 1–3 second silence before audio starts | WebSocket streaming API |
| Use `XState` for five-state session machine | ~50KB + serialization complexity for 30 lines of logic | Plain `Map` + explicit transition guard |
| Use professional voice clone (PVC) for default voice | 100–300ms additional latency per generation | Pre-made ElevenLabs voice, benchmarked before committing |
| Rely on RLS to isolate service_role queries | `service_role` bypasses RLS entirely | Every query includes `.eq('user_id', userId)` |
| Use `@great-detail/whatsapp` SDK by default | Unofficial, adds abstraction; raw fetch is sufficient | Native `fetch` against Graph API v23.0 |

---

## 4. Top Pitfalls to Avoid

Ordered by severity and phase impact.

### C1 — HMAC Verification Against Parsed Body (CRITICAL, Phase 1/2)
Read raw body with `c.req.text()` in middleware before any JSON parsing. Store as `rawBody` on Hono context. Verify with `crypto.timingSafeEqual`. Parse JSON after verification. Getting this wrong either opens the webhook to spoofed message injection or causes every legitimate Meta event to return 403 (webhook silently breaks; Meta retries for 7 days then drops all events).

### C2 — Duplicate Webhook Events (CRITICAL, Phase 2)
WhatsApp guarantees at-least-once delivery. Any response over 200ms or a non-200 status triggers a retry. Return 200 within 200ms, then enqueue. Use Redis `SET msg:{id} 1 EX 7200 NX` as an atomic deduplication gate before enqueuing. Without this, the user receives duplicate spoken messages and contacts are saved twice.

### C3 — BullMQ Worker Stalls Under Bun (CRITICAL, Phase 2)
Three modes of failure: (A) using `Bun.redis` instead of `ioredis` as the BullMQ connection — jobs stall immediately; (B) missing `maxRetriesPerRequest: null` on the IORedis options — worker event loop breaks; (C) Redis configured with `allkeys-lru` eviction — queued jobs disappear silently under memory pressure. Validate the worker processes a test job successfully before building anything on top of it.

### C4 — service_role Bypasses RLS (CRITICAL, Phase 1 and Phase 3)
`service_role` sets `BYPASSRLS`. RLS policies protect direct client access, not backend queries. Every agent tool that touches user data must include `.eq('user_id', userId)` explicitly. Write a test that queries with a fabricated `user_id` through the backend to verify application-layer isolation.

### C5 — ElevenLabs Outputs MP3; WhatsApp Voice Notes Require OGG/Opus (CRITICAL, Phase 4)
Set `output_format: 'opus_48000_32'` on all ElevenLabs requests that produce WhatsApp voice notes. MP3 either fails the media upload or renders as a broken attachment. Establish this constant in the ElevenLabs client wrapper on day one, not as a fix discovered during testing.

### M1 — WhatsApp Status Update Flood (MODERATE, Phase 2)
Every outbound message generates three status callbacks: sent, delivered, read. Without branching at the top of the webhook handler, these trigger agent invocations with no corresponding user message. Branch immediately: if `value.statuses` exists, return 200 and discard. Only process `value.messages`.

### M4 — Markdown in TTS Output (MODERATE, Phase 3/4)
Claude naturally produces markdown. ElevenLabs reads `**bold**` as "asterisk asterisk bold asterisk asterisk". Enforce spoken-natural prose in the system prompt AND add a post-processing sanitiser (strip `**`, `##`, `- ` at line start, backticks) before every TTS call. Test by asserting agent output strings contain none of: `*`, `#`, `` ` ``.

### H3 — WhatsApp Access Token Expiry (DEMO RISK)
User access tokens expire; system user tokens from Meta Business Manager are stable. Generate a fresh system user token at least one hour before the demo. Add to the pre-demo checklist.

---

## 5. Build Order Implications

The dependency graph is clear and non-negotiable. Deviating from this order produces blocked work.

### Phase 1 — Foundation (build first, no dependencies)

**Goal:** Working database schema, environment validation, and server skeleton that can receive a request.

Includes:
- Supabase schema: `users`, `messages`, `user_contacts`, `memories`, `routines` tables with RLS policies and pgvector extension enabled
- HNSW index on `memories.embedding` — include in the initial migration, not later
- `validateEnv()` startup check — all 11 required env vars, throw with clear message on missing
- Hono server skeleton with raw-body capture middleware on `/webhook/*`
- Session state machine (pure logic, no DB dependency)
- Fast-path regex intent classifier (pure logic, no dependencies)
- `spokenError()` fallback utility

**Must avoid:** Global JSON body-parsing middleware. Establish correct route registration pattern here.

### Phase 2 — Message Ingestion (depends on Phase 1)

**Goal:** Real WhatsApp messages arriving, persisted to DB, and enqueued — validated end-to-end with a real phone.

Includes:
- WhatsApp webhook GET verification handler (`hub.challenge` echo)
- WhatsApp webhook POST handler with HMAC verification, user upsert, message persistence
- Webhook event type branching (statuses vs messages vs unknown)
- BullMQ queue + ioredis connection (validated with a test job)
- Heartbeat worker skeleton (processes jobs, surface-decision logic)
- Redis deduplication key (`SET msg:{id} 1 EX 7200 NX`)
- WhatsApp field subscription verification (not just console green checkmark — curl test)

**Must validate:** Worker actually processes a test job before proceeding to Phase 3.

### Phase 3 — Agent Intelligence (depends on Phase 2)

**Goal:** Voice command → transcript → intent → agent → spoken response (text only, no audio yet).

Includes:
- OpenAI Whisper STT module (audio blob → transcript, with `language` hint from user preference)
- Claude agent orchestrator with sub-agents: WhatsApp, Contacts, Ambient
- WhatsApp sub-agent tools: ReadMessages, SendMessage, ResolveContact
- Contacts sub-agent tools: GetContact, SaveContact, ListContacts
- Ambient sub-agent tools: GetLoadShedding (EskomSePush), GetWeather (OpenWeather), WebSearch (Tavily)
- Context budget enforcement: compact tool results, cap at 10 tool calls per conversation
- AbortController with 5-second timeout on every external API call
- BullMQ job option: `{ attempts: 1, timeout: 15000 }`
- Markdown sanitiser applied to all agent text output before it leaves the agent layer

### Phase 4 — Voice Pipeline (depends on Phase 3)

**Goal:** Full end-to-end: voice in → spoken audio response out, including approval loop and contact flows.

Includes:
- ElevenLabs TTS WebSocket streaming module (`eleven_flash_v2_5`; `output_format: 'opus_48000_32'` for WA voice notes)
- WebSocket manager: per-user connection Map, binary audio push, JSON control frames (`audio_start`, `audio_end`)
- `POST /api/voice/command` route (full pipeline: STT → classify → agent → TTS → WS push)
- `formatPhoneForSpeech()` utility — apply to every agent response containing a phone number
- Priority contact flagging (interrupt decision gate)
- Voice contact creation flow (multi-turn)
- Voice compose + pre-send approval loop (confirmation loop, max 3 no-match, cancel on third)
- Read incoming messages aloud with contact name resolution
- BullMQ `upsertJobScheduler` for morning briefing cron, synced from `routines` table on startup
- Morning briefing worker: parallel EskomSePush + OpenWeather + overnight message digest → spoken briefing (load shedding first)
- Ambient query handling (load shedding, weather, web search)
- Afrikaans TTS voice selection based on user preference

**Research flag:** Voice flow error recovery paths (each error state needs a TTS response) will take longer than expected. Use `spokenError()` template for all v0.1 unhappy paths.

### Phase 5 — Polish and Demo Prep (depends on Phase 4)

**Goal:** Demo-ready, stable, tests passing.

Includes:
- Episodic memory: embed → store → `match_memories` RPC recall (P1)
- Caregiver dashboard: Vite + React, Hono SSE push (P1)
- 85+ test cases across 11 suites with `bun test`
- Pre-demo checklist: fresh system user token, WABA tier verification, all env vars confirmed in demo environment
- Demo script rehearsal with real WhatsApp messages

**Deferred to v0.2 (explicit non-scope):**
- isiZulu TTS (Google Cloud TTS)
- Group message send/reply
- iOS background audio
- Proactive load shedding push alerts
- Research-to-podcast synthesis
- Multi-device session management

---

## 6. Open Questions

Unresolved decisions that need attention during or before Phase 1.

| Question | Impact | Recommendation |
|----------|--------|----------------|
| Which ElevenLabs voice IDs for English SA and Afrikaans? | Phase 4 — voice selection affects perceived quality and latency | Benchmark 3–5 pre-made voices per language in isolation before committing; do not use PVC voices in v0.1 |
| EskomSePush area ID for demo user | Phase 4 — morning briefing fails without it | Add area configuration to onboarding voice flow; hardcode a Johannesburg area ID as demo fallback |
| Redis hosting for hackathon | Phase 2 — BullMQ cannot start without Redis | Decide between Upstash (serverless, free tier) or Railway Redis before Phase 2 begins |
| `Bun.cron` vs BullMQ `upsertJobScheduler` for morning briefing | Phase 4 — affects durability and retry semantics | Use BullMQ `upsertJobScheduler` (durable, retryable, deduplicatable); reserve `Bun.cron` for lightweight in-process triggers that don't need retry |
| WhatsApp WABA Business Verification status | Demo risk — 250-message cap on unverified accounts | Verify Meta Business Verification is complete before demo day; check WABA tier in Business Manager |
| WebSocket client implementation on Android | Phase 4 — audio push requires a WS client on the mobile side | Confirm Android demo client can handle mixed binary + JSON frames on a single WebSocket connection |
| Demo phone number registered long enough to avoid WhatsApp rate limits? | Demo risk | Test with a real message exchange at least 24 hours before the demo |

---

## Confidence Assessment

| Domain | Confidence | Basis |
|--------|------------|-------|
| Stack | HIGH | All versions pinned; Bun + Hono + BullMQ compatibility verified against official docs and community issue trackers |
| Features | HIGH | VUI and accessibility patterns are mature; WhatsApp Cloud API behaviour is well-documented; EskomSePush API scope is defined |
| Architecture | HIGH | Patterns verified against official docs for Hono, BullMQ, Supabase pgvector, ElevenLabs WebSocket, Claude Agent SDK |
| Pitfalls | HIGH | Most pitfalls verified against official docs, GitHub issues, and community reports; demo-specific risks are well-understood |
| South African context | MEDIUM | EskomSePush API free tier limits (50 req/day) have not been stress-tested; Afrikaans STT accuracy at 85–90% is an estimate |
| Episodic memory (pgvector) | MEDIUM | Pattern is correct; specific threshold values (0.78 similarity, topK=5) will need tuning against real interaction data |

**Gaps that need attention during planning:**
- No validated requirements yet (PROJECT.md explicitly notes "None yet — ship to validate"); all feature priorities are assumptions until tested with a real visually impaired user
- STT accuracy on South African English accents and Afrikaans code-switching is a known risk without a mitigation beyond the confirmation loop
- ElevenLabs Afrikaans voice naturalness has not been benchmarked against user expectations

---

## Sources (Aggregated)

- Bun v1.3.11 changelog: https://bun.com/blog/bun-v1.3.11
- Hono documentation (Bun adapter, SSE, WebSocket): https://hono.dev/docs/getting-started/bun
- BullMQ Bun compatibility: https://github.com/taskforcesh/bullmq/issues/2177
- BullMQ Job Schedulers: https://docs.bullmq.io/guide/job-schedulers
- Claude Agent SDK: https://platform.claude.com/docs/en/agent-sdk/overview
- Supabase pgvector semantic search: https://supabase.com/docs/guides/ai/semantic-search
- Supabase RAG with permissions: https://supabase.com/docs/guides/ai/rag-with-permissions
- ElevenLabs models and latency: https://elevenlabs.io/docs/overview/models
- ElevenLabs WebSocket streaming: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- OpenAI gpt-4o-mini-transcribe: https://developers.openai.com/blog/updates-audio-models
- Meta Graph API v23 (WhatsApp Cloud API): https://developers.facebook.com/docs/whatsapp/cloud-api/
- WhatsApp HMAC webhook verification: https://hookdeck.com/webhooks/guides/how-to-implement-sha256-webhook-signature-verification
- EskomSePush API: https://eskomsepush.gumroad.com/l/api
- Google Cloud Dialogflow CX — Voice agent design: https://docs.cloud.google.com/dialogflow/cx/docs/concept/voice-agent-design
- BullMQ Going to Production: https://docs.bullmq.io/guide/going-to-production
- pgvector HNSW index pitfalls: https://dev.to/mianzubair/4-pgvector-mistakes-that-silently-break-your-rag-pipeline-in-production-4e0p
