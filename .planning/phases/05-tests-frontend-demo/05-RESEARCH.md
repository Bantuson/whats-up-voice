# Phase 5: Tests + Frontend + Demo — Research

**Researched:** 2026-03-28
**Domain:** Bun test runner (unit suites), Vite + React 18 SPA, pgvector episodic memory, Hono SSE, demo reliability
**Confidence:** HIGH

---

## Summary

Phase 5 completes the VoiceApp hackathon build across four parallel workstreams: (1) bringing the test suite from 196 passing / 14 failing to 85+ passing with zero failures, (2) wiring episodic memory (OpenAI `text-embedding-3-small` → `memory_store` → `match_memories` RPC injection into system prompt), (3) building a caregiver dashboard in Vite + React 18 fed by Hono SSE, and (4) demo hardening.

The good news: as of 2026-03-28 the project already has 207 tests across 20 files. 196 pass, 14 fail. The 14 failures are in three categories: (a) integration tests that need a live Supabase connection (`schema.test.ts`, `isolation.test.ts`) — these fail because the Supabase schema has not been deployed yet, (b) a `phone.ts` implementation gap (local SA format `0xx` conversion and non-SA `formatPhoneForSpeech` formatting), and (c) `health.test.ts` and a partial `webhookHandler.test.ts` test that needs a running server. The 85+ target requires fixing these 14 failures, not writing 49 new tests. However the ROADMAP specifies 11 named suites that must all be identifiable in the output — some suites exist under different names and need aliasing or consolidation.

The frontend stack (Vite 5 + React 18.3 + Hono `streamSSE`) is a well-understood pattern with no compatibility surprises on this project. The design spec is precise: `#0D0D0D` background, `#00FF88` terminal green, IBM Plex Mono / IBM Plex Sans typography. The 24-bar audio waveform SVG must animate only when session state is `listening` or `playing` — driven by the SSE agent-state event. The heartbeat feed colour-coding (interrupt = green, batch = amber, skip = red) is driven by the SSE heartbeat event stream. No client-side routing library is required for 7 pages — React Router v6 or a simple hash-router is sufficient.

The episodic memory implementation is straightforward: after each completed session (`playing → idle` transition), summarise the exchange, call `openai.embeddings.create({ model: 'text-embedding-3-small', input: summary })`, insert the 1536-dimensional vector into `memory_store`, then on every orchestrator invocation call `supabase.rpc('match_memories', { query_embedding, match_threshold: 0.75, match_count: 5, p_user_id: userId })` and prepend results to the system prompt. The `match_memories` SQL function was already deployed in Phase 1.

