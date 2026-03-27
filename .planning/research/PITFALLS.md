# Domain Pitfalls

**Project:** VoiceApp — Voice AI + WhatsApp Backend
**Domain:** Voice-native AI companion, WhatsApp Cloud API integration, visually impaired accessibility
**Researched:** 2026-03-27
**Overall Confidence:** HIGH (most pitfalls verified against official docs + community issue trackers)

---

## Critical Pitfalls

Mistakes in this category cause rewrites, silent data loss, or demo-breaking failures.

---

### Pitfall C1: HMAC Signature Verification Against Parsed Body (Not Raw Body)

**What goes wrong:**
Any JSON parsing middleware — including Hono's built-in `c.req.json()` if called before verification — will deserialise and re-serialise the body. The resulting string differs from the original bytes Meta signed. The HMAC check always fails, so either you skip verification (leaving the webhook open to spoofed messages) or your handler rejects every real event.

**Why it happens:**
The `X-Hub-Signature-256` header contains a SHA256 HMAC of the exact raw bytes Meta sent, not of the parsed JSON object. Even whitespace differences in re-serialisation break the signature.

**Consequences:**
- Skip verification: any actor who finds your webhook URL can inject fake messages, triggering agent actions with fabricated contact data
- Enforce verification on parsed body: every legitimate Meta event returns 403, webhook stops working silently (Meta retries for 7 days then drops events)

**Prevention:**
Read the raw body bytes once at the top of the webhook handler before any parsing. In Hono + Bun:
```typescript
const rawBody = await c.req.text(); // capture bytes before any .json() call
const signature = c.req.header('x-hub-signature-256')?.replace('sha256=', '');
const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return c.text('Forbidden', 403);
const body = JSON.parse(rawBody); // parse after verification
```
Use `crypto.timingSafeEqual` — standard `===` leaks timing information.

**Warning signs:**
- All webhook POSTs return 403 immediately
- No events ever reach your handler even though Meta's test button says "success"
- HMAC check passes in development (where you might have disabled it) but fails in production

**Phase:** Supabase schema + backend skeleton (Phase 1) — implement correctly from the first route, not as a retrofit.

---

### Pitfall C2: Duplicate Webhook Events Processed Multiple Times

**What goes wrong:**
WhatsApp Cloud API guarantees at-least-once delivery with exponential backoff retries for up to 7 days. Network hiccups, brief process restarts, or any response that takes longer than 5–10 seconds triggers a retry. Without deduplication, every retry causes a second agent invocation — resulting in duplicate voice responses, duplicate database writes, and double-queued BullMQ jobs.

**Why it happens:**
The WhatsApp platform treats any non-200 response or a timeout as a delivery failure and retries. A 200ms LLM inference or ElevenLabs TTS call inside the webhook handler body will reliably exceed the timeout under load.

**Consequences:**
- User receives the same spoken message twice
- Contacts saved twice to `user_contacts`
- Agent invoked twice with identical user intent — second run may contradict the first

**Prevention:**
1. Return `200 OK` within 200ms of receiving the POST — acknowledge, then enqueue
2. Extract `messages[0].id` (for inbound) or `statuses[0].id` (for status updates) as a deduplication key
3. Store processed IDs in Redis with a 2-hour TTL: `SET msg:{id} 1 EX 7200 NX` — the `NX` flag makes this atomic
4. BullMQ is already in the stack: the webhook handler should be an enqueue-only function; all processing lives in the worker

**Warning signs:**
- User reports "it said that twice"
- `user_contacts` table has duplicate entries for the same phone number
- Agent tool logs show two identical tool calls within seconds of each other

**Phase:** Webhook handler (Phase 2, Phase 3). The enqueue-only pattern must be established at webhook creation, not added later.

---

### Pitfall C3: BullMQ Worker Crashes Under Bun — Stalled Jobs and Redis Key Eviction

**What goes wrong:**
Two distinct failure modes exist under Bun:

**Mode A — IORedis / native Redis client conflict:** Bun ships a native `Bun.redis` client that is incompatible with BullMQ. BullMQ internally uses `ioredis`. If you accidentally initialise `Bun.redis` instead of an `ioredis` instance and pass it to `new Worker(...)`, jobs stall immediately.

