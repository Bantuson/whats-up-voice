# Phase 1: Foundation — Research

**Researched:** 2026-03-27
**Domain:** Supabase schema + RLS, Bun/Hono server skeleton, session state machine, intent classifier, env validation
**Confidence:** HIGH

---

## Summary

Phase 1 is pure infrastructure — no external API calls, no LLM invocations, no queue workers. Its job is to lay the bed that every other phase writes to: the database schema, the server process, and two pure-logic modules (session machine and intent classifier) that later phases consume. Because nothing upstream exists yet, Phase 1 can be built entirely from pinned packages and verified patterns — there is no ambiguity about stack choices.

The most important decision already made is the HMAC raw-body middleware ordering constraint: the webhook middleware that captures `c.req.text()` must be registered on the `app` instance BEFORE any route is added. If a route is registered first, Hono's body stream may be consumed before the middleware runs. This constraint makes the exact registration order in `server.ts` a correctness requirement, not just a style preference.

All 8 Supabase tables are known, all RLS patterns are known, and the SQL functions (`match_memories`, `resolve_contact_name`) have verified signatures from the architecture research. Phase 1 can be completed as three self-contained plans: (1) deploy Supabase schema, (2) build Hono skeleton, (3) write pure-logic modules.

**Primary recommendation:** Build in strict dependency order — schema first (can be deployed independently of the running server), then Hono skeleton with HMAC middleware registered before all routes, then pure-logic modules with `bun test` unit tests confirming all transition rules and all 8 intent patterns.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Supabase PostgreSQL schema deployed — all 8 tables | SQL DDL patterns for all 8 tables documented below; RLS syntax verified against Supabase docs |
| INFRA-02 | Row Level Security enforced on all tables with user policy + service_role bypass | Two-policy pattern (user SELECT/INSERT/UPDATE/DELETE + service_role bypass) verified |
| INFRA-03 | pgvector enabled; `match_memories` and `resolve_contact_name` SQL functions deployed | Exact SQL function signatures documented; HNSW index DDL included |
| INFRA-04 | Bun/Hono server on port 3000; `validateEnv()` startup guard; health check endpoint | Hono 4.12.9 Bun adapter patterns verified; env validation pattern documented |
| INFRA-05 | CORS for frontend origin; Bearer token auth middleware on `/api/*` | Hono CORS and `bearerAuth` middleware patterns verified |
| INFRA-06 | Session state machine enforced: 5 valid states, invalid transitions throw | State machine pattern with explicit guard verified; transition table documented |
| ISO-01 | All agent tool queries explicitly filter by `user_id` | Pattern documented; test strategy for app-layer isolation included |
| ISO-02 | Phone number normalised to E.164 on every inbound webhook before lookup/upsert | E.164 normalisation helper pattern documented |
| ISO-03 | WebSocket sessions scoped per `userId` — no cross-user delivery possible | Per-user `Map<userId, WSContext>` pattern verified; Phase 1 registers the WS route scaffold |
</phase_requirements>

---

## Standard Stack

### Core (versions verified against npm registry 2026-03-27)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.10 (installed) | Runtime, test runner, TypeScript | Native TS, built-in `bun test`, fastest cold start |
| Hono | 4.12.9 | HTTP framework | Web Standards native, first-class Bun adapter, ships WS + SSE helpers |
| @supabase/supabase-js | 2.100.1 (registry) | DB client, RPC | Only way to call pgvector via `.rpc()` |
| zod | 4.3.6 (registry) | Schema validation | Env var validation at startup, webhook payload validation at boundary |
| ioredis | 5.10.1 | Redis client | Required by BullMQ — Bun.redis is incompatible |
| bullmq | 5.71.1 | Job queue, cron scheduler | Durable, retryable; `upsertJobScheduler` for cron |

Note: BullMQ and ioredis are installed in Phase 1 even though the worker is wired in Phase 2. Installing all packages in Phase 1 keeps `package.json` stable and prevents package-resolution issues mid-phase.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @anthropic-ai/sdk | 0.80.0 | Claude agent | Installed in Phase 1, wired in Phase 3 |
| openai | 6.33.0 | Whisper STT + embeddings | Installed in Phase 1, wired in Phase 3/4 |
| @elevenlabs/elevenlabs-js | 2.40.0 (registry) | TTS | Installed in Phase 1, wired in Phase 4 |