**Primary recommendation:** Fix the 14 failing tests first (all have root causes in missing Supabase schema deployment or `phone.ts` logic gaps), then build episodic memory, then the frontend, then run demo rehearsal. The test count goal is already 93% achieved.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | `bun test` passes 85+ test cases across 11 suites: quiet hours, phone normalisation, HMAC verification, heartbeat gate, intent classification, session state machine, cron validation, message log helpers, morning briefing builder, contact save flow, WhatsApp payload parsing | 196/207 tests pass today. 14 failures traced to: schema not deployed (isolation.test.ts, schema.test.ts), phone.ts E.164 local format bug, health/server start issue. Fix these to reach 196+. Add missing "message log helpers" and "WhatsApp payload parsing" suites (~6–10 new cases) to hit 85+ clean. |
| FE-01 | Login page: phone number entry sets userId context | Simple React form, sets userId in state/localStorage. No auth complexity. |
| FE-02 | Setup page: language, location, quiet hours, morning briefing toggle | Form that POSTs to `/api/settings` — backend route needed. React controlled inputs. |
| FE-03 | Dashboard: live agent state panel, 24-bar waveform SVG, voice command simulator | SSE subscription to `/api/sse/agent-state`; animated SVG bars driven by session state field in event; text input → POST `/api/voice/command` with Bearer token. |
| FE-04 | Heartbeat feed: live log with colour coding (interrupt=green, batch=amber, skip=red) | SSE subscription to `/api/sse/heartbeat`; colour map applied to `decision` field. |
| FE-05 | Contacts page: address book management, priority toggle, manual add | CRUD calls to existing backend contacts endpoints. |
| FE-06 | Routines page: cron routine management with human-readable labels | Read `/api/routines`; human-readable cron label helper (e.g. "0 7 * * 1-5" → "Weekdays at 7am"). |
| FE-07 | Log page: message history, heartbeat audit, memory schema viewer | Read-only fetches from `/api/messages`, `/api/heartbeat-log`, `/api/memories`. |
| FE-08 | Design: dark `#0D0D0D` background, terminal green `#00FF88` accents, IBM Plex Mono for data, IBM Plex Sans for prose | CSS custom properties; Google Fonts or Bunny Fonts for IBM Plex families. |
| MEM-01 | Interaction summaries written to `memory_store` after each completed session with OpenAI `text-embedding-3-small` embeddings | Hook into `playing → idle` transition. Generate summary. Call embeddings API. Insert to `memory_store`. |
| MEM-02 | `match_memories` RPC called via `supabase.rpc()` with `p_threshold = 0.75`, top-5 results | Already deployed in Phase 1. Call pattern: `supabase.rpc('match_memories', { query_embedding, match_threshold: 0.75, match_count: 5, p_user_id: userId })`. |
| MEM-03 | Top-5 memory snippets injected into orchestrator system prompt on every invocation | Modify `orchestrator.ts` system prompt builder: prepend memory context block before user instruction. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.10 (installed) | Test runner (`bun test`), runtime | Built-in test runner with `describe`/`test`/`expect`; `mock.module()` for ES module mocking; no separate Jest install needed |
| Vite | 5.x (5.4.x latest stable) | Frontend build tool | Instant HMR, native ES modules, first-class React 18 support via `@vitejs/plugin-react` |
| React | 18.3.1 | Frontend UI library | Locked by project decision; hooks-based, concurrent mode, stable as of 2024 |
| react-dom | 18.3.1 | React DOM renderer | Paired with React 18.3.1 |
| @vitejs/plugin-react | 4.x (4.3.x) | React Fast Refresh in Vite | Official plugin; uses Babel transforms for React |
| openai | 6.33.0 (installed) | text-embedding-3-small embeddings | Already in project; `client.embeddings.create()` API |
| @supabase/supabase-js | 2.100.1 (installed) | `match_memories` RPC, `memory_store` inserts | Already in project; `.rpc()` pattern locked |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-router-dom | 6.x | Client-side routing (7 pages) | Single app with Login, Setup, Dashboard, Feed, Contacts, Routines, Log pages |
| zustand | 5.0.x | Lightweight client state (userId context, session state) | Simpler than Redux for small SPA; SSE-driven state updates |
| @types/react | 18.3.28 | TypeScript types for React 18 | Dev dependency |
| @types/react-dom | 18.3.x | TypeScript types for ReactDOM | Dev dependency |
| typescript | 5.x | Type checking in frontend | Already a project peer dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vite | Create React App | CRA is deprecated; Vite is the community standard since 2023 |
| react-router-dom | TanStack Router | Overkill for 7 static pages in a hackathon demo |
| zustand | React Context + useReducer | Context causes full re-render on every SSE event; zustand's selector pattern avoids this |
| Google Fonts | Local font files | Google Fonts CDN is simplest for hackathon; local files add build complexity |

### Installation

```bash
# From voice-app root — frontend scaffolded in ./frontend/
bun create vite frontend --template react-ts
cd frontend
bun add react-router-dom zustand
bun add -d @types/react @types/react-dom
```

**Note:** The Vite frontend is a separate directory (`./frontend/`) from the Hono backend. It runs on port 5173 in development; in demo it can be served statically via Hono `serveStatic` from `'hono/bun'`.

---

## Architecture Patterns

### Recommended Project Structure

```
voice-app/
├── src/                     # Hono backend (existing)
│   ├── routes/
│   │   ├── api.ts           # Add /api/sse/agent-state, /api/sse/heartbeat SSE endpoints
│   │   └── ...
│   ├── memory/              # NEW: episodic memory module
│   │   ├── embed.ts         # generateEmbedding(text) → number[]
│   │   ├── store.ts         # storeMemory(userId, summary, embedding) → void
│   │   └── recall.ts        # recallMemories(userId, query) → MemoryRow[]
│   └── agent/
│       └── orchestrator.ts  # MODIFY: inject memories into system prompt
├── frontend/                # NEW: Vite + React 18 SPA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Setup.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── HeartbeatFeed.tsx
│   │   │   ├── Contacts.tsx
│   │   │   ├── Routines.tsx
│   │   │   └── Log.tsx
│   │   ├── components/
│   │   │   ├── Waveform.tsx  # 24-bar SVG, animated by session state
│   │   │   ├── SSEProvider.tsx  # wraps EventSource, dispatches events
│   │   │   └── HeartbeatRow.tsx
│   │   ├── store/
│   │   │   └── appStore.ts   # zustand store: userId, sessionState, heartbeatLog
│   │   └── App.tsx
│   ├── index.html
│   └── vite.config.ts
└── tests/                   # Existing bun test suites
    └── memory.test.ts        # NEW: episodic memory unit tests
```

### Pattern 1: Hono SSE Push

**What:** Backend emits `text/event-stream` events when agent state or heartbeat decisions change. Frontend subscribes with `EventSource`.

**When to use:** Any read-only real-time view. Never for bidirectional control.

