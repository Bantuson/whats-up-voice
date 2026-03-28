# Phase 3: Agent Intelligence - Research

**Researched:** 2026-03-28
**Domain:** Claude tool-use orchestrator, sub-agent pattern, WhatsApp/contact/ambient tools, markdown sanitiser, session approval loop
**Confidence:** HIGH

---

## Summary

Phase 3 wires the existing fast-path classifier (`src/agent/classifier.ts`) and session state machine (`src/session/machine.ts`) into a complete voice command handler. The core pattern is: `POST /api/voice/command` → fast-path regex check → if null, Claude `messages.create` tool-use agentic loop → spoken response → session state transition. Three sub-domains exist: (1) the Claude orchestrator with tool definitions for WhatsApp, Contacts, and Ambient; (2) the approval loop (`composing → awaiting_approval → idle/playing`); and (3) external API wrappers for EskomSePush, OpenWeather, and Tavily.

The critical architectural constraint from prior research is that `@anthropic-ai/sdk` (installed at 0.80.0) uses the **manual tool-use agentic loop** pattern via `client.messages.create()`, NOT `@anthropic-ai/claude-agent-sdk` (`query()` API). These are separate packages. The project uses the former; the prior research ARCHITECTURE.md incorrectly references `@anthropic-ai/claude-agent-sdk` query() syntax. Plans must use `messages.create` with a `while stop_reason === 'tool_use'` loop.

**Primary recommendation:** Build the orchestrator as a manual tool-use loop in `src/agent/orchestrator.ts`. Define tools as typed TypeScript objects. Cap at 10 tool calls with an AbortController on every external API call. Apply markdown sanitiser at the return boundary before any caller can forward output to TTS.

---

## Standard Stack

### Core (all already installed — no new packages needed for Phase 3 logic)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | 0.80.0 (installed) | Claude orchestrator — `client.messages.create` with tools array | Project-locked; installed Phase 1 |
| `@supabase/supabase-js` | 2.100.1 (installed) | DB queries for ReadMessages, ResolveContact, SaveContact, user_contacts | Singleton `supabase` already in `src/db/client.ts` |
| `zod` | 4.3.6 (installed) | Validate `/api/voice/command` request body `{ userId, transcript, sessionId }` | Already in project |
| `hono` | 4.12.9 (installed) | Route handler for `POST /api/voice/command` | Server framework already in use |

### External API Wrappers (new thin wrappers, raw fetch — no new packages)

| Wrapper | API | Auth | Key Env Var |
|---------|-----|------|-------------|
| `src/tools/getLoadShedding.ts` | EskomSePush v2 | `Token` header | `ESKOMSEPUSH_API_KEY` |
| `src/tools/getWeather.ts` | OpenWeather One Call 3.0 | `appid` query param | `OPENWEATHER_API_KEY` |
| `src/tools/webSearch.ts` | Tavily `@tavily/core` | constructor API key | `TAVILY_API_KEY` |

**Tavily requires a new package:**

```bash
bun add @tavily/core
```

All other Phase 3 logic uses already-installed packages. Two new env vars also required: `ESKOMSEPUSH_API_KEY` and `OPENWEATHER_API_KEY`. (Tavily key `TAVILY_API_KEY` already implied by design.)

**Version verification (npm registry, 2026-03-28):**

| Package | Installed | Registry Latest | Status |
|---------|-----------|-----------------|--------|
| `@anthropic-ai/sdk` | 0.80.0 | 0.80.0 | Current |
| `@tavily/core` | not installed | latest | Needs `bun add` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@tavily/core` | Raw fetch to `https://api.tavily.com/search` | SDK adds typed responses; raw fetch is fine too, saves a dep |
| Manual tool loop | `@anthropic-ai/claude-agent-sdk` query() | Agent SDK is separate package not installed; manual loop is simpler for this scope |

---

## Architecture Patterns

### Recommended File Structure for Phase 3

```
src/
├── agent/
│   ├── classifier.ts          # EXISTING — fast-path regex (AGENT-01, AGENT-02)
│   ├── orchestrator.ts        # NEW — Claude tool-use loop, returns spoken string
│   └── sanitiser.ts           # NEW — markdown strip at output boundary (AGENT-07, AGENT-08)
├── tools/
│   ├── whatsapp.ts            # NEW — ReadMessages, SendMessage, ResolveContact tool handlers
│   ├── contacts.ts            # NEW — GetContact, SaveContact, ListContacts, SetPriority handlers
│   └── ambient.ts             # NEW — GetLoadShedding, GetWeather, WebSearch wrappers
├── routes/
│   └── api.ts                 # MODIFY — wire POST /api/voice/command (currently 501 stub)
└── session/
    └── machine.ts             # EXISTING — state machine (used by orchestrator for approval loop)
```

