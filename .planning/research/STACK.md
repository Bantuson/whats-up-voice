# Technology Stack

**Project:** VoiceApp — Voice-native AI companion for WhatsApp (South Africa)
**Researched:** 2026-03-27
**Stack is fixed per PROJECT.md constraints** — this document provides rationale and version-specific guidance, not alternative selection.

---

## Recommended Stack

### Runtime and Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun | 1.3.x (latest 1.3.11 as of 2026-03-18) | JS runtime, test runner, bundler, package manager | 99% Node.js compatibility as of v1.2+, native TypeScript, built-in test runner replaces Jest/Vitest, fastest cold start in class. v1.3.x adds Bun.cron API (OS-level cron scheduling) and built-in Bun.redis client. Fixed per PROJECT.md. |
| Hono | 4.x (latest 4.12.9 as of 2026-03-23) | HTTP framework | Ultrafast, built on Web Standards, first-class Bun adapter via `hono/bun`, SSE and WebSocket helpers ship in-box. Import `upgradeWebSocket, websocket` from `'hono/bun'` for WS; `streamSSE` from `'hono/streaming'` for dashboard push. Fixed per PROJECT.md. |

**Version gotcha — Hono v4 breaking changes (from v3):**
- `serveStatic` is now runtime-specific: use `import { serveStatic } from 'hono/bun'`, not a generic import.
- `basicAuth`/`bearerAuth` middleware return values changed — must return the middleware result, not await it.
- GraphQL Server and Mustache middleware removed. No action needed for this project.
- Validator now throws on failure instead of returning JSON — wrap validator middleware accordingly.

---

### Database and Vector Search

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Supabase (PostgreSQL 15) | Managed (latest) | Primary persistence, RLS user isolation | pgvector built-in, RLS enforced at DB layer means cross-user data leaks are impossible even with app-layer bugs. Service-role key for backend; no separate auth system needed (phone number is identity). Fixed per PROJECT.md. |
| @supabase/supabase-js | 2.99.x (latest 2.99.3) | DB client, RPC, Realtime | Supports `.rpc()` for pgvector similarity search (PostgREST does not expose vector operators natively — must wrap similarity query in a Postgres function). Node.js 18 support dropped in v2.79.0; Bun v1.3.x runs on the equivalent of Node 20+ so no issue. |
| pgvector (Supabase extension) | Built into Supabase | Semantic/episodic memory search | Enable via `create extension if not exists vector;`. Use `vector(1536)` column type for text-embedding-3-small. Similarity query pattern: `match_documents` Postgres function called via `.rpc('match_documents', {...})`. |

**pgvector embedding model — OpenAI text-embedding-3-small:**
- Default dimension: 1536. Use this; smaller dimensions (256/512/1024) reduce accuracy.
- Must use the same model for all embeddings stored in a table — mixing models produces meaningless similarity scores.
- Called via `openai` npm package (v6.x — see AI section below), not a separate embeddings SDK.

---

### AI and Agent Intelligence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/sdk | 0.80.x (latest 0.80.0 as of 2026-03-19) | Claude agent, tool use, orchestrator + sub-agent pattern | Primary intelligence layer. MODEL: `claude-sonnet-4-6` as fixed in PROJECT.md. Fast-path regex intent classification runs before LLM invocation to keep common commands under 500ms. |
| openai | 6.x (latest 6.33.0 as of 2026-03-27) | Whisper STT (transcription) + text-embedding-3-small | Official OpenAI SDK explicitly supports Bun. Use `client.audio.transcriptions.create()` for STT; `client.embeddings.create()` for vector embeddings. v6.x is the current active series — v5.x is superseded. |

