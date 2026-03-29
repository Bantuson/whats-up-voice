// src/routes/api.ts
// POST /api/voice/command — Phase 3 agent intelligence entry point.
// All routes here are protected by Bearer auth middleware in server.ts (mounted at /api).
// Fast-path intents bypass the LLM entirely (< 1ms). Slow-path routes to Claude orchestrator.
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { EventEmitter } from 'node:events'
import { toFile } from 'openai'
import OpenAI from 'openai'

// Singleton emitters — heartbeat worker emits here; SSE streams consume
export const heartbeatEmitter = new EventEmitter()
export const agentStateEmitter = new EventEmitter()
import { classifyIntent } from '../agent/classifier'
import { generatePodcast, parsePodcastSegments, stitchPodcastAudio, scriptToPlainText } from '../tools/podcast'
import { runOrchestrator } from '../agent/orchestrator'
import { toolReadMessages } from '../tools/whatsapp'
import { toolGetLoadShedding, toolGetWeather, toolWebSearch } from '../tools/ambient'
import { getState, getPhase, clearSession, transition, setDetectedLanguage, appendConversationTurn, getConversationHistory, hydratePendingMessage } from '../session/machine'
import { supabase } from '../db/client'
import { spokenError } from '../lib/errors'
import { streamSpeech, synthesiseSpeech } from '../tts/openai-tts'
import { activateTranslation, deactivateTranslation, translateUtterance } from '../tools/translation'
import { sanitiseForSpeech } from '../agent/sanitiser'
import { startNavigation, stopNavigation } from '../tools/navigation'

export const apiRouter = new Hono()

// ---------------------------------------------------------------------------
// GET /api/sse/heartbeat — live heartbeat decision feed (FE-04)
// Bearer token passed as ?token= query param (EventSource does not support headers)
// ---------------------------------------------------------------------------
apiRouter.get('/sse/heartbeat', (c) => {
  return streamSSE(c, async (stream) => {
    const listener = (event: unknown) => {
      stream.writeSSE({ event: 'heartbeat', data: JSON.stringify(event) }).catch(() => {})
    }
    heartbeatEmitter.on('decision', listener)
    try {
      while (true) {
        await stream.sleep(30_000)
        await stream.writeSSE({ event: 'ping', data: 'keep-alive' })
      }
    } finally {
      heartbeatEmitter.off('decision', listener)
    }
  })
})

// ---------------------------------------------------------------------------
// GET /api/sse/agent-state — live session phase updates (FE-03)
// ---------------------------------------------------------------------------
apiRouter.get('/sse/agent-state', (c) => {
  return streamSSE(c, async (stream) => {
    const listener = (event: unknown) => {
      stream.writeSSE({ event: 'agent-state', data: JSON.stringify(event) }).catch(() => {})
    }
    agentStateEmitter.on('phase', listener)
    try {
      while (true) {
        await stream.sleep(30_000)
        await stream.writeSSE({ event: 'ping', data: 'keep-alive' })
      }
    } finally {
      agentStateEmitter.off('phase', listener)
    }
  })
})

// Lazy OpenAI singleton — same pattern as ambient.ts
let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  return _openai
}

// Emit a composing-phase hint to all connected SSE clients
function emitHint(hint: string) {
  agentStateEmitter.emit('phase', { phase: 'composing', hint })
}

// In-process no-match counter for three-strike approval reset (AGENT-05).
// Must be cleared whenever clearSession() is called.
const noMatchCounts = new Map<string, number>()

function clearUserState(userId: string): void {
  clearSession(userId)
  noMatchCounts.delete(userId)
}

// ---------------------------------------------------------------------------
// deliverSpoken — returns JSON; frontend fetches /api/tts to play audio.
// WebSocket (streamSpeech) is reserved for background pushes only
// (navigation waypoints, translation, heartbeat interrupts).
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverSpoken(c: any, userId: string, spoken: string, action: string, rest: Record<string, unknown> = {}): Promise<Response> {
  try { transition(userId, 'playing') } catch { /* ignore — session may not allow playing */ }
  try { transition(userId, 'idle')    } catch { /* ignore */ }
  return c.json({ spoken, action, requiresConfirmation: false, ...rest })
}