**Mode B — `maxRetriesPerRequest` not null:** BullMQ workers require `maxRetriesPerRequest: null` on the IORedis connection options. Without it, IORedis throws exceptions on certain commands that break the worker's event loop, causing silent stalls.

**Mode C — Redis key eviction:** If the Redis instance has `maxmemory-policy` set to anything other than `noeviction`, Redis may evict BullMQ's internal keys under memory pressure. Jobs disappear permanently with no error.

**Why it happens:**
BullMQ was historically Node-only. Bun support was closed as complete in 2024 but with a "not recommended for production yet" caveat from maintainers due to earlier segfault reports. The `ioredis` dependency is a Node-native module that Bun shims rather than natively supports.

**Consequences:**
- Heartbeat events queue up but no worker processes them
- Morning briefing cron fires but jobs never execute
- Active jobs become "stalled" — BullMQ recovers them on restart but only if `maxStalledCount` is configured

**Prevention:**
```typescript
// Always create the connection explicitly with ioredis
import IORedis from 'ioredis';
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // REQUIRED for BullMQ workers
  enableReadyCheck: false,
});
const worker = new Worker('heartbeat', processor, { connection });
```
Redis must be configured with `maxmemory-policy noeviction`.
Add `stalledInterval: 30000` and `maxStalledCount: 1` to worker options for hackathon durability.

**Warning signs:**
- Jobs added to queue but `worker.on('active')` never fires
- `queue.getWaiting()` grows but `queue.getActive()` stays at 0
- Redis `INFO memory` shows `maxmemory_policy: allkeys-lru`

**Phase:** Backend skeleton / BullMQ worker setup (Phase 2). Validate the worker actually processes a test job before building on top of it.

---

### Pitfall C4: Supabase service_role Key Bypasses RLS — Data Isolation Only Works for Anon/Authenticated Queries

**What goes wrong:**
The backend is designed to use `service_role` for all database operations. This is correct — but it means RLS policies provide zero protection against backend bugs. A bug in the agent that constructs the wrong `user_id` filter will silently return another user's messages. The RLS policies exist to protect against direct client (anon/authenticated) access, not backend access.

**Why it happens:**
Supabase's `service_role` key sets the `BYPASSRLS` Postgres attribute. Every row is visible regardless of your RLS `USING` clause. This is by design and documented, but easy to misunderstand when the security model says "RLS enforced at DB layer."

**Second failure mode:** If a user JWT somehow ends up in the `Authorization` header of a `service_role` client (e.g., an SSR framework that injects session cookies), the user's JWT overrides the service role, suddenly enforcing RLS against the logged-in user rather than bypassing it.

**Consequences:**
- Cross-user data leakage if agent tools don't consistently filter by `user_id`
- Unexpected 42501 RLS violation errors if a user JWT contaminates the service_role client
- RLS policies that appear to work in development (anon key) but fail to apply the same constraints in production (service_role backend)

**Prevention:**
- Never pass a user JWT to the Supabase client used by the backend. Keep one `service_role` client per process, initialised at startup from env, never re-initialised per request
- Every agent tool that queries user data must explicitly include `.eq('user_id', userId)` — do not rely on RLS to filter rows when using service_role
- RLS policies serve as the last-resort barrier for direct PostgREST calls; they are not a substitute for correct `user_id` filtering in backend code
- Write a test that queries with a fabricated `user_id` through the backend to verify isolation is enforced by the application layer

**Warning signs:**
- Agent returns messages belonging to a different user
- Service_role client suddenly gets 403 or 42501 errors (indicates a user JWT has leaked into the client)
- RLS policy test passes with anon key but does not enforce as expected with service_role

**Phase:** Supabase schema (Phase 1) and agent tools (Phase 3). Document the isolation model explicitly in the schema file so future contributors understand why manual `user_id` filtering is required.

---

### Pitfall C5: ElevenLabs Returns MP3 — WhatsApp Requires OGG/Opus for Voice Notes

