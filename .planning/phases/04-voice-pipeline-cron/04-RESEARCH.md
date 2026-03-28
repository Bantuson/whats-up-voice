# Phase 4: Voice Pipeline + Cron — Research

**Researched:** 2026-03-28
**Domain:** ElevenLabs TTS streaming, OpenAI Whisper STT, Hono/Bun WebSocket, BullMQ job schedulers, Twilio media download
**Confidence:** HIGH (critical findings verified against installed package types; confirmed against official docs)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-01 | `POST /api/voice/command` accepts `{ userId, transcript, sessionId }` returns `{ spoken, action, requiresConfirmation, pendingAction }` | Route already exists (Phase 3); Phase 4 extends it with STT input path — no new route needed |
| VOICE-02 | OpenAI Whisper (`whisper-1`) STT with language hint from user profile | `openai.audio.transcriptions.create` accepts `Uploadable`; `toFile` converts `ArrayBuffer` → `File`; language code `'af'` (ISO 639-1) |
| VOICE-03 | ElevenLabs TTS using `eleven_flash_v2_5` (NOT deprecated `eleven_turbo_v2_5`) | `client.textToSpeech.stream(voiceId, { modelId: 'eleven_flash_v2_5', outputFormat: 'opus_48000_32', text })` returns `ReadableStream<Uint8Array>` |
| VOICE-04 | TTS output streamed via WebSocket (`/ws/session/:userId`) — first audio chunk under 500ms | `wsConnections` Map + `ws.send(chunk)` binary push; `eleven_flash_v2_5` targets ~75ms TTFB |
| VOICE-05 | Received voice notes fetched from Twilio media URL and streamed to device for playback | `MediaUrl0` already in webhook payload; fetch with Basic auth (`ACCOUNT_SID:AUTH_TOKEN`) |
| CONTACT-01 | Unknown number interrupt → spoken digit-by-digit phone; `pushInterrupt()` wires TTS delivery | Phase 2 `pushInterrupt()` sends JSON stub; Phase 4 replaces with TTS audio binary push |
| CRON-01 | BullMQ job scheduler for `morning_briefing` at `0 7 * * 1-5` per user (NEVER `node-cron`) | `queue.upsertJobScheduler(id, { pattern }, { name, data })` — confirmed API from installed bullmq types |
| CRON-02 | Double-fire protection — skip if `last_run` within 55 seconds | Check `routines.last_run` column before worker produces output |
| CRON-03 | Morning briefing order: greeting → load shedding → weather → overnight message digest | Parallel fetch EskomSePush + OpenWeather + `message_log`; build spoken string in order |
| CRON-04 | Evening digest (`0 18 * * *`) and custom reminders via `routines` table; Afrikaans TTS for `language = 'af'` | `syncUserRoutines()` reads all enabled routines; voice selection branch on `user_profile.language` |
</phase_requirements>

---

## ElevenLabs Streaming API

### SDK Version in Use

`@elevenlabs/elevenlabs-js` **v2.40.0** — installed and verified.

### Client Instantiation

```typescript
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })
```

Note: `ElevenLabsClient` is the correct export name. `ElevenLabs` (default export) is **not a constructor** in the installed version — confirmed by runtime error. Always use `ElevenLabsClient`.

### HTTP Streaming (SDK — Use This)

The SDK's `textToSpeech.stream()` method is the correct approach for this project. It returns a `ReadableStream<Uint8Array>` that can be iterated and pushed as binary frames over WebSocket.

**Exact TypeScript signature** (from installed `Client.d.ts`):

```typescript
stream(
  voice_id: string,
  request: StreamTextToSpeechRequest,
  requestOptions?: TextToSpeechClient.RequestOptions
): core.HttpResponsePromise<ReadableStream<Uint8Array>>
```

**`StreamTextToSpeechRequest` key fields** (from installed `StreamTextToSpeechRequest.d.ts`):

```typescript
{
  text: string                   // required
  modelId?: string               // 'eleven_flash_v2_5'
  outputFormat?: string          // 'opus_48000_32' — confirmed valid in AllowedOutputFormats.d.ts
  languageCode?: string          // ISO 639-1: 'en' or 'af'
  voiceSettings?: VoiceSettings  // { stability, similarityBoost, style, useSpeakerBoost }
  optimizeStreamingLatency?: number // 0-4; use 3 for lowest latency
}
```

**Audio iteration pattern for WebSocket push:**

```typescript
const stream = await elevenlabs.textToSpeech.stream(voiceId, {
  text: spokenText,
  modelId: 'eleven_flash_v2_5',
  outputFormat: 'opus_48000_32',
  languageCode: language === 'af' ? 'af' : 'en',
  optimizeStreamingLatency: 3,
})
const ws = wsConnections.get(userId)
if (ws) {
  ws.send(JSON.stringify({ type: 'audio_start' }))
  for await (const chunk of stream) {
    ws.send(chunk)   // chunk is already Uint8Array — send binary directly
  }
  ws.send(JSON.stringify({ type: 'audio_end' }))
}
```

