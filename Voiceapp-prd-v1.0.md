# VoiceApp — Product Requirements Document

**Version:** 1.0
**Date:** 27 March 2026
**Author:** Mzansi Agentive (Pty) Ltd — Enterprise No. 2026/179878/07
**Status:** Draft — Hackathon build v0.1
**Classification:** Internal only

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Scope](#2-scope)
3. [System Architecture](#3-system-architecture)
4. [Database Schema](#4-database-schema)
5. [Backend API Specification](#5-backend-api-specification)
6. [AI Agent System](#6-ai-agent-system)
7. [Heartbeat Engine](#7-heartbeat-engine)
8. [User Journeys](#8-user-journeys)
9. [User Isolation and Data Architecture](#9-user-isolation-and-data-architecture)
10. [Test Suite](#10-test-suite)
11. [Technology Stack](#11-technology-stack)
12. [Frontend — Caregiver Dashboard](#12-frontend--caregiver-dashboard)
13. [Environment Variables](#13-environment-variables)
14. [Hackathon Build Order](#14-hackathon-build-order)

---

## 1. Product Overview

### 1.1 Problem Statement

Visually impaired users in South Africa cannot independently use WhatsApp's screen-based interface. Existing accessibility tools are partial, fragmented, and designed without the South African context in mind — no Afrikaans or isiZulu support, no load shedding awareness, no WhatsApp-native integration that preserves the existing social graph.

No product today combines ambient intelligence, WhatsApp messaging, and proactive audio briefings in a single coherent voice-native experience. VoiceApp fills this gap.

### 1.2 Value Proposition

> *The first AI companion designed for users who navigate the world by sound.*

The WhatsApp social graph serves as the communication backbone — users keep their existing contacts, groups, and conversation history. The Claude agent provides composition, reading, research, and memory. South African context awareness (load shedding, Afrikaans, isiZulu) provides daily relevance. Everything is delivered through audio. No screen interaction is required after initial setup.

### 1.3 Target Users

| Persona | Description | Primary need |
|---|---|---|
| Visually impaired adult | Active WhatsApp user, 18–65, South Africa | Full WhatsApp access by voice |
| Hands-occupied user | Driver, factory worker, domestic worker | Ambient messaging and information |
| Caregiver or family member | Sets up device once for primary user | Configuration and monitoring UI |

### 1.4 Core Capabilities

- Voice compose and send WhatsApp messages with an approval loop before sending
- Read incoming messages aloud with resolved contact names
- Voice note playback (received) and recording (outbound)
- Morning briefing: load shedding + weather + overnight message digest
- Ambient queries: load shedding schedule, weather, quick web search
- Save new contacts entirely by voice — no screen required
- Priority contact flagging with interrupt vs batch surface decisions
- Long-term memory: user profile, quiet hours, episodic interaction history
- Multi-language: English and Afrikaans TTS in v0.1, isiZulu in v0.2
- Full user isolation: all data scoped per WhatsApp phone number with RLS

---

## 2. Scope

### 2.1 In Scope — Hackathon v0.1

| Feature | Priority | Effort |
|---|---|---|
| Voice compose + send with approval loop | P0 | M |
| Read incoming messages aloud | P0 | S |
| Contact name resolution from address book | P0 | S |
| Save contacts by voice (unknown number flow + proactive) | P0 | M |
| Priority contact flagging — interrupt vs batch | P0 | M |
| Morning briefing cron (load shedding + weather + digest) | P0 | L |
| Heartbeat engine — event-driven surface decision gate | P0 | L |
| Supabase schema with RLS user isolation | P0 | M |
| WhatsApp webhook handler with HMAC signature verification | P0 | S |
| Ambient queries: load shedding and weather | P1 | S |
| Ambient web search via Tavily | P1 | S |
| Voice note playback for received audio messages | P1 | M |
| Episodic memory store via pgvector | P1 | M |
| Cron scheduler for user routines | P1 | M |
| Caregiver dashboard — Vite + React frontend | P1 | L |
| English + Afrikaans TTS via ElevenLabs | P1 | S |

### 2.2 Out of Scope — v0.1

- isiZulu TTS — deferred to v0.2 (Google Cloud TTS)
- iOS native integration — Android first due to background audio restrictions
- Group message creation — reading only in v0.1
- Research-to-podcast synthesis — deferred to v0.2
- Multi-device session management
- Payments integration
- Proactive load shedding push alerts — deferred to v0.2

---

## 3. System Architecture

### 3.1 Overview

VoiceApp is server-side driven. The WhatsApp Business API is a cloud-hosted webhook API — it does not provide native app-level message interception. All messages pass through the backend, which orchestrates the Claude agent, heartbeat engine, and TTS pipeline.

```
┌─────────────────────────────────────────────────────────────────┐
│  User Device (Android)                                          │
│  Mic → Whisper STT → POST /api/voice/command                   │
│  Speaker ← ElevenLabs TTS ← Agent spoken response              │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Bun / Hono Backend (port 3000)                                 │
│                                                                  │
│  POST /webhook/whatsapp   ← WhatsApp Cloud API inbound          │
│  POST /api/voice/command  ← STT transcript from device          │
│  WS   /ws/session/:userId ← Real-time session state push        │
│                                                                  │
│  ┌──────────────────┐   ┌──────────────────────────────────┐   │
│  │ Heartbeat Engine │   │ Claude Agent Core                 │   │
│  │                  │   │                                   │   │
│  │ BullMQ event Q   │   │ Orchestrator                     │   │
│  │ node-cron sched  │   │ → Messaging agent                │   │
│  │ Decision gate    │   │ → Ambient query agent            │   │
│  └──────────────────┘   │ → Memory agent                  │   │
│                          │ → Research agent (v0.2)         │   │
│                          └──────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Supabase (PostgreSQL + pgvector)                               │
│                                                                  │
│  users            user_profile      user_contacts               │
│  sessions         message_log       memory_store                │
│  routines         heartbeat_log                                  │
│                                                                  │
│  RLS enforced on all tables — user_id scoped                    │
└─────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  External APIs                                                   │
│                                                                  │
│  WhatsApp Cloud API (Meta)   Tavily (web search)                │
│  EskomSePush (load shedding) OpenWeather (weather)              │
│  ElevenLabs (TTS EN/AF)      OpenAI Whisper (STT)               │
│  OpenAI text-embedding-3 (memory embeddings)                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Inbound Message Flow

```
WhatsApp message arrives
  → POST /webhook/whatsapp
  → Verify x-hub-signature-256 HMAC
  → Extract sender phone (from field)
  → Normalise to E.164 format
  → Upsert to users table (creates on first contact)
  → Log to message_log (direction = 'in')
  → Enqueue to heartbeat engine
  → Heartbeat runs surface decision gate
      → interrupt: TTS spoken immediately via WebSocket push
      → batch: add to in-memory digest queue
      → silent: log only, no surface action
      → skip: no action (quiet hours + non-priority)
  → Interaction summary written to memory_store
```

### 3.3 Outbound Message Flow

```
User speaks: "Tell my wife I need condensed milk"
  → Whisper STT transcribes to text
  → POST /api/voice/command { userId, transcript }
  → Orchestrator classifies intent: send_message
  → Messaging agent resolves "wife" → user_contacts lookup
  → Agent drafts message text
  → Session state → awaiting_approval
  → TTS: "I've drafted this to Naledi: I need condensed milk.
          Should I send it?"
  → User says "yes"
  → Agent calls send_message tool
  → POST to WhatsApp Cloud API /messages
  → Outbound logged to message_log (direction = 'out')
  → Session state → idle
  → TTS: "Sent. Anything else?"
```

---

## 4. Database Schema

### 4.1 Design Principles

All data lives in Supabase (PostgreSQL). Every table carries a `user_id` foreign key. Row Level Security is enforced at the database layer — the DB itself refuses cross-user data access even if application code has a bug. Backend operations run as the `service_role`, which has a separate bypass policy. Phone number from the WhatsApp webhook is the identity anchor.

The `pgvector` extension enables cosine similarity search over `memory_store` for episodic memory retrieval.

### 4.2 Table Reference

| Table | Purpose | Key fields | RLS |
|---|---|---|---|
| `users` | Primary identity anchor | `user_id` PK, `phone_number` unique | Yes |
| `user_profile` | Preferences and settings | `language_pref`, `quiet_hours`, `location_area` | Yes |
| `user_contacts` | Voice-populated address book | `contact_phone`, `contact_name`, `is_priority` | Yes |
| `sessions` | Active audio context state machine | `state`, `context` JSONB | Yes |
| `message_log` | Full inbound/outbound history | `direction`, `message_type`, `content`, `media_url` | Yes |
| `memory_store` | Episodic memory with embeddings | `summary`, `embedding` vector(1536) | Yes |
| `routines` | Cron schedule entries | `cron_expression`, `routine_type`, `config` JSONB | Yes |
| `heartbeat_log` | Audit log of surface decisions | `trigger_type`, `decision`, `reason` | Yes |

### 4.3 Key Schema Definitions

```sql
-- users
CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number  TEXT NOT NULL UNIQUE,    -- E.164 e.g. +27831234567
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_profile
CREATE TABLE user_profile (
  profile_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  language_pref             TEXT NOT NULL DEFAULT 'en'
                            CHECK (language_pref IN ('en','af','zu')),
  quiet_hours_start         TIME,            -- e.g. 22:00
  quiet_hours_end           TIME,            -- e.g. 07:00
  location_area             TEXT,            -- for EskomSePush + OpenWeather
  timezone                  TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  morning_briefing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  evening_digest_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_contacts
CREATE TABLE user_contacts (
  contact_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,             -- E.164 format
  contact_name  TEXT NOT NULL,             -- as spoken by user
  is_priority   BOOLEAN NOT NULL DEFAULT FALSE,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, contact_phone)           -- one entry per phone per user
);

-- sessions
CREATE TABLE sessions (
  session_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  state       TEXT NOT NULL DEFAULT 'idle'
              CHECK (state IN ('idle','listening','composing','awaiting_approval','playing')),
  context     JSONB,                       -- current draft, pending action etc.
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);

-- message_log
CREATE TABLE message_log (
  message_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  contact_phone TEXT NOT NULL,
  contact_name  TEXT,
  message_type  TEXT NOT NULL DEFAULT 'text'
                CHECK (message_type IN ('text','audio','image','document')),
  content       TEXT,
  media_url     TEXT,
  is_read_aloud BOOLEAN NOT NULL DEFAULT FALSE,
  is_batched    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- memory_store
CREATE TABLE memory_store (
  memory_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  embedding   vector(1536),               -- OpenAI text-embedding-3-small
  memory_type TEXT NOT NULL DEFAULT 'episodic'
              CHECK (memory_type IN ('episodic','preference','contact_note')),
  source_ref  UUID,                       -- optional link to message_id or session_id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- routines
CREATE TABLE routines (
  routine_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  routine_type    TEXT NOT NULL
                  CHECK (routine_type IN ('morning_briefing','evening_digest','custom_reminder')),
  cron_expression TEXT NOT NULL,
  label           TEXT,
  config          JSONB,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.4 Session State Machine

Valid states and allowed transitions:

| From | Can transition to |
|---|---|
| `idle` | `listening` |
| `listening` | `composing`, `playing`, `idle` |
| `composing` | `awaiting_approval`, `idle` |
| `awaiting_approval` | `listening`, `idle` |
| `playing` | `listening`, `idle` |

### 4.5 RLS Policy Design

Two policy layers apply to every table:

- **User policy** — restricts reads/writes to rows where `user_id = auth.uid()`
- **Service role policy** — grants full access to `service_role` (used by backend webhook handler)

```sql
-- Example for user_contacts
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_contacts_isolation ON user_contacts
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY service_role_contacts ON user_contacts
  FOR ALL TO service_role USING (true);
```

### 4.6 Helper Functions

```sql
-- Semantic memory search
CREATE OR REPLACE FUNCTION match_memories(
  p_user_id   UUID,
  p_embedding vector(1536),
  p_limit     INT DEFAULT 5,
  p_threshold FLOAT DEFAULT 0.75
)
RETURNS TABLE (memory_id UUID, summary TEXT, similarity FLOAT, created_at TIMESTAMPTZ) AS $$
  SELECT memory_id, summary,
         1 - (embedding <=> p_embedding) AS similarity,
         created_at
  FROM memory_store
  WHERE user_id = p_user_id
    AND 1 - (embedding <=> p_embedding) > p_threshold
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$ LANGUAGE sql;

-- Contact name resolver — returns phone if not found
CREATE OR REPLACE FUNCTION resolve_contact_name(p_user_id UUID, p_phone TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT contact_name FROM user_contacts
     WHERE user_id = p_user_id AND contact_phone = p_phone),
    p_phone
  );
$$ LANGUAGE sql;
```

---

## 5. Backend API Specification

### 5.1 Runtime

| Property | Value |
|---|---|
| Runtime | Bun v1.x |
| HTTP framework | Hono v4 |
| Port | 3000 (configurable via `PORT` env) |
| Webhook auth | HMAC `x-hub-signature-256` |
| API auth | Bearer token for `/api/*` routes |

### 5.2 Endpoint Reference

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/health` | Health check | None |
| `GET` | `/webhook/whatsapp` | WA webhook verification handshake | Verify token |
| `POST` | `/webhook/whatsapp` | Inbound WA messages | HMAC sig |
| `POST` | `/api/voice/command` | Process voice transcript | Bearer |
| `GET` | `/api/voice/digest` | Get and flush batched message digest | Bearer |
| `GET` | `/api/contacts` | List user contacts | Bearer |
| `POST` | `/api/contacts` | Save new contact | Bearer |
| `PATCH` | `/api/contacts/:id` | Update contact name or priority | Bearer |
| `DELETE` | `/api/contacts/:id` | Remove contact | Bearer |
| `GET` | `/api/routines` | List user routines | Bearer |
| `POST` | `/api/routines` | Create routine | Bearer |
| `DELETE` | `/api/routines/:id` | Remove routine | Bearer |
| `GET` | `/api/sessions/active` | Get active session state | Bearer |
| `POST` | `/api/sessions` | Create new session | Bearer |
| `PATCH` | `/api/sessions/:id/state` | Update session state | Bearer |
| `POST` | `/api/sessions/:id/end` | End session | Bearer |

### 5.3 Voice Command — Request / Response

**Request**
```json
POST /api/voice/command
{
  "userId": "uuid",
  "transcript": "Tell my wife I need condensed milk",
  "sessionId": "uuid"
}
```

**Response**
```json
{
  "spoken": "I've drafted this to Naledi: \"I need condensed milk.\" Should I send it?",
  "action": "send_pending_approval",
  "requiresConfirmation": true,
  "pendingAction": {
    "type": "send",
    "toPhone": "+27831234567",
    "text": "I need condensed milk",
    "contactName": "Naledi"
  }
}
```

### 5.4 Webhook Signature Verification

```typescript
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  return signature === expected
}
// Called with: c.req.header('x-hub-signature-256')
```

---

## 6. AI Agent System

### 6.1 Architecture

The agent system is built on the Claude Agents SDK. An orchestrator receives the transcribed voice command, classifies intent, and routes to a sub-agent or directly calls a tool. All agents share the tool registry. Context — user profile, recent memory, session state — is injected into the orchestrator system prompt on every invocation.

Fast-path intent classification uses regex matching before invoking the LLM, keeping latency under 500ms for common commands like "read my messages" or "check load shedding". The LLM is used for complex composition tasks and ambiguous multi-part requests.

### 6.2 Agent Roles

| Agent | Responsibility | Key tools |
|---|---|---|
| Orchestrator | Intent classification, routing, spoken response assembly | All tools |
| Messaging agent | Compose, send, read, reply flows, approval loop | `send_message`, `get_recent_messages`, `resolve_contact`, `play_voice_note` |
| Ambient query agent | Fast single-tool calls, sub-3s target | `get_weather`, `get_loadshedding`, `web_search` |
| Memory agent | Read/write episodic memory, update user profile | `read_memory`, `write_memory`, `update_profile` |
| Research agent *(v0.2)* | Multi-step research + podcast synthesis | `web_search`, `web_fetch`, `script_writer`, `tts_stitch` |

### 6.3 Tool Registry

| Tool | Maps to | Agent |
|---|---|---|
| `send_message` | POST `/messages` — WhatsApp Cloud API | Messaging |
| `get_recent_messages` | SELECT `message_log` — Supabase | Messaging |
| `resolve_contact` | SELECT `user_contacts` — Supabase | Messaging |
| `save_contact` | UPSERT `user_contacts` — Supabase | Messaging |
| `set_priority` | UPDATE `user_contacts.is_priority` | Messaging |
| `play_voice_note` | Fetch WA Media URL + stream to device | Messaging |
| `web_search` | Tavily API | Ambient |
| `get_weather` | OpenWeather API | Ambient |
| `get_loadshedding` | EskomSePush API | Ambient |
| `read_memory` | pgvector cosine similarity search | Memory |
| `write_memory` | INSERT `memory_store` + embed | Memory |
| `update_profile` | UPSERT `user_profile` | Memory |

### 6.4 Intent Classification

| Intent | Trigger patterns | Route to |
|---|---|---|
| `send_message` | `"tell"`, `"send"`, `"message"`, `"whatsapp"` + contact | Messaging agent |
| `read_messages` | `"read"`, `"check messages"`, `"do i have messages"` | Messaging agent |
| `save_contact` | `"save contact"`, `"save this number"` | Messaging agent |
| `set_priority` | `"make ... priority"`, `"remove ... priority"` | Messaging agent |
| `load_shedding` | `"load shedding"`, `"eskom"`, `"power cut"`, `"outage"` | Ambient agent |
| `weather` | `"weather"`, `"temperature"`, `"rain"`, `"forecast"` | Ambient agent |
| `web_search` | `"search"`, `"look up"`, `"what is"`, `"who is"` | Ambient agent |
| `message_digest` | `"messages"`, `"digest"`, `"what did i miss"` | Heartbeat flush |

### 6.5 Orchestrator System Prompt Template

```
You are VoiceApp, a voice-native AI companion for a visually impaired user.

User: {display_name}, phone: {phone_number}
Language preference: {language_pref}
Current time: {current_time} ({timezone})
Session state: {session_state}

Recent memory:
{memory_snippets}

Active contacts (priority first):
{contact_list}

Rules:
- All responses are spoken aloud. Keep them conversational and concise.
- Never produce markdown, lists with dashes, or formatting.
- Always confirm before sending messages.
- When reading messages, state the sender name first.
- If the user's preferred language is Afrikaans, respond in Afrikaans unless
  the incoming message is in a different language.
- Never ask more than one question at a time.
```

---

## 7. Heartbeat Engine

### 7.1 Design Principle

The heartbeat engine is the proactive core of VoiceApp. Unlike a reactive assistant, it monitors two trigger streams — live events and scheduled crons — and decides whether and how to surface each event to the user. The agent is always on. Silence is an explicit choice, not a default.

### 7.2 Trigger Sources

| Type | Source | Examples |
|---|---|---|
| Event-driven | WhatsApp webhook inbound | New message, voice note, unknown number |
| Event-driven | External API change | Load shedding schedule update |
| Schedule-driven | Cron expression in `routines` table | Morning briefing, evening digest, custom reminders |

### 7.3 Surface Decision Gate

Every trigger is evaluated in this priority order:

```
1. Is user in quiet hours AND sender is NOT priority?
   → skip

2. Is user in quiet hours AND sender IS priority?
   → interrupt (priority overrides quiet hours)

3. Is session state 'composing' or 'awaiting_approval'?
   → batch (do not interrupt an active task)

4. Is sender a priority contact?
   → interrupt

5. Is sender an unknown number (not in user_contacts)?
   → interrupt (offer save flow)

6. Is message type 'audio' (voice note)?
   → batch (play at convenient time)

7. Default — known non-priority contact
   → batch
```

### 7.4 Output Modes

| Decision | Action | Triggers TTS? |
|---|---|---|
| `interrupt` | Push spoken text via WebSocket to active device | Yes — immediately |
| `batch` | Add to in-memory queue, flush at next briefing | Yes — at briefing time |
| `silent` | Log to `message_log` only, no surface action | No |
| `skip` | No action whatsoever | No |

### 7.5 Quiet Hours Logic

Quiet hours support overnight ranges (e.g. 22:00 to 07:00):

```typescript
function isInQuietHours(profile: UserProfile): boolean {
  if (!profile.quiet_hours_start || !profile.quiet_hours_end) return false

  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const [startH, startM] = profile.quiet_hours_start.split(':').map(Number)
  const [endH, endM] = profile.quiet_hours_end.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  // Overnight range: startMinutes > endMinutes
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes
  }
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes
}
```

### 7.6 Morning Briefing Composition

The morning briefing cron fires at `0 7 * * 1-5` by default (07:00 weekdays). Content is assembled in this order:

1. Personalised greeting with display name and current date
2. Load shedding schedule for user's registered area (EskomSePush API)
3. Weather summary for user's area (OpenWeather API)
4. Batched overnight message digest — priority contacts first, then others grouped by sender
5. Offer to read or reply to any message

**Example output:**

> "Good morning Sipho. It's Monday, 27 March. Stage 2 load shedding from 10:00 to 12:00 in your area. It's 18 degrees in Johannesburg, partly cloudy. Overnight you got 5 messages: two from Naledi, one from your brother, and two from the family group. Want me to start with Naledi's?"

### 7.7 Cron Scheduler

The scheduler polls the `routines` table every 60 seconds. Each row maps to a handler:

| `routine_type` | Default cron | Handler |
|---|---|---|
| `morning_briefing` | `0 7 * * 1-5` | Build and speak morning briefing |
| `evening_digest` | `0 18 * * *` | Digest of day's messages |
| `custom_reminder` | User-set | Speak `config.message` text |

Double-fire protection: `last_run` is checked — if within 55 seconds of current time, the routine is skipped.

---

## 8. User Journeys

### Journey 1 — Send a message by voice

| Step | User action | System response |
|---|---|---|
| 1 | Double-presses volume button to activate | App opens, session starts, `state → listening` |
| 2 | Speaks: "Tell my wife I need condensed milk and to get it when she passes the store" | Whisper STT transcribes |
| 3 | — | Agent resolves "wife" to Naledi's contact, drafts message |
| 4 | — | TTS: "I've drafted this to Naledi: I need condensed milk, can you grab some when you pass the store. Should I send it?" |
| 5 | Says "yes" | Agent calls `send_message` tool, WA message sent |
| 6 | — | TTS: "Sent. Anything else?" Session `→ idle` |

### Journey 2 — Incoming message from priority contact

| Step | Event | System response |
|---|---|---|
| 1 | Naledi sends "Are you home?" | WA webhook fires |
| 2 | — | Heartbeat: Naledi is priority contact → `interrupt` |
| 3 | — | TTS: "Message from Naledi: Are you home?" |
| 4 | User says "reply yes, I'll be back by 6" | Agent drafts, reads back, waits for confirmation |
| 5 | User says "yes" | Agent sends, confirms aloud |

### Journey 3 — Save a new contact by voice

| Step | Event | System response |
|---|---|---|
| 1 | Message arrives from +27311234567 (unknown) | WA webhook fires |
| 2 | — | Heartbeat: unknown number → `interrupt` |
| 3 | — | TTS: "New message from unsaved number: plus two seven three one one two three four five six seven. They say: Hi it's Themba from the church committee. Would you like to save this number?" |
| 4 | User says "yes" | TTS: "What name should I save them as?" |
| 5 | User says "Themba church" | Agent confirms: "Saving Themba church. Done." |
| 6 | — | Row inserted to `user_contacts` with `is_priority = false` |

### Journey 4 — Morning briefing (cron-driven)

| Step | Event | System response |
|---|---|---|
| 1 | 07:00 — cron fires for `morning_briefing` routine | Heartbeat engine wakes |
| 2 | — | Pull user profile (name, location, language) |
| 3 | — | Call EskomSePush for today's load shedding in user's area |
| 4 | — | Call OpenWeather for current conditions |
| 5 | — | Flush batched overnight messages, group by sender |
| 6 | — | Compose full briefing text |
| 7 | — | Push to device via WebSocket → TTS pipeline |

### Journey 5 — Ambient load shedding query

| Step | User action | System response |
|---|---|---|
| 1 | User says "what's the load shedding today?" | STT + POST to `/api/voice/command` |
| 2 | — | Orchestrator classifies: `load_shedding` intent |
| 3 | — | Ambient agent calls `get_loadshedding` tool → EskomSePush API |
| 4 | — | TTS: "Stage 2 from 10:00 to 12:00 and again from 18:00 to 20:00 in your area." |

Total latency target: under 3 seconds.

### Journey 6 — Set a priority contact by voice

| Step | User action | System response |
|---|---|---|
| 1 | User says "make Bongani a priority contact" | STT + intent classification |
| 2 | — | Agent resolves "Bongani" from `user_contacts` |
| 3 | — | Calls `set_priority` tool → UPDATE `is_priority = true` |
| 4 | — | TTS: "Bongani has been added to priority contacts. His messages will always interrupt immediately." |

---

## 9. User Isolation and Data Architecture

### 9.1 Identity Model

Every user is anchored to their WhatsApp phone number. This is extracted from the `from` field of every inbound webhook payload and normalised to E.164 format (`+27XXXXXXXXX` for South African numbers). On first contact, a new `users` row is created. On subsequent contacts, `last_active` is updated. All downstream tables use `user_id` as a foreign key.

```typescript
// On every inbound webhook:
const phone = normalisePhone(message.from)       // → +27831234567
const user = await upsertUser(phone)              // creates or updates
// All subsequent DB operations scoped to user.user_id
```

### 9.2 What is Isolated Per User

Everything. Per-user isolation applies to:

- Contact address book (`user_contacts`) — populated only through voice flows
- Preferences (`user_profile`) — language, quiet hours, location area
- Message history (`message_log`) — full inbound and outbound log
- Episodic memory (`memory_store`) — interaction summaries and embeddings
- Scheduled routines (`routines`) — cron entries
- Active session (`sessions`) — audio context state machine
- Heartbeat audit log (`heartbeat_log`) — surface decision history

### 9.3 Contact Model Constraints

The WhatsApp Business API provides the sender's phone number on every inbound message but does not expose the user's device contact list. The `user_contacts` table is entirely this product's own construct, populated only through:

1. **Unknown number flow** — agent offers to save when an unrecognised number messages
2. **Proactive save** — user explicitly says "save my neighbour's number" and speaks the digits

This is deliberate. The agent only knows contacts the user has consciously introduced, keeping the system intentional and privacy-respecting.

### 9.4 Phone Number Normalisation

```typescript
function normalisePhone(phone: string): string {
  const digits = phone.replace(/[\s\-\(\)]/g, '')
  return digits.startsWith('+') ? digits : '+' + digits
}
// "+27 83 123 4567"  → "+27831234567"
// "27831234567"      → "+27831234567"
// "+27831234567"     → "+27831234567"
```

### 9.5 Spoken Phone Number Format

When reading an unknown number aloud, it must be spoken digit by digit:

```typescript
function formatPhoneSpoken(phone: string): string {
  return phone.split('').map(c => c === '+' ? 'plus ' : c + ' ').join('').trim()
}
// "+27831234567" → "plus 2 7 8 3 1 2 3 4 5 6 7"
```

---

## 10. Test Suite

### 10.1 Philosophy

Tests are pure unit tests and integration-style tests that do not require a live Supabase instance or external API connections. Core business logic is tested in isolation. Mocks are only used for DB and external HTTP calls.

**Run:** `bun test` from the `backend/` directory.

### 10.2 Coverage Areas

| Suite | What is tested | Cases |
|---|---|---|
| `isInQuietHours` | Null profile, no hours set, overnight range, boundary conditions | 5 |
| Phone normalisation | E.164 prefix, spaces, dashes, parentheses, mixed | 5 |
| Webhook signature verification | Valid, invalid, empty, wrong secret | 4 |
| Heartbeat decision gate | All 8 decision combinations + quiet hours boundary conditions | 15 |
| Intent classification | Send, read, save contact, priority, load shedding, weather, search | 19 |
| Session state machine | Valid states, invalid states, all allowed transitions | 9 |
| Cron expression validation | Parse, wrong field count, empty, common expressions | 6 |
| Message log helpers | Direction validation, type validation, spoken text construction | 4 |
| Morning briefing builder | Greeting by hour (morning/afternoon/evening), composition order | 8 |
| Contact voice save flow | Extraction from transcript, spoken phone format, default priority | 4 |
| WhatsApp payload parsing | Messages extraction, sender phone, field filter, content types, empty | 6 |

**Total: 85+ test cases across 11 suites**

### 10.3 Running Tests

```bash
cd backend

# Run all tests
bun test

# With coverage report
bun test --coverage

# Watch mode during development
bun test --watch

# Specific test file
bun test tests/voiceapp.test.ts

# Filter by test name
bun test --test-name-pattern "heartbeat"
```

### 10.4 Example Test Cases

```typescript
// Heartbeat decision gate
it('skips non-priority messages during quiet hours', () => {
  expect(decide({ isQuietHours: true, isPriority: false, ... })).toBe('skip')
})

it('interrupts priority messages even during quiet hours', () => {
  expect(decide({ isQuietHours: true, isPriority: true, ... })).toBe('interrupt')
})

// Intent classification
it('detects send intent: "tell my wife I need milk"', () => {
  expect(matchesSendIntent('tell my wife I need milk')).toBe(true)
})

it('detects load shedding: "loadshedding"', () => {
  expect(matchesLoadSheddingIntent('loadshedding')).toBe(true)
})

// Quiet hours boundary
it('22:00–07:00 range: midnight is in quiet hours', () => {
  expect(isInQuietHoursSync({ start: '22:00', end: '07:00' }, 0, 0)).toBe(true)
})

it('22:00–07:00 range: 14:00 is NOT in quiet hours', () => {
  expect(isInQuietHoursSync({ start: '22:00', end: '07:00' }, 14, 0)).toBe(false)
})
```

---

## 11. Technology Stack

| Category | Technology | Purpose | Version |
|---|---|---|---|
| Runtime | Bun | Backend JS runtime | 1.x |
| HTTP | Hono | API framework | 4.x |
| Agent SDK | `@anthropic-ai/sdk` | Claude agent orchestration | latest |
| Model | `claude-sonnet-4-6` | Agent intelligence | current |
| STT | OpenAI Whisper | Voice to text | `whisper-1` |
| TTS (EN/AF) | ElevenLabs | Text to speech | v1 |
| TTS (ZU, v0.2) | Google Cloud TTS | isiZulu voice | v1 |
| Database | Supabase (PostgreSQL) | Primary data store | 15.x |
| Vector memory | pgvector on Supabase | Episodic memory search | 0.7.x |
| Auth / RLS | Supabase RLS policies | User isolation | built-in |
| Job queue | BullMQ + Redis | Heartbeat event queue | 5.x |
| Cron | node-cron | Routine scheduler | 3.x |
| Messaging | WhatsApp Cloud API (Meta) | Social layer | v19 |
| Web search | Tavily | Ambient + research queries | v1 |
| Load shedding | EskomSePush API | SA-specific context | v2 |
| Weather | OpenWeather API | SA weather data | 2.5 |
| Frontend | Vite + React | Caregiver dashboard | 5.x / 18.x |
| State | Zustand | Frontend global state | 4.x |
| Validation | Zod | Runtime type checking | 3.x |
| Deploy | Railway / Render | Hackathon hosting | — |

---

## 12. Frontend — Caregiver Dashboard

### 12.1 Purpose

The frontend is not used by the visually impaired end-user. It is a caregiver setup and monitoring dashboard — a way for a family member or helper to configure the system once and monitor it during demos or support sessions.

### 12.2 Design Direction

- **Theme:** Dark background (`#0D0D0D`), terminal green accents (`#00FF88`)
- **Typography:** IBM Plex Mono for data labels and status, IBM Plex Sans for prose
- **Aesthetic:** Mission control — operator panel, not consumer app
- **Animation:** Audio waveform pulse when agent is active, blinking dot for listening state
- **Contrast:** Legible across a room during demo presentations

### 12.3 Page Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | Login | Phone number entry — sets userId context |
| `/setup` | Setup | Language, location, quiet hours, briefing toggles |
| `/dashboard` | Dashboard | Live agent state, audio visualiser, heartbeat feed, voice simulator |
| `/contacts` | Contacts | Manage address book, toggle priority, add manually |
| `/routines` | Routines | View and edit cron routines with human-readable labels |
| `/log` | Log | Message history, heartbeat audit, memory schema viewer |

### 12.4 Dashboard Key Components

- **Agent state panel** — shows current session state with colour-coded indicator and animated pulse ring when active
- **AudioWaveform** — 24-bar animated waveform SVG, active when agent is in `listening` or `playing` state
- **Voice command simulator** — type a transcript, send it to the backend, see the spoken response — no microphone needed for demo
- **Heartbeat feed** — live log of surface decisions with colour coding (`interrupt` = green, `batch` = amber, `skip` = red)
- **Batch queue card** — count of messages awaiting next digest with flush button

### 12.5 Frontend File Structure

```
frontend/src/
  main.tsx                  React router entry + protected routes
  index.css                 Dark mission control design system (IBM Plex Mono)
  stores/useStore.ts        Zustand global state (userId, session, contacts, routines)
  lib/api.ts                Typed backend API client (fetch wrapper)
  components/
    Layout.tsx              Sidebar nav shell with agent state indicator
  pages/
    LoginPage.tsx           Phone number sign-in
    SetupPage.tsx           User profile configuration form
    DashboardPage.tsx       Live state + waveform + heartbeat + simulator
    ContactsPage.tsx        Contact management with priority toggle
    RoutinesPage.tsx        Cron routine management with helper presets
    LogPage.tsx             Message log + heartbeat audit + memory viewer
```

---

## 13. Environment Variables

```bash
# ── SUPABASE ──────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ── WHATSAPP CLOUD API ────────────────────────────────────────
WA_PHONE_NUMBER_ID=your-phone-number-id
WA_ACCESS_TOKEN=your-permanent-access-token
WA_VERIFY_TOKEN=voiceapp_verify_2026
WA_APP_SECRET=your-app-secret-for-hmac

# ── AI + VOICE ────────────────────────────────────────────────
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-key          # Whisper STT + embeddings
ELEVENLABS_API_KEY=your-elevenlabs-key

# ── EXTERNAL APIS ─────────────────────────────────────────────
ESKOMSEPUSH_API_KEY=your-eskomsepush-key
OPENWEATHER_API_KEY=your-openweather-key
TAVILY_API_KEY=your-tavily-key

# ── INFRASTRUCTURE ────────────────────────────────────────────
REDIS_URL=redis://localhost:6379         # Upstash in prod: rediss://...

# ── SERVER ───────────────────────────────────────────────────
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

| Variable | Required | Where to get |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase project → Settings → API |
| `WA_PHONE_NUMBER_ID` | Yes | Meta Developer Portal → WhatsApp → API Setup |
| `WA_ACCESS_TOKEN` | Yes | Meta Developer Portal → WhatsApp → API Setup |
| `WA_VERIFY_TOKEN` | Yes | Set yourself, register in Meta portal |
| `WA_APP_SECRET` | Yes | Meta Developer Portal → App Settings → Basic |
| `ANTHROPIC_API_KEY` | Yes | console.anthropic.com |
| `OPENAI_API_KEY` | Yes | platform.openai.com |
| `ELEVENLABS_API_KEY` | Yes | elevenlabs.io |
| `ESKOMSEPUSH_API_KEY` | Yes | eskomsepush.com/business |
| `OPENWEATHER_API_KEY` | Yes | openweathermap.org/api |
| `TAVILY_API_KEY` | Yes | tavily.com |
| `REDIS_URL` | Yes | Local Redis or Upstash |

---

## 14. Hackathon Build Order

Target: **6–7 hours** for a complete working demo. Phases 1–8 are backend; phase 9 is frontend. Phases can be parallelised with a co-founder.

| Phase | Task | Estimate | Owner |
|---|---|---|---|
| 1 | Supabase project setup, run `001_initial.sql`, verify RLS policies | 30 min | Backend |
| 2 | Bun/Hono backend skeleton — health check, env config, CORS | 20 min | Backend |
| 3 | Webhook handler — HMAC verification, user upsert, message log | 30 min | Backend |
| 4 | Agent tool implementations — send, read, contacts, search, weather, load shedding | 60 min | Backend |
| 5 | Heartbeat engine — event queue, surface decision gate, batch queue | 45 min | Backend |
| 6 | Cron scheduler — routine polling, morning briefing builder | 30 min | Backend |
| 7 | Voice command route — intent classification and routing | 45 min | Backend |
| 8 | Test suite — run `bun test`, fix any failures, verify 85+ green | 30 min | Backend |
| 9 | Vite frontend — login, dashboard, contacts, routines pages | 60 min | Frontend |
| 10 | End-to-end demo flow — send message, morning briefing, save contact | 30 min | Both |
| 11 | Demo polish — spoken phrases, edge cases, demo script prep | 20 min | Both |

**Total: ~7 hours**

### Demo Script (for judges)

**Flow 1 — Send a message**
> "Tell my wife I need condensed milk and to get it when she stops by the grocery store"

**Flow 2 — Trigger morning briefing manually**

```bash
# Fire briefing immediately for demo purposes
curl -X POST http://localhost:3000/api/routines \
  -H "Content-Type: application/json" \
  -d '{"userId":"YOUR_ID","routineType":"morning_briefing","cronExpression":"* * * * *"}'
```

**Flow 3 — Load shedding query**
> "What's the load shedding today?"

**Flow 4 — Save unknown contact**
Simulate an inbound from a new number via the dashboard voice simulator — agent announces the number and offers to save.

**Flow 5 — Set priority contact**
> "Make Bongani a priority contact"

---

*Mzansi Agentive (Pty) Ltd — Enterprise No. 2026/179878/07 — Johannesburg — Confidential*