**What goes wrong:**
ElevenLabs TTS defaults to MP3 output. WhatsApp's media upload endpoint for voice messages requires OGG/Opus format (audio/ogg; codecs=opus). Sending an MP3 file as a voice note either fails at upload or renders incorrectly on the recipient's device.

**Why it happens:**
ElevenLabs is a general-purpose TTS service. Its default output format (MP3 at 128kbps) is correct for browser playback but incorrect for WhatsApp voice messages. The ElevenLabs API supports `output_format: opus_48000_32` which produces native Opus output.

**Consequences:**
- WhatsApp media upload returns an error
- If upload somehow succeeds, the message appears as a broken attachment rather than a playable voice note
- Debugging this mid-demo is time-consuming

**Prevention:**
Always set `output_format: 'opus_48000_32'` in ElevenLabs requests when the output will be sent as a WhatsApp voice note. If sending TTS audio to the user as a regular audio attachment (not a voice note), MP3 is acceptable. Decide on the delivery mechanism early — voice note vs audio attachment — and set the format once at the service boundary.

**Warning signs:**
- WhatsApp API returns a 400 on media upload with an "invalid media type" error
- Audio message appears with a broken playback icon in WhatsApp

**Phase:** Voice command route / TTS integration (Phase 4). Establish the format constant in the ElevenLabs client wrapper on day one.

---

## Moderate Pitfalls

These cause wasted time or degraded quality but are recoverable without a rewrite.

---

### Pitfall M1: WhatsApp Status Updates Flood — Treating Every Webhook as a User Message

**What goes wrong:**
For every message your bot sends, WhatsApp delivers up to three status callbacks: `sent`, `delivered`, and `read`. At even modest traffic volumes these vastly outnumber inbound message events. Processing all of them through the full agent pipeline wastes tokens, adds latency, and can saturate your BullMQ queue.

**Why it happens:**
The webhook payload structure is identical for status updates and inbound messages but the routing key differs. The inbound message has `entry[].changes[].value.messages[]` populated. Status updates populate `entry[].changes[].value.statuses[]` instead.

**Prevention:**
At the top of the webhook handler, branch on payload type:
```typescript
const value = body.entry?.[0]?.changes?.[0]?.value;
if (value?.statuses) { return c.text('OK', 200); } // drop status updates entirely for v0.1
if (!value?.messages) { return c.text('OK', 200); } // unknown type — drop
// proceed with message processing
```
Status updates can be persisted to a `message_delivery_status` table for analytics, but should never trigger agent invocations.

**Warning signs:**
- BullMQ queue fills with jobs that produce no visible user-facing output
- Agent logs show tool calls with no corresponding user message
- Redis memory grows unexpectedly

**Phase:** Webhook handler (Phase 2).

---

### Pitfall M2: pgvector HNSW Index Not Created — Full Table Scans on Every Memory Query

**What goes wrong:**
pgvector performs exact nearest-neighbour search by default: every similarity query scans the entire vectors table. At even a few thousand rows (episodic memory entries across users) query time crosses 800ms and grows linearly. The 3-second ambient query budget is easily blown.

**Why it happens:**
Creating the HNSW index is a separate DDL step that is easy to forget when the table schema is defined in a migration. The query returns correct results without the index, so the absence is invisible until performance degrades.

**Prevention:**
Include the index in the initial migration, not as a later optimisation:
```sql
CREATE INDEX ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```
Use `vector_cosine_ops` with the `<=>` operator to match the distance function your application uses. Ensure the application query also uses `<=>` — mixing operators (e.g., `<#>` for inner product) silently bypasses the index.

**Warning signs:**
- `EXPLAIN ANALYZE` on a similarity query shows `Seq Scan` instead of `Index Scan`
- Memory retrieval latency exceeds 200ms for small datasets

**Phase:** Supabase schema (Phase 1). Create the index in the migration, not post-deploy.

---

### Pitfall M3: Context Window Accumulation in Long Agent Conversations