**Installation (single command for all Phase 1 dependencies):**
```bash
bun init -y
bun add hono @supabase/supabase-js zod bullmq ioredis @anthropic-ai/sdk openai @elevenlabs/elevenlabs-js
bun add -d typescript @types/node @types/bun
```

---

## Architecture Patterns

### Recommended Project Structure

```
voice-app/
├── src/
│   ├── server.ts              # Entry point — Bun.serve export
│   ├── env.ts                 # validateEnv() — throws on missing vars
│   ├── routes/
│   │   ├── health.ts          # GET /health
│   │   ├── webhook.ts         # POST/GET /webhook/whatsapp (scaffold in Phase 1)
│   │   └── api.ts             # /api/* routes (scaffold in Phase 1)
│   ├── session/
│   │   └── machine.ts         # Map<userId, SessionState> + transition guard
│   ├── agent/
│   │   └── classifier.ts      # Fast-path regex intent classifier
│   ├── lib/
│   │   ├── phone.ts           # E.164 normalisation + formatPhoneForSpeech
│   │   └── errors.ts          # spokenError() utility
│   ├── db/
│   │   └── client.ts          # Single Supabase service_role client (singleton)
│   └── ws/
│       └── manager.ts         # Map<userId, WSContext> — scaffold in Phase 1
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql     # All 8 tables + RLS policies
│       └── 002_functions.sql  # match_memories + resolve_contact_name + HNSW index
├── tests/
│   ├── session.test.ts        # State machine valid + invalid transitions
│   └── classifier.test.ts     # All 8 fast-path patterns + fallthrough
├── .env.example               # All 11 required vars (no values)
├── package.json
└── tsconfig.json
```

### Pattern 1: Raw-Body HMAC Middleware Registration Order

**What:** The `/webhook/*` middleware that captures `c.req.text()` must be registered before ANY route is added to the app. This is a correctness constraint in Bun/Hono, not just a style preference.

**When to use:** Every time the server.ts is modified — the middleware must remain first.

```typescript
// src/server.ts
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import { cors } from 'hono/cors'
import { bearerAuth } from 'hono/bearer-auth'
import { validateEnv } from './env'
import { healthRouter } from './routes/health'
import { webhookRouter } from './routes/webhook'
import { apiRouter } from './routes/api'
import { wsConnections } from './ws/manager'

// Must run before Bun.serve() starts
validateEnv()

const app = new Hono()

// STEP 1: Raw body capture middleware — MUST be registered before all routes
app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

// STEP 2: CORS — applies to all routes
app.use('*', cors({
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}))

// STEP 3: Bearer auth on /api/* routes
app.use('/api/*', bearerAuth({ token: process.env.API_BEARER_TOKEN! }))

// STEP 4: Register routes AFTER middleware
app.route('/health', healthRouter)
app.route('/webhook', webhookRouter)
app.route('/api', apiRouter)

// STEP 5: WebSocket upgrade route
app.get('/ws/session/:userId', upgradeWebSocket((c) => {
  const userId = c.req.param('userId')
  return {
    onOpen(_event, ws) { wsConnections.set(userId, ws) },
    onClose() { wsConnections.delete(userId) },
  }
}))

// STEP 6: Export both fetch and websocket — Bun requires both
export default { fetch: app.fetch, websocket }
```

**Confidence:** HIGH — verified against Hono official docs (hono.dev/docs/getting-started/bun)

### Pattern 2: Environment Validation at Startup

**What:** All 11 required env vars checked before `Bun.serve()` is called. Missing vars throw a clear error that names the missing key.

