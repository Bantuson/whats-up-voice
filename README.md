# VoiceApp — AI Voice Companion for Visually Impaired South Africans

A voice-native AI assistant that lets visually impaired users manage their WhatsApp life, stay informed, and navigate the world — entirely through natural conversation. No screen, no touch, no sight required.

---

## Problem Statement

Visually impaired people in South Africa face a profound digital divide. Smartphones are inherently visual interfaces — every notification, every message, every news update demands sight to act on. Screen readers help, but they require deliberate navigation and technical literacy most users don't have. The result: a daily dependency on sighted helpers for tasks as simple as replying to a WhatsApp message.

There are roughly 2.2 million visually impaired South Africans. The vast majority own basic smartphones and use WhatsApp as their primary communication channel. They are connected, but effectively locked out of managing their own digital lives.

---

## Solution

VoiceApp provides a fully voice-driven AI companion that:

- **Speaks** all responses aloud through text-to-speech — no reading required
- **Listens** via a mic button — the user simply talks; the agent understands intent
- **Manages WhatsApp** — read messages, compose and send replies, save contacts, all by voice
- **Surfaces context** — real-time load shedding schedule, weather, and priority contact alerts
- **Generates personalised podcasts** — on any topic, in a natural two-host format
- **Translates in real time** — between English, Zulu, Xhosa, Sesotho, and Afrikaans
- **Navigates verbally** — turn-by-turn walking directions with environmental descriptions
- **Remembers** — builds an episodic memory of the user's preferences and context over time

The caregiver (family member, support worker) gets a live monitoring dashboard: see the session state, message drafts awaiting approval, and the full conversation log — without ever touching the VI user's phone.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VI User's Phone                         │
│                                                             │
│  WhatsApp ──── Twilio Webhook ──────────────────────┐       │
└─────────────────────────────────────────────────────┼───────┘
                                                      │
                                               ┌──────▼──────┐
                                               │  Hono/Bun   │
                                               │  Backend    │
                                               │  :3000      │
                                               └──┬──┬──┬────┘
                                                  │  │  │
          ┌───────────────────────────────────────┘  │  └────────────────┐
          │                                          │                   │
   ┌──────▼──────┐   ┌──────────────────┐   ┌───────▼──────┐   ┌────────▼───────┐
   │  Claude     │   │  Supabase        │   │  OpenAI      │   │  BullMQ/Redis  │
   │  Sonnet 4.6 │   │  Postgres +      │   │  TTS + embeds│   │  cron workers  │
   │  Agentic    │   │  pgvector + RLS  │   │              │   │  (optional)    │
   └─────────────┘   └──────────────────┘   └──────────────┘   └────────────────┘

          ┌────────────────────────────────────────────────────────────┐
          │                  Caregiver Dashboard                       │
          │    React 19 + Vite  ←→  WebSocket  ←→  Backend :3000      │
          │    Live session phase · Chat log · Draft approval          │
          └────────────────────────────────────────────────────────────┘