**What goes wrong:**
Each tool call round-trip appends the tool result to the context. In a multi-turn conversation (message read → identify sender → look up contacts → compose reply → confirm → send), the context grows rapidly. For claude-sonnet-4-6 the practical ceiling before compaction fires is ~170K tokens. In a voice-only interaction, the agent must also carry the full TTS-ready response text, which is verbose by necessity. Long sessions can exhaust the budget mid-conversation.

**Why it happens:**
The `@anthropic-ai/sdk` agentic loop appends every tool result to `messages[]`. There is no automatic pruning. The fast-path regex classification reduces LLM invocations for simple commands, but a morning briefing with multiple tool calls (load shedding + weather + message digest + TTS) can easily use 8–12 tool round-trips.

**Consequences:**
- API returns a 400 with `context_length_exceeded` mid-flow
- Partial morning briefing delivered — audio cuts off without explanation
- Confusing user experience in a voice-only interface (silence or no response)

**Prevention:**
- Keep system prompts under 2K tokens. Avoid embedding full contact lists in the system prompt; use a `lookup_contact` tool instead
- Summarise tool results before appending: instead of appending a full EskomSePush JSON payload, have the tool return "Load shedding Stage 2 in your area from 10:00 to 12:00 today"
- For the morning briefing specifically, define a maximum of 4 tool calls. If the briefing agent needs more, it has scope creep
- The fast-path regex bypass for common intents is essential — keep it

**Warning signs:**
- API errors containing `context_length_exceeded` during testing
- Briefing generation takes more than 8 seconds (excessive tool round-trips)
- System prompt bloat — measure token count before shipping

**Phase:** Agent tools (Phase 3). Build the context budget into the agent design, not as a fix after hitting the limit.

---

### Pitfall M4: ElevenLabs TTS Response Phrasing — Markdown Breaks Spoken Output

**What goes wrong:**
Claude naturally generates responses with markdown formatting: bold text (`**word**`), bullet lists (`- item`), numbered steps (`1. do this`). ElevenLabs reads these literally: asterisks become "asterisk asterisk word asterisk asterisk", hyphens become "hyphen item". The spoken output sounds broken and is inaccessible to visually impaired users.

**Why it happens:**
The system prompt constraint ("no markdown, no bullet points") must be reinforced structurally. Claude will comply during development but drift under edge cases — an unfamiliar query type, a long briefing with multiple facts, or a follow-up question that confuses the model about its output register.

**Prevention:**
- System prompt must explicitly state: "You are producing audio output. Never use markdown. Never use bullet points, bold, headers, or numbered lists. Speak as a person would: 'First... then... finally...' not '1. ... 2. ...'"
- Add a post-processing sanitiser that strips common markdown before calling ElevenLabs: `/\*\*/g`, `/^[-*]\s/gm`, `/#{1,6}\s/g`
- In tests, assert that TTS input strings contain none of: `*`, `#`, `-` (at line start), `` ` ``

**Warning signs:**
- TTS output includes spoken asterisks or hyphens
- User reports "it sounds garbled"
- Agent response text contains `**` or `##` in application logs

**Phase:** Agent tools and TTS pipeline (Phases 3, 4). Enforce in the system prompt and add the sanitiser at the TTS call boundary.

---

### Pitfall M5: Phone Numbers in TTS — Digit-by-Digit vs Natural Reading

**What goes wrong:**
ElevenLabs and most TTS engines read phone numbers either as a large cardinal number ("eighty-two hundred thirty-four...") or concatenated without pauses. Neither is intelligible for a visually impaired user who needs to hear a contact's phone number to verify it. South African numbers (e.g., `+27 82 234 5678`) have a specific grouping convention.

**Why it happens:**
The TTS engine receives a string like `+27822345678` and interprets it as a single large number or reads it digit-run by digit-run without the expected grouping pauses.

**Prevention:**
Format phone numbers before they reach TTS. Write a `formatPhoneForSpeech` utility:
```typescript
// +27822345678 → "plus 2 7, 8 2, 2 3 4, 5 6 7 8"
function formatPhoneForSpeech(e164: string): string {
  const local = e164.replace('+27', '0');
  // 0823456789 → "0 8 2, 3 4 5, 6 7 8 9"
  return local.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')
              .split('').join(' ');
}
```
Apply this to any agent response that includes a phone number. Also apply to contact name confirmation: "Sending to John Banda, number ending in 6 7 8 9. Shall I send?"