```typescript
// Source: https://hono.dev/docs/helpers/streaming
import { streamSSE } from 'hono/streaming'

// In api.ts router
app.get('/api/sse/heartbeat', bearerAuth({ token: env.API_BEARER_TOKEN }), (c) => {
  return streamSSE(c, async (stream) => {
    // Subscribe to heartbeat events (internal pub/sub or polling)
    const listener = (event: HeartbeatEvent) => {
      stream.writeSSE({
        event: 'heartbeat',
        data: JSON.stringify(event),
        id: event.id,
      })
    }
    heartbeatEmitter.on('decision', listener)
    // Keep alive with periodic ping
    while (true) {
      await stream.sleep(30_000)
      await stream.writeSSE({ event: 'ping', data: 'keep-alive' })
    }
    // Cleanup on disconnect
    heartbeatEmitter.off('decision', listener)
  })
})
```

**SSE event types for dashboard:**
- `agent-state`: `{ userId, phase, timestamp }` — triggers waveform animation
- `heartbeat`: `{ id, userId, decision, from_phone, body_preview, timestamp }` — colour-coded row in feed

**Internal pub/sub:** Use Node.js `EventEmitter` (built into Bun) to bridge heartbeat worker decisions and SSE streams without adding a new dependency. A module-level singleton `heartbeatEmitter = new EventEmitter()` in `src/events/emitter.ts` lets the worker emit events that all active SSE streams consume.

### Pattern 2: React SSE Subscription with useEffect

**What:** `EventSource` API subscribed in a component or store initialiser.

```typescript
// Source: MDN EventSource API
// frontend/src/store/appStore.ts
import { create } from 'zustand'

interface AppStore {
  heartbeatLog: HeartbeatEvent[]
  sessionPhase: string
  subscribeToSSE: (token: string) => () => void
}

export const useAppStore = create<AppStore>((set) => ({
  heartbeatLog: [],
  sessionPhase: 'idle',
  subscribeToSSE: (token) => {
    // EventSource doesn't support custom headers — pass token in URL query param
    const es = new EventSource(`/api/sse/heartbeat?token=${token}`)
    es.addEventListener('heartbeat', (e) => {
      const event = JSON.parse(e.data)
      set((s) => ({ heartbeatLog: [event, ...s.heartbeatLog].slice(0, 100) }))
    })
    es.addEventListener('agent-state', (e) => {
      const { phase } = JSON.parse(e.data)
      set({ sessionPhase: phase })
    })
    return () => es.close()
  },
}))
```

**SSE auth note:** `EventSource` does not support the `Authorization` header. Options: (1) pass token as URL query parameter and validate in handler, (2) use a cookie, (3) use a short-lived one-time token. For hackathon: query parameter is simplest.

### Pattern 3: 24-Bar Audio Waveform SVG

**What:** Pure SVG component with CSS animation — no canvas, no audio analysis library.

```typescript
// frontend/src/components/Waveform.tsx
const BAR_COUNT = 24
const ACTIVE_PHASES = ['listening', 'playing']

export function Waveform({ phase }: { phase: string }) {
  const isActive = ACTIVE_PHASES.includes(phase)
  return (
    <svg width="120" height="32" aria-label={isActive ? 'Audio active' : 'Audio idle'}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <rect
          key={i}
          x={i * 5}
          y={isActive ? 0 : 12}
          width={3}
          height={isActive ? 32 : 8}
          fill="#00FF88"
          style={{
            transition: 'height 0.1s ease, y 0.1s ease',
            animationDelay: `${(i * 50) % 400}ms`,
            animation: isActive ? 'waveBar 0.6s ease-in-out infinite alternate' : 'none',
          }}
        />
      ))}
    </svg>
  )
}
```

```css
@keyframes waveBar {
  0%   { height: 4px; }
  100% { height: 32px; }
}
```

**Gotcha:** Each bar needs a different `animation-delay` to create a wave effect, not synchronised pulsing. Use `(i * 50) % 400` for a rolling pattern across 24 bars.

### Pattern 4: Episodic Memory Module

**What:** After each session completes (`playing → idle`), generate a text summary of the exchange, embed it, and store it. On each orchestrator call, recall similar memories and prepend to system prompt.

```typescript
// src/memory/embed.ts
import { openai } from '../clients/openai'

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding  // 1536 dimensions
}
```

```typescript
// src/memory/store.ts
import { supabase } from '../db/client'

export async function storeMemory(userId: string, summary: string, embedding: number[]): Promise<void> {
  const { error } = await supabase
    .from('memory_store')
    .insert({ user_id: userId, content: summary, embedding })
  if (error) throw error
}
```