**Confidence:** HIGH — signature verified from installed `.d.ts` files.

### Output Format

`opus_48000_32` is confirmed valid:
- Present in `AllowedOutputFormats.d.ts` as `Opus4800032: "opus_48000_32"`
- OGG/Opus container at 48kHz, 32kbps — correct format for WhatsApp voice notes
- Do NOT use default MP3; WhatsApp voice notes require OGG/Opus

### Model: `eleven_flash_v2_5`

- **Status:** Valid and actively recommended (confirmed: ElevenLabs docs + research)
- **Latency:** ~75ms TTFB — meets the <500ms first chunk requirement (VOICE-04)
- **Languages:** 32 languages including English and Afrikaans
- **`eleven_turbo_v2_5`:** Superseded by Flash v2.5; do not use

### Raw WebSocket Protocol (Alternative — Use SDK Instead)

If bypassing the SDK, the raw WebSocket endpoint is:

```
wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
  ?output_format=opus_48000_32
  &model_id=eleven_flash_v2_5
```

Authentication via query parameter: `?xi-api-key={API_KEY}` or as a message field in the first message.

Protocol:
1. Open connection
2. Send `{ "text": " ", "xi-api-key": "..." }` (single space = init signal)
3. Send `{ "text": "Hello world " }` (text chunks — end each with space)
4. Send `{ "flush": true }` to flush remaining buffer
5. Send `{ "text": "" }` to close
6. Receive `AudioOutput` messages: `{ "audio": "<base64 string>", "isFinal": false }`
7. Receive `FinalOutput`: `{ "isFinal": true }`

**Use the SDK (`textToSpeech.stream()`) instead** — simpler, handles protocol automatically.

---

## ElevenLabs Afrikaans Support

### Critical Finding

`eleven_flash_v2_5` does **not** list Afrikaans in its 32-language set. Only `eleven_v3` explicitly supports Afrikaans (`afr`).

**Recommendation for Phase 4:** Use the `languageCode: 'af'` parameter with `eleven_flash_v2_5`. ElevenLabs SDK accepts it without error (it may fall back to English pronunciation). If Afrikaans fidelity is critical, switch model to `eleven_multilingual_v2` for `language = 'af'` users, accepting higher latency (~200ms vs ~75ms).

**Practical implementation pattern:**

```typescript
const modelId = language === 'af' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5'
const languageCode = language === 'af' ? 'af' : 'en'
```

**Confidence:** MEDIUM — Flash v2.5's language list per docs does not include Afrikaans; `eleven_v3` does. Multilingual v2 supports 29 languages but does not explicitly list Afrikaans either in the docs summary reviewed.

**Action:** Voice IDs and Afrikaans language support should be confirmed via `GET /v1/voices` against the live API before finalising. Do not hardcode voice IDs without testing.

### English Voice IDs

Rachel (`21m00Tcm4TlvDq8ikWAM`) is the commonly cited default preset. The correct approach is to store voice IDs in user profile or env vars, not hardcode in source.

**Env var pattern:**
```
ELEVENLABS_VOICE_EN=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_VOICE_AF=<to be confirmed via GET /v1/voices>
```

---

## Hono WebSocket + Bun

### Export Pattern (Already Correctly Implemented in server.ts)

The current `src/server.ts` is correct:

```typescript
import { upgradeWebSocket, websocket } from 'hono/bun'

app.get('/ws/session/:userId', upgradeWebSocket((c) => {
  const userId = c.req.param('userId')
  return {
    onOpen(_event, ws) { wsConnections.set(userId, ws) },
    onClose() { wsConnections.delete(userId) },
    onMessage(event) { /* inbound audio frames */ },
  }
}))

export default {
  fetch: app.fetch,
  websocket,
  port: 3000,
}
```

**Do not change this pattern.** Phase 4 only adds TTS audio push logic to the `pushInterrupt()` / `pushTTS()` helper functions.

### CORS + WebSocket Conflict — Existing Risk

The current server.ts applies CORS on `'*'` (all routes) including `/ws/*`. Per Hono issue #2535, CORS middleware on WebSocket upgrade routes causes "Headers are immutable" errors because `upgradeWebSocket()` modifies response headers internally.

**Current server.ts already registers `app.get('/ws/session/:userId', upgradeWebSocket(...))` AFTER `app.use('*', cors(...))`.** This is the potentially conflicting order.