**Warning signs:**
- Users cannot repeat a phone number back after hearing it
- TTS reads "+27" as "plus twenty seven" (acceptable) but continues reading the rest as a continuous number

**Phase:** Agent tools / voice command route (Phases 3, 4). Build the formatter at the schema/utility layer once, use everywhere.

---

### Pitfall M6: ElevenLabs Professional Voice Clone Latency — Wrong Voice ID Selection

**What goes wrong:**
ElevenLabs has multiple voice tiers. Professional Voice Clones (PVC) have additional model complexity and add 100–300ms per generation compared to Instant Voice Clones or default voices. For a voice-native app targeting sub-500ms latency on common commands, choosing a PVC voice as the default eliminates the latency budget.

**Why it happens:**
PVC voices sound most natural — they are appealing for demos. Developers select them during testing without benchmarking the latency impact.

**Prevention:**
- Use a pre-made ElevenLabs voice for English and Afrikaans in v0.1. Turbo/Flash voices add only ~75ms model inference latency
- Request with `optimize_streaming_latency: 3` (max optimisations, normaliser on) or `4` (normaliser off — safe if TTS input is already normalised)
- Always stream (`stream: true`) rather than waiting for the complete audio buffer
- Benchmark your chosen voice ID in isolation before committing to it

**Warning signs:**
- Time-to-first-audio exceeds 800ms in local testing
- ElevenLabs dashboard shows voice type as "Professional Clone"

**Phase:** TTS integration (Phase 4). Select and benchmark voice IDs before the first end-to-end test.

---

### Pitfall M7: WhatsApp Webhook Verification — Silent Subscription Failure After Token Validation

**What goes wrong:**
The Meta Developer Console webhook registration has two independent steps:
1. GET verification (your endpoint returns `hub.challenge`)
2. WABA-to-App field subscription (subscribe to `messages`, `message_status`, etc.)

The console shows a green checkmark after step 1 even if step 2 silently fails. Real events never arrive, but the verification "success" creates a false sense that the webhook is working.

**Why it happens:**
Step 1 is synchronous and visible. Step 2 is an async graph API call that the Meta UI confirms optimistically in some versions of the developer console. Developers proceed to testing without verifying that field subscriptions are active.

**Prevention:**
After registering the webhook, send a test message from a real WhatsApp account and verify it arrives in your logs within 30 seconds. Do not rely solely on the console's verification status indicator. Check field subscriptions programmatically:
```bash
curl "https://graph.facebook.com/v19.0/{WABA-ID}/subscribed_apps" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```
The response should list your app ID under `subscribed_fields`.

**Warning signs:**
- Verification GET succeeds but no POST events arrive during testing
- Console shows "active" but `subscribed_apps` endpoint returns an empty list
- Events arrive for a few minutes then stop (indicates a subscription that was registered but not persisted)

**Phase:** Webhook handler (Phase 2). Validate end-to-end with a real message before building the agent on top.

---

## Minor Pitfalls

These cause friction but are straightforward to fix.

---

### Pitfall m1: BullMQ Redis `noeviction` Policy Not Set — Jobs Disappear Under Memory Pressure

**What goes wrong:**
Redis with default memory policies (`allkeys-lru` or `volatile-lru`) will evict BullMQ's internal sorted-set keys when memory is under pressure. Queued jobs disappear silently. This is especially dangerous for the morning briefing cron — a job enqueued the night before may simply not exist by morning.

**Prevention:**
Add to Redis config or set at runtime:
```bash
redis-cli CONFIG SET maxmemory-policy noeviction
```
Also configure AOF persistence (`appendonly yes`) so jobs survive process restarts.

**Phase:** Infrastructure setup (Phase 1/2). Set once at Redis initialisation.

---

### Pitfall m2: WhatsApp Cloud API — 250 Message/24h Limit Before Business Verification

**What goes wrong:**
New WhatsApp Business Accounts without completed Meta Business Verification are capped at 250 conversations per 24 hours. For a hackathon demo this is unlikely to be reached, but if the demo phone number was registered recently and verification is incomplete, the cap hits during a live demonstration.

