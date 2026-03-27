# Architecture Patterns

**Domain:** Voice AI + WhatsApp backend (Bun + Hono + Supabase + BullMQ)
**Researched:** 2026-03-27
**Confidence:** HIGH (verified against official docs for all major subsystems)

---

## Recommended Architecture

### System Overview

```
Mobile Client (Android)
       |
       |  WebSocket (wss://)  ←  TTS audio push, session state events
       |
[ Hono HTTP Server — single Bun process, single port ]
       |
       ├── POST /webhook/whatsapp    (HMAC-verified WhatsApp Cloud API events)
       ├── POST /api/voice/command   (voice command entry point, Bearer auth)
       ├── GET  /ws                  (WebSocket upgrade, real-time audio push)
       └── GET  /health              (liveness probe)
       |
       ├── Session State Machine     (in-process, Map<userId, SessionState>)
       |
       ├── Claude Agent Orchestrator (query() loop, sub-agent dispatch)
       |       ├── WhatsApp Agent    (send/read messages)
       |       ├── Contacts Agent    (contact CRUD)
       |       └── Ambient Agent     (load shedding, weather, search)
       |
       ├── BullMQ Queue + Worker     (heartbeat event queue)
       |       └── JobScheduler      (morning briefing cron)
       |
       └── Supabase Client           (PostgreSQL + pgvector, service_role)
               ├── users             (phone-number identity)
               ├── messages          (incoming/outgoing WhatsApp messages)
               ├── user_contacts     (voice-populated contact list)
               ├── memories          (pgvector episodic memory, 1536-dim)
               └── routines          (cron schedules per user)

External APIs
  ├── WhatsApp Cloud API   (send messages, GET /profile)
  ├── ElevenLabs TTS       (WebSocket streaming, MP3 base64 chunks)
  ├── OpenAI Whisper       (POST /audio/transcriptions, STT)
  ├── EskomSePush          (load shedding schedule)
  └── OpenWeather          (current weather)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Hono HTTP server | Route ingress, auth middleware, raw body capture for HMAC | Session state machine, BullMQ queue, Agent orchestrator |
| WhatsApp webhook handler | HMAC verification, event parsing, user upsert, message persistence | Supabase, BullMQ heartbeat queue |
| Session state machine | Tracks per-user state (idle/listening/composing/awaiting_approval/playing) | Agent orchestrator, WebSocket manager |
| WebSocket manager | Maintains per-user ws connections, pushes TTS audio frames | Session state machine, ElevenLabs TTS stream |
| Agent orchestrator | Intent classification (regex fast-path then LLM), sub-agent dispatch | Claude Agent SDK, Supabase, external APIs |
| BullMQ heartbeat worker | Processes surface-decision events (interrupt/batch/silent/skip) | WhatsApp Cloud API, WebSocket manager |
| BullMQ JobScheduler | Fires daily morning briefing and user routines at cron times | BullMQ queue (produces briefing jobs) |
| Supabase client | Single service_role client, all DB operations | PostgreSQL (RLS enforced at DB layer) |
| pgvector memory module | Embed → store → cosine-similarity recall | OpenAI embeddings API, Supabase memories table |
| ElevenLabs TTS module | Text → streaming audio, base64 MP3 chunks | ElevenLabs wss API, WebSocket manager |
| OpenAI Whisper STT module | Audio blob → transcript text | OpenAI REST API |

---

## Data Flow

### Incoming WhatsApp Message Flow

```
WhatsApp Cloud API
  → POST /webhook/whatsapp
    → [Middleware] capture raw body as text (c.req.text())
    → [Middleware] HMAC-SHA256 verify x-hub-signature-256 with timingSafeEqual
    → [Handler] parse JSON, extract message type + sender phone
    → upsert user in Supabase (phone → user row)
    → persist message in messages table
    → enqueue heartbeat event in BullMQ { userId, messageId, priority }
    → respond 200 immediately (WhatsApp requires <5s response)

BullMQ Worker picks up heartbeat event
  → evaluate surface decision (interrupt / batch / silent / skip)
    based on: contact priority flag, time of day, user session state
  → if INTERRUPT: push to user WebSocket → TTS read aloud
  → if BATCH: defer to next morning briefing digest
  → if SILENT: store only, no notification
