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
import { generatePodcast } from '../tools/podcast'
import { runOrchestrator } from '../agent/orchestrator'
import { toolReadMessages } from '../tools/whatsapp'
import { toolGetLoadShedding, toolGetWeather, toolWebSearch } from '../tools/ambient'
import { getState, getPhase, clearSession, transition, setDetectedLanguage } from '../session/machine'
import { supabase } from '../db/client'
import { spokenError } from '../lib/errors'
import { streamSpeech } from '../tts/elevenlabs'
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

// In-process no-match counter for three-strike approval reset (AGENT-05).
// Must be cleared whenever clearSession() is called.
const noMatchCounts = new Map<string, number>()

function clearUserState(userId: string): void {
  clearSession(userId)
  noMatchCounts.delete(userId)
}

// ---------------------------------------------------------------------------
// deliverSpoken — wire TTS after every spoken response (VOICE-03, VOICE-04)
// Fires streamSpeech non-blocking so JSON response returns immediately.
// Session transitions: playing (before TTS) → idle (after kicking off TTS).
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverSpoken(c: any, userId: string, spoken: string, action: string, rest: Record<string, unknown> = {}): Promise<Response> {
  // Transition to playing — guard: some session phases may not allow it
  try {
    transition(userId, 'playing')
  } catch {
    // Session may be in a state that doesn't allow playing (e.g. awaiting_approval)
    // Still deliver audio but do not mutate session state
  }

  // Fire TTS — do not await to keep response latency low; client receives JSON immediately
  // and audio arrives via WebSocket independently
  streamSpeech(spoken, userId).catch((err) => {
    console.error(`[TTS] streamSpeech failed for ${userId}:`, err)
  })

  // Transition back to idle after kicking off TTS (non-blocking)
  try {
    transition(userId, 'idle')
  } catch { /* ignore — session may already be idle */ }

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
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const intent = classifyIntent(transcript)
  const sessionPhase = getPhase(userId)

  // ------------------------------------------------------------------
  // FAST PATH: confirm / cancel (approval loop — AGENT-05)
  // ------------------------------------------------------------------
  if (intent === 'confirm_send') {
    return handleConfirmSend(c, userId)
  }

  if (intent === 'cancel') {
    clearUserState(userId)
    return deliverSpoken(c, userId, 'Message cancelled.', 'cancel')
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
    transition(userId, 'listening')
    // Extract topic from transcript — strip known trigger phrases
    const topic = transcript
      .replace(/^(tell me (something |a story |more )?(about|on)|make (me )?a podcast (about)?|i want to hear about|podcast about|tell me about)\s*/i, '')
      .trim() || transcript
    const spoken = await generatePodcast(topic, userId)
    return deliverSpoken(c, userId, spoken, 'podcast')
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
      const answer = await runOrchestrator(userId, transcript, controller.signal)
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
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const spoken = await runOrchestrator(userId, transcript, controller.signal)
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
        signal: AbortSignal.timeout(5000),
      }
    )
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

    // Wire TTS for confirm_send (VOICE-04)
    streamSpeech(`Message sent to ${name}.`, userId).catch(() => {})

    return c.json({
      spoken: `Message sent to ${name}.`,
      action: 'confirm',
      requiresConfirmation: false,
    })
  } catch {
    return c.json({
      spoken: spokenError('sending your message'),
      action: 'error',
      requiresConfirmation: false,
    })
  }
}