**Workaround:** CORS middleware applied **before** the WebSocket handler may not cause an issue if the WebSocket connection upgrade happens at the handler level and CORS runs first as a no-op on upgrade responses. In practice, the existing server.ts has been working. **Do not change middleware order in Phase 4.**

If `TypeError: Headers are immutable` errors appear in Phase 4, the fix is to scope CORS away from WS routes:

```typescript
// Replace: app.use('*', cors(...))
// With:
app.use('/health/*', cors(...))
app.use('/api/*', cors(...))
app.use('/webhook/*', cors(...))
```

**Confidence:** MEDIUM — existing code may already work; only fix if errors surface.

### TypeScript Export Type Error (Known Issue)

Hono 4.7.2+ may emit a TS error: "Default export has or is using private name 'BunWebSocketHandler'". This is a type-level error only and does not affect runtime behavior. Suppress with `@ts-ignore` on the export if needed.

### WSContext Binary Send

The `wsConnections` Map stores `WSContext` from `hono/ws`. The `ws.send()` method accepts both `string` (JSON) and `ArrayBuffer | Uint8Array` (binary). Audio chunks from the ElevenLabs `ReadableStream<Uint8Array>` can be passed directly to `ws.send()` without conversion.

---

## BullMQ `upsertJobScheduler`

### Confirmed TypeScript Signature (from installed `queue.d.ts`, BullMQ v5.71.1)

```typescript
upsertJobScheduler(
  jobSchedulerId: NameType,
  repeatOpts: Omit<RepeatOptions, 'key'>,
  jobTemplate?: {
    name?: NameType
    data?: DataType
    opts?: JobSchedulerTemplateOptions
  }
): Promise<Job<DataType, ResultType, NameType>>
```

### Correct Cron Pattern

```typescript
import { Queue } from 'bullmq'
import { redis } from './heartbeat'

export const routinesQueue = new Queue('routines', { connection: redis })

// Morning briefing — weekdays 07:00
await routinesQueue.upsertJobScheduler(
  `morning_briefing:${userId}`,       // schedulerId — must be unique per user
  { pattern: '0 7 * * 1-5' },         // standard 5-field cron
  {
    name: 'morning_briefing',
    data: { userId, routineType: 'morning_briefing' },
    opts: {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 5 },
    },
  }
)

// Evening digest — daily 18:00
await routinesQueue.upsertJobScheduler(
  `evening_digest:${userId}`,
  { pattern: '0 18 * * *' },
  {
    name: 'evening_digest',
    data: { userId, routineType: 'evening_digest' },
  }
)
```

### Key Behavioral Notes

- **Upsert semantics:** Calling again with the same `schedulerId` updates the scheduler without duplication. Safe to call on every startup.
- **Worker identification:** Workers identify the routine via `job.name` (e.g., `'morning_briefing'`) and `job.data.routineType`.
- **Delayed state:** One job always sits in "delayed" state, waiting for the next fire time.
- **Job ID:** Auto-generated — cannot set custom IDs for scheduler jobs.
- **BullMQ version gate:** `upsertJobScheduler` was introduced in v5.16.0. Installed version is v5.71.1. No compatibility issue.
- **NEVER use `node-cron`** — BullMQ scheduler is durable (survives server restarts), `node-cron` is not.

### `syncUserRoutines()` Pattern

```typescript
export async function syncUserRoutines(): Promise<void> {
  const { data: routines } = await supabase
    .from('routines')
    .select('user_id, routine_type, cron_expression, enabled')

  for (const routine of routines ?? []) {
    if (!routine.enabled) continue
    await routinesQueue.upsertJobScheduler(
      `${routine.routine_type}:${routine.user_id}`,
      { pattern: routine.cron_expression },
      {
        name: routine.routine_type,
        data: { userId: routine.user_id, routineType: routine.routine_type },
      }
    )
  }
}
```

Call `syncUserRoutines()` at server startup, after `validateEnv()` and queue initialisation.

### `routines` Table Schema (from `001_schema.sql`)

```sql
routines (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  routine_type    TEXT NOT NULL,       -- 'morning_briefing' | 'evening_digest' | custom
  cron_expression TEXT NOT NULL,       -- '0 7 * * 1-5'
  label           TEXT,
  enabled         BOOLEAN DEFAULT TRUE,
  last_run        TIMESTAMPTZ,        -- used for double-fire protection (CRON-02)
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
```

---

## OpenAI Whisper in Bun

### SDK Method

```typescript
import OpenAI, { toFile } from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const transcription = await openai.audio.transcriptions.create({
  file: await toFile(audioBuffer, 'audio.ogg', { type: 'audio/ogg' }),
  model: 'whisper-1',
  language: userLanguage === 'af' ? 'af' : 'en',  // ISO 639-1
})
// transcription.text is the spoken text
```

### Key Facts (from installed `transcriptions.d.ts`)