```

### Voice Command Flow

```
Mobile client sends audio blob
  → POST /api/voice/command { audioBase64, userId }
    → [Middleware] Bearer token auth
    → session state: idle → listening
    → OpenAI Whisper STT → transcript text
    → Fast-path regex intent classifier
        match: /send message to (.+)/i  → dispatch WhatsApp sub-agent
        match: /read messages/i         → dispatch WhatsApp sub-agent
        match: /save contact/i          → dispatch Contacts sub-agent
        match: /weather|load.?shedding/ → dispatch Ambient sub-agent
        no match → Claude Agent orchestrator (full LLM)
    → session state: listening → composing
    → agent produces spoken response (no markdown, no lists)
    → if compose+send flow: session state → awaiting_approval
        → TTS: "Ready to send to [name]. Say yes to confirm."
        → wait for follow-up voice command (yes/cancel)
    → ElevenLabs TTS stream → base64 MP3 chunks
    → session state: composing → playing
    → push audio chunks over WebSocket
    → on stream complete: session state: playing → idle
```

### Morning Briefing Flow

```
BullMQ JobScheduler (cron: user.routines row, default "0 6 * * *")
  → produces briefing job in queue
BullMQ Worker picks up briefing job
  → parallel fetch:
      EskomSePush API → today's load shedding slots
      OpenWeather API → current conditions
      Supabase → unread messages since yesterday (batched)
  → build spoken briefing text (load shedding first, per PROJECT.md)
  → ElevenLabs TTS → audio
  → push over user WebSocket if connected
  → else: store in Supabase for next connection
```

### Episodic Memory Flow

```
After each significant exchange:
  → extract memory-worthy content (agent decides via tool call)
  → OpenAI text-embedding-3-small → 1536-dim vector
  → INSERT into memories (user_id, content, embedding, created_at)

On agent query requiring context:
  → embed current query
  → supabase.rpc('match_memories', { query_embedding, match_threshold: 0.78, match_count: 5, p_user_id: userId })
  → inject top-k memories into agent system prompt
```

---

## Implementation Patterns

### 1. Bun/Hono Server — REST + WebSocket + Webhook on Single Port

Use `upgradeWebSocket` and `websocket` from `hono/bun`. Both HTTP and WebSocket routes share the same `app` instance. Bun's server requires exporting both `fetch` and `websocket` together.

```typescript
// src/server.ts
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import { webhookRouter } from './routes/webhook'
import { apiRouter } from './routes/api'
import { wsConnections } from './ws/manager'

const app = new Hono()