```typescript
// src/memory/recall.ts
import { generateEmbedding } from './embed'
import { supabase } from '../db/client'

export async function recallMemories(userId: string, query: string, topK = 5) {
  const embedding = await generateEmbedding(query)
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

**Session summary generation:** After `playing → idle`, call the orchestrator with a summarisation prompt: "Summarise this session in 2–3 sentences as a factual memory entry." The result is the text to embed.

### Anti-Patterns to Avoid

- **SSE with polling fallback:** Hono `streamSSE` is native HTTP/2 streaming — do not add Socket.IO or a polling loop. The browser `EventSource` automatically reconnects on disconnect.
- **Canvas for waveform:** Canvas requires `requestAnimationFrame` loops and is harder to test. Pure SVG + CSS animation is sufficient for a 24-bar visualisation and is accessible (aria-label).
- **Running Vite dev server on the same port as Hono:** In dev, configure Vite proxy in `vite.config.ts` to forward `/api/*` and `/ws/*` to `localhost:3000`. In demo, serve the built Vite dist via Hono `serveStatic`.
- **Storing embeddings as JSON strings:** The `memory_store.embedding` column is `vector(1536)` — pass a JavaScript `number[]` directly to the Supabase client; it serialises correctly to the pgvector wire format.
- **Using `bun test --watch` for CI gate:** The `bun test` command (no flags) is the correct test gate. `--watch` is dev-only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE client reconnection | Custom retry loop | `EventSource` built-in | Browser EventSource reconnects automatically with `retry:` field from server |
| Frontend state management | Global `window` variables | zustand | SSE events arrive outside React lifecycle; zustand store updates trigger proper re-renders |
| Cron label formatting | Custom cron parser | Simple lookup map | Only 3 patterns in use: `0 7 * * 1-5`, `0 18 * * *`, custom. Map 2 known patterns; fallback to raw string |
| Vector similarity | Raw SQL `<=>` via Supabase client | `supabase.rpc('match_memories', ...)` | PostgREST cannot use vector operators — SQL function already deployed in Phase 1 |
| ES module mocking in Bun | Dynamic require() tricks | `mock.module()` from `bun:test` | Bun 1.3.x has native module mock hoisting — use it |
| Waveform audio analysis | Web Audio API + FFT | CSS animation on SVG bars | Dashboard shows state indicator, not real audio waveform — pure CSS is correct |

---

## Test Suite Gap Analysis

### Current State (2026-03-28)

- **Total tests:** 207 across 20 files
- **Passing:** 196
- **Failing:** 14 (all have known root causes)
- **Target:** 85+ passing, 0 failing

### The 14 Failures — Root Causes and Fixes

| Test File | Failing Tests | Root Cause | Fix Required |
|-----------|--------------|------------|-------------|
| `isolation.test.ts` | 7 tests (all) | Supabase schema not deployed — live DB queries fail | Deploy schema (Phase 1 prerequisite) OR convert to mocked unit tests |
| `schema.test.ts` | 2 tests | Same — `match_memories` and `resolve_contact_name` RPCs not callable without schema | Same as above |
| `health.test.ts` | 2 tests | Server not started in test process — `/health` returns nothing | Add server startup in test setup OR mock the server for route tests |
| `phone.test.ts` | 2 tests | `normaliseE164('0821234567')` → SA local format conversion not implemented; `formatPhoneForSpeech` non-SA case | Fix `phone.ts` logic for `0x` prefix → `+27x` |
| `webhookHandler.test.ts` | 1 test | HMAC verification failing — likely env var `WHATSAPP_APP_SECRET` not set in test env | Set test env var or mock hmac module in that test |

**Strategy for 85+ goal:** Fix the 14 failures → reach 207 pass, 0 fail (already above 85). The ROADMAP requires 11 named suites to be identifiable in `bun test` output. Map existing test files to required suite names:

| Required Suite Name | Existing Test File | Status |
|--------------------|-------------------|--------|
| quiet hours | `quietHours.test.ts` | Passing |
| phone normalisation | `phone.test.ts` | 2 fixes needed |
| HMAC verification | `hubVerification.test.ts`, `webhookHandler.test.ts` | Mostly passing |
| heartbeat gate | `heartbeat.test.ts` | Passing |
| intent classification | `classifier.test.ts` | Passing |
| session state machine | `session.test.ts` | Passing |
| cron validation | `cron.test.ts` | Passing |
| message log helpers | **MISSING** | New suite needed |
| morning briefing builder | `cron.test.ts` (describe block) | Passing |
| contact save flow | `contacts.test.ts` | Passing |
| WhatsApp payload parsing | `webhook.test.ts`, `webhookHandler.test.ts` | Partially passing |

**Gap:** "message log helpers" suite does not exist. Needs ~5–8 tests covering `message_log` insert shape validation, `direction` enum values (`in`/`out`), and the `to_phone` `+${WHATSAPP_PHONE_NUMBER_ID}` construction.

**Current test count with all fixes:** 207 passing (above 85 target). Adding message log helpers brings total to ~215.

---

## Common Pitfalls

### Pitfall 1: EventSource Cannot Send Authorization Header

**What goes wrong:** Browser `EventSource` does not support custom headers. A `new EventSource('/api/sse/heartbeat', { headers: { Authorization: ... } })` silently ignores the header.

**Why it happens:** EventSource API predates the Fetch API. It uses a GET request with no custom header support in browsers.

**How to avoid:** Pass the bearer token as a query parameter (`?token=...`) and validate it in the Hono SSE handler. For production: use a short-lived SSE token endpoint. For hackathon: query parameter is acceptable.

**Warning signs:** SSE connection returns 401 even though you added the `Authorization` header in the EventSource constructor.

### Pitfall 2: Bun mock.module() Must Be Called Before Production Imports

**What goes wrong:** Mocking a module after importing the production module has no effect — the real module is already bound.

**Why it happens:** Bun 1.3.x hoists `mock.module()` calls in test files but only before the first production import. If the import appears before the mock, the mock is too late.

**How to avoid:** Always place all `mock.module()` calls at the top of the test file, before any `import` from production code. See the established pattern in `cron.test.ts` and `orchestrator.test.ts`.

**Warning signs:** Test calls mock but production function still executes (you see actual Redis/Supabase connection attempts in test output).

### Pitfall 3: isolation.test.ts and schema.test.ts Require Live Supabase

**What goes wrong:** These tests make real RPC calls to Supabase. Without the schema deployed and credentials in the test environment, they fail with empty/unexpected results.

**Why it happens:** These are intentional integration tests that validate the deployed schema, not unit tests.

**How to avoid:** Two options: (a) deploy the Supabase schema and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the test environment before running, or (b) convert to mocked unit tests that verify the query structure without a live connection. For the 85+ target, option (a) is the correct path — the schema should already be deployed.

**Warning signs:** `error: expect(received).toBe(expected) — Expected: true, Received: false` on `Array.isArray(data)`.

### Pitfall 4: pgvector embedding dimension mismatch

**What goes wrong:** If any call to `openai.embeddings.create` uses a `dimensions` parameter or a different model, the stored vector has a different dimension than the `vector(1536)` column type, causing an insert error.

**Why it happens:** The `memory_store.embedding` column is typed as `vector(1536)`. Passing a vector of any other length throws a PostgreSQL dimension mismatch error.

**How to avoid:** Never pass `dimensions` to `openai.embeddings.create` for this model. `text-embedding-3-small` defaults to 1536. Add a runtime assertion: `if (embedding.length !== 1536) throw new Error(...)`.

**Warning signs:** `ERROR: expected 1536 dimensions, not X` from Supabase insert.

### Pitfall 5: Vite proxy not configured for API calls in development

**What goes wrong:** Frontend on port 5173 calls `/api/sse/heartbeat` — browser blocks it as CORS violation because the Hono backend is on port 3000.

**Why it happens:** In development, Vite and Hono run on different ports.

**How to avoid:** Add a proxy in `vite.config.ts`:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    }
  }
})
```

**Warning signs:** 404 or CORS errors on `/api/*` calls from the React app in development.

### Pitfall 6: SSE connection drops when Hono server is behind Bun's HTTP/1.1

**What goes wrong:** Some reverse proxies (nginx default config, some hosting platforms) buffer SSE responses and the client never receives events.

**Why it happens:** SSE requires `Transfer-Encoding: chunked` or HTTP/2. Buffering proxies hold chunks.

**How to avoid:** For demo: run Hono directly (no proxy). Set `Cache-Control: no-cache` and `X-Accel-Buffering: no` headers in the SSE response. Hono `streamSSE` sets `Content-Type: text/event-stream` and `Cache-Control: no-cache` automatically.

---

## Code Examples

### Session-Triggered Memory Store (MEM-01)

```typescript
// Source: Architecture patterns above + openai SDK v6 docs
// Called in src/session/machine.ts when phase transitions playing → idle

import { generateEmbedding } from '../memory/embed'
import { storeMemory } from '../memory/store'
import { getAnthropic } from '../agent/orchestrator'

export async function onSessionComplete(userId: string, transcript: string, agentResponse: string): Promise<void> {
  try {
    const client = getAnthropic()
    const summaryMsg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Summarise this voice interaction as a 2-sentence factual memory entry.\nUser said: "${transcript}"\nAgent responded: "${agentResponse}"`
      }]
    })
    const summary = (summaryMsg.content[0] as { text: string }).text
    const embedding = await generateEmbedding(summary)
    await storeMemory(userId, summary, embedding)
  } catch (err) {
    // Memory store failure must not block session completion
    console.error('[memory] storeMemory failed:', err)
  }
}
```

### Memory Injection in Orchestrator (MEM-03)

```typescript
// src/agent/orchestrator.ts — modify buildSystemPrompt()
import { recallMemories } from '../memory/recall'

export async function buildSystemPromptWithMemory(userId: string, transcript: string): Promise<string> {
  const memories = await recallMemories(userId, transcript)
  const memoryBlock = memories.length > 0
    ? `\n\nRelevant memories from past sessions:\n${memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}\n\n`
    : ''
  return `${BASE_SYSTEM_PROMPT}${memoryBlock}`
}
```

### Hono SSE Agent State Endpoint

```typescript
// src/routes/api.ts — add SSE endpoints
import { streamSSE } from 'hono/streaming'
import { agentStateEmitter } from '../events/emitter'

router.get('/sse/agent-state', (c) => {
  // Token validation: query param for EventSource compatibility
  const token = c.req.query('token')
  if (token !== process.env.API_BEARER_TOKEN) return c.json({ error: 'Unauthorized' }, 401)

  return streamSSE(c, async (stream) => {
    const handler = (event: { userId: string; phase: string }) => {
      stream.writeSSE({ event: 'agent-state', data: JSON.stringify(event) })
    }
    agentStateEmitter.on('phase-change', handler)
    try {
      while (true) await stream.sleep(30_000)
    } finally {
      agentStateEmitter.off('phase-change', handler)
    }
  })
})
```

### React SSE Subscription with Cleanup

```typescript
// frontend/src/pages/Dashboard.tsx
import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

export function Dashboard() {
  const { sessionPhase, subscribeToSSE } = useAppStore()
  const token = localStorage.getItem('bearerToken') ?? ''

  useEffect(() => {
    const cleanup = subscribeToSSE(token)
    return cleanup  // EventSource.close() on unmount
  }, [token])

  return (
    <div className="dashboard">
      <Waveform phase={sessionPhase} />
      {/* ... */}
    </div>
  )
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App | Vite 5 | 2022–2023 | CRA deprecated; Vite is the standard scaffolding tool |
| React 17 (no concurrent mode) | React 18.3 | 2022 (React 18.0) | `useTransition`, `useDeferredValue` available; Suspense improvements; no immediate impact for this SPA |
| Socket.IO for SSE | Hono `streamSSE` | 2023 | Native HTTP streaming; no dependency |
| `elevenlabs` npm package | `@elevenlabs/elevenlabs-js` | Early 2026 | Old package deprecated; already using correct package |
| `eleven_turbo_v2_5` | `eleven_flash_v2_5` | Early 2026 | Turbo deprecated; already locked in project |