### Pattern 1: Manual Tool-Use Agentic Loop

**What:** `client.messages.create` → check `stop_reason === 'tool_use'` → execute tool → append `tool_result` → repeat until `end_turn`.
**When to use:** All LLM-handled intents that fall through the fast-path classifier.

```typescript
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works
// src/agent/orchestrator.ts

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MAX_TOOL_CALLS = 10

export async function runOrchestrator(
  userId: string,
  transcript: string,
  signal: AbortSignal
): Promise<string> {
  const messages: MessageParam[] = [{ role: 'user', content: transcript }]
  let toolCallCount = 0

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      tools: ALL_TOOLS,
      messages,
    }, { signal })

    // Append assistant turn
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      const raw = textBlock?.text ?? 'I could not process that request.'
      return sanitiseForSpeech(raw)
    }

    if (response.stop_reason !== 'tool_use') break

    // Execute tool calls, collect results
    const toolResults = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      toolCallCount++
      const result = await executeTool(block.name, block.input as Record<string, unknown>, userId, signal)
      toolResults.push({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: JSON.stringify(result),
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return sanitiseForSpeech('I ran into a problem and could not complete that. Please try again.')
}
```

### Pattern 2: Tool Definition Schema

**What:** Each tool is a typed object passed in the `tools` array to `messages.create`.
**When to use:** Define all 9 tools as a static array — no dynamic registration needed.

```typescript
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
// IMPORTANT: 'strict: true' guarantees schema conformance

export const ALL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'ReadMessages',
    description: 'Read the user\'s recent inbound WhatsApp messages. Returns messages with sender name if in contacts.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages to return (default 5)' },
      },
      required: [],
    },
  },
  {
    name: 'SendMessage',
    description: 'Queue an outbound WhatsApp message for approval. Does NOT send immediately — transitions session to awaiting_approval.',
    input_schema: {
      type: 'object',
      properties: {
        toPhone: { type: 'string', description: 'E.164 recipient phone number' },
        toName:  { type: 'string', description: 'Resolved contact name for read-back' },
        body:    { type: 'string', description: 'Message text to send' },
      },
      required: ['toPhone', 'body'],
    },
  },
  {
    name: 'ResolveContact',
    description: 'Resolve a spoken name like "Naledi" or "my wife" to an E.164 phone number via user_contacts.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or alias to look up' },
      },
      required: ['name'],
    },
  },
  // ... GetContact, SaveContact, ListContacts, SetPriority, GetLoadShedding, GetWeather, WebSearch
]
```

### Pattern 3: AbortController Timeout on Every External API Call

**What:** Wrap all external HTTP requests with `AbortSignal.timeout(5000)`.
**When to use:** All tool handler functions that make HTTP requests (EskomSePush, OpenWeather, Tavily, WhatsApp Cloud API).

```typescript
// Pattern for every external API wrapper
export async function getLoadShedding(areaId: string): Promise<string> {
  const signal = AbortSignal.timeout(5000)
  const res = await fetch(
    `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`,
    {
      headers: { Token: process.env.ESKOMSEPUSH_API_KEY! },
      signal,
    }
  )
  if (!res.ok) throw new Error(`EskomSePush ${res.status}`)
  const data = await res.json()
  return formatLoadSheddingResponse(data)
}
```

### Pattern 4: POST /api/voice/command Handler

**What:** The Hono route that drives fast-path → LLM → session transition → return.
**When to use:** This is the primary entry point for all Phase 3 voice commands (VOICE-01 scaffold lands here).

```typescript
// src/routes/api.ts — replaces 501 stub
apiRouter.post('/voice/command', bearerAuth, async (c) => {
  const { userId, transcript, sessionId } = await c.req.json()

  // Fast-path: < 1ms, no LLM
  const fastIntent = classifyIntent(transcript.trim())
  if (fastIntent === 'confirm_send') {
    return handleConfirmSend(c, userId)
  }
  if (fastIntent === 'cancel') {
    return handleCancel(c, userId)
  }
  if (fastIntent === 'read_messages') {
    const spoken = await readMessagesForUser(userId)
    return c.json({ spoken, action: 'read', requiresConfirmation: false })
  }

  // LLM path: orchestrator with 5s timeout
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const spoken = await runOrchestrator(userId, transcript, controller.signal)
    return c.json({ spoken, action: 'agent', requiresConfirmation: false })
  } finally {
    clearTimeout(timer)
  }
})
```

### Pattern 5: Markdown Sanitiser