// Webhook: raw body must be captured BEFORE any body parsing middleware
app.use('/webhook/*', async (c, next) => {
  // Store raw text on context for HMAC verification
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

app.route('/webhook', webhookRouter)
app.route('/api', apiRouter)

// WebSocket route — same app, same port
app.get('/ws', upgradeWebSocket((c) => {
  const userId = c.req.query('userId') // auth token validated here
  return {
    onOpen(_event, ws) {
      wsConnections.set(userId, ws)
    },
    onMessage(event, ws) {
      // handle inbound audio or ping frames
    },
    onClose() {
      wsConnections.delete(userId)
    },
  }
}))

// Required Bun export — must include both fetch and websocket
export default {
  fetch: app.fetch,
  websocket,
}
```

**Critical detail:** Hono on Bun reads the request body stream once. For HMAC verification of the WhatsApp webhook, call `c.req.text()` in middleware _before_ the route handler calls `c.req.json()`. Store the raw string on Hono context with `c.set('rawBody', rawBody)`. Verify with `crypto.timingSafeEqual()`.

**Confidence:** HIGH — verified against Hono official docs and Bun guide.

---

### 2. BullMQ Integration with Hono

BullMQ Queue and Worker are instantiated at server startup, outside the request/response cycle. The queue reference is passed to route handlers via Hono context or a module-level singleton. Workers run in the same Bun process for hackathon scope.

```typescript
// src/queue/index.ts
import { Queue, Worker, JobScheduler } from 'bullmq'

const connection = { host: process.env.REDIS_HOST, port: 6379 }

export const heartbeatQueue = new Queue('heartbeat', { connection })

export const heartbeatWorker = new Worker('heartbeat', async (job) => {
  const { userId, messageId, priority } = job.data
  await processSurfaceDecision(userId, messageId, priority)
}, { connection, concurrency: 10 })

// Morning briefing scheduler
export const briefingScheduler = new JobScheduler('briefing', { connection })

export async function registerUserBriefing(userId: string, cronExpression: string) {
  await heartbeatQueue.upsertJobScheduler(
    `briefing:${userId}`,
    { pattern: cronExpression }, // e.g. "0 6 * * *"
    { name: 'morning-briefing', data: { userId } }
  )
}
```

```typescript
// src/routes/webhook.ts — enqueue from route handler
import { heartbeatQueue } from '../queue'

router.post('/', async (c) => {
  // ... parse event
  await heartbeatQueue.add('inbound-message', { userId, messageId, priority })
  return c.json({ status: 'ok' })
})
```

**Confidence:** HIGH — verified against BullMQ official docs (upsertJobScheduler, cron pattern support).

---

### 3. Session State Machine

Store session state in a `Map<string, SessionState>` in process memory for hackathon scope. State transitions are synchronous and explicit. For multi-instance deployments (post-hackathon) this moves to Redis.

```typescript
// src/session/machine.ts
type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'

interface SessionState {
  phase: SessionPhase
  pendingMessage?: { to: string; body: string }
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening'],
  listening:         ['composing', 'idle'],  // idle on error
  composing:         ['awaiting_approval', 'playing', 'idle'],
  awaiting_approval: ['playing', 'idle'],    // idle on cancel/timeout
  playing:           ['idle'],
}

export function transition(userId: string, next: SessionPhase): void {
  const current = sessions.get(userId)?.phase ?? 'idle'
  const allowed = TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(`Invalid transition: ${current} → ${next}`)
  }
  sessions.set(userId, { phase: next, lastActivity: Date.now() })
}

export function getPhase(userId: string): SessionPhase {
  return sessions.get(userId)?.phase ?? 'idle'
}
```

**Key design decision:** Do not use XState for hackathon scope — the overhead of serializable machines is unnecessary when state is per-process and session count is low. A plain Map with an explicit transition guard covers all five states cleanly.

**Confidence:** MEDIUM — XState is the idiomatic library for complex state machines, but the plain-map approach is well-established for simple enumerated states.

---

### 4. Claude Agent SDK — Orchestrator + Sub-Agent Pattern

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) wraps Claude Code as a library. Use `query()` with `agents` to define named sub-agents. The orchestrator includes `"Agent"` in `allowedTools` so it can delegate.

**Important distinction:** The Claude Agent SDK is NOT the same as `@anthropic-ai/sdk` (the messages API client). It runs a Claude Code subprocess with full tool execution. For this project's voice commands, use the Agent SDK for multi-step tasks (compose + resolve contact + send) and the direct messages API for single-shot intent classification.

```typescript
// src/agent/orchestrator.ts
import { query } from '@anthropic-ai/claude-agent-sdk'

export async function runVoiceCommand(userId: string, transcript: string): Promise<string> {
  let result = ''

  for await (const message of query({
    prompt: buildPrompt(userId, transcript),
    options: {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Agent'],
      maxTurns: 5,
      agents: {
        'whatsapp': {
          description: 'Sends and reads WhatsApp messages. Use for compose, send, read flows.',
          prompt: WHATSAPP_AGENT_SYSTEM_PROMPT,
          tools: ['ReadMessages', 'SendMessage', 'ResolveContact'],
        },
        'contacts': {
          description: 'Manages the user contact list. Use for save, lookup, update contact flows.',
          prompt: CONTACTS_AGENT_SYSTEM_PROMPT,
          tools: ['GetContact', 'SaveContact', 'ListContacts'],
        },
        'ambient': {
          description: 'Answers ambient queries: load shedding schedule, weather, web search.',
          prompt: AMBIENT_AGENT_SYSTEM_PROMPT,
          tools: ['GetLoadShedding', 'GetWeather', 'WebSearch'],
        },
      },
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    },
  })) {
    if ('result' in message) result = message.result as string
  }

  return result // spoken-natural text, no markdown
}
```

**Fast-path classification:** Run a regex intent classifier _before_ invoking the Agent SDK. Common patterns like `/^(yes|confirm|send it)$/i` resolve in <1ms. Only fall through to the LLM for unrecognized intents.

```typescript
const FAST_PATH: Array<[RegExp, string]> = [
  [/^(yes|confirm|send it)$/i,        'confirm_send'],
  [/^(no|cancel|stop)$/i,             'cancel'],
  [/read (my |new )?messages?/i,       'read_messages'],
  [/(load.?shedding|eskom)/i,          'load_shedding'],
  [/weather/i,                         'weather'],
]

export function classifyFast(transcript: string): string | null {
  for (const [pattern, intent] of FAST_PATH) {
    if (pattern.test(transcript)) return intent
  }
  return null
}
```

**Confidence:** HIGH — patterns verified against Claude Agent SDK official docs (agents option, query() API, allowedTools including "Agent" for subagent delegation).

---

### 5. pgvector Cosine Similarity for Episodic Memory

PostgREST (used by the Supabase JS client) does not support pgvector operators directly. Wrap similarity search in a Postgres function and call it via `supabase.rpc()`. Add a `p_user_id` parameter to enforce user isolation inside the function — do not rely solely on RLS in security-definer functions.

```sql
-- migrations/match_memories.sql
create or replace function match_memories(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from memories
  where user_id = p_user_id
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding asc
  limit least(match_count, 20);
$$;
```

```typescript
// src/memory/recall.ts
import { openai } from '../clients/openai'
import { supabase } from '../clients/supabase'

export async function recallMemories(userId: string, query: string, topK = 5) {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const embedding = embeddingResponse.data[0].embedding

  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    match_threshold: 0.75,
    match_count: topK,
    p_user_id: userId,
  })

  if (error) throw error
  return data ?? []
}
```

**Index:** Create an HNSW index for production performance. For hackathon scale (hundreds of rows) no index is required, but add it anyway:

```sql
create index memories_embedding_idx
  on memories using hnsw (embedding vector_cosine_ops);