```typescript
// src/env.ts
const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'API_BEARER_TOKEN',
] as const

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Server cannot start. Missing required environment variables:\n  ${missing.join('\n  ')}`
    )
  }
}
```

Note: The requirements list 10 env vars but the architecture docs include `WHATSAPP_VERIFY_TOKEN` for webhook GET verification, making 11 total. `API_BEARER_TOKEN` is needed for the Bearer auth middleware on `/api/*`. The server.ts should call `validateEnv()` before registering any routes — and certainly before `Bun.serve()`.

**Confidence:** HIGH — pattern matches ROADMAP.md success criterion 1 ("server refuses to start if any of the 11 required env vars are absent")

### Pattern 3: Session State Machine

**What:** `Map<userId, SessionState>` with an explicit transition guard that throws on invalid transitions.

**Valid transitions:**
| From | To (allowed) |
|------|--------------|
| idle | listening |
| listening | composing, idle (on error) |
| composing | awaiting_approval, playing, idle (on error) |
| awaiting_approval | playing, idle (on cancel/timeout) |
| playing | idle |

Note: `idle → awaiting_approval` is INVALID. The ROADMAP success criterion explicitly tests that this throws. Any code that tries to jump from idle directly to awaiting_approval should fail with an error, not silently succeed.

```typescript
// src/session/machine.ts
export type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'

export interface SessionState {
  phase: SessionPhase
  pendingMessage?: { to: string; toName?: string; body: string }
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening'],
  listening:         ['composing', 'idle'],
  composing:         ['awaiting_approval', 'playing', 'idle'],
  awaiting_approval: ['playing', 'idle'],
  playing:           ['idle'],
}

export function transition(userId: string, next: SessionPhase): void {
  const current = sessions.get(userId)?.phase ?? 'idle'
  const allowed = TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(`Invalid session transition for ${userId}: ${current} → ${next}`)
  }
  const existing = sessions.get(userId)
  sessions.set(userId, {
    ...(existing ?? {}),
    phase: next,
    lastActivity: Date.now(),
  })
}

export function getState(userId: string): SessionState {
  return sessions.get(userId) ?? { phase: 'idle', lastActivity: Date.now() }
}

export function getPhase(userId: string): SessionPhase {
  return getState(userId).phase
}

export function setPendingMessage(
  userId: string,
  msg: { to: string; toName?: string; body: string }
): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, pendingMessage: msg, lastActivity: Date.now() })
}

export function clearSession(userId: string): void {
  sessions.delete(userId)
}
```

**Confidence:** HIGH — pattern is pure TypeScript, no external dependencies, verified transitions match ROADMAP success criteria.

### Pattern 4: Fast-Path Intent Classifier

**What:** Regex patterns evaluated in order before any LLM invocation. Returns an intent string or `null` (falls through to LLM).

**8 required intents from AGENT-02:**

| Intent | Trigger Patterns |
|--------|-----------------|
| `confirm_send` | "yes", "confirm", "send it", "yep", "yeah send" |
| `cancel` | "no", "cancel", "stop", "don't send", "nope" |
| `send_message` | "send a message to", "message [name]", "text [name]", "whatsapp [name]" |
| `read_messages` | "read my messages", "read messages", "any new messages", "what messages" |
| `save_contact` | "save contact", "add contact", "save [name]", "add [name] as a contact" |
| `set_priority` | "make [name] a priority", "set [name] as priority", "priority contact" |
| `load_shedding` | "load shedding", "eskom", "power", "loadshed" |
| `weather` | "weather", "temperature", "rain", "forecast", "hot", "cold today" |
| `web_search` | "search for", "look up", "google", "find out about" |
| `message_digest` | "digest", "summary", "what did I miss", "overnight messages" |

Note: AGENT-02 lists 8 intents but the classifier also needs `confirm_send` and `cancel` for the approval loop (these resolve without LLM). The full classifier covers 10 patterns; the 8 from AGENT-02 plus the 2 confirmation patterns.

```typescript
// src/agent/classifier.ts
export type FastPathIntent =
  | 'confirm_send'
  | 'cancel'
  | 'send_message'
  | 'read_messages'
  | 'save_contact'
  | 'set_priority'
  | 'load_shedding'
  | 'weather'
  | 'web_search'
  | 'message_digest'

const FAST_PATH: Array<[RegExp, FastPathIntent]> = [
  // Confirmation loop — checked first (short utterances, no ambiguity)
  [/^(yes|yep|yeah|confirm|send it|go ahead|do it)\.?$/i, 'confirm_send'],
  [/^(no|nope|cancel|stop|don't send|abort|never mind)\.?$/i, 'cancel'],
  // Message digest
  [/digest|summary|what did i miss|overnight messages?/i, 'message_digest'],
  // Send message — checked before read (avoids "send me my messages" misfire)
  [/send (a )?message to|message |text |whatsapp /i, 'send_message'],
  // Read messages
  [/read (my |new )?messages?|any new messages?|what messages?|my messages?/i, 'read_messages'],
  // Contact management
  [/save (a )?contact|add (a )?contact|save .+ as (a )?contact|add .+ as (a )?contact/i, 'save_contact'],
  [/make .+ (a )?priority|set .+ as priority|priority contact/i, 'set_priority'],
  // Ambient queries
  [/load.?shed|eskom|power cut|power outage|loadshed/i, 'load_shedding'],
  [/weather|temperature|rain|forecast|hot today|cold today|how warm|how cold/i, 'weather'],
  [/search for|look up|google|find out|tell me about|what is /i, 'web_search'],
]

export function classifyIntent(transcript: string): FastPathIntent | null {
  const t = transcript.trim()
  for (const [pattern, intent] of FAST_PATH) {
    if (pattern.test(t)) return intent
  }
  return null // falls through to LLM
}
```

**Confidence:** HIGH for structure; MEDIUM for exact regex patterns (will need tuning against real SA English speech patterns in Phase 5 tests).

### Pattern 5: Supabase Singleton Client

**What:** One `service_role` client per process. Never re-initialised per request. Never receives a user JWT.

```typescript
// src/db/client.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
```

Every query that touches user data MUST append `.eq('user_id', userId)` — service_role bypasses RLS entirely.

**Confidence:** HIGH — pattern verified against Supabase docs on service_role usage.

### Pattern 6: E.164 Phone Normalisation

**What:** ISO-02 requires every inbound phone to be normalised before lookup/upsert. South African numbers arrive in multiple formats from WhatsApp.

```typescript
// src/lib/phone.ts
/**
 * Normalise a phone number to E.164 format.
 * WhatsApp sends numbers without + prefix (e.g. "27821234567")
 * This normaliser handles that and a leading 0 for local SA numbers.
 */