- **`file` parameter type:** `Uploadable` — accepts `FileLike`, `ResponseLike`, `ArrayBuffer`, `ArrayBufferView`, `AsyncIterable`
- **`toFile()` import:** `import { toFile } from 'openai'` — exported from package root
- **Bun compatibility:** `toFile` accepts `ArrayBuffer` and `ArrayBufferView` natively — Bun's `ArrayBuffer` is standard; no conversion needed
- **Accepted audio formats:** `flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm` — OGG (WhatsApp voice notes) is accepted
- **Language parameter:** ISO 639-1 two-letter code — `'af'` for Afrikaans, `'en'` for English (not `'afr'`)
- **Response shape:** `{ text: string }` for `response_format: 'json'` (default)

### WhatsApp Voice Note Flow (VOICE-02)

WhatsApp voice notes arrive as OGG/Opus files. The `mediaId` field in `HeartbeatJobData` stores the Twilio `MediaUrl0` value. Phase 4 fetches the binary, passes it to Whisper:

```typescript
// 1. Fetch audio from Twilio media URL
const audioBuffer = await fetchTwilioMedia(mediaUrl)

// 2. Transcribe
const { text } = await openai.audio.transcriptions.create({
  file: await toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' }),
  model: 'whisper-1',
  language: 'af',  // or 'en' from user profile
})
```

---

## Twilio Media URL Fetch (VOICE-05)

**Critical: This project uses Twilio, NOT WhatsApp Cloud API directly.** The `src/routes/webhook.ts` uses Twilio form-encoded webhooks. Media URLs (`MediaUrl0`) are Twilio's proxied CDN URLs.

### Fetch Pattern

Twilio media URLs require HTTP Basic Auth using `TWILIO_ACCOUNT_SID` as username and `TWILIO_AUTH_TOKEN` as password:

```typescript
export async function fetchTwilioMedia(mediaUrl: string): Promise<ArrayBuffer> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken  = process.env.TWILIO_AUTH_TOKEN!
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Twilio media fetch failed: ${res.status}`)
  return res.arrayBuffer()
}
```

### Notes

- **No two-step redirect** (unlike WhatsApp Cloud API) — `MediaUrl0` is a direct Twilio CDN URL
- **URL lifetime:** Media URLs are persistent while the message exists in Twilio; not 5-minute TTLs
- **Auth enforcement:** Only required if Twilio account has HTTP Auth enabled; basic auth on all requests is safest
- **env vars needed:** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` already required at startup (in `validateEnv()`)

**Confidence:** MEDIUM — based on Twilio docs + webhook.ts code analysis. Confirm via actual media download test.

---

## Critical Pitfalls

### 1. `ElevenLabs` vs `ElevenLabsClient` Constructor Name

**What goes wrong:** `new ElevenLabs(...)` throws `TypeError: Object is not a constructor` in Bun runtime (verified by running against installed package).
**Fix:** Use `ElevenLabsClient` — the named export that is the actual class.
```typescript
// WRONG:
import { ElevenLabs } from '@elevenlabs/elevenlabs-js'
new ElevenLabs(...)

// CORRECT:
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
new ElevenLabsClient(...)
```

### 2. Wrong Model ID (`eleven_turbo_v2_5` vs `eleven_flash_v2_5`)

**What goes wrong:** Using the superseded `eleven_turbo_v2_5` gives higher latency, missing the <500ms VOICE-04 target.
**Fix:** Always use `eleven_flash_v2_5`. Verify model name in test assertions.

### 3. Wrong Output Format (MP3 Default)

**What goes wrong:** ElevenLabs defaults to MP3. WhatsApp voice notes require OGG/Opus. Sending MP3 to WhatsApp as a voice note will fail or produce garbled audio.
**Fix:** Always set `outputFormat: 'opus_48000_32'` explicitly in every TTS call.

### 4. BullMQ Cron — 6-Field vs 5-Field Cron

**What goes wrong:** Standard cron has 5 fields. Some BullMQ docs show 6-field cron (with seconds prefix). Using `0 0 7 * * 1-5` (6-field) instead of `0 7 * * 1-5` (5-field) may fire at wrong times.
**Fix:** BullMQ uses `cron-parser` which supports both. Use standard 5-field cron `'0 7 * * 1-5'` for "07:00 weekdays".

### 5. BullMQ Scheduler IDs — Uniqueness Per User

**What goes wrong:** Using just `'morning_briefing'` as the scheduler ID means all users share one scheduler — only one user gets the briefing.
**Fix:** Always include `userId` in the scheduler ID: `morning_briefing:${userId}`.

### 6. `node-cron` — Never Use