```

**Confidence:** HIGH — verified against Supabase pgvector docs and RAG-with-permissions guide.

---

### 6. WebSocket TTS Audio Push Pattern

ElevenLabs returns audio as base64-encoded MP3 chunks from their WebSocket API (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`). The backend receives chunks, decodes base64 to binary, and forwards binary frames over the client WebSocket connection. The mobile client receives binary frames and plays them sequentially.

```typescript
// src/tts/elevenlabs.ts
import WebSocket from 'ws'

export async function* streamTTS(text: string, voiceId: string): AsyncGenerator<Buffer> {
  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?output_format=mp3_44100_128`,
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } }
  )

  await new Promise<void>((resolve) => ws.on('open', resolve))

  // Initialize connection
  ws.send(JSON.stringify({ text: ' ' }))
  // Send text with flush to force immediate generation
  ws.send(JSON.stringify({ text, flush: true }))
  ws.send(JSON.stringify({ text: '' })) // CloseConnection signal

  const chunks: Buffer[] = []
  let done = false

  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString())
    if (msg.audio) {
      chunks.push(Buffer.from(msg.audio, 'base64'))
    }
    if (msg.isFinal) {
      done = true
      ws.close()
    }
  })

  await new Promise<void>((resolve) => ws.on('close', resolve))
  yield* chunks
}
```

```typescript
// src/ws/manager.ts — push audio to mobile client
import type { WSContext } from 'hono/ws'

export const wsConnections = new Map<string, WSContext>()