export function normaliseE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) {
    // Local SA format: 0821234567 → +27821234567
    return `+27${digits.slice(1)}`
  }
  if (!digits.startsWith('+')) {
    return `+${digits}`
  }
  return digits
}

/**
 * Format a phone number for spoken TTS output.
 * +27821234567 → "0 8 2 1 2 3 4 5 6 7" (digit-spaced)
 * Users should hear individual digits, not a cardinal number.
 */
export function formatPhoneForSpeech(e164: string): string {
  const local = e164.startsWith('+27') ? '0' + e164.slice(3) : e164.replace(/^\+/, '')
  return local.split('').join(' ')
}
```

**Confidence:** HIGH — pattern matches PITFALLS.md M5 documentation and REQUIREMENTS ISO-02.

### Pattern 7: Spoken Error Utility

**What:** Every unhappy path in the voice flow needs a TTS-ready spoken response. The `spokenError()` utility prevents per-flow copy and ensures consistent error messaging.

```typescript
// src/lib/errors.ts
export function spokenError(context: string): string {
  return `Sorry, I had a problem with ${context}. Please try again.`
}
```

**Confidence:** HIGH — documented in ROADMAP.md Plan 3 and PITFALLS.md H1.

### Anti-Patterns to Avoid (Phase 1 specific)

- **Global JSON body-parsing middleware:** Never `app.use('*', async (c, next) => { await c.req.json(); ... })`. Consumes body stream. Parse per-route only.
- **XState or any state machine library:** `Map` + guard function is 30 lines. XState adds ~50KB and serialization overhead.
- **Re-initialising the Supabase client per request:** Creates a new connection pool entry on every request. One singleton, initialised at startup.
- **Calling `validateEnv()` lazily (on first request):** Must be called synchronously before `Bun.serve()` so startup failure is immediate and visible.
- **Registering routes before HMAC middleware:** Routes added before `app.use('/webhook/*', ...)` may run before middleware, leaving rawBody unset.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime schema validation | Custom validators | `zod` | Edge cases in type coercion, union types, error messages |
| Timing-safe HMAC comparison | String equality `===` | `crypto.timingSafeEqual` | Timing attacks reveal secret length |
| pgvector similarity search | PostgREST filter params | `supabase.rpc('match_memories', ...)` | PostgREST does not support `<=>` operator |
| CORS headers | Manual header setting | `hono/cors` middleware | Preflight OPTIONS handling, header enumeration |
| Bearer token auth | Custom header parsing | `hono/bearer-auth` | Constant-time comparison, standard middleware |
| Environment variable access | Direct `process.env` everywhere | Centralised `validateEnv()` + typed accessors | Fail-fast at startup, not at first use |

---

## Supabase Schema (Complete SQL)

### 001_schema.sql — All 8 Tables + RLS

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- TABLE: users
-- Identity anchor: WhatsApp phone (E.164)
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL UNIQUE,             -- E.164 format, e.g. +27821234567
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: user can access own row"
  ON users FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "users: service_role bypass"
  ON users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: user_profile
-- Language preference, location, quiet hours
-- ==========================================
CREATE TABLE IF NOT EXISTS user_profile (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language        TEXT NOT NULL DEFAULT 'en',    -- 'en' or 'af'
  location        TEXT,                           -- free-text, used for EskomSePush area lookup
  quiet_hours_start TIME,                         -- e.g. 22:00
  quiet_hours_end   TIME,                         -- e.g. 07:00 (may be next day)
  briefing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profile: user can access own row"
  ON user_profile FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_profile: service_role bypass"
  ON user_profile FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: user_contacts
-- Voice-populated contact list
-- ==========================================
CREATE TABLE IF NOT EXISTS user_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,                      -- E.164 format
  name        TEXT NOT NULL,                      -- user-assigned name (e.g. "wife", "Naledi")
  is_priority BOOLEAN NOT NULL DEFAULT FALSE,     -- surfaces as interrupt in heartbeat
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone)
);

ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_contacts: user can access own rows"
  ON user_contacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_contacts: service_role bypass"
  ON user_contacts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: sessions
-- Persisted session metadata (phase 1 scaffold)
-- Active phase held in-memory Map in the server process
-- ==========================================
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL DEFAULT 'idle',       -- mirrors SessionPhase enum
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  UNIQUE (user_id)                                 -- one active session per user
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: user can access own row"
  ON sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions: service_role bypass"
  ON sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: message_log
-- All inbound (direction='in') and outbound (direction='out') messages
-- ==========================================
CREATE TABLE IF NOT EXISTS message_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id TEXT,                              -- WhatsApp message ID for dedup
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  from_phone    TEXT NOT NULL,                     -- E.164
  to_phone      TEXT NOT NULL,                     -- E.164
  body          TEXT,                              -- text content (null for media-only)
  media_type    TEXT,                              -- 'audio', 'image', 'video', null
  media_id      TEXT,                              -- WhatsApp media ID for fetch
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_log: user can access own rows"
  ON message_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "message_log: service_role bypass"
  ON message_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS message_log_user_created_idx
  ON message_log (user_id, created_at DESC);

-- ==========================================
-- TABLE: memory_store
-- Episodic memory with pgvector embeddings
-- ==========================================
CREATE TABLE IF NOT EXISTS memory_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,                       -- plain text summary of interaction
  embedding   VECTOR(1536),                        -- text-embedding-3-small at 1536 dims
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memory_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory_store: user can access own rows"
  ON memory_store FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "memory_store: service_role bypass"
  ON memory_store FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: routines
-- Per-user cron schedules (morning briefing, evening digest, reminders)
-- ==========================================
CREATE TABLE IF NOT EXISTS routines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_type    TEXT NOT NULL,                   -- 'morning_briefing', 'evening_digest', 'reminder'
  cron_expression TEXT NOT NULL,                   -- e.g. '0 7 * * 1-5'
  label           TEXT,                            -- human-readable, e.g. "Weekday morning briefing"
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run        TIMESTAMPTZ,                     -- for double-fire protection (< 55s skip)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routines: user can access own rows"
  ON routines FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "routines: service_role bypass"
  ON routines FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- TABLE: heartbeat_log
-- Audit log for all heartbeat surface decisions
-- ==========================================
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES message_log(id),
  decision    TEXT NOT NULL CHECK (decision IN ('interrupt', 'batch', 'silent', 'skip')),
  reason      TEXT,                                -- human-readable reason string
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE heartbeat_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heartbeat_log: user can access own rows"
  ON heartbeat_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "heartbeat_log: service_role bypass"
  ON heartbeat_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS heartbeat_log_user_created_idx
  ON heartbeat_log (user_id, created_at DESC);
```