**STT model selection (Whisper via OpenAI API):**
- `whisper-1` — proven, reliable, multilingual including Afrikaans. Cost: ~$0.006/min.
- `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` — newer 2025 models with higher accuracy and diarization support. `gpt-4o-mini-transcribe` (snapshot: `gpt-4o-mini-transcribe-2025-12-15`) is the cost-effective 2025 option for production.
- **Recommendation:** Use `gpt-4o-mini-transcribe` for production (better accuracy, cheaper per minute than `gpt-4o-transcribe`). Fall back to `whisper-1` if latency is unacceptable.
- Audio file size limit: 25 MB per request. WhatsApp voice notes are typically OGG Opus; must convert to MP3/WAV/M4A before sending to API. Use Bun's native `Bun.write` + ffmpeg subprocess or the `fluent-ffmpeg` npm package for format conversion.

**Anthropic SDK gotcha:**
- The `@anthropic-ai/claude-agent-sdk` (v0.2.x) is a separate, more opinionated package for agent orchestration. PROJECT.md specifies `@anthropic-ai/sdk` (the general-purpose client) with a manual orchestrator + sub-agents pattern. Do not substitute with the agent SDK unless you verify feature parity.

---

### Text-to-Speech

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @elevenlabs/elevenlabs-js | 2.x (latest 2.39.0 as of 2026-03-19) | TTS for English and Afrikaans agent responses | Afrikaans confirmed supported (language code: `afr`). Better naturalness for Afrikaans than Google Cloud TTS. Simple streaming API. Fixed per PROJECT.md. Note: the old `elevenlabs` npm package is deprecated — use `@elevenlabs/elevenlabs-js` exclusively. |

**ElevenLabs model selection:**
- `eleven_flash_v2_5` — ultra-low latency (~75ms first-chunk), 32 languages including Afrikaans. **Use this for all voice responses** — latency is the primary constraint.
- `eleven_multilingual_v2` — highest quality, 29 languages, higher latency. Use only for pre-generated audio (e.g., morning briefing queued overnight).
- `eleven_turbo_v2_5` — **DEPRECATED** as of early 2026. Do not use. Use `eleven_flash_v2_5` instead.
- `eleven_v3` — Eleven v3 (most expressive, 70+ languages). Highest latency. Not suitable for real-time responses.

**Streaming pattern:**
```typescript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Stream to buffer for WhatsApp audio upload
const audioStream = await client.textToSpeech.stream(voiceId, {
  text: spokenResponse,
  model_id: "eleven_flash_v2_5",
  voice_settings: { stability: 0.5, similarity_boost: 0.75 },
});
```

**Spoken-first constraint:** All Claude responses sent to TTS must be stripped of markdown before synthesis. No asterisks, no bullet points, no code blocks. Enforce this at the agent output layer, not the TTS layer.

---

### WhatsApp Cloud API Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native fetch (Bun built-in) | N/A | WhatsApp Cloud API calls | The official Meta Node.js SDK (`WhatsApp/WhatsApp-Nodejs-SDK`) was ARCHIVED on 2023-06-07 and is read-only. Do not use it. Raw fetch against the Graph API is the correct approach for a hackathon build — no unnecessary abstraction, full control over HMAC verification. |
| Meta Graph API | v23.0 (current default, Feb 2026) | Send/receive WhatsApp messages | Target `https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages`. |

**Unofficial SDK option (if raw fetch becomes tedious):**
- `@great-detail/whatsapp` (WhatsApp-JS-SDK v8.x) — targets Graph API v23, explicitly tested on Bun v1.2, CJS + ESM + TypeScript. Actively maintained (1,380+ commits). This is an unofficial fork of the archived Meta SDK. Use if rapid iteration demands a typed wrapper; validate its maintenance status before production commitment.

**HMAC webhook verification — critical implementation detail:**
```
Header: x-hub-signature-256
Format: sha256={hex_digest}
Key: App Secret from Meta Developer Console
Input: RAW request body (before JSON parsing — must read body as Buffer/string FIRST)
Algorithm: HMAC-SHA256
Comparison: crypto.timingSafeEqual() — mandatory, prevents timing attacks
```