**What:** Strip all markdown characters from agent output before returning to caller.
**When to use:** Applied at the `orchestrator.ts` return boundary — sanitiseForSpeech() is called on every code path that returns a spoken string.

```typescript
// src/agent/sanitiser.ts (AGENT-07, AGENT-08)
// Source: requirements state no *, #, ` in output strings

const MD_PATTERNS: RegExp[] = [
  /\*{1,3}([^*]+)\*{1,3}/g,   // **bold**, *italic*, ***both***
  /#{1,6}\s/g,                  // ## headers
  /^[-*+]\s/gm,                 // - bullet points at line start
  /`{1,3}[^`]*`{1,3}/g,        // `code` and ```blocks```
  /\[([^\]]+)\]\([^)]+\)/g,    // [link text](url) → link text
  /^\s*>\s/gm,                  // > blockquotes
]

export function sanitiseForSpeech(text: string): string {
  let out = text
  for (const pattern of MD_PATTERNS) {
    out = out.replace(pattern, (_match, p1?: string) => p1 ?? '')
  }
  return out.replace(/\n{2,}/g, ' ').trim()
}
```

### Pattern 6: Approval Loop State Handling

**What:** `SendMessage` tool does not call the WhatsApp API directly. It stores a pending message in the session and transitions state to `awaiting_approval`. A subsequent `confirm_send` fast-path call sends the actual message.
**When to use:** All outbound message flows (AGENT-04, AGENT-05).

```typescript
// In the SendMessage tool handler — src/tools/whatsapp.ts
export async function toolSendMessage(
  userId: string,
  toPhone: string,
  body: string,
  toName?: string,
): Promise<{ queued: true; readBack: string }> {
  // Store pending message — do NOT call WhatsApp API yet
  transition(userId, 'composing')
  setPendingMessage(userId, { to: toPhone, toName, body })
  transition(userId, 'awaiting_approval')

  const name = toName ?? formatPhoneForSpeech(toPhone)
  return {
    queued: true,
    readBack: `Ready to send to ${name}: "${body}". Say yes to confirm, or no to cancel.`,
  }
}
```

### Pattern 7: Three-Strike No-Match Reset

**What:** When session is `awaiting_approval` and input matches neither `confirm_send` nor `cancel` fast-path, increment a counter. After 3 consecutive misses, reset to `idle` and return a `spokenError()`.
**When to use:** In the voice command handler after fast-path classification returns null while session is `awaiting_approval`.

```typescript
// Track no-match count in session state (extend SessionState if needed)
// or use a separate in-process Map<userId, number>

const noMatchCounts = new Map<string, number>()

function handleNoMatchDuringApproval(userId: string): { spoken: string } {
  const count = (noMatchCounts.get(userId) ?? 0) + 1
  noMatchCounts.set(userId, count)
  if (count >= 3) {
    noMatchCounts.delete(userId)
    clearSession(userId)
    return { spoken: "I didn't understand that three times. The pending message has been cancelled." }
  }
  return { spoken: `I didn't catch that. Say yes to confirm, or no to cancel. (${3 - count} attempts left)` }
}
```

### Anti-Patterns to Avoid

- **Wrong SDK import:** Do NOT use `from '@anthropic-ai/claude-agent-sdk'` or call `query()`. The installed package is `@anthropic-ai/sdk` — use `client.messages.create` with a manual tool loop.
- **Sending messages without approval:** The `SendMessage` tool must NEVER call the WhatsApp Cloud API directly. It must transition session to `awaiting_approval` and let the `confirm_send` fast-path handler do the actual send.
- **Markdown in spoken output:** Never return agent text directly to a caller. Always pass through `sanitiseForSpeech()` before the return value leaves `orchestrator.ts`.
- **Raw phone digits in speech:** Any phone number read aloud must be passed through `formatPhoneForSpeech()` (existing `src/lib/phone.ts`). Never concatenate a raw E.164 number into a spoken string.
- **Missing `.eq('user_id', userId)`:** Every Supabase query in tool handlers must include this filter. The service_role key bypasses RLS — app-layer isolation is mandatory (ISO-01).
- **Blocking agentic loop without timeout:** External API calls in tool handlers must use `AbortSignal.timeout(5000)`. Without this, a slow EskomSePush or Tavily response will silently block the request beyond the 3-second ambient latency target.
- **Calling tools more than 10 times:** Cap the `while` loop at `MAX_TOOL_CALLS = 10` and return an error spoken string if reached. This prevents infinite loops and runaway API costs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Web search in tools | Custom Bing/Google scraper | `@tavily/core` TavilyClient | Handles auth, retries, structured results, rate limits |
| Markdown stripping | Nested regex on the fly | `sanitiseForSpeech()` centralised function | If scattered, easy to miss a code path; centralise and test |
| Contact name resolution | Fuzzy string match in TypeScript | `resolve_contact_name` SQL function via `supabase.rpc()` | Already deployed in Phase 1 `002_functions.sql`; handles NULL for unknown phones |
| Phone speech formatting | Inline string split | `formatPhoneForSpeech()` from existing `src/lib/phone.ts` | Already built, tested, handles +27 prefix correctly |
| Session state transitions | Manual object updates | `transition()`, `setPendingMessage()`, `clearSession()` from `src/session/machine.ts` | Already built with transition guards that throw on invalid state |

**Key insight:** Phases 1–2 pre-built the pure-logic foundations. Phase 3 assembles them — almost no new pure-logic modules needed, only the orchestrator wiring and external API wrappers.

---

## External API Details

### EskomSePush v2

- **Base URL:** `https://developer.sepush.co.za/business/2.0/`
- **Auth:** Header `Token: {api_key}` (not Bearer, not query param)
- **Key endpoint:** `GET /area?id={area_id}` — returns events (load shedding slots) for the area
- **Status endpoint:** `GET /status` — returns national loadshedding stage
- **Rate limit:** Varies by subscription tier; free tier 50 calls/day
- **Area ID format:** e.g. `eskde-10-fourwaysext10cityofjohannesburggauteng` — area-specific strings
- **Fallback strategy (per STATE.md open question):** Hardcode Johannesburg area ID (`eskde-10-fourwaysext10`) as default; expose env var `ESKOMSEPUSH_AREA_ID` to override
- **New env var needed:** `ESKOMSEPUSH_API_KEY`