**Deprecated/outdated:**
- `react-scripts` (Create React App): deprecated 2023, do not use
- `eleven_turbo_v2_5`: deprecated early 2026, already locked out in STACK.md
- `@anthropic-ai/claude-agent-sdk`: this project uses `@anthropic-ai/sdk` (the general client) with manual orchestrator — do not switch

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Test runner, runtime | Yes | 1.3.10 | — |
| Node.js | npm version checks | Yes | 22.17.0 | — |
| npm / npx | Vite scaffolding | Yes | 10.9.2 | — |
| Supabase schema | isolation.test.ts, schema.test.ts | **Unverified** | — | Convert tests to mocked units (fallback) |
| Redis | BullMQ worker tests | Unverified (not probed) | — | Tests that mock BullMQ pass regardless |
| IBM Plex Mono font | FE-08 design | CDN (Google Fonts) | — | System monospace fallback |
| IBM Plex Sans font | FE-08 design | CDN (Google Fonts) | — | System sans-serif fallback |

**Missing dependencies with no fallback:**
- Supabase schema deployed — required for `isolation.test.ts` and `schema.test.ts` to pass green. The Phase 1 plan covered schema deployment. If this is already done, these tests will pass once credentials are in the test environment.

**Missing dependencies with fallback:**
- IBM Plex fonts via Google Fonts CDN — fallback to system fonts if CDN is unreachable at demo time. Load fonts locally from npm `@fontsource/ibm-plex-mono` and `@fontsource/ibm-plex-sans` for offline demo safety.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bun 1.3.10 built-in test runner (`bun:test`) |
| Config file | None (Bun auto-discovers `tests/*.test.ts`) |
| Quick run command | `bun test tests/quietHours.test.ts tests/phone.test.ts tests/classifier.test.ts tests/session.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 (quiet hours) | `isQuietHours` overnight range, daytime range, edge cases | unit | `bun test tests/quietHours.test.ts` | Yes |
| TEST-01 (phone normalisation) | `normaliseE164` + `formatPhoneForSpeech` all formats | unit | `bun test tests/phone.test.ts` | Yes (2 fixes needed) |
| TEST-01 (HMAC verification) | Valid sig, tampered body, missing header | unit | `bun test tests/hubVerification.test.ts tests/webhookHandler.test.ts` | Yes |
| TEST-01 (heartbeat gate) | All 6 decision paths | unit | `bun test tests/heartbeat.test.ts` | Yes |
| TEST-01 (intent classification) | All 8 fast-path patterns + null fallthrough | unit | `bun test tests/classifier.test.ts` | Yes |
| TEST-01 (session state machine) | Valid + invalid transitions | unit | `bun test tests/session.test.ts` | Yes |
| TEST-01 (cron validation) | Double-fire protection | unit | `bun test tests/cron.test.ts` | Yes |
| TEST-01 (message log helpers) | `message_log` insert shape, direction enum, to_phone format | unit | `bun test tests/messageLog.test.ts` | **No — Wave 0 gap** |
| TEST-01 (morning briefing builder) | Load shedding before weather, priority contacts first | unit | `bun test tests/cron.test.ts` | Yes (in existing cron suite) |
| TEST-01 (contact save flow) | Multi-turn contact creation | unit | `bun test tests/contacts.test.ts` | Yes |
| TEST-01 (WhatsApp payload parsing) | messages vs statuses vs unknown structure | unit | `bun test tests/webhook.test.ts tests/webhookHandler.test.ts` | Yes |
| MEM-01 | Embedding stored in `memory_store` after session | unit (mocked OpenAI + Supabase) | `bun test tests/memory.test.ts` | **No — Wave 0 gap** |
| MEM-02 | `match_memories` RPC returns results above threshold | unit (mocked Supabase RPC) | `bun test tests/memory.test.ts` | **No — Wave 0 gap** |
| MEM-03 | Memory snippets appear in orchestrator system prompt | unit (mocked recall) | `bun test tests/orchestrator.test.ts` | Partial (existing orchestrator tests) |
| FE-01–08 | Frontend pages render, SSE connects, waveform animates | manual | Open `http://localhost:5173` | No (no frontend yet) |
| FE-04 (heartbeat colour coding) | interrupt=green, batch=amber, skip=red rendered | manual | Browser visual inspection | No |
| DEMO | Full end-to-end flow without error | manual e2e | Run demo script | No |