Hono gotcha: Hono's `c.req.json()` consumes the body stream. Read raw body with `c.req.raw.clone().arrayBuffer()` BEFORE calling `.json()`, or use a middleware that stashes `rawBody` on the context.

Meta encodes special characters as escaped Unicode when computing the signature — your raw body must preserve this encoding exactly (do not normalize or re-encode).

**WhatsApp Cloud API version policy:** Meta deprecates API versions with 2+ year notice. v23.0 is current as of Feb 2026. The deprecated On-Premises API was fully shut down October 2025 — Cloud API is now the only official option.

---

### Job Queue

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ | 5.x (latest 5.45.0 tested with Bun) | Heartbeat event queue, durable job processing | Redis-backed, durable across process restarts, retry semantics built-in. Fixed per PROJECT.md. |
| ioredis | 5.x (latest 5.10.1) | Redis client required by BullMQ | BullMQ depends on ioredis internally — Bun.redis is NOT ioredis-compatible and cannot substitute for it. Must install ioredis explicitly. |
| Redis | 7.x (any compatible instance) | Queue backend | Use Upstash (serverless, free tier) or Railway Redis for hackathon. Local Docker `redis:7-alpine` for development. |

**BullMQ + Bun compatibility warning — HIGH PRIORITY:**
The official BullMQ Bun compatibility issue (#2177) was closed but the underlying concern (segmentation faults in earlier experiments) means caution is warranted. Mitigation:
1. Use `ioredis` v5.10.1, not `Bun.redis`.
2. Set `maxRetriesPerRequest: null` in the Redis connection config — required for BullMQ Worker.
3. Run workers with concurrency: 1 initially; increase only after testing.
4. A practical example from April 2025 confirms BullMQ 5.45.0 + ioredis 5.6.0 works with Bun. Match these versions.

```typescript
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

const heartbeatQueue = new Queue("heartbeat", { connection });
```

**Bun.cron for scheduled cron (not BullMQ):**
Bun v1.3.11 ships `Bun.cron` — a built-in OS-level cron API. Use it for morning briefing and evening digest cron jobs (predictable schedule, no queue needed). Reserve BullMQ for event-driven, retry-critical jobs (heartbeat events, message send with approval).

---

### Real-Time Push (Caregiver Dashboard)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Hono `streamSSE` | Built into Hono 4.x | Server-sent events for dashboard | One-way push from server to browser — correct model for a read-only dashboard. Simpler than WebSocket. Hono's `streamSSE()` sets `Content-Type: text/event-stream` automatically and supports custom event types, IDs, and `stream.sleep()`. |
| Hono `upgradeWebSocket` from `'hono/bun'` | Built into Hono 4.x | Bidirectional real-time if needed | Available if dashboard evolves to need bidirectional control (e.g., caregiver sends override commands). Not needed for v0.1. |

**SSE vs WebSocket decision:**
The caregiver dashboard is read-only in v0.1 (mission control aesthetic — observe, not intervene). SSE is the correct choice: simpler, lower overhead, automatic browser reconnection, works through HTTP/2 multiplexing. WebSocket adds complexity with no benefit for a read-only view.

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| croner | 8.x | In-process cron scheduler | Alternative to Bun.cron when you need cron to run within the process (e.g., for testing or when OS-level scheduling is impractical). Zero dependencies, explicit Bun 1.x support. |
| zod | 3.x | Runtime schema validation | Validate incoming webhook payloads, API request bodies, env variables. Use `z.object({}).parse()` at boundary points. |
| dotenv / Bun native | Built into Bun | Environment configuration | Bun natively loads `.env` files — no `dotenv` package needed. Use `process.env.VAR_NAME` directly. |
| node-fetch / undici | Not needed | HTTP client | Bun has native `fetch` built-in (Web Standards compliant). No polyfill needed. |

---

## Alternatives Considered

| Category | Recommended | Alternative Rejected | Why Rejected |
|----------|-------------|---------------------|--------------|
| Runtime | Bun 1.3.x | Node.js 22 | Project constraint. Bun is faster, has built-in test runner, native TypeScript. |
| Framework | Hono 4.x | Fastify, Express | Project constraint. Hono is lighter, Web Standards native, works on edge runtimes. |
| Database | Supabase PostgreSQL | PlanetScale, Neon | Project constraint. pgvector + RLS combination is uniquely strong for this use case. |
| Agent LLM | @anthropic-ai/sdk (Claude) | Vercel AI SDK | Project constraint. Direct SDK avoids abstraction overhead; `@ai-sdk/anthropic` wraps the same API with more indirection. |
| TTS | ElevenLabs (eleven_flash_v2_5) | Google Cloud TTS | ElevenLabs has better Afrikaans naturalness. Google Cloud TTS added for isiZulu in v0.2 only. |
| STT | OpenAI gpt-4o-mini-transcribe | Google Speech-to-Text, AssemblyAI | OpenAI SDK already in project (embeddings); single vendor. Good Afrikaans support. |
| Queue | BullMQ + ioredis | Bun.redis + custom queue | Bun.redis is NOT ioredis-compatible — BullMQ requires ioredis. BullMQ provides durable retry semantics that a custom queue would need to re-implement. |
| WhatsApp integration | Raw fetch (Graph API v23) | Official Meta SDK | Official SDK archived June 2023. Raw fetch is maintenance-free and fully controllable. |
| Cron scheduling | Bun.cron (built-in) | node-cron, node-schedule | Bun.cron is OS-native as of v1.3.11. node-cron has no explicit Bun compatibility guarantee. |
| Real-time push | Hono streamSSE | Socket.IO | Socket.IO adds a 45KB dependency + long-polling fallback complexity; unnecessary for a read-only dashboard. Hono SSE is native. |

---

## Installation

```bash
# Core runtime (install separately)
# See https://bun.sh for Bun installation

# Core application
bun add hono @anthropic-ai/sdk openai @elevenlabs/elevenlabs-js @supabase/supabase-js

# Queue infrastructure
bun add bullmq ioredis

# Validation
bun add zod

# Optional: unofficial WhatsApp typed wrapper (only if raw fetch becomes unwieldy)
bun add @great-detail/whatsapp

# Optional: in-process cron (only if Bun.cron OS-level scheduling is unsuitable)
bun add croner

# Dev dependencies
bun add -d typescript @types/node
```

**Environment variables required:**
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=          # For HMAC webhook verification
WHATSAPP_VERIFY_TOKEN=        # For webhook GET verification handshake
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # Backend uses service_role only — no anon key
REDIS_URL=                    # ioredis connection string
```

---

## Version Compatibility Matrix

| Package | Pinned Version | Bun 1.3.x Compatible | Notes |
|---------|---------------|----------------------|-------|
| hono | ^4.12.0 | Yes | Use `hono/bun` imports |
| @anthropic-ai/sdk | ^0.80.0 | Yes | |
| openai | ^6.33.0 | Yes — explicitly supports Bun | v5.x superseded |
| @elevenlabs/elevenlabs-js | ^2.39.0 | Yes | Old `elevenlabs` package deprecated |
| @supabase/supabase-js | ^2.99.0 | Yes | Requires Node 20+ equiv — Bun 1.3 satisfies |
| bullmq | ^5.45.0 | Partial — requires ioredis, not Bun.redis | Set maxRetriesPerRequest: null |
| ioredis | ^5.10.1 | Yes — tested | Do not substitute Bun.redis |
| zod | ^3.x | Yes | |

---

## Critical Gotchas Summary

1. **Hono raw body for HMAC:** Read raw body before calling `c.req.json()`. Body stream is consumed on first read. Use `c.req.raw.clone().arrayBuffer()` pattern or a raw-body middleware.

2. **BullMQ requires ioredis, not Bun.redis:** `Bun.redis` is a node-redis replacement, not an ioredis replacement. BullMQ uses ioredis internals. Installing both is the correct approach — they coexist.

3. **ElevenLabs turbo models deprecated:** `eleven_turbo_v2_5` and `eleven_turbo_v2` are deprecated as of early 2026. Use `eleven_flash_v2_5` for real-time, `eleven_multilingual_v2` for pre-generated content.

4. **Official WhatsApp SDK archived:** `WhatsApp/WhatsApp-Nodejs-SDK` (npm: `whatsapp`) has been archived since June 2023. Use raw fetch or `@great-detail/whatsapp` (v8, Bun-tested, unofficial).

5. **pgvector requires RPC wrapper:** PostgREST (Supabase's REST layer) does not expose pgvector `<=>` / `<->` operators. All similarity queries must be wrapped in a Postgres function and called via `.rpc()`.

6. **Whisper audio format:** WhatsApp sends voice notes as OGG Opus. OpenAI's transcription API accepts OGG but requires the file to be named with `.ogg` extension (or `.mp3`, `.wav`, `.m4a`, `.webm`). Pass `File` object with correct MIME type.

7. **Hono serveStatic is runtime-specific:** Import from `'hono/bun'` not the generic `'hono/serve-static'`. This changed in Hono v4.

8. **Bun.cron is OS-level (crontab), not in-process:** It registers OS cron jobs on the host. For in-process scheduling (e.g., during tests or containerized environments where you can't modify the OS crontab), use `croner` instead.

9. **Supabase service_role bypasses RLS:** The backend uses `service_role` to write across users. Every query that should be user-scoped must explicitly filter by `user_id` — RLS is only enforced when using the `anon` or authenticated JWT roles.

---

## Sources

- Bun changelog and version history: https://bun.com/blog, https://endoflife.date/bun
- Bun v1.3.11 release: https://bun.com/blog/bun-v1.3.11
- Hono documentation (Bun adapter, SSE, WebSocket): https://hono.dev/docs/getting-started/bun, https://hono.dev/docs/helpers/websocket
- Hono latest version (4.12.9): https://www.npmjs.com/package/hono
- BullMQ Bun compatibility issue: https://github.com/taskforcesh/bullmq/issues/2177
- BullMQ + Bun practical example: https://dev.to/anupom69/scheduling-whatsapp-messages-with-bun-bullmq-3il2
- ioredis v5.10.1 latest: https://www.npmjs.com/package/ioredis
- Bun.redis vs ioredis: https://github.com/oven-sh/bun/issues/23630
- ElevenLabs models (Flash v2.5, turbo deprecation): https://elevenlabs.io/docs/overview/models
- ElevenLabs Afrikaans support: https://elevenlabs.io/text-to-speech/afrikaans
- @elevenlabs/elevenlabs-js v2.39.0: https://www.npmjs.com/package/@elevenlabs/elevenlabs-js
- OpenAI npm v6.33.0: https://www.npmjs.com/package/openai
- OpenAI gpt-4o-mini-transcribe: https://developers.openai.com/blog/updates-audio-models
- @anthropic-ai/sdk v0.80.0: https://www.npmjs.com/package/@anthropic-ai/sdk
- WhatsApp Official SDK archived: https://github.com/WhatsApp/WhatsApp-Nodejs-SDK
- WhatsApp-JS-SDK (unofficial, Bun-tested): https://github.com/great-detail/WhatsApp-JS-SDK
- Meta Graph API v23 (current): https://developers.facebook.com/docs/whatsapp/cloud-api/
- Supabase pgvector + RPC pattern: https://supabase.com/docs/guides/database/extensions/pgvector
- supabase-js v2.99.3: https://github.com/supabase/supabase-js/releases
- text-embedding-3-small dimensions: https://developers.openai.com/api/docs/guides/embeddings
- croner Bun support: https://github.com/Hexagon/croner