**What goes wrong:** `node-cron` runs in-process and is lost on server restart. No persistence.
**Fix:** `upsertJobScheduler` only. BullMQ scheduler state lives in Redis.

### 7. CORS + WebSocket Middleware Conflict

**What goes wrong:** Applying CORS on `'*'` before a WebSocket route can cause `TypeError: Headers are immutable` in Hono + Bun. Existing code may already be affected silently.
**Fix:** If errors surface, narrow CORS scope to exclude `/ws/*`. Do not add new middleware to `/ws/*` routes in Phase 4.

### 8. Double-Fire Window

**What goes wrong:** BullMQ may fire the same scheduler within the 55-second protection window if a worker runs slow and the next fire queues while the first is still processing.
**Fix:** Check `last_run` from Supabase at the START of the worker function (before doing any work). Update `last_run` immediately before heavy fetches, not after.

### 9. ElevenLabs Afrikaans Language Fallback

**What goes wrong:** `eleven_flash_v2_5` does not list Afrikaans in its 32 supported languages. Passing `languageCode: 'af'` may return an error or silently use English pronunciation.
**Fix:** For `language = 'af'` users, use `eleven_multilingual_v2` as model ID. Accept the higher latency (~200ms). Or test `eleven_flash_v2_5` with `languageCode: 'af'` against the live API first.

### 10. Whisper Language Code — ISO 639-1 Not ISO 639-3

**What goes wrong:** ElevenLabs v3 docs use `afr` (ISO 639-3). OpenAI Whisper uses `af` (ISO 639-1). Using `afr` in Whisper's `language` parameter causes an error.
**Fix:** Whisper `language: 'af'` (two-letter ISO 639-1 code). Confirmed from installed SDK types docstring.

---

## Recommended Implementation Patterns

### Plan 1: `src/tts/client.ts` — TTS Streaming Module

```typescript
// src/tts/client.ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { wsConnections } from '../ws/manager'
import { sanitiseForSpeech } from '../agent/sanitiser'

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })

// Voice IDs — store in env, confirm via GET /v1/voices before launch
const VOICE_EN = process.env.ELEVENLABS_VOICE_EN ?? '21m00Tcm4TlvDq8ikWAM'  // Rachel
const VOICE_AF = process.env.ELEVENLABS_VOICE_AF ?? '21m00Tcm4TlvDq8ikWAM'  // confirm before demo

export async function pushTTS(
  userId: string,
  text: string,
  language: 'en' | 'af' = 'en'
): Promise<void> {
  const safe = sanitiseForSpeech(text)
  const voiceId = language === 'af' ? VOICE_AF : VOICE_EN
  const modelId = language === 'af' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5'

  const ws = wsConnections.get(userId)
  if (!ws) {
    console.log(`[TTS] No active WebSocket for ${userId} — skipping audio push`)
    return
  }

  const stream = await elevenlabs.textToSpeech.stream(voiceId, {
    text: safe,
    modelId,
    outputFormat: 'opus_48000_32',
    languageCode: language,
    optimizeStreamingLatency: 3,
  })

  ws.send(JSON.stringify({ type: 'audio_start', text: safe }))
  for await (const chunk of stream) {
    ws.send(chunk)
  }
  ws.send(JSON.stringify({ type: 'audio_end' }))
}
```

### Plan 1: `pushInterrupt()` Upgrade in `src/queue/worker.ts`

The existing `pushInterrupt()` sends a JSON text frame. Phase 4 replaces it with TTS audio:

```typescript
// Replace the Phase 2 stub in src/queue/worker.ts:
async function pushInterrupt(userId: string, spoken: string): Promise<void> {
  const userLang = await getUserLanguage(userId)  // query user_profile
  await pushTTS(userId, spoken, userLang)
  console.log(`[Worker] TTS interrupt pushed to ${userId}`)
}
```

### Plan 2: `src/routes/api.ts` — STT Extension

The existing `POST /api/voice/command` route handles `{ userId, transcript }`. Phase 4 adds a multipart audio path:

```typescript
// Add above existing route handler, or add new route:
// POST /api/voice/audio — accepts multipart/form-data with audio blob
apiRouter.post('/voice/audio', async (c) => {
  const body = await c.req.parseBody()
  const userId = body['userId'] as string
  const audioFile = body['audio'] as File  // Bun File type
  const sessionId = body['sessionId'] as string | undefined

  if (!userId || !audioFile) {
    return c.json({ error: 'userId and audio are required' }, 400)
  }

  // Get user language for Whisper hint
  const { data: profile } = await supabase
    .from('user_profile')
    .select('language')
    .eq('user_id', userId)
    .single()
  const language = profile?.language ?? 'en'

  // STT — Whisper
  const arrayBuf = await audioFile.arrayBuffer()
  const { text: transcript } = await openai.audio.transcriptions.create({
    file: await toFile(arrayBuf, 'audio.ogg', { type: 'audio/ogg' }),
    model: 'whisper-1',
    language: language === 'af' ? 'af' : 'en',
  })

  // Pass transcript through existing voice/command pipeline
  // (reuse the existing route logic by calling shared handler)
  // ... route to classifyIntent → fast-path or orchestrator
})
```