### 002_functions.sql — pgvector HNSW Index + SQL Functions

```sql
-- ==========================================
-- HNSW index on memory_store.embedding
-- Must be created AFTER the table exists.
-- Include in initial migration — not as a later optimisation.
-- ==========================================
CREATE INDEX IF NOT EXISTS memory_store_embedding_hnsw_idx
  ON memory_store
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ==========================================
-- FUNCTION: match_memories
-- Cosine similarity search over a user's memory_store rows.
-- Called via supabase.rpc('match_memories', {...}) — PostgREST
-- cannot use the <=> operator directly.
-- ==========================================
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memory_store
  WHERE user_id = p_user_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- ==========================================
-- FUNCTION: resolve_contact_name
-- Looks up the user-assigned contact name for a given phone number.
-- Returns NULL if the contact is not saved.
-- Used in read-aloud flows: "Naledi" not "+27821234567"
-- ==========================================
CREATE OR REPLACE FUNCTION resolve_contact_name(
  p_user_id UUID,
  p_phone   TEXT
)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT name
  FROM user_contacts
  WHERE user_id = p_user_id
    AND phone = p_phone
  LIMIT 1;
$$;
```

---

## Common Pitfalls

### Pitfall 1: Route Registered Before Raw-Body Middleware
**What goes wrong:** A webhook route added before `app.use('/webhook/*', ...)` may execute before the middleware, leaving `c.get('rawBody')` as `undefined`. HMAC verification gets an empty or undefined string.
**Why it happens:** Hono processes middleware registered with `app.use()` in registration order. Routes registered with `app.route()` or `app.get/post()` BEFORE a middleware use-call are not covered by that middleware.
**How to avoid:** The raw-body middleware MUST be the first `app.use()` call in server.ts, before any `app.route()` calls. Add a comment: `// RAW BODY CAPTURE — must precede all route registration`.
**Warning signs:** `c.get('rawBody')` is `undefined` inside the webhook handler; HMAC check always fails.