### Nyquist Validation Strategy (per Plan)

**Plan 1 — Test Suite (85+ cases)**

- Sampling per commit: `bun test tests/phone.test.ts tests/hubVerification.test.ts tests/classifier.test.ts`
- Wave gate: `bun test` — full suite, 85+ pass, 0 fail
- Manual verification: inspect `bun test` output for all 11 suite names present in describe blocks

**Plan 2 — Episodic Memory**

- Sampling per commit: `bun test tests/memory.test.ts`
- Wave gate: `bun test` (includes memory tests)
- Manual verification: After a real session, query `SELECT content, embedding IS NOT NULL FROM memory_store WHERE user_id = '...' ORDER BY created_at DESC LIMIT 1` — confirm row exists with non-null embedding. Then call `supabase.rpc('match_memories', ...)` with similar query text, confirm top result is returned.

**Plan 3 — Caregiver Dashboard**

- Automated: `bun test` (no frontend unit tests planned — component library adds significant complexity for hackathon scope)
- Wave gate: Manual browser verification
- Manual checklist:
  1. `cd frontend && bun run dev` starts without error on port 5173
  2. Login page accepts phone number and sets userId in localStorage
  3. Dashboard page loads and shows "idle" state
  4. Send a WhatsApp message to the demo number — heartbeat feed entry appears within 2 seconds with correct colour
  5. Trigger a voice command — waveform activates (bars animate) when session enters `listening`, deactivates when returns to `idle`
  6. Contacts page loads contact list
  7. Routines page shows human-readable cron labels