// ---------------------------------------------------------------------------
// POST /api/voice/command
// Body (JSON): { userId: string, transcript: string, sessionId?: string }
// Body (multipart): { userId: string, audioBlob: File }
// Response: { spoken: string, action: string, requiresConfirmation: boolean, pendingAction?: object }
// ---------------------------------------------------------------------------
apiRouter.post('/voice/command', async (c) => {
  let userId: string
  let transcript: string

  try {
    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      // STT path (VOICE-02)
      const formData = await c.req.formData()
      const userIdField = formData.get('userId')
      const audioBlobField = formData.get('audioBlob')

      if (!userIdField || !audioBlobField || !(audioBlobField instanceof File)) {
        return c.json({ error: 'userId and audioBlob are required for multipart requests' }, 400)
      }
      userId = String(userIdField)

      // Fetch language from user_profile for Whisper language hint
      const { data: profile } = await supabase
        .from('user_profile')
        .select('language')
        .eq('user_id', userId)
        .single()
      const lang: string = profile?.language ?? 'en'

      // Convert File → openai File using toFile() helper
      const arrayBuffer = await audioBlobField.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' })

      const result = await getOpenAI().audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: lang,
      })
      transcript = result.text.trim()
      if (!transcript) {
        return c.json({ error: 'STT returned empty transcript' }, 422)
      }
      // Show transcript preview in composing hint
      const preview = transcript.length > 60 ? transcript.slice(0, 60) + '…' : transcript
      emitHint(`Heard: "${preview}"`)
      // Store Whisper-detected language in session for translation bidirectionality
      // result.language is present at runtime (Whisper returns it) but not in the OpenAI SDK type
      const whisperResult = result as typeof result & { language?: string }
      if (whisperResult.language) {
        setDetectedLanguage(userId, whisperResult.language)
      }
    } else {
      // Existing JSON text path (VOICE-01 — preserved exactly)
      const body = await c.req.json() as { userId?: string; transcript?: string; sessionId?: string }
      if (!body.userId || !body.transcript) {
        return c.json({ error: 'userId and transcript are required' }, 400)
      }
      userId = body.userId
      transcript = body.transcript.trim()
    }
  } catch (err) {
    console.error('[VoiceCommand] Request parsing / STT error:', err)
    return c.json({ error: 'Invalid request body' }, 400)
  }

  // Restore pending message from Supabase if server restarted mid-confirmation
  await hydratePendingMessage(userId)

  console.log(`[VoiceCommand] transcript="${transcript}" userId=${userId}`)
  const intent = classifyIntent(transcript)
  const sessionPhase = getPhase(userId)

  // Emit intent-contextual hint so the composing card reflects what's happening
  const INTENT_HINTS: Record<string, string> = {
    confirm_send:      'Sending your message…',
    cancel:            'Cancelling…',
    stop_translation:  'Stopping translation…',
    start_translation: 'Activating translation…',
    load_shedding:     'Checking load shedding schedule…',
    weather:           'Fetching current weather…',
    read_messages:     'Reading your messages…',
    web_search:        'Searching the web…',
    podcast_request:   'Researching your topic…',
    play_podcast:      'Finding your podcast…',
    short_version:     'Condensing podcast…',
    stop_navigation:   'Stopping navigation…',
    start_navigation:  'Starting navigation…',
  }
  emitHint(intent ? (INTENT_HINTS[intent] ?? 'Processing…') : 'Thinking…')

  // ------------------------------------------------------------------
  // FAST PATH: confirm / cancel (approval loop — AGENT-05)
  // Context-aware fallback: when already awaiting_approval, broaden the
  // affirmative/negative detection so Whisper variations ("Yes, please.",
  // "Yeah go ahead", "Yes I confirm") still route correctly.
  // ------------------------------------------------------------------
  if (intent === 'confirm_send') {
    return handleConfirmSend(c, userId)
  }

  if (intent === 'cancel') {
    clearUserState(userId)
    return deliverSpoken(c, userId, 'Message cancelled.', 'cancel')
  }

  // Broader approval detection — only fires when session is already awaiting confirmation
  if (sessionPhase === 'awaiting_approval' && intent === null) {
    const t = transcript.toLowerCase()
    const isYes = /\b(yes|yeah|yep|yup|ok|okay|sure|confirm|correct|right|send it|go ahead|do it|please|please send|send the message|send that)\b/.test(t)
    const isNo  = /\b(no|nope|cancel|stop|don't send|abort|never mind|change it|actually)\b/.test(t)
    if (isYes) return handleConfirmSend(c, userId)
    if (isNo)  { clearUserState(userId); return deliverSpoken(c, userId, 'Message cancelled.', 'cancel') }
  }

  // ------------------------------------------------------------------
  // FAST PATH: stop_translation — deactivate translation session
  // ------------------------------------------------------------------
  if (intent === 'stop_translation') {
    await deactivateTranslation(userId)
    return deliverSpoken(c, userId, 'Translation mode stopped. Back to normal.', 'stop_translation')
  }

  // ------------------------------------------------------------------
  // FAST PATH: start_translation — extract language + activate
  // ------------------------------------------------------------------
  if (intent === 'start_translation') {
    // Extract language from transcript
    const langMatch = transcript.match(/\b(zulu|xhosa|sotho|sesotho|afrikaans|french|portuguese|swahili|english)\b/i)
    const langName = langMatch?.[1]?.toLowerCase() ?? ''
    const LANG_CODE_MAP: Record<string, string> = {
      zulu: 'zu', xhosa: 'xh', sotho: 'st', sesotho: 'st',
      afrikaans: 'af', english: 'en', french: 'fr', portuguese: 'pt', swahili: 'sw',
    }
    const targetLanguage = LANG_CODE_MAP[langName] ?? langName
    const result = await activateTranslation(userId, targetLanguage || 'en')
    return deliverSpoken(c, userId, result.spokenConfirmation, 'start_translation')
  }

  // ------------------------------------------------------------------
  // TRANSLATION MODE INTERCEPT: if session is translating and intent is not
  // a control command, translate the utterance instead of normal processing
  // ------------------------------------------------------------------
  const currentState = getState(userId)
  if (currentState.phase === 'translating' && intent === null) {
    const translated = await translateUtterance(userId, transcript)
    return c.json({ spoken: translated, action: 'translate', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // THREE-STRIKE RESET (AGENT-05)
  // If session is awaiting_approval and intent doesn't match confirm/cancel,
  // increment no-match counter; reset after 3 misses.
  // ------------------------------------------------------------------
  if (sessionPhase === 'awaiting_approval' && intent === null) {
    const count = (noMatchCounts.get(userId) ?? 0) + 1
    noMatchCounts.set(userId, count)
    if (count >= 3) {
      clearUserState(userId)
      return c.json({
        spoken: "I didn't understand that three times. The pending message has been cancelled.",
        action: 'error',
        requiresConfirmation: false,
      })
    }
    const remaining = 3 - count
    return c.json({
      spoken: `I didn't catch that. Say yes to confirm, or no to cancel. ${remaining} attempt${remaining !== 1 ? 's' : ''} left.`,
      action: 'awaiting',
      requiresConfirmation: true,
      pendingAction: getState(userId).pendingMessage
        ? { type: 'send_message', ...getState(userId).pendingMessage }
        : undefined,
    })
  }

  // ------------------------------------------------------------------
  // FAST PATH: ambient queries (no LLM — AGENT-06)
  // Use a short 5-second AbortSignal for each external call.
  // ------------------------------------------------------------------
  if (intent === 'load_shedding') {
    const signal = AbortSignal.timeout(5000)
    const spoken = await toolGetLoadShedding(signal)
    return deliverSpoken(c, userId, spoken, 'fast_path')
  }

  if (intent === 'weather') {
    const signal = AbortSignal.timeout(5000)
    const spoken = await toolGetWeather(signal)
    return deliverSpoken(c, userId, spoken, 'fast_path')
  }

  // ------------------------------------------------------------------
  // FAST PATH: read messages (no LLM — AGENT-01, AGENT-02)
  // ------------------------------------------------------------------
  if (intent === 'read_messages') {
    const spoken = await toolReadMessages(userId, 5)
    return deliverSpoken(c, userId, spoken, 'fast_path')
  }

  // ------------------------------------------------------------------
  // FAST PATH: web_search without LLM — route directly to Tavily tool
  // ------------------------------------------------------------------
  if (intent === 'web_search') {
    const signal = AbortSignal.timeout(5000)
    const spoken = await toolWebSearch(transcript, signal)
    return deliverSpoken(c, userId, spoken, 'fast_path')
  }

  // ------------------------------------------------------------------
  // FAST PATH: podcast_request — research + synthesise + TTS (VI-PODCAST-01)
  // ------------------------------------------------------------------
  if (intent === 'podcast_request') {
    // Extract topic from transcript — strip known trigger phrases
    const topic = transcript
      .replace(/^(tell me (something |a story |more )?(about|on)|make (me )?a podcast (about)?|i want to hear about|podcast about|tell me about)\s*/i, '')
      .trim() || transcript
    // generatePodcast: Tavily research → Claude synthesis → DB save → returns script
    // Audio delivery is handled by the frontend via /api/tts (HTTP, reliable)
    // No WebSocket call here — avoids triple-delivery (streamSpeech×2 + HTTP)
    const spoken = await generatePodcast(topic, userId)
    return c.json({ spoken, action: 'podcast', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // FAST PATH: play_podcast — look up most recent matching podcast in DB (VI-PODCAST-03)
  // ------------------------------------------------------------------
  if (intent === 'play_podcast') {
    // Extract optional topic keyword from transcript
    const topicKeyword = transcript
      .replace(/play (my |the |latest |recent )?(podcast|episode)|replay (podcast|episode)|listen to (my |the )?(podcast|episode)/i, '')
      .replace(/\babout\b/i, '')
      .trim()

    let query = supabase
      .from('generated_podcasts')
      .select('id, topic, script')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (topicKeyword) {
      query = supabase
        .from('generated_podcasts')
        .select('id, topic, script')
        .eq('user_id', userId)
        .ilike('topic', `%${topicKeyword}%`)
        .order('created_at', { ascending: false })
        .limit(1)
    }

    const { data: rows } = await query
    const podcast = rows?.[0]
    if (!podcast) {
      const spoken = topicKeyword
        ? `I don't have a podcast about ${topicKeyword} yet. Say tell me about ${topicKeyword} to generate one.`
        : "You don't have any podcasts yet. Say tell me about a topic to generate one."
      return c.json({ spoken, action: 'play_podcast', requiresConfirmation: false })
    }

    // Return plain-text script (strip host markers) so frontend TTS works without parsing
    const spoken = scriptToPlainText(podcast.script as string)
    return c.json({ spoken, action: 'play_podcast', podcastId: podcast.id as string, topic: podcast.topic as string, requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // FAST PATH: short_version — re-synthesise condensed podcast (VI-PODCAST-02)
  // ------------------------------------------------------------------
  if (intent === 'short_version') {
    const spoken = await runOrchestrator(userId, 'Please give me a short version or summary of what you just told me.', AbortSignal.timeout(15_000))
    return deliverSpoken(c, userId, spoken, 'short_version')
  }

  // ------------------------------------------------------------------
  // FAST PATH: stop_navigation — exit navigation session (VI-NAV-03)
  // ------------------------------------------------------------------
  if (intent === 'stop_navigation') {
    await stopNavigation(userId)
    return deliverSpoken(c, userId, 'Navigation stopped. You can ask me anything.', 'stop_navigation')
  }

  // ------------------------------------------------------------------
  // FAST PATH: start_navigation — extract destination + begin route (VI-NAV-01)
  // ------------------------------------------------------------------
  if (intent === 'start_navigation') {
    const destination = transcript
      .replace(/^(help me (get|go) to|navigate to|take me to|directions? to|how do i get to|find my way to)\s*/i, '')
      .trim()
    if (!destination || destination.toLowerCase() === transcript.toLowerCase().trim()) {
      return deliverSpoken(c, userId, 'Where would you like to go? Please say the destination.', 'navigation_prompt')
    }
    const result = await startNavigation(userId, destination)
    if (!result.started) {
      return deliverSpoken(c, userId, result.firstDescription, 'navigation_error')
    }
    return c.json({ spoken: result.firstDescription, action: 'navigation_started', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // NAVIGATION INTERRUPTION INTERCEPT: if user speaks during navigation,
  // pause, answer the question, then offer to resume (VI-NAV-03)
  // ------------------------------------------------------------------
  const navState = getState(userId)
  if (navState.phase === 'navigating' && intent === null) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let spoken: string
    try {
      const history = getConversationHistory(userId)
      const answer = await runOrchestrator(userId, transcript, controller.signal, history)
      appendConversationTurn(userId, transcript, answer)
      // Restore navigating phase after orchestrator may have changed it
      try { transition(userId, 'navigating') } catch { /* ignore */ }
      spoken = sanitiseForSpeech(`${answer} Say continue navigation to resume your route, or ask me anything else.`)
    } finally {
      clearTimeout(timer)
    }
    return c.json({ spoken, action: 'navigation_interrupted', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // LLM PATH: orchestrator handles send_message, save_contact, set_priority,
  // message_digest, and all unrecognised transcripts (null fast-path)
  // ------------------------------------------------------------------
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const history = getConversationHistory(userId)
    const spoken = await runOrchestrator(userId, transcript, controller.signal, history)
    appendConversationTurn(userId, transcript, spoken)
    const state = getState(userId)
    const requiresConfirmation = state.phase === 'awaiting_approval'
    if (!requiresConfirmation) {
      return deliverSpoken(c, userId, spoken, 'agent')
    }
    return c.json({
      spoken,
      action: 'agent',
      requiresConfirmation,
      pendingAction: requiresConfirmation && state.pendingMessage
        ? { type: 'send_message', ...state.pendingMessage }
        : undefined,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    const isTimeout = msg.includes('aborted') || msg.includes('timeout')
    console.error('[VoiceCommand] Orchestrator error:', err)
    return c.json({
      spoken: spokenError(isTimeout ? 'processing your request — it timed out' : 'processing your request'),
      action: 'error',
      requiresConfirmation: false,
    })
  } finally {
    clearTimeout(timer)
  }
})

// ---------------------------------------------------------------------------
// POST /api/voice/playback — VOICE-05
// Body: { userId: string, mediaUrl: string }
// Fetches Twilio media with Basic auth and streams audio to user's WebSocket.
// ---------------------------------------------------------------------------
apiRouter.post('/voice/playback', async (c) => {
  let userId: string
  let mediaUrl: string
  try {
    const body = await c.req.json() as { userId?: string; mediaUrl?: string }
    if (!body.userId || !body.mediaUrl) {
      return c.json({ error: 'userId and mediaUrl are required' }, 400)
    }
    userId = body.userId
    mediaUrl = body.mediaUrl
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const ws = (await import('../ws/connections')).getConnection(userId)
  if (!ws) {
    return c.json({ error: 'No active WebSocket connection for user' }, 404)
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken  = process.env.TWILIO_AUTH_TOKEN!
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

  try {
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(10_000),
    })
    if (!mediaRes.ok || !mediaRes.body) {
      return c.json({ error: 'Failed to fetch media' }, 502)
    }

    ws.send(JSON.stringify({ type: 'audio_start' }))

    const reader = mediaRes.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) ws.send(value)
    }

    ws.send(JSON.stringify({ type: 'audio_end' }))
    return c.json({ streamed: true }, 200)
  } catch {
    return c.json({ error: 'Media streaming failed' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/tts — convert text to MP3 audio, return binary response
// Body: { text: string, userId: string }
// Used by frontend after /api/voice/command returns spoken text.
// ---------------------------------------------------------------------------
apiRouter.post('/tts', async (c) => {
  let body: { text?: string; userId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  if (!body.text || !body.userId) return c.json({ error: 'text and userId are required' }, 400)
  try {
    const audio = await synthesiseSpeech(body.text, body.userId)
    return c.body(audio, 200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.byteLength),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[TTS] /api/tts error:', msg)
    return c.json({ error: msg }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /api/contacts?userId= — list VI user's contacts
// ---------------------------------------------------------------------------
apiRouter.get('/contacts', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) return c.json({ error: 'userId is required' }, 400)
  const { data, error } = await supabase
    .from('user_contacts')
    .select('id, name, phone, is_priority')
    .eq('user_id', userId)
    .order('name')
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ contacts: data ?? [] })
})

// ---------------------------------------------------------------------------
// POST /api/contacts — add a contact for VI user
// ---------------------------------------------------------------------------
apiRouter.post('/contacts', async (c) => {
  let body: { userId?: string; name?: string; phone?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  if (!body.userId || !body.name || !body.phone) {
    return c.json({ error: 'userId, name and phone are required' }, 400)
  }
  if (!/^\+\d{10,15}$/.test(body.phone)) {
    return c.json({ error: 'phone must be E.164 format e.g. +27831000000' }, 400)
  }
  const { data, error } = await supabase
    .from('user_contacts')
    .insert({ user_id: body.userId, name: body.name.trim(), phone: body.phone.trim() })
    .select('id, name, phone, is_priority')
    .single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ contact: data })
})

// ---------------------------------------------------------------------------
// DELETE /api/contacts/:id — remove a contact
// ---------------------------------------------------------------------------
apiRouter.delete('/contacts/:id', async (c) => {
  const id = c.req.param('id')
  const { error } = await supabase.from('user_contacts').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ deleted: true })
})

// ---------------------------------------------------------------------------
// POST /api/settings — upsert VI user profile
// Body: { userId, language, location, quietFrom, quietTo, morningBriefing }
// ---------------------------------------------------------------------------
apiRouter.post('/settings', async (c) => {
  let body: { userId?: string; language?: string; location?: string; quietFrom?: string; quietTo?: string; morningBriefing?: boolean }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  if (!body.userId) return c.json({ error: 'userId is required' }, 400)
  const { error } = await supabase
    .from('user_profile')
    .upsert({
      user_id: body.userId,
      language: body.language ?? 'en',
      location: body.location ?? null,
      quiet_hours_start: body.quietFrom ?? null,
      quiet_hours_end:   body.quietTo   ?? null,
      briefing_enabled:  body.morningBriefing ?? true,
    }, { onConflict: 'user_id' })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ saved: true })
})

// ---------------------------------------------------------------------------
// GET /api/routines?userId= — list user routines
// ---------------------------------------------------------------------------
apiRouter.get('/routines', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) return c.json({ error: 'userId is required' }, 400)
  const { data, error } = await supabase
    .from('routines')
    .select('id, label, cron_expression, routine_type, enabled')
    .eq('user_id', userId)
    .order('created_at')
  if (error) return c.json({ error: error.message }, 500)
  return c.json((data ?? []).map((r) => ({
    id:      r.id,
    label:   r.label ?? r.routine_type,
    cron:    r.cron_expression,
    type:    r.routine_type,
    enabled: r.enabled,
  })))
})

// ---------------------------------------------------------------------------
// PATCH /api/contacts/:id/priority — toggle is_priority flag
// ---------------------------------------------------------------------------
apiRouter.patch('/contacts/:id/priority', async (c) => {
  const id = c.req.param('id')
  let body: { is_priority?: boolean }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  if (typeof body.is_priority !== 'boolean') return c.json({ error: 'is_priority (boolean) is required' }, 400)
  const { error } = await supabase.from('user_contacts').update({ is_priority: body.is_priority }).eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ updated: true })
})

// ---------------------------------------------------------------------------
// PATCH /api/routines/:id — toggle routine enabled
// Body: { enabled: boolean }
// ---------------------------------------------------------------------------
apiRouter.patch('/routines/:id', async (c) => {
  const id = c.req.param('id')
  let body: { enabled?: boolean }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) is required' }, 400)
  const { error } = await supabase.from('routines').update({ enabled: body.enabled }).eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ updated: true })
})

// ---------------------------------------------------------------------------
// GET /api/podcasts?userId= — list persisted podcast scripts (newest first)
// ---------------------------------------------------------------------------
apiRouter.get('/podcasts', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) return c.json({ error: 'userId is required' }, 400)
  const { data, error } = await supabase
    .from('generated_podcasts')
    .select('id, topic, script, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ podcasts: data ?? [] })
})

// ---------------------------------------------------------------------------
// GET /api/podcasts/:id/audio — two-voice stitched MP3 for a saved podcast.
// Parses [THABO]/[NALEDI] markers and stitches ElevenLabs audio segments.
// ---------------------------------------------------------------------------
apiRouter.get('/podcasts/:id/audio', async (c) => {
  const id = c.req.param('id')
  const { data, error } = await supabase
    .from('generated_podcasts')
    .select('script')
    .eq('id', id)
    .single()
  if (error || !data) return c.json({ error: 'Podcast not found' }, 404)

  try {
    const segments = parsePodcastSegments(data.script as string)
    const audio = await stitchPodcastAudio(segments)
    return c.body(audio, 200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.byteLength),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Podcast] audio stitch failed:', msg)
    return c.json({ error: msg }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /api/dashboard?userId= — live dashboard data: weather, load shedding,
// priority contacts, and incoming message queue.
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) return c.json({ error: 'userId is required' }, 400)

  const areaId = process.env.ESKOMSEPUSH_AREA_ID ?? 'eskde-10-fourwaysext10cityofjohannesburggauteng'

  const [weatherRes, loadRes, contactsRes, queueRes, userRes] = await Promise.allSettled([
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=-26.2041&lon=28.0473&units=metric&appid=${process.env.OPENWEATHER_API_KEY!}`,
      { signal: AbortSignal.timeout(5000) }
    ),
    fetch(
      `https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`,
      { headers: { Token: process.env.ESKOMSEPUSH_API_KEY! }, signal: AbortSignal.timeout(5000) }
    ),
    supabase.from('user_contacts').select('name').eq('user_id', userId).eq('is_priority', true),
    supabase
      .from('message_log')
      .select('from_phone, body, created_at')
      .eq('user_id', userId)
      .eq('direction', 'in')
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
      .order('created_at', { ascending: false }),
    supabase.from('users').select('name').eq('id', userId).single(),
  ])

  // Weather
  let weather: { temp: number | null; description: string | null } = { temp: null, description: null }
  if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
    const d = await weatherRes.value.json() as { main: { temp: number }; weather: Array<{ description: string }> }
    weather = { temp: Math.round(d.main.temp), description: d.weather[0]?.description ?? null }
  }

  // Load shedding
  let loadShedding: { stage: string | null; time: string | null } = { stage: null, time: null }
  if (loadRes.status === 'fulfilled' && loadRes.value.ok) {
    const d = await loadRes.value.json() as { events?: Array<{ note: string; start: string; end: string }> }
    const ev = d.events?.[0]
    if (ev) {
      const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
      loadShedding = { stage: ev.note, time: `${fmt(ev.start)} – ${fmt(ev.end)}` }
    }
  }

  // Priority contacts
  const priorityRows = contactsRes.status === 'fulfilled' ? (contactsRes.value.data ?? []) : []

  // Batch queue — group by sender
  const msgs = queueRes.status === 'fulfilled' ? (queueRes.value.data ?? []) : []
  const uniquePhones = [...new Set(msgs.map((m) => m.from_phone as string).filter(Boolean))]
  const nameRows = uniquePhones.length > 0
    ? (await supabase.from('user_contacts').select('name, phone').eq('user_id', userId).in('phone', uniquePhones)).data ?? []
    : []
  const phoneToName = Object.fromEntries(nameRows.map((r) => [r.phone as string, r.name as string]))

  const queueMap = new Map<string, { name: string; preview: string; count: number }>()
  for (const msg of msgs) {
    const phone = msg.from_phone as string
    if (!queueMap.has(phone)) {
      queueMap.set(phone, { name: phoneToName[phone] ?? phone, preview: msg.body as string, count: 0 })
    }
    queueMap.get(phone)!.count++
  }

  const viUserName = userRes.status === 'fulfilled' ? ((userRes.value.data as { name?: string } | null)?.name ?? null) : null

  return c.json({
    viUserName,
    weather,
    loadShedding,
    batchedCount: msgs.length,
    priorityContacts: { count: priorityRows.length, names: priorityRows.map((r) => r.name as string) },
    queue: [...queueMap.values()],
  })
})

// ---------------------------------------------------------------------------
// handleConfirmSend — executes the actual WhatsApp send after user says "yes"
// ISO-01: message_log insert includes user_id
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleConfirmSend(c: any, userId: string) {
  const state = getState(userId)
  if (state.phase !== 'awaiting_approval' || !state.pendingMessage) {
    return c.json({ spoken: 'There is no pending message to confirm.', action: 'error', requiresConfirmation: false })
  }
  const { to, toName, body } = state.pendingMessage

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!
    const authToken  = process.env.TWILIO_AUTH_TOKEN!
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER!

    const formBody = new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To:   `whatsapp:${to}`,
      Body: body,
    })

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
        signal: AbortSignal.timeout(10_000),
      }
    )

    if (!res.ok) {
      const errBody = await res.text().catch(() => `HTTP ${res.status}`)
      console.error(`[ConfirmSend] Twilio error ${res.status}:`, errBody)
      throw new Error(`Twilio ${res.status}: ${errBody}`)
    }

    const json = await res.json() as { sid?: string }
    const wamid = json.sid

    // Log to message_log direction='out' — ISO-01: includes user_id
    await supabase.from('message_log').insert({
      user_id: userId,
      direction: 'out',
      to_phone: to,
      body,
      wa_message_id: wamid,
    })

    clearUserState(userId)
    const name = toName ?? to
    const spoken = `Message sent to ${name}.`

    return c.json({ spoken, action: 'confirm', requiresConfirmation: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ConfirmSend] Failed:', msg)
    return c.json({
      spoken: spokenError('sending your message'),
      action: 'error',
      requiresConfirmation: false,
    })
  }
}