```

**Request flow:**
1. VI user sends WhatsApp message → Twilio posts to `/webhook/whatsapp`
2. Heartbeat engine classifies urgency (interrupt / batch / silent)
3. Interrupt → `runOrchestrator()` — Claude Sonnet with 17 tools in an agentic loop
4. Response text → OpenAI TTS → MP3 streamed back to the user via WhatsApp voice note
5. Caregiver dashboard receives real-time updates via SSE + WebSocket

**Key design choices:**
- **No mobile app** — WhatsApp as the voice channel means zero install friction
- **Tool-use agentic loop** — Claude calls tools (ReadMessages, SendMessage, ResolveContact, WebSearch, etc.) and retries up to 10 times per request
- **pgvector memory** — past conversations embedded and recalled by cosine similarity
- **Podcast audio via WebSocket** — bypasses browser autoplay policy for long audio
- **State machine sessions** — 7 phases (idle → listening → composing → awaiting_approval → playing → translating → navigating) with Supabase-backed persistence

---

## Features

| Feature | Voice command example |
|---|---|
| Read messages | "Read my messages" |
| Send WhatsApp | "Send Naledi a message: see you at 3" |
| Save contact | "Save Louise, plus 27 69 685 4584" |
| Set priority | "Mark Mom as a priority contact" |
| Load shedding | "What's the load shedding schedule?" |
| Weather | "What's the weather today?" |
| Web search | "Who won the PSL last night?" |
| Generate podcast | "Make me a podcast about the Cape Town water crisis" |
| Replay podcast | "Play my last podcast" |
| Translate | "Translate to Zulu" (then speak — translates in real time) |
| Navigation | "Take me to Sandton City" |
| Memory | Automatic — agent recalls past context in future sessions |

---

## Running Locally (without Docker)

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 — `curl -fsSL https://bun.sh/install | bash`
- Node.js ≥ 20 (for the Vite frontend build)
- A Supabase project (free tier at [supabase.com](https://supabase.com))
- A Twilio account with WhatsApp sandbox access (free at [twilio.com](https://twilio.com))
- Anthropic and OpenAI API keys

### 1. Clone and install

```bash
git clone <repo-url>
cd voice-app

# Backend dependencies
bun install

# Frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Open .env and fill in your credentials — see the Credential Guide below
```

Create `frontend/.env.local` for the Vite dev server:
```bash
cat > frontend/.env.local << 'EOF'
VITE_API_TOKEN=<same value as API_BEARER_TOKEN in root .env>
VITE_SUPABASE_URL=<your supabase project url>
VITE_SUPABASE_ANON_KEY=<your supabase anon public key>
EOF
```

### 3. Set up Supabase — one migration, one paste

1. Open [supabase.com](https://supabase.com) → your project → **SQL Editor**
2. Click **New query**
3. Open `supabase/migrations/schema_full.sql` from this repo
4. Paste the entire file → click **Run**

Done. All 10 tables, all RLS policies, both SQL functions — in one shot.

### 4. Start the servers

**Terminal 1 — Backend:**
```bash
bun dev
```
Starts on `http://localhost:3000`. If `NGROK_AUTHTOKEN` is set, also prints your public tunnel URL.

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```
Dashboard at `http://localhost:5173`.

### 5. Configure Twilio webhook

The backend logs:
```
[ngrok] Twilio webhook: https://xxxx.ngrok-free.app/webhook/whatsapp
```

Set that URL in Twilio:
**Console → Messaging → Try WhatsApp → Sandbox Settings → "When a message comes in"**

### 6. Create your caregiver account

1. Open `http://localhost:5173`
2. Sign up with email — check your email for the Supabase magic link
3. The app will walk you through linking your VI user's WhatsApp number

---

## Running with Docker

Docker bundles backend + built frontend into a single image. Redis is included.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- `.env` file populated from `.env.example`

### Build and run

```bash
cp .env.example .env
# (fill in credentials)

docker compose up --build
```

Everything runs at `http://localhost:3000`. Redis starts automatically.

### Without Redis (core features only — no batch/cron)

```bash
docker build -t voiceapp \
  --build-arg VITE_API_TOKEN=your_token \
  .
docker run -p 3000:3000 --env-file .env voiceapp
```

---

## Credential Guide

| Variable | Where to get it | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys | Yes |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Yes |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com) → API Keys (free: 1000 searches/mo) | Yes |
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) → Account Info | Yes |
| `TWILIO_AUTH_TOKEN` | [console.twilio.com](https://console.twilio.com) → Account Info | Yes |
| `TWILIO_WHATSAPP_NUMBER` | Use `+14155238886` (sandbox) for local dev | Yes |
| `SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** secret key | Yes |
| `API_BEARER_TOKEN` | Generate: `openssl rand -hex 32` | Yes |
| `NGROK_AUTHTOKEN` | [dashboard.ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken) (free) | Dev only |
| `REDIS_URL` | `redis://localhost:6379` local, or [Upstash](https://upstash.com) free tier | Optional |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` **public** key (frontend only) | Yes |

> **service_role vs anon:** The backend uses `service_role` (bypasses RLS — server-only). The frontend uses `anon` (public key — safe to expose).

---

## Project Structure

```
voice-app/
├── src/
│   ├── server.ts              # Hono entry point, WebSocket upgrade, cron boot
│   ├── agent/
│   │   ├── orchestrator.ts    # Claude agentic loop — 17 tools, up to 10 iterations
│   │   └── sanitiser.ts       # Strip markdown for clean TTS output
│   ├── routes/
│   │   ├── api.ts             # /api/* — voice commands, TTS, dashboard, podcasts
│   │   ├── webhook.ts         # /webhook/whatsapp — Twilio HMAC-verified inbound
│   │   └── auth.ts            # /auth/* — Supabase caregiver sign-in
│   ├── tools/                 # Agent tool implementations
│   │   ├── whatsapp.ts        # ReadMessages, SendMessage, ResolveContact
│   │   ├── contacts.ts        # GetContact, SaveContact, ListContacts, SetPriority
│   │   ├── ambient.ts         # GetLoadShedding, GetWeather, WebSearch (Tavily)
│   │   ├── podcast.ts         # GeneratePodcast, PlayPodcast — two-host TTS stitching
│   │   ├── translation.ts     # ActivateTranslation, TranslateUtterance
│   │   └── navigation.ts      # StartNavigation, DescribeCurrentWaypoint
│   ├── session/
│   │   └── machine.ts         # In-memory state machine — 7 phases, Supabase-backed pending
│   ├── memory/
│   │   ├── store.ts           # Save episodic memories with OpenAI embeddings
│   │   └── recall.ts          # pgvector cosine similarity recall (top-5)
│   ├── tts/
│   │   └── openai-tts.ts      # HTTP path + WebSocket streaming path
│   ├── queue/                 # BullMQ heartbeat worker
│   └── cron/                  # Morning briefing + routine schedulers
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx  # Live view — mic button, orb, real-time chat log
│       │   └── Configure.tsx  # Settings — contacts, podcasts, routines
│       └── store/
│           └── appStore.ts    # Zustand global state + SSE subscription
├── supabase/
│   └── migrations/
│       └── schema_full.sql    # Complete schema — run once in Supabase SQL Editor
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | [Bun](https://bun.sh) 1.2 |
| Backend framework | [Hono](https://hono.dev) |
| AI orchestrator | Claude Sonnet 4.6 (`@anthropic-ai/sdk`) |
| Text-to-speech | OpenAI TTS (`tts-1`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Web search | [Tavily](https://tavily.com) |
| WhatsApp | Twilio |
| Database | Supabase (Postgres + pgvector + Auth + RLS) |
| Frontend | React 19 + Vite + Zustand |
| Queue / cron | BullMQ + Redis (optional) |
| Dev tunnelling | ngrok |