**Plan 4 — Demo Polish + Pre-Demo Checklist**

- Automated: `bun test` (full suite green)
- Manual: Run complete demo script end-to-end at least once:
  1. Real WhatsApp message received from test phone
  2. Heartbeat decision fires as `interrupt`
  3. TTS audio plays via WebSocket
  4. Voice compose reply recorded
  5. Approval loop: agent reads back message, user says "yes"
  6. Message sent — `message_log` has `direction=out` row
  7. Trigger morning briefing manually via BullMQ
  8. Briefing plays: load shedding text before weather text
  9. Memory query: post-session `memory_store` has new row with non-null embedding

### Sampling Rate

- **Per task commit:** `bun test tests/phone.test.ts tests/classifier.test.ts tests/session.test.ts` (fast, <5s)
- **Per wave merge:** `bun test` (full suite — all 207+ tests)
- **Phase gate:** Full suite green before demo run

### Wave 0 Gaps

- [ ] `tests/messageLog.test.ts` — covers TEST-01 "message log helpers" suite (~6–8 tests: insert shape, direction enum `in`/`out`, `to_phone` format `+${PHONEID}`)
- [ ] `tests/memory.test.ts` — covers MEM-01 (embedding generated and stored), MEM-02 (recall returns above-threshold results), MEM-03 (memories injected into system prompt). Requires mocking `openai.embeddings.create` and `supabase.rpc`.
- [ ] Fix `src/lib/phone.ts` — `normaliseE164('0821234567')` should return `+27821234567` (local SA `0x` → `+27x` conversion), and `formatPhoneForSpeech('+447700900000')` should return `4 4 7 7 0 0 9 0 0 0 0 0`.
- [ ] Fix `tests/health.test.ts` — 2 failing tests need server running; ensure test setup starts the Hono server or mocks the Hono app directly.
- [ ] Fix `tests/webhookHandler.test.ts` — 1 failing HMAC test; ensure `WHATSAPP_APP_SECRET` is set in test env or the HMAC module is mocked.
- [ ] Deploy Supabase schema — `isolation.test.ts` and `schema.test.ts` (9 failing tests total) require live DB. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in test environment `.env.test`.