### Pitfall 2: Missing `validateEnv()` Before Bun.serve()
**What goes wrong:** Server starts with missing API keys. The first request to a route that uses the missing key throws at runtime, not at startup. Debugging mid-demo.
**Why it happens:** Lazy validation defers the error to first use.
**How to avoid:** Call `validateEnv()` as the very first line of server.ts, before any imports of route modules that might access `process.env`.
**Warning signs:** Server appears to start cleanly, then crashes on first request with `Cannot read properties of undefined`.

### Pitfall 3: RLS Gives False Security Confidence
**What goes wrong:** Developer writes Supabase queries without `.eq('user_id', userId)` assuming RLS covers it. With `service_role`, RLS is bypassed entirely — all rows from all users are returned.
**Why it happens:** The Supabase dashboard shows "RLS enabled" and it looks secure. The bypass only applies to `service_role` credentials, which the backend uses.
**How to avoid:** Every query in agent tools must include `.eq('user_id', userId)`. Write a unit test that queries with a fabricated UUID and confirms zero rows are returned (ROADMAP success criterion 2).
**Warning signs:** A query returns rows belonging to other users when tested with a known user's `service_role` client.

### Pitfall 4: `idle → awaiting_approval` Direct Transition
**What goes wrong:** Phase 3 code tries to set a user directly to `awaiting_approval` from `idle` (e.g., an inbound message arrives while the session is idle). The transition guard throws, breaking the flow.
**Why it happens:** The approval state should only be reachable through `composing`. Skipping `composing` means the agent has not drafted a message to approve.
**How to avoid:** The transition table explicitly disallows `idle → awaiting_approval`. Phase 3 code must always transition `idle → listening → composing → awaiting_approval` in sequence.
**Warning signs:** `Error: Invalid session transition: idle → awaiting_approval` thrown in agent code.

### Pitfall 5: Supabase Client Receives User JWT
**What goes wrong:** A request handler accidentally passes a user-provided `Authorization` header to the Supabase client. The service_role privilege is overridden by the user's JWT, suddenly applying RLS against that user. Queries return empty results that should have data.
**Why it happens:** Framework patterns (Next.js, Nuxt SSR) sometimes inject `Authorization` headers into all outbound requests.
**How to avoid:** The Supabase client is a module-level singleton initialised with `SUPABASE_SERVICE_ROLE_KEY` only. Never pass request headers to it. Never call `supabase.auth.setSession()`.
**Warning signs:** The service_role client begins returning `42501 permission denied for table` errors.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in, no install needed) |
| Config file | None required — `bun test` discovers `*.test.ts` files automatically |
| Quick run command | `bun test tests/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-04 | Server refuses to start if env var missing | smoke | Manual: remove one var, run `bun run src/server.ts` | Wave 0 |
| INFRA-04 | GET /health returns 200 | integration | `bun test tests/health.test.ts` | Wave 0 |
| INFRA-06 | Valid state transitions accepted | unit | `bun test tests/session.test.ts` | Wave 0 |
| INFRA-06 | `idle → awaiting_approval` throws | unit | `bun test tests/session.test.ts` | Wave 0 |
| INFRA-06 | All 5 states covered | unit | `bun test tests/session.test.ts` | Wave 0 |
| AGENT-02 | Fast-path returns correct intent for all 8 patterns | unit | `bun test tests/classifier.test.ts` | Wave 0 |
| AGENT-02 | Unknown transcript returns `null` (falls through to LLM) | unit | `bun test tests/classifier.test.ts` | Wave 0 |
| ISO-01 | Query with fabricated user_id returns zero rows | integration | `bun test tests/isolation.test.ts` | Wave 0 |
| ISO-02 | `normaliseE164` handles all SA number formats | unit | `bun test tests/phone.test.ts` | Wave 0 |
| INFRA-01 | All 8 tables exist in Supabase | integration | `bun test tests/schema.test.ts` | Wave 0 |
| INFRA-03 | `supabase.rpc('match_memories', ...)` executes without error | integration | `bun test tests/schema.test.ts` | Wave 0 |

Note: Integration tests for schema (INFRA-01, INFRA-03, ISO-01) require live Supabase credentials in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. These tests should run against the actual Supabase project, not a mock.

### Sampling Rate
- **Per task commit:** `bun test tests/session.test.ts tests/classifier.test.ts tests/phone.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before marking Phase 1 complete