### Plan 2: `src/lib/twilio.ts` — Twilio Media Fetch (VOICE-05)

```typescript
// src/lib/twilio.ts
export async function fetchTwilioMedia(mediaUrl: string): Promise<ArrayBuffer> {
  const credentials = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID!}:${process.env.TWILIO_AUTH_TOKEN!}`
  ).toString('base64')

  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status} ${res.statusText}`)
  return res.arrayBuffer()
}
```

Voice note playback (VOICE-05) — send fetched audio to device WebSocket:

```typescript
export async function pushVoiceNotePlayback(
  userId: string,
  mediaUrl: string
): Promise<void> {
  const ws = wsConnections.get(userId)
  if (!ws) return
  const audioBuffer = await fetchTwilioMedia(mediaUrl)
  ws.send(JSON.stringify({ type: 'audio_start', source: 'voice_note' }))
  ws.send(audioBuffer)  // send raw ArrayBuffer
  ws.send(JSON.stringify({ type: 'audio_end' }))
}
```

### Plan 3: `src/queue/routines.ts` — BullMQ Cron Worker

```typescript
// src/queue/routines.ts
import { Queue, Worker } from 'bullmq'
import { redis } from './heartbeat'
import { supabase } from '../db/client'
import { pushTTS } from '../tts/client'
import { toolGetLoadShedding, toolGetWeather } from '../tools/ambient'

export const routinesQueue = new Queue('routines', { connection: redis })

// CRON-01: Register all enabled routines from DB
export async function syncUserRoutines(): Promise<void> {
  const { data: routines, error } = await supabase
    .from('routines')
    .select('user_id, routine_type, cron_expression, enabled')

  if (error) {
    console.error('[Routines] Failed to load routines:', error)
    return
  }

  for (const routine of routines ?? []) {
    if (!routine.enabled) continue
    await routinesQueue.upsertJobScheduler(
      `${routine.routine_type}:${routine.user_id}`,
      { pattern: routine.cron_expression },
      {
        name: routine.routine_type,
        data: { userId: routine.user_id, routineType: routine.routine_type },
        opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 5 } },
      }
    )
    console.log(`[Routines] Registered: ${routine.routine_type}:${routine.user_id}`)
  }
}

// CRON-02: Double-fire protection helper
async function checkAndMarkRun(userId: string, routineType: string): Promise<boolean> {
  const { data } = await supabase
    .from('routines')
    .select('last_run')
    .eq('user_id', userId)
    .eq('routine_type', routineType)
    .single()

  const lastRun = data?.last_run ? new Date(data.last_run).getTime() : 0
  const elapsed = Date.now() - lastRun
  if (elapsed < 55_000) {
    console.log(`[Routines] Double-fire skipped (${elapsed}ms since last run)`)
    return false
  }

  // Mark last_run immediately to prevent race condition
  await supabase
    .from('routines')
    .update({ last_run: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('routine_type', routineType)

  return true
}

// CRON-03: Morning briefing builder
async function buildMorningBriefing(userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('language')
    .eq('user_id', userId)
    .single()

  const isAf = profile?.language === 'af'
  const greeting = isAf ? 'Goeie môre.' : 'Good morning.'

  // Parallel fetch (CRON-03 — order preserved in spoken output, not fetch order)
  const signal = AbortSignal.timeout(8_000)
  const [loadShedding, weather] = await Promise.all([
    toolGetLoadShedding(signal).catch(() => 'Load shedding status unavailable.'),
    toolGetWeather(signal).catch(() => 'Weather unavailable.'),
  ])

  // Overnight message digest — priority contacts first (CRON-03)
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const { data: messages } = await supabase
    .from('message_log')
    .select('from_phone, body, created_at')
    .eq('user_id', userId)
    .eq('direction', 'in')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)

  let digest = ''
  if (!messages || messages.length === 0) {
    digest = 'No new messages overnight.'
  } else {
    digest = `You have ${messages.length} message${messages.length !== 1 ? 's' : ''} since last night.`
  }

  // CRON-03 order: greeting → load shedding → weather → digest
  return [greeting, loadShedding, weather, digest].join(' ')
}

export const routinesWorker = new Worker<{ userId: string; routineType: string }>(
  'routines',
  async (job) => {
    const { userId, routineType } = job.data
    const { data: profile } = await supabase
      .from('user_profile')
      .select('language')
      .eq('user_id', userId)
      .single()
    const language = (profile?.language ?? 'en') as 'en' | 'af'

    const shouldRun = await checkAndMarkRun(userId, routineType)
    if (!shouldRun) return

    if (routineType === 'morning_briefing') {
      const spoken = await buildMorningBriefing(userId)
      await pushTTS(userId, spoken, language)
    } else if (routineType === 'evening_digest') {
      // Similar digest pattern, no load shedding
      await pushTTS(userId, 'Good evening. Here is your evening summary.', language)
    }
    // Custom reminder types can be handled here via routine.label
  },
  { connection: redis, concurrency: 5 }
)
```