export async function pushAudioToUser(userId: string, text: string, voiceId: string) {
  const ws = wsConnections.get(userId)
  if (!ws) return // user not connected, store for later

  // Signal start of audio stream
  ws.send(JSON.stringify({ type: 'audio_start' }))

  for await (const chunk of streamTTS(text, voiceId)) {
    // Send binary frame — mobile client buffers and plays
    ws.send(chunk)
  }

  // Signal end of audio stream
  ws.send(JSON.stringify({ type: 'audio_end' }))
}
```

**Mobile client contract:** The client must handle two frame types on the same WebSocket: JSON control messages (`audio_start`, `audio_end`) and binary MP3 data frames. Parse frame type with `typeof event.data === 'string'` check.

**Confidence:** HIGH — ElevenLabs WebSocket API structure verified via official API reference. Hono WebSocket binary send pattern verified via Hono docs.

---

### 7. Morning Briefing Cron — node-cron vs BullMQ

Use BullMQ's `upsertJobScheduler()` rather than `node-cron`. Rationale: BullMQ cron jobs are durable (survive process restart), deduplicatable (upsert prevents double-registration), and produce normal queue jobs that the existing heartbeat worker can process. `node-cron` fires in-process timers that are lost on restart and require a separate execution path.

```typescript
// src/cron/briefing.ts
import { heartbeatQueue } from '../queue'
import { supabase } from '../clients/supabase'

export async function syncUserRoutines() {
  // Called at startup: read routines table, register schedulers
  const { data: routines } = await supabase
    .from('routines')
    .select('user_id, cron_expression, routine_type')
    .eq('routine_type', 'morning_briefing')
    .eq('enabled', true)

  for (const routine of routines ?? []) {
    await heartbeatQueue.upsertJobScheduler(
      `briefing:${routine.user_id}`,
      { pattern: routine.cron_expression }, // e.g. "0 6 * * *"
      {
        name: 'morning-briefing',
        data: { userId: routine.user_id, type: 'morning_briefing' },
      }
    )
  }
}
```

The worker handles `morning-briefing` jobs by fetching load shedding, weather, and overnight message digest, then building the spoken briefing text and pushing it via WebSocket.

**Confidence:** HIGH — BullMQ JobScheduler / upsertJobScheduler pattern verified against official BullMQ docs.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reading body twice in Hono
**What:** Calling `c.req.json()` in middleware then `c.req.text()` in handler (or vice versa).
**Why bad:** Hono reads the body stream once. Second read returns empty.
**Instead:** Call `c.req.text()` once in middleware, store on context with `c.set('rawBody', raw)`. Handler calls `JSON.parse(c.get('rawBody'))`.

### Anti-Pattern 2: Storing WebSocket connections in a plain global Map across multiple processes
**What:** Using `Map<userId, ws>` when running multiple Bun processes behind a load balancer.
**Why bad:** Connection lives in one process; events may arrive at another.
**Instead:** For hackathon (single process), Map is fine. For production, use Redis pub/sub to fan-out events to the process holding the connection.

### Anti-Pattern 3: Using XState or a heavy state machine library for 5 states
**What:** Installing XState for idle/listening/composing/awaiting_approval/playing.
**Why bad:** Adds ~50KB, serialization complexity, and actor model overhead for 5 states with 6 transitions.
**Instead:** Plain Map + explicit transition guard function. Less than 30 lines.

### Anti-Pattern 4: Calling ElevenLabs REST (non-streaming) for TTS
**What:** Using `POST /v1/text-to-speech/{voice_id}` and waiting for the full MP3.
**Why bad:** Adds 1–3 seconds of silence before audio starts playing.
**Instead:** Use the WebSocket streaming API. First audio chunk arrives in ~200ms.

### Anti-Pattern 5: Agent SDK for fast-path intents
**What:** Routing every voice command through `query()` (Agent SDK) including simple confirmations.
**Why bad:** Agent SDK spawns a subprocess and adds 300–800ms overhead minimum.
**Instead:** Regex fast-path classifier first. Agent SDK only for genuinely multi-step flows.

### Anti-Pattern 6: pgvector similarity search via Supabase JS client directly
**What:** Using `.filter('embedding', 'cd', ...)` on the supabase client.
**Why bad:** PostgREST does not support pgvector operators. Queries silently fail or error.
**Instead:** Wrap in a Postgres function (`match_memories`) and call via `supabase.rpc()`.

### Anti-Pattern 7: node-cron for scheduled briefings
**What:** `cron.schedule('0 6 * * *', () => runBriefing(userId))`.
**Why bad:** Timer is lost on process restart. No retry on failure. No deduplication.
**Instead:** BullMQ `upsertJobScheduler` — durable, retryable, deduplicatable.

---

## Scalability Considerations

| Concern | Hackathon (1–10 users) | Post-launch (100–1K users) | Production (10K+ users) |
|---------|----------------------|--------------------------|------------------------|
| Session state | In-process Map | Redis hash (TTL-backed) | Redis + session expiry events |
| WebSocket routing | Single process Map | Redis pub/sub fan-out | Dedicated WS gateway (e.g., Soketi) |
| BullMQ workers | Same process as HTTP | Separate worker process | Horizontally scaled worker pool |
| Vector search | No index needed | HNSW index | HNSW + partitioned by user shard |
| Supabase | Direct client | Connection pooler (PgBouncer) | Read replicas |

---

## Suggested Build Order (Dependency Graph)

Dependencies flow top-to-bottom. Build in this sequence to avoid blocked work.

```
1. Supabase schema + RLS policies + pgvector extension
   (Everything downstream needs the DB)