### Wave 0 Gaps (Test Files to Create)

- [ ] `tests/session.test.ts` — covers INFRA-06: valid transitions, invalid transitions throw, all 5 states, `pendingMessage` storage/retrieval
- [ ] `tests/classifier.test.ts` — covers AGENT-02: all 8 intent patterns, confirm/cancel, null fallthrough, case-insensitive matching
- [ ] `tests/phone.test.ts` — covers ISO-02: E.164 normalisation for +27, 0xx, bare digits; formatPhoneForSpeech output
- [ ] `tests/health.test.ts` — covers INFRA-04: `GET /health` returns 200 with valid env
- [ ] `tests/schema.test.ts` — covers INFRA-01, INFRA-03, ISO-01: table existence, rpc callable, fabricated user_id isolation
- [ ] `tests/isolation.test.ts` — covers ISO-01: app-layer query returns zero rows for wrong user_id

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | Entire server | Yes | 1.3.10 | — |
| npm registry | Package install | Yes | via `npm view` | — |
| Supabase project | Schema deployment, integration tests | Unknown | — | Cannot deploy schema without it — must be created before Phase 1 Plan 1 runs |
| Redis | BullMQ (installed in Phase 1, used Phase 2) | Unknown | — | Upstash free tier or Railway Redis — decide before Phase 2 |