---

## Environment Availability

Step 2.6: This phase requires ElevenLabs API, OpenAI API, Redis (BullMQ), and Twilio media CDN.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | All | Yes | 1.3.10 | — |
| `@elevenlabs/elevenlabs-js` | VOICE-03, VOICE-04 | Yes | 2.40.0 (installed) | — |
| `openai` SDK | VOICE-02 | Yes | 6.33.0 (installed) | — |
| `bullmq` + `ioredis` | CRON-01–04 | Yes | 5.71.1 (installed) | — |
| Redis server | CRON-01–04 | Not verified (no `redis-cli` in PATH) | — | Cannot run cron without Redis |
| ELEVENLABS_API_KEY | VOICE-03 | In env.ts required list | — | Cannot TTS without key |
| OPENAI_API_KEY | VOICE-02 | In env.ts required list | — | Cannot STT without key |
| ELEVENLABS_VOICE_EN | VOICE-03 | Not in .env.example | — | Add to .env.example |
| ELEVENLABS_VOICE_AF | CRON-04, VOICE-03 | Not in .env.example | — | Add to .env.example |

**Missing dependencies with no fallback:**
- Redis server must be running — `REDIS_URL` is required at startup. Confirm Redis is accessible before starting Phase 4 work.

**Missing dependencies with fallback:**
- `ELEVENLABS_VOICE_EN` / `ELEVENLABS_VOICE_AF` — fallback to Rachel (`21m00Tcm4TlvDq8ikWAM`) until confirmed via API.

**New env vars needed:**
```
ELEVENLABS_VOICE_EN=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_VOICE_AF=<confirm via GET /v1/voices>
```

These must be added to `src/env.ts` REQUIRED_ENV_VARS and to `.env.example`.

---

## Validation Architecture

Test framework: `bun test` with `bunfig.toml` preload `tests/setup.ts`. Existing pattern uses `mock.module()` to isolate external dependencies.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOICE-01 | Route returns correct shape with transcript input | unit | `bun test tests/voiceCommand.test.ts` | Yes (extend existing) |
| VOICE-02 | STT transcription path triggered on audio input | unit (mock openai) | `bun test tests/voiceAudio.test.ts` | No — Wave 0 |
| VOICE-03 | TTS called with `eleven_flash_v2_5` and `opus_48000_32` | unit (mock elevenlabs) | `bun test tests/ttsClient.test.ts` | No — Wave 0 |
| VOICE-04 | Audio chunks sent over WebSocket in order | unit (mock ws) | `bun test tests/ttsClient.test.ts` | No — Wave 0 |
| VOICE-05 | Twilio media fetch returns ArrayBuffer | unit (mock fetch) | `bun test tests/twilio.test.ts` | No — Wave 0 |
| CONTACT-01 | `pushInterrupt()` invokes TTS, not JSON stub | unit (mock pushTTS) | `bun test tests/worker.test.ts` | Partial (heartbeat.test.ts) |
| CRON-01 | `upsertJobScheduler` called per enabled routine | unit (mock queue) | `bun test tests/routines.test.ts` | No — Wave 0 |
| CRON-02 | Double-fire: second call within 55s is skipped | unit (mock supabase) | `bun test tests/routines.test.ts` | No — Wave 0 |
| CRON-03 | Briefing order: greeting first, digest last | unit | `bun test tests/morningBriefing.test.ts` | No — Wave 0 |
| CRON-04 | Afrikaans user gets `eleven_multilingual_v2` model | unit (mock elevenlabs) | `bun test tests/ttsClient.test.ts` | No — Wave 0 |

### Wave 0 Gaps

- [ ] `tests/ttsClient.test.ts` — covers VOICE-03, VOICE-04, CRON-04 (mock `ElevenLabsClient.textToSpeech.stream`)
- [ ] `tests/voiceAudio.test.ts` — covers VOICE-02 (mock `openai.audio.transcriptions.create` + `toFile`)
- [ ] `tests/twilio.test.ts` — covers VOICE-05 (mock global `fetch`)
- [ ] `tests/routines.test.ts` — covers CRON-01, CRON-02 (mock `Queue.upsertJobScheduler`, mock supabase)
- [ ] `tests/morningBriefing.test.ts` — covers CRON-03 (mock ambient tools, mock message_log query)
- [ ] `tests/setup.ts` — extend with `ELEVENLABS_VOICE_EN`, `ELEVENLABS_VOICE_AF`, `ELEVENLABS_API_KEY`

