// src/routes/api.ts
// POST /api/voice/command — Phase 3 agent intelligence entry point.
// All routes here are protected by Bearer auth middleware in server.ts (mounted at /api).
// Fast-path intents bypass the LLM entirely (< 1ms). Slow-path routes to Claude orchestrator.
import { Hono } from 'hono'
import { classifyIntent } from '../agent/classifier'
import { runOrchestrator } from '../agent/orchestrator'
import { toolReadMessages } from '../tools/whatsapp'
import { toolGetLoadShedding, toolGetWeather, toolWebSearch } from '../tools/ambient'
import { getState, getPhase, clearSession } from '../session/machine'
import { supabase } from '../db/client'
import { spokenError } from '../lib/errors'

export const apiRouter = new Hono()

// In-process no-match counter for three-strike approval reset (AGENT-05).
// Must be cleared whenever clearSession() is called.
const noMatchCounts = new Map<string, number>()

function clearUserState(userId: string): void {
  clearSession(userId)
  noMatchCounts.delete(userId)
}

// ---------------------------------------------------------------------------
// POST /api/voice/command
// Body: { userId: string, transcript: string, sessionId?: string }
// Response: { spoken: string, action: string, requiresConfirmation: boolean, pendingAction?: object }
// ---------------------------------------------------------------------------
apiRouter.post('/voice/command', async (c) => {
  let userId: string
  let transcript: string
  try {
    const body = await c.req.json() as { userId?: string; transcript?: string; sessionId?: string }
    if (!body.userId || !body.transcript) {
      return c.json({ error: 'userId and transcript are required' }, 400)
    }
    userId = body.userId
    transcript = body.transcript.trim()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
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
    return c.json({ spoken: 'Message cancelled.', action: 'cancel', requiresConfirmation: false })
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
    return c.json({ spoken, action: 'fast_path', requiresConfirmation: false })
  }

  if (intent === 'weather') {
    const signal = AbortSignal.timeout(5000)
    const spoken = await toolGetWeather(signal)
    return c.json({ spoken, action: 'fast_path', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // FAST PATH: read messages (no LLM — AGENT-01, AGENT-02)
  // ------------------------------------------------------------------
  if (intent === 'read_messages') {
    const spoken = await toolReadMessages(userId, 5)
    return c.json({ spoken, action: 'fast_path', requiresConfirmation: false })
  }

  // ------------------------------------------------------------------
  // FAST PATH: web_search without LLM — route directly to Tavily tool
  // ------------------------------------------------------------------
  if (intent === 'web_search') {
    const signal = AbortSignal.timeout(5000)
    const spoken = await toolWebSearch(transcript, signal)
    return c.json({ spoken, action: 'fast_path', requiresConfirmation: false })
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
    const json = await res.json() as { messages?: Array<{ id: string }> }
    const wamid = json.messages?.[0]?.id

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