**Prevention:**
Complete Meta Business Verification before the demo day. Check your WABA's messaging tier in the Meta Business Manager → WhatsApp Manager → Overview. Tier 1 (1,000 conversations/day) requires verification.

**Warning signs:**
- API returns error code 131049 ("Business account is not eligible") or 130472 ("User's number is part of an experiment")

**Phase:** Infrastructure / pre-demo checklist (Phase 5/Demo prep).

---

### Pitfall m3: WhatsApp Media Messages — Binary Not Included in Webhook Payload

**What goes wrong:**
When a user sends a voice note (audio message) to the bot, the webhook payload contains only a `media_id`, not the audio bytes. You must make a separate authenticated GET request to `https://graph.facebook.com/v19.0/{media-id}` to retrieve a temporary download URL, then download the bytes from that URL. Both requests require the access token.

**Prevention:**
Build a `downloadMedia(mediaId: string): Promise<Buffer>` utility that handles both the ID-to-URL lookup and the binary download. Cache the temporary URL for the duration of the request (it expires quickly). For voice note playback in v0.1, pipe the download URL directly to Whisper STT without persisting the audio file.

**Warning signs:**
- Webhook payload for an audio message has `type: "audio"` but no audio data in the body
- Handler crashes with "Cannot read property 'data' of undefined" when expecting audio bytes

**Phase:** Webhook handler (Phase 2), voice note playback (Phase 4).

---

### Pitfall m4: Whisper STT — Afrikaans and Accented South African English Transcription Failures

**What goes wrong:**
OpenAI Whisper performs significantly better on standard American English than on South African English accents or Afrikaans. The `language` parameter defaults to auto-detection. When a user code-switches between English and Afrikaans mid-sentence (common in South Africa), Whisper may detect the wrong language and produce garbled output.

**Prevention:**
- Pass `language: 'af'` for Afrikaans sessions and `language: 'en'` for English — let the user's preference (stored in `user_settings.preferred_language`) drive the hint
- Accept that STT accuracy may be 85–90% rather than 95%+ for local accents; design the confirmation loop ("Did you say you want to send to John Banda?") to be the error recovery mechanism
- For the hackathon demo: script the demo commands using clear, slow speech and test the specific phrases used in the demo flow

**Warning signs:**
- Transcription of Afrikaans words appears in English transliteration
- Common South African English words ("eish", "lekker", "braai") transcribed as nonsense

**Phase:** Voice command route (Phase 4). STT language hints must be set at the call boundary.

---

### Pitfall m5: Hono Body Parsed Before Middleware — Route Order Matters

**What goes wrong:**
If a global JSON parsing middleware is registered before the webhook route (e.g., `app.use('*', async (c, next) => { await c.req.json(); ... })`), the raw body stream is consumed. Subsequent calls to `c.req.text()` or `c.req.arrayBuffer()` return empty content. The HMAC check gets an empty string to hash.

**Prevention:**
Do not register a global body-parsing middleware in Hono. Parse the body explicitly per-route. The webhook route should call `c.req.text()` first, then `JSON.parse(...)` after HMAC verification. Other routes can call `c.req.json()` directly.

**Warning signs:**
- `c.req.text()` returns `""` in the webhook handler
- HMAC computed against empty string — never matches

**Phase:** Backend skeleton (Phase 1/2). Establish the route registration pattern before adding any middleware.

---

## Hackathon-Specific Traps

---

### Pitfall H1: Scope Creep on Voice Flows — Every Error Needs an Audio Response

**What goes wrong:**
Building voice flows exposes how many error states produce silent failures in a text-based app. When a contact lookup fails, a text app shows a toast; a voice app must speak "I couldn't find a contact called John. Would you like to add a new contact?" Every unhappy path needs TTS copy, which multiplies the time each feature takes to implement.

**Prevention:**
Define a `spokenError(context: string): string` utility that generates fallback TTS copy from a template. Do not write custom error copy per flow in v0.1. Use: "Sorry, I had a problem with [context]. Please try again." This covers 80% of cases without per-flow design.