### Sampling Rate

- **Per task commit:** `bun test tests/[relevant suite].test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `eleven_turbo_v2_5` | `eleven_flash_v2_5` | ~60ms lower latency; same quality; use Flash |
| Repeatable jobs (`addRepeat`) | `upsertJobScheduler` | Safer upsert semantics; available BullMQ ≥ 5.16 |
| `node-cron` | BullMQ `upsertJobScheduler` | Durable: survives restarts; stored in Redis |
| `ElevenLabs` (old named export) | `ElevenLabsClient` | Runtime error if wrong name used in Bun |

---

## Open Questions

1. **Afrikaans voice ID for ElevenLabs**
   - What we know: ElevenLabs v3 explicitly supports Afrikaans (`afr`); Flash v2.5 supports 32 languages (does not explicitly list Afrikaans in docs reviewed)
   - What's unclear: Whether `eleven_flash_v2_5` with `languageCode: 'af'` produces acceptable Afrikaans output, or returns an error
   - Recommendation: Test live call `GET https://api.elevenlabs.io/v1/models` to confirm language support; run a test TTS call with `languageCode: 'af'` before committing to `eleven_multilingual_v2` fallback

2. **WebSocket binary send — `Uint8Array` vs `ArrayBuffer`**
   - What we know: `ws.send()` in Hono/Bun accepts both string and binary types
   - What's unclear: Whether Hono's `WSContext.send()` wraps Bun's `ServerWebSocket.send()` and handles `Uint8Array` vs `ArrayBuffer` transparently
   - Recommendation: Test with a small synthetic audio chunk in the WS smoke test; check if `ws.send(chunk)` requires `.buffer` extraction

3. **CORS + WebSocket conflict in existing server.ts**
   - What we know: The existing server registers CORS on `'*'` before the WS route
   - What's unclear: Whether this is already causing silent failures or will surface during Phase 4
   - Recommendation: Run a WS connection test at start of Phase 4 implementation; if errors, narrow CORS scope

---

## Sources

### Primary (HIGH confidence)
- Installed `@elevenlabs/elevenlabs-js@2.40.0` TypeScript definitions — verified `ElevenLabsClient`, `stream()`, `StreamTextToSpeechRequest`, `AllowedOutputFormats`
- Installed `openai@6.33.0` TypeScript definitions — verified `transcriptions.create`, `toFile`, `TranscriptionCreateParamsBase`
- Installed `bullmq@5.71.1` TypeScript definitions — verified `upsertJobScheduler` signature
- `src/server.ts`, `src/ws/manager.ts`, `src/queue/heartbeat.ts`, `src/queue/worker.ts` — confirmed existing patterns

### Secondary (MEDIUM confidence)
- [ElevenLabs WebSocket API — stream-input endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input) — verified output_format query param, auth methods, protocol messages
- [ElevenLabs Models page](https://elevenlabs.io/docs/overview/models) — eleven_flash_v2_5 language list (32 languages; Afrikaans not listed)
- [BullMQ Job Schedulers guide](https://docs.bullmq.io/guide/job-schedulers) — upsertJobScheduler example
- [Hono WebSocket docs](https://hono.dev/docs/helpers/websocket) — upgradeWebSocket + websocket export pattern
- [Hono issue #2535](https://github.com/honojs/hono/issues/2535) — CORS + WS immutable headers workaround
- Twilio docs (via search) — MediaUrl0 with Basic auth pattern

### Tertiary (LOW confidence)
- ElevenLabs Afrikaans support — `eleven_v3` confirmed; `eleven_flash_v2_5` Afrikaans support not confirmed from official source — flag for live API test

---

## Metadata

**Confidence breakdown:**
- ElevenLabs SDK usage: HIGH — verified from installed types
- Output format `opus_48000_32`: HIGH — verified from `AllowedOutputFormats.d.ts`
- Model `eleven_flash_v2_5`: HIGH — confirmed from docs and search
- Afrikaans support on `eleven_flash_v2_5`: LOW — not confirmed; use `eleven_multilingual_v2` as safe fallback
- BullMQ `upsertJobScheduler` API: HIGH — verified from installed types
- OpenAI Whisper `toFile` + `language: 'af'`: HIGH — verified from installed types
- Twilio media fetch pattern: MEDIUM — confirmed via docs/search, not tested
- Hono WebSocket CORS conflict: MEDIUM — known issue, workaround documented

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (30 days — stable APIs)