**Missing dependencies with no fallback:**
- Supabase project: a Supabase project URL and service_role key must exist before the migration SQL can be executed. The developer must create a Supabase project and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env` before running Plan 1.

**Missing dependencies with fallback:**
- Redis: not needed until Phase 2. Decide hosting (Upstash free tier recommended for hackathon) before Phase 2 begins.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `eleven_turbo_v2_5` for TTS | `eleven_flash_v2_5` | Early 2026 | Turbo deprecated; Flash is the real-time model |
| Official Meta WhatsApp Node SDK | Raw `fetch` against Graph API v23.0 | June 2023 (SDK archived) | No official SDK; raw fetch is the standard |
| `node-cron` for scheduled jobs | BullMQ `upsertJobScheduler` | 2024–2025 | Durable, survives process restart, no re-registration |
| pgvector via PostgREST filters | pgvector via `supabase.rpc()` | Always — PostgREST limitation | Vector operators not exposed in REST layer; RPC is mandatory |

---

## Open Questions

1. **Which Supabase region to deploy in?**
   - What we know: Standard Supabase regions include `af-south-1` (Cape Town, AWS) — lowest latency for South African users.
   - What's unclear: Whether the Supabase project already exists or needs to be created.
   - Recommendation: Create the Supabase project in `af-south-1` before Phase 1 Plan 1 runs. Add the URL and key to `.env`.

2. **`API_BEARER_TOKEN` value and distribution**
   - What we know: The Hono `bearerAuth` middleware on `/api/*` requires a token. The POST `/api/voice/command` route (Phase 4) and the WebSocket upgrade will both be protected.
   - What's unclear: How the demo client (Android browser/PWA) will obtain and send this token.
   - Recommendation: For hackathon, use a fixed strong random string in `.env`. Generate with `openssl rand -hex 32` and hardcode into the demo client.

3. **`FRONTEND_ORIGIN` for CORS**
   - What we know: The caregiver dashboard (Phase 5) is a Vite + React app. In development it runs on `localhost:5173`.
   - What's unclear: The production URL where the dashboard will be deployed for the demo.
   - Recommendation: Use `http://localhost:5173` as default in `validateEnv()` (not required var). Add `FRONTEND_ORIGIN` to `.env.example` for production use.

4. **Supabase migration tooling**
   - What we know: The SQL migration files can be applied via the Supabase dashboard SQL editor or via `supabase` CLI (`supabase db push`).
   - What's unclear: Whether the Supabase CLI is installed on the dev machine.
   - Recommendation: For hackathon speed, apply migrations via the Supabase dashboard SQL editor (paste and run). CLI is optional.

---

## Sources

### Primary (HIGH confidence)
- Hono official docs (Bun adapter, middleware, WebSocket): https://hono.dev/docs/getting-started/bun
- Hono middleware reference (cors, bearerAuth): https://hono.dev/docs/middleware/builtin/cors
- Supabase pgvector semantic search guide: https://supabase.com/docs/guides/ai/semantic-search
- Supabase RAG with permissions (RLS + pgvector): https://supabase.com/docs/guides/ai/rag-with-permissions
- Supabase Row Level Security docs: https://supabase.com/docs/guides/database/postgres/row-level-security
- BullMQ Job Schedulers (upsertJobScheduler): https://docs.bullmq.io/guide/job-schedulers
- Project research files: `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md`

### Secondary (MEDIUM confidence)
- Bun v1.3.10 (installed, verified via `bun --version`)
- npm registry versions verified 2026-03-27 for: hono 4.12.9, @supabase/supabase-js 2.100.1, bullmq 5.71.1, ioredis 5.10.1, zod 4.3.6, @elevenlabs/elevenlabs-js 2.40.0

### Tertiary (LOW confidence)
- Exact regex patterns for 8 intents — tuning against SA English speech needed in Phase 5 tests
- HNSW index parameters (m=16, ef_construction=64) — defaults, may need tuning at production scale

---

## Metadata

**Confidence breakdown:**
- Supabase SQL schema: HIGH — all 8 tables, RLS patterns, and SQL functions derived from official Supabase docs and the existing architecture research
- Hono server patterns: HIGH — middleware ordering and Bun export pattern verified against Hono official docs
- Session state machine: HIGH — pure TypeScript logic, transitions match ROADMAP success criteria exactly
- Intent classifier: MEDIUM — structure is correct; exact regex patterns will need Phase 5 tuning against real speech data
- pgvector SQL functions: HIGH — signatures match the architecture research which was verified against Supabase pgvector docs
- Test strategy: HIGH — `bun test` is built-in to Bun 1.3.10; all test commands verified

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (30 days — stable libraries, no fast-moving dependencies in Phase 1 scope)

---

## RESEARCH COMPLETE

Phase 1: Foundation research is complete.

### Key Findings

- All 8 Supabase table schemas and RLS policies are fully specified with exact SQL — the planner can use these verbatim in migration files.
- The HMAC raw-body middleware ordering constraint is the single highest-risk correctness issue in Phase 1: the `app.use('/webhook/*', ...)` call must precede every `app.route()` call in server.ts.
- The session state machine is 5 states, 6 valid transition arrows, with `idle → awaiting_approval` explicitly invalid — the transition table is documented and test cases are defined.
- The intent classifier covers 10 patterns (8 from AGENT-02 plus `confirm_send` and `cancel` for the approval loop) and returns `null` to fall through to the LLM.
- Package versions verified against the npm registry as of 2026-03-27: several are newer than the pinned versions in STATE.md (e.g., `@supabase/supabase-js` is 2.100.1, not 2.99.3; `@elevenlabs/elevenlabs-js` is 2.40.0, not 2.39.0). The planner should use the verified registry versions.
- Bun 1.3.10 is installed (not 1.3.11 as specified — one patch version behind). This is unlikely to cause issues for Phase 1.

### File Created

`C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Supabase schema | HIGH | All tables, columns, RLS policies, and SQL functions specified from official docs |
| Hono server patterns | HIGH | Middleware ordering, Bun export, CORS, bearerAuth verified against Hono docs |
| Session state machine | HIGH | Pure logic, exact transitions match ROADMAP success criteria |
| Intent classifier | MEDIUM | Structure correct; regex patterns need SA English speech tuning |
| Test strategy | HIGH | bun test built-in, all test files and commands specified |

### Open Questions

- Supabase project not yet created — required before Plan 1 runs
- Redis hosting provider not yet decided — required before Phase 2
- `API_BEARER_TOKEN` distribution to demo client not decided — needed before Phase 4

### Ready for Planning

Research is complete. The planner can now create PLAN.md for Phase 1 with three self-contained plans: (1) Supabase schema deployment, (2) Hono server skeleton, (3) pure-logic modules + unit tests.