Timebox each P0 feature strictly. If the confirmation loop for sending messages takes more than 45 minutes to implement, cut the sub-feature that is taking the time, not the confirmation loop itself (the confirmation loop is safety-critical for the target user).

**Phase:** All feature phases. Establish the `spokenError` utility in Phase 1.

---

### Pitfall H2: Demo Failure — Environment Variables Not Set in Demo Environment

**What goes wrong:**
All API keys (WhatsApp access token, ElevenLabs, Anthropic, Supabase, OpenAI) must be present in the demo runtime. A missing key produces a startup crash or a runtime error that is difficult to diagnose under demo pressure.

**Prevention:**
Write a `validateEnv()` function that runs at startup and throws with a clear message listing every missing required variable:
```typescript
const REQUIRED = [
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_PHONE_NUMBER_ID',
  'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID_EN', 'ELEVENLABS_VOICE_ID_AF',
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'REDIS_URL',
];
REQUIRED.forEach(k => { if (!process.env[k]) throw new Error(`Missing env: ${k}`); });
```
Run this check before `Bun.serve(...)`. Test the demo environment 1 hour before presenting.

**Phase:** Backend skeleton (Phase 1). The validator must exist before any other code that reads env vars.

---

### Pitfall H3: Demo Failure — WhatsApp Access Token Expiry Mid-Demo

**What goes wrong:**
WhatsApp Cloud API user access tokens expire (by default after 60 days for long-lived tokens, or 24 hours for short-lived). If the token used in development expires during the demo, all outbound messages fail with a 190 error ("Invalid OAuth access token").

**Prevention:**
Generate a fresh long-lived system user token from the Meta Business Manager at least 1 hour before the demo. System user tokens (not user access tokens) are more stable and do not expire in 24 hours. Store the expiry date in the project notes.

**Warning signs:**
- API returns `{"error": {"code": 190}}` or `OAuthException: Invalid OAuth access token`
- Outbound messages stop sending; inbound webhooks continue working (webhook verification uses the app secret, not the access token)

**Phase:** Pre-demo checklist (Phase 5/Demo prep).

---

### Pitfall H4: Agent Loop Without Timeout — Runaway Tool Calls Block the Queue

**What goes wrong:**
A Claude agent in an agentic loop with access to tools has no built-in timeout. If a tool (e.g., EskomSePush API) hangs, the agent waits indefinitely. The BullMQ worker job that triggered the agent stays in `active` state, consuming a worker slot. Under the default `lockDuration` of 30 seconds, BullMQ marks the job as stalled and re-queues it — spawning a second agent invocation that also hangs.

**Prevention:**
- Wrap every external API call in an `AbortController` with a 5-second timeout
- Set BullMQ job options: `{ attempts: 1, removeOnComplete: true, timeout: 15000 }` — timeout terminates the job before BullMQ's `lockDuration` fires
- Agent orchestrator must pass a max tool call count: if a single conversation uses more than 10 tool calls, abort and return a spoken error

**Warning signs:**
- Worker `active` count stays at 1 indefinitely
- Same job appears in completed queue multiple times (stall-and-retry loop)
- Redis `TYPE bullmq:heartbeat:active` returns a sorted set with one persistent entry

**Phase:** Agent tools / heartbeat engine (Phase 3). Timeouts belong in the initial agent configuration.

---

## Phase-Specific Warning Summary