### OpenWeather One Call API 3.0

- **Base URL:** `https://api.openweathermap.org/data/3.0/onecall`
- **Auth:** Query param `appid={api_key}`
- **Key params:** `lat`, `lon`, `exclude=minutely,hourly,alerts` (keep `current` and `daily`)
- **Response:** `current.temp`, `current.weather[0].description`, `daily[0].temp.max/min`
- **Subscription:** "One Call by Call" — 1,000 free calls/day
- **Coordinates strategy:** Derive from user's `user_profile.location` (city string) → hardcode Johannesburg `lat=-26.2041,lon=28.0473` as fallback
- **New env var needed:** `OPENWEATHER_API_KEY`

### Tavily Search API

- **Package:** `@tavily/core`
- **Auth:** Constructor param `{ apiKey: process.env.TAVILY_API_KEY }`
- **Key method:** `client.search(query, { searchDepth: 'basic', maxResults: 3, includeAnswer: true })`
- **Response:** `response.answer` (string) is the summarised answer — ideal for spoken output; `response.results` for individual results
- **Search depth:** Use `'basic'` for speed (ambient target < 3s); `'advanced'` is higher quality but slower
- **New env var needed:** `TAVILY_API_KEY`

### WhatsApp Cloud API (outbound send)

- **Endpoint:** `POST https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages`
- **Auth:** Header `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}`
- **Payload:** `{ messaging_product: 'whatsapp', to: '{E.164}', type: 'text', text: { body: '...' } }`
- **Response:** `{ messages: [{ id: 'wamid.xxx' }] }` — store wamid as `wa_message_id` in `message_log`
- **Direction in message_log:** `out`
- **All env vars already present** in `src/env.ts` (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`)

---

## Common Pitfalls

### Pitfall 1: Wrong Anthropic SDK Import Pattern

**What goes wrong:** Developer writes `import { query } from '@anthropic-ai/claude-agent-sdk'` or similar, which is not installed.
**Why it happens:** Prior ARCHITECTURE.md research doc references the Agent SDK query() API, which is a different package. The installed package is `@anthropic-ai/sdk` v0.80.0.
**How to avoid:** Always import from `'@anthropic-ai/sdk'` — use `new Anthropic()` and `client.messages.create({ tools: [...], ... })`.
**Warning signs:** TypeScript import errors at compile time, `Cannot find module '@anthropic-ai/claude-agent-sdk'`.

### Pitfall 2: Tool Handler Forgets `.eq('user_id', userId)`

**What goes wrong:** A query to `message_log` or `user_contacts` returns all users' data (service_role bypasses RLS).
**Why it happens:** Tool handlers are new code and may not carry the ISO-01 constraint awareness.
**How to avoid:** Every Supabase query in `src/tools/*.ts` must include `.eq('user_id', userId)` as the first filter after `.from().select()`. Add a lint comment at the top of each tool file.
**Warning signs:** Tests that mock Supabase return all rows; isolation tests fail.

### Pitfall 3: SendMessage Tool Calling WhatsApp API Directly

**What goes wrong:** The Claude orchestrator calls `SendMessage` which immediately POSTs to WhatsApp without user confirmation. The approval loop is bypassed.
**Why it happens:** Treating `SendMessage` as a fire-and-forget action rather than a session state transition.
**How to avoid:** `SendMessage` tool handler MUST only: (1) call `setPendingMessage()`, (2) call `transition(userId, 'awaiting_approval')`, (3) return a `readBack` string. The actual WhatsApp POST is done in the `confirm_send` fast-path handler.
**Warning signs:** `message_log` gets `direction='out'` rows before user said "yes".

### Pitfall 4: Markdown in TTS Output

**What goes wrong:** Claude produces `**Ready to send**` or `- Message from Naledi: ...` — ElevenLabs reads asterisks and dashes aloud or they cause garbled speech.
**Why it happens:** Claude defaults to markdown-rich prose in system prompts unless explicitly instructed otherwise. Prompt-only enforcement is unreliable.
**How to avoid:** Two-layer defence: (1) system prompt: "All responses must be spoken-natural prose. Never use markdown, bullet points, asterisks, or hash symbols." (2) `sanitiseForSpeech()` applied unconditionally at orchestrator return boundary.
**Warning signs:** Test assertions on output strings — assert no `*`, `#`, or `` ` `` in the returned string.

### Pitfall 5: Ambient Latency Exceeding 3 Seconds

**What goes wrong:** `GetLoadShedding + GetWeather` sequential calls exceed the 3-second target.
**Why it happens:** Each external API call can take 500ms–2s. Sequential calls compound.
**How to avoid:** For multi-ambient queries, `Promise.all()` the external API calls. For single ambient queries, `AbortSignal.timeout(5000)` caps the worst case. Keep tool call count to 1 for typical ambient intents.
**Warning signs:** Integration tests with real APIs take > 3s wall clock.

### Pitfall 6: No-Match Counter Persisting Across Sessions

**What goes wrong:** After a session reset, the no-match counter retains old state, so the user only gets 2 attempts instead of 3.
**Why it happens:** `noMatchCounts` Map not cleared when `clearSession()` is called.
**How to avoid:** Either integrate the no-match counter into `SessionState` in `machine.ts` (preferred), or ensure the voice command handler calls `noMatchCounts.delete(userId)` whenever session is cleared.
**Warning signs:** Session state tests that sequence confirm_send/cancel/clear fail to reset the counter.

### Pitfall 7: Contact Resolution Case Sensitivity

**What goes wrong:** User says "naledi" (lowercase), but `user_contacts.name` is stored as "Naledi". Exact match fails.
**Why it happens:** Supabase `.eq('name', spokenName)` is case-sensitive by default.
**How to avoid:** Use `.ilike('name', spokenName)` or the existing `resolve_contact_name` SQL function (which should use `ILIKE` internally). Confirm `002_functions.sql` uses case-insensitive match.
**Warning signs:** ResolveContact tool returns null for contacts with capitalised names.

---

## Code Examples

### Complete Tool Execution Dispatcher

```typescript
// src/agent/orchestrator.ts — executeTool dispatcher
// Source: manual pattern based on @anthropic-ai/sdk docs

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  signal: AbortSignal,
): Promise<unknown> {
  switch (name) {
    case 'ReadMessages':
      return toolReadMessages(userId, (input.limit as number) ?? 5)
    case 'SendMessage':
      return toolSendMessage(userId, input.toPhone as string, input.body as string, input.toName as string | undefined)
    case 'ResolveContact':
      return toolResolveContact(userId, input.name as string)
    case 'GetContact':
      return toolGetContact(userId, input.name as string)
    case 'SaveContact':
      return toolSaveContact(userId, input.name as string, input.phone as string)
    case 'ListContacts':
      return toolListContacts(userId)
    case 'SetPriority':
      return toolSetPriority(userId, input.name as string, input.priority as boolean)
    case 'GetLoadShedding':
      return toolGetLoadShedding(signal)
    case 'GetWeather':
      return toolGetWeather(signal)
    case 'WebSearch':
      return toolWebSearch(input.query as string, signal)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
```

### Orchestrator System Prompt

```typescript
// Enforces spoken-natural prose (AGENT-07)
export const ORCHESTRATOR_SYSTEM_PROMPT = `
You are a voice assistant for a visually impaired South African WhatsApp user.
All your responses will be spoken aloud via text-to-speech.

CRITICAL RULES:
1. Never use markdown formatting: no **, no ##, no -, no \`, no bullet points
2. Write all responses as natural spoken sentences, not lists
3. Phone numbers must be spoken digit-by-digit (e.g., "plus 2 7 8 3 1")
4. Ask only one question at a time
5. Keep responses brief — the user cannot see; every extra word costs attention
6. When composing a message, always read back the recipient name and message for confirmation
7. All database queries are already filtered by the current user — do not ask for user identity
`.trim()
```

### Tavily Web Search Wrapper

```typescript
// src/tools/ambient.ts — WebSearch tool handler
import { tavily } from '@tavily/core'

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! })

export async function toolWebSearch(query: string, signal: AbortSignal): Promise<string> {
  // Note: @tavily/core does not yet expose signal parameter natively;
  // wrap in a race with AbortSignal via Promise.race if needed
  const response = await tavilyClient.search(query, {
    searchDepth: 'basic',
    maxResults: 3,
    includeAnswer: true,
    topic: 'general',
  })
  return response.answer ?? response.results.map(r => r.content).join(' ')
}
```

### EskomSePush Wrapper

```typescript
// src/tools/ambient.ts — GetLoadShedding tool handler
export async function toolGetLoadShedding(signal: AbortSignal): Promise<string> {
  const areaId = process.env.ESKOMSEPUSH_AREA_ID ?? 'eskde-10-fourwaysext10cityofjohannesburggauteng'
  const res = await fetch(
    `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`,
    { headers: { Token: process.env.ESKOMSEPUSH_API_KEY! }, signal }
  )
  if (!res.ok) return 'I could not fetch load shedding information right now.'
  const data = await res.json() as EskomAreaResponse
  return formatLoadSheddingForSpeech(data)
}
```

### Confirm Send Handler

```typescript
// In POST /api/voice/command after fast-path classify → 'confirm_send'
async function handleConfirmSend(c: Context, userId: string) {
  const state = getState(userId)
  if (state.phase !== 'awaiting_approval' || !state.pendingMessage) {
    return c.json({ spoken: 'There is no pending message to confirm.' })
  }
  const { to, toName, body } = state.pendingMessage

  // Send via WhatsApp Cloud API
  const res = await fetch(
    `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      signal: AbortSignal.timeout(5000),
    }
  )
  const json = await res.json() as { messages?: [{ id: string }] }
  const wamid = json.messages?.[0]?.id

  // Log to message_log direction='out'
  await supabase.from('message_log').insert({
    user_id: userId,
    direction: 'out',
    to_phone: to,
    body,
    wa_message_id: wamid,
  })

  clearSession(userId)
  const name = toName ?? formatPhoneForSpeech(to)
  return c.json({ spoken: `Sent to ${name}.`, action: 'sent', requiresConfirmation: false })
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@anthropic-ai/claude-agent-sdk` query() | Manual `messages.create` tool loop | N/A — Agent SDK is a separate package never installed | Plans must use `messages.create` not `query()` |
| `eleven_turbo_v2_5` | `eleven_flash_v2_5` | Early 2026 | `eleven_turbo_v2_5` is deprecated; Flash is the low-latency model |
| Server-side tool `web_search` | Client-side `@tavily/core` | N/A | Server-side web_search adds per-search cost and removes AbortController control |

**Deprecated/outdated:**

- `@anthropic-ai/claude-agent-sdk` `query()` pattern: not installed, not relevant to this project
- `eleven_turbo_v2_5`: deprecated, replaced by `eleven_flash_v2_5` (Phase 4 concern, noted here for awareness)

---

## Open Questions

1. **EskomSePush area ID for demo user**
   - What we know: API requires a specific area ID string; default can be hardcoded
   - What's unclear: The exact area ID for the demo user's location
   - Recommendation: Add `ESKOMSEPUSH_AREA_ID` env var with Johannesburg default `eskde-10-fourwaysext10cityofjohannesburggauteng`; verify actual ID via `GET /areas_search?text=johannesburg` before demo

2. **resolve_contact_name SQL function — case sensitivity**
   - What we know: Function deployed in `002_functions.sql` Phase 1
   - What's unclear: Whether it uses `ILIKE` or `=` for name matching
   - Recommendation: Check `002_functions.sql` before implementing ResolveContact tool; if `=`, add `ILIKE` variant or patch the function

3. **Tavily AbortSignal support**
   - What we know: `@tavily/core` `client.search()` signature may not accept AbortSignal directly
   - What's unclear: Whether signal propagation to Tavily is possible without wrapping in Promise.race
   - Recommendation: Implement as `Promise.race([tavilyClient.search(q, opts), rejectAfter(5000)])` if signal is not natively supported; verify in Wave 0

4. **Three-strike counter storage**
   - What we know: No-match counter needs to reset on `clearSession()`
   - What's unclear: Whether to extend `SessionState` interface or use a separate Map
   - Recommendation: Extend `SessionState` with `noMatchCount?: number` — keeps all session state co-located and clears atomically with `clearSession()`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime | Yes | 1.3.10 | — |
| `@anthropic-ai/sdk` | Orchestrator | Yes (installed) | 0.80.0 | — |
| `@supabase/supabase-js` | Tool handlers | Installed but missing from node_modules* | 2.100.1 | — |
| `@tavily/core` | WebSearch tool | No — needs `bun add @tavily/core` | — | Raw fetch to `https://api.tavily.com/search` |
| `ANTHROPIC_API_KEY` | Orchestrator | Not in .env (file missing) | — | Required; cannot mock in production |
| `ESKOMSEPUSH_API_KEY` | GetLoadShedding | Not in .env | — | Tool returns graceful error string |
| `OPENWEATHER_API_KEY` | GetWeather | Not in .env | — | Tool returns graceful error string |
| `TAVILY_API_KEY` | WebSearch | Not in .env | — | Tool returns graceful error string |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | All DB tools | Not in .env | — | Required; schema tests skip without them |

*Note: `bun test` shows `Cannot find module '@supabase/supabase-js'` for schema/isolation tests — this is a missing `.env` + dependency resolution issue. Run `bun install` if needed.

**Missing dependencies with no fallback:**
- `.env` file with `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required before any integration test can run

**Missing dependencies with fallback:**
- `@tavily/core` — use `bun add @tavily/core` (preferred) or raw fetch fallback
- `ESKOMSEPUSH_API_KEY`, `OPENWEATHER_API_KEY`, `TAVILY_API_KEY` — tools should return graceful spoken fallback strings when keys are absent

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bun built-in test runner (no config file needed) |
| Config file | None — `bun test` discovers `tests/*.test.ts` automatically |
| Quick run command | `bun test tests/agent.test.ts tests/contact.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGENT-01 | Fast-path regex resolves in < 1ms before LLM | unit | `bun test tests/classifier.test.ts` | Yes (28 tests passing) |
| AGENT-02 | 8 AGENT-02 intents + confirm/cancel classified correctly | unit | `bun test tests/classifier.test.ts` | Yes |
| AGENT-03 | ResolveContact tool returns phone for known name | unit | `bun test tests/agent.test.ts` | No — Wave 0 |
| AGENT-04 | SendMessage tool sets session to awaiting_approval | unit | `bun test tests/agent.test.ts` | No — Wave 0 |
| AGENT-05 | confirm_send sends; cancel returns idle; 3-strike resets | unit | `bun test tests/agent.test.ts` | No — Wave 0 |
| AGENT-06 | Ambient tools return string in < 3s | integration | `bun test tests/ambient.test.ts` (with real API keys) | No — Wave 0 |
| AGENT-07 | All spoken responses contain no markdown | unit | `bun test tests/sanitiser.test.ts` | No — Wave 0 |
| AGENT-08 | sanitiseForSpeech strips *, #, \` | unit | `bun test tests/sanitiser.test.ts` | No — Wave 0 |
| CONTACT-02 | Save unknown number flow completes multi-turn | unit | `bun test tests/contact.test.ts` | No — Wave 0 |
| CONTACT-03 | Proactive save by voice inserts to user_contacts | unit | `bun test tests/contact.test.ts` | No — Wave 0 |
| CONTACT-04 | Set/unset priority by voice updates is_priority | unit | `bun test tests/contact.test.ts` | No — Wave 0 |
| CONTACT-05 | Contact name used in read-aloud; no raw phone | unit | `bun test tests/contact.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test tests/classifier.test.ts tests/session.test.ts tests/sanitiser.test.ts`
- **Per wave merge:** `bun test` (excluding schema.test.ts and isolation.test.ts which require live Supabase)
- **Phase gate:** Full suite green (offline tests) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/agent.test.ts` — covers AGENT-03, AGENT-04, AGENT-05 (mock Supabase, mock Anthropic SDK)
- [ ] `tests/sanitiser.test.ts` — covers AGENT-07, AGENT-08 (pure function, no mocks needed)
- [ ] `tests/contact.test.ts` — covers CONTACT-02, CONTACT-03, CONTACT-04, CONTACT-05 (mock Supabase)
- [ ] `tests/ambient.test.ts` — covers AGENT-06 (mark as manual/integration; pure wrapper unit tests with mock fetch are automated)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGENT-01 | Orchestrator receives STT transcript, classifies intent via fast-path regex before invoking LLM | `classifyIntent()` already built in `src/agent/classifier.ts`; wire into `POST /api/voice/command` handler |
| AGENT-02 | Intent classification covers 8 intents + confirm/cancel | `classifier.ts` already covers all 10 patterns with 28 passing tests |
| AGENT-03 | Messaging sub-agent resolves contact by name via `user_contacts` lookup | `ResolveContact` tool handler: `.ilike('name', name).eq('user_id', userId)` query; use `resolve_contact_name` SQL function if available |
| AGENT-04 | Messaging sub-agent drafts outbound message and enters `awaiting_approval` state | `SendMessage` tool: call `setPendingMessage()` then `transition(userId, 'awaiting_approval')` — no WhatsApp API call |
| AGENT-05 | User can confirm or cancel pending message; state returns to `idle` | Fast-path `confirm_send` / `cancel` handlers in `api.ts`; 3-strike no-match counter |
| AGENT-06 | Ambient sub-agent handles load shedding, weather, web search under 3s | `GetLoadShedding` (EskomSePush v2), `GetWeather` (OpenWeather 3.0), `WebSearch` (Tavily); all with `AbortSignal.timeout(5000)`; `Promise.all` for parallel ambient fetches |
| AGENT-07 | All spoken responses are plain conversational text | System prompt enforces prose; `sanitiseForSpeech()` applied at orchestrator return boundary |
| AGENT-08 | Markdown sanitiser at TTS call boundary | `src/agent/sanitiser.ts` — strip `**`, `##`, `- `, backticks before return |
| CONTACT-01 | Unknown number triggers interrupt with digit-by-digit spoken phone | Already satisfied in Phase 2 (worker.ts); Phase 3 adds the conversational save flow |
| CONTACT-02 | User can save unknown number by voice — agent asks name, confirms, inserts to `user_contacts` | `SaveContact` tool with multi-turn session; tool handler does `supabase.from('user_contacts').insert({user_id, name, phone})` |
| CONTACT-03 | User can proactively save a contact by speaking digits and a name | Handled by `save_contact` fast-path → Claude orchestrator → `SaveContact` tool |
| CONTACT-04 | User can set/unset priority contact by voice | `SetPriority` tool: `supabase.from('user_contacts').update({is_priority}).eq('user_id').ilike('name')` |
| CONTACT-05 | Contact name used in all read-aloud flows; phone numbers never spoken when name is known | All tool handlers that produce spoken text must call `resolve_contact_name` or look up contact name before formatting output |
</phase_requirements>

---

## Sources

### Primary (HIGH confidence)

- `@anthropic-ai/sdk` installed at 0.80.0 — confirmed via `bun pm ls`
- [Anthropic tool use overview](https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/overview) — TypeScript `messages.create` with `tools` array
- [Anthropic how tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works) — agentic loop, `stop_reason: 'tool_use'`, `tool_result` pattern
- [Tavily JS SDK reference](https://docs.tavily.com/sdk/javascript/reference) — `client.search()` signature and `SearchResponse` type
- `src/agent/classifier.ts` — existing fast-path classifier with 28 passing tests
- `src/session/machine.ts` — existing session state machine (5 states, transition guards)
- `src/queue/worker.ts` — existing CONTACT-01 implementation (unknown number interrupt)
- `.planning/research/ARCHITECTURE.md` — overall system architecture (note: Agent SDK import references are wrong; use `@anthropic-ai/sdk`)
- `.planning/research/STACK.md` — pinned versions and critical gotchas

### Secondary (MEDIUM confidence)

- [EskomSePush API v2 Postman docs](https://documenter.getpostman.com/view/1296288/UzQuNk3E) — endpoint structure (`Token` header, `/area?id=` endpoint)
- [OpenWeather One Call API 3.0](https://openweathermap.org/api/one-call-3) — endpoint, params, response shape

### Tertiary (LOW confidence — needs validation)

- EskomSePush exact Johannesburg area ID string — not verified against live API; use `GET /areas_search?text=johannesburg` to confirm before demo

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages confirmed installed via `bun pm ls`; Tavily package existence confirmed via npm
- Architecture: HIGH — tool-use agentic loop verified against official Anthropic docs; session machine and classifier code reviewed directly
- Pitfalls: HIGH — SDK import confusion pitfall confirmed by cross-checking ARCHITECTURE.md (wrong import) vs installed packages; other pitfalls from direct code review
- External API details: MEDIUM — EskomSePush/OpenWeather endpoints verified via web search and official pages; exact area IDs and response schemas not tested against live APIs

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable APIs — Anthropic tool-use API, OpenWeather, EskomSePush all stable; Tavily may add signal support in minor release)