---

## Open Questions

1. **Is the Supabase schema deployed to the target instance?**
   - What we know: `isolation.test.ts` and `schema.test.ts` are failing. These are live integration tests.
   - What's unclear: Whether the schema migrations in `supabase/migrations/` have been applied to the demo Supabase project.
   - Recommendation: Run `supabase db push` or apply migrations manually before Plan 1 begins. These 9 tests will then pass without code changes.

2. **Where does the frontend live relative to the Hono server at demo time?**
   - What we know: Vite dev server runs on 5173; Hono on 3000. For demo, they need to be co-located or cross-origin CORS must be set.
   - What's unclear: Whether the demo will use `bun run dev` (two processes) or a production build served by Hono `serveStatic`.
   - Recommendation: For demo simplicity, build the Vite app (`bun run build`), then serve `frontend/dist` from Hono using `serveStatic` from `'hono/bun'`. Single process, single port, no CORS issue.

3. **What session events trigger memory storage?**
   - What we know: MEM-01 says "after each completed session." The session machine has `playing → idle` as the completion transition.
   - What's unclear: Not every `playing → idle` transition represents a meaningful memory (e.g., a cancelled flow or a one-word confirmation might not be worth storing).
   - Recommendation: Store memory only when the agent produced a substantive response (spoken text length > 50 characters) and the intent was not `confirm_send` or `cancel`.

4. **How should the `formatPhoneForSpeech` bug be fixed for non-SA numbers?**
   - What we know: The test expects `formatPhoneForSpeech('+447700900000')` → `'4 4 7 7 0 0 9 0 0 0 0 0'`. The current implementation may be returning `+4 4 7...` (with the + sign) or stripping the + but not converting correctly.
   - Recommendation: Strip the leading `+`, then space-join all digits: `input.replace(/^\+/, '').split('').join(' ')`.

---

## Sources

### Primary (HIGH confidence)

- Bun 1.3.10 test runner API (describe, test, mock.module): https://bun.sh/docs/cli/test
- Hono streaming SSE (streamSSE): https://hono.dev/docs/helpers/streaming
- OpenAI SDK v6 embeddings.create: https://platform.openai.com/docs/api-reference/embeddings
- Supabase pgvector match_memories RPC pattern: https://supabase.com/docs/guides/ai/semantic-search
- Vite 5 React TypeScript setup: https://vitejs.dev/guide/
- React 18.3 latest: https://npmjs.com/package/react (verified 18.3.1)
- @vitejs/plugin-react latest: https://npmjs.com/package/@vitejs/plugin-react (verified 6.0.1)
- zustand 5.0.12 latest: https://npmjs.com/package/zustand (verified via npm view)

### Secondary (MEDIUM confidence)

- EventSource API and header limitation: MDN Web Docs (well-established browser standard)
- IBM Plex Mono / IBM Plex Sans via @fontsource: https://fontsource.org/fonts/ibm-plex-mono

### Tertiary (LOW confidence — needs validation at run time)

- Supabase schema deployment status: unverified — requires checking actual Supabase project dashboard

---

## Metadata

**Confidence breakdown:**
- Test suite gap analysis: HIGH — based on direct `bun test` run (207 tests, 196 pass, 14 fail), file inspection, and failure message analysis
- Standard stack: HIGH — versions verified via `npm view`, package.json inspection, and project STACK.md
- Architecture: HIGH — SSE pattern verified against Hono docs; pgvector pattern from Phase 1 research (already locked)
- Frontend: HIGH — Vite + React 18 is a well-documented standard stack; versions confirmed
- Episodic memory: HIGH — pattern follows ARCHITECTURE.md with direct code reference to Phase 1 deployed SQL function
- Pitfalls: HIGH — EventSource header limitation is a known browser spec constraint; Bun mock hoisting is documented

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable stack — Vite/React versions move slowly; Bun test API is stable)