| Phase | Topic | Likely Pitfall | Key Mitigation |
|-------|-------|----------------|----------------|
| 1 — Schema | Supabase setup | service_role bypasses RLS — app must filter by user_id | Every query includes `.eq('user_id', userId)` |
| 1 — Schema | pgvector | Missing HNSW index causes slow queries | Include index in initial migration |
| 1 — Skeleton | Environment | Missing env vars crash demo | `validateEnv()` at startup |
| 1 — Skeleton | Hono middleware | Global body parser consumes raw body | No global JSON middleware; parse per-route |
| 2 — Webhook | HMAC | Parsing before signature check breaks verification | `c.req.text()` before any `.json()` call |
| 2 — Webhook | Duplicates | At-least-once delivery causes double processing | Enqueue-only handler + Redis NX deduplication key |
| 2 — Webhook | Status floods | Status update events trigger agent invocations | Branch on `value.statuses` vs `value.messages` at top of handler |
| 2 — Webhook | Subscription | Verification passes but events never arrive | Validate field subscriptions via API, not just console |
| 2 — BullMQ | Redis config | Key eviction destroys queued jobs | `noeviction` policy + AOF persistence |
| 2 — BullMQ | IORedis options | `maxRetriesPerRequest` default breaks workers | `maxRetriesPerRequest: null` on connection |
| 3 — Agent | Context growth | Tool results bloat context window | Compact tool results; cap at 10 tool calls per conversation |
| 3 — Agent | Timeouts | Hanging external calls stall worker slots | `AbortController` + `timeout: 15000` on BullMQ jobs |
| 4 — Voice | TTS format | MP3 output rejected by WhatsApp voice note API | `output_format: 'opus_48000_32'` on ElevenLabs requests |
| 4 — Voice | Markdown in TTS | Claude formatting breaks spoken output | Post-processing sanitiser + system prompt constraint |
| 4 — Voice | Phone number reading | Numbers read as cardinal integers | `formatPhoneForSpeech()` utility before every TTS call |
| 4 — Voice | PVC latency | Professional voice clone exceeds latency budget | Use Flash/turbo voice, benchmark before committing |
| 4 — Voice | Whisper language | Auto-detect fails on Afrikaans / SA English | Pass `language` hint from user preference |
| 5 — Demo prep | Access token | WhatsApp token expires mid-demo | Generate fresh system user token 1 hour before demo |
| 5 — Demo prep | WABA tier | 250-message cap on unverified accounts | Complete Meta Business Verification pre-demo |

---

## Sources

- [Hookdeck — Guide to WhatsApp Webhooks](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- [Medium — Handling Duplicate Webhooks in WhatsApp API Using Redis](https://medium.com/@nkangprecious26/handling-duplicate-webhooks-in-whatsapp-api-using-redis-d7d117731f95)
- [BullMQ GitHub Issue #2177 — Make BullMQ Compatible with Bun](https://github.com/taskforcesh/bullmq/issues/2177)
- [BullMQ Docs — Going to Production](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ Docs — Failing Fast When Redis Is Down](https://docs.bullmq.io/failing-fast-when-redis-is-down)
- [Supabase Docs — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Docs — Understanding API Keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase GitHub Discussion #34958 — service_role key does not work unless RLS policies deleted](https://github.com/orgs/supabase/discussions/34958)
- [ElevenLabs Docs — Understanding Latency](https://elevenlabs.io/docs/eleven-api/concepts/latency)
- [ElevenLabs Blog — Enhancing Conversational AI Latency](https://elevenlabs.io/blog/enhancing-conversational-ai-latency-with-efficient-tts-pipelines)
- [ElevenLabs Blog — ElevenLabs Agents now support WhatsApp](https://elevenlabs.io/blog/elevenlabs-agents-whatsapp-support)
- [4 pgvector Mistakes That Silently Break Your RAG Pipeline — DEV Community](https://dev.to/mianzubair/4-pgvector-mistakes-that-silently-break-your-rag-pipeline-in-production-4e0p)
- [Anthropic — Advanced Tool Use Engineering Blog](https://www.anthropic.com/engineering/advanced-tool-use)
- [Parallel HQ — Voice User Interface Design Principles](https://www.parallelhq.com/blog/voice-user-interface-vui-design-principles)
- [Agora.io — 10 Lessons Learned Building Voice AI Agents](https://www.agora.io/en/blog/lessons-learned-building-voice-ai-agents/)
- [WASenderApi — WhatsApp API Rate Limits Explained](https://wasenderapi.com/blog/whatsapp-api-rate-limits-explained-how-to-scale-messaging-safely-in-2025)
- [OneUptime — How to Handle Worker Crashes in BullMQ (2026)](https://oneuptime.com/blog/post/2026-01-21-bullmq-worker-crashes-recovery/view)