2. Hono server skeleton
   (Webhook handler, API routes, WebSocket, HMAC middleware)
   Dependency: schema

3. WhatsApp webhook handler + user upsert
   (Validates HMAC, persists messages, upserts users)
   Dependency: Hono server, Supabase schema

4. BullMQ queue + Redis connection + heartbeat worker skeleton
   (Heartbeat loop, surface decision logic)
   Dependency: Supabase schema (reads messages)

5. Session state machine
   (State Map, transition guard, phase exports)
   Dependency: none (pure logic)

6. OpenAI Whisper STT module
   (Audio → transcript)
   Dependency: none (external API wrapper)

7. Fast-path intent classifier
   (Regex patterns → intent strings)
   Dependency: none (pure logic)

8. Claude Agent orchestrator + sub-agents
   (voice command → agent dispatch → spoken response)
   Dependency: STT module, intent classifier, Supabase (contact lookup)

9. ElevenLabs TTS streaming module
   (Text → base64 MP3 chunks)
   Dependency: none (external API wrapper)

10. WebSocket manager + audio push
    (Hono WS route, per-user connection Map, binary push)
    Dependency: Hono server, ElevenLabs TTS module

11. Voice command route (POST /api/voice/command)
    (Full pipeline: STT → classify → agent → TTS → WS push)
    Dependency: all of 5–10

12. BullMQ JobScheduler + routines table polling
    (Morning briefing cron, syncUserRoutines on startup)
    Dependency: BullMQ queue (step 4), Supabase routines table

13. Morning briefing worker handler
    (EskomSePush + weather + message digest → spoken briefing)
    Dependency: ambient API wrappers, TTS module, WS manager

14. pgvector episodic memory module
    (embed → store → recall)
    Dependency: Supabase memories table, OpenAI embeddings

15. Caregiver dashboard (Vite + React frontend)
    Dependency: all backend routes stable (P1 feature, last)
```

---

## Sources

- Hono WebSocket helper (Bun): https://hono.dev/docs/helpers/websocket
- Bun + Hono quickstart: https://bun.sh/guides/ecosystem/hono
- BullMQ Job Schedulers (upsertJobScheduler): https://docs.bullmq.io/guide/job-schedulers
- BullMQ Repeatable / cron: https://docs.bullmq.io/guide/jobs/repeatable
- Claude Agent SDK overview: https://platform.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK TypeScript reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- Supabase pgvector semantic search: https://supabase.com/docs/guides/ai/semantic-search
- Supabase RAG with permissions (RLS + vector search): https://supabase.com/docs/guides/ai/rag-with-permissions
- ElevenLabs WebSocket streaming TTS API: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- WhatsApp Cloud API webhooks + HMAC: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/
- Meta HMAC signature verification: https://hookdeck.com/webhooks/guides/how-to-implement-sha256-webhook-signature-verification
