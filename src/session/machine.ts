// src/session/machine.ts
// Session state machine for voice interaction flow.
// Uses a plain Map — no XState, no external library (50KB overhead not justified for 5 states).
//
// Valid transitions:
//   idle              → listening, translating, navigating, composing
//   listening         → composing, idle (on error/timeout), translating, navigating
//   composing         → awaiting_approval, playing, idle (on error)
//   awaiting_approval → playing, idle (on cancel/timeout)
//   playing           → idle, translating, navigating
//   translating       → idle (stop command), translating (recursive — each utterance stays in mode)
//   navigating        → idle, navigating, listening
//
// Pending message is persisted to Supabase user_profile.pending_message so the
// confirmation flow survives server restarts (bun --watch, crashes).

export type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'
  | 'translating'
  | 'navigating'

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface SessionState {
  phase: SessionPhase
  pendingMessage?: { to: string; toName?: string; body: string }
  translationTarget?: string
  detectedLanguage?: string
  navigationSession?: {
    destination: string
    waypoints: Array<{
      stepIndex: number
      instruction: string
      startLat: number
      startLng: number
      endLat: number
      endLng: number
      distanceMetres: number
      nearbyPlaces: string[]
    }>
    currentWaypointIndex: number
    origin?: { lat: number; lng: number }
  }
  conversationHistory?: ConversationTurn[]
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

// ---------------------------------------------------------------------------
// Supabase-backed pending message persistence — survives server restarts.
// Only the pendingMessage is persisted; phase and history stay in-memory.
// ---------------------------------------------------------------------------
function persistPendingMessage(userId: string, msg: { to: string; toName?: string; body: string } | null): void {
  import('../db/client').then(({ supabase }) => {
    supabase
      .from('user_profile')
      .upsert({ user_id: userId, pending_message: msg }, { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) console.error('[Session] persistPendingMessage failed (run migration 005?):', error.message)
        else console.log(`[Session] pendingMessage persisted for ${userId} — msg=${msg ? 'set' : 'cleared'}`)
      })
      .catch((err) => console.error('[Session] persistPendingMessage unexpected error:', err))
  }).catch((err) => console.error('[Session] persistPendingMessage import error:', err))
}

export async function hydratePendingMessage(userId: string): Promise<void> {
  if (sessions.has(userId)) return
  try {
    const { supabase } = await import('../db/client')
    const { data } = await supabase
      .from('user_profile')
      .select('pending_message')
      .eq('user_id', userId)
      .single()
    if (data?.pending_message) {
      const state: SessionState = { phase: 'awaiting_approval', pendingMessage: data.pending_message, lastActivity: Date.now() }
      sessions.set(userId, state)
      console.log(`[Session] Hydrated pending message for ${userId} from Supabase`)
    }
  } catch (err) {
    console.error('[Session] hydratePendingMessage failed (run migration 005?):', err)
  }
}

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening', 'translating', 'navigating', 'composing'],
  listening:         ['composing', 'idle', 'translating', 'navigating'],
  composing:         ['awaiting_approval', 'playing', 'idle'],
  awaiting_approval: ['playing', 'idle'],
  playing:           ['idle', 'translating', 'navigating'],
  translating:       ['idle', 'translating'],
  navigating:        ['idle', 'navigating', 'listening'],
}

export function transition(userId: string, next: SessionPhase): void {
  const current = sessions.get(userId)?.phase ?? 'idle'
  const allowed = TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(`Invalid session transition for ${userId}: ${current} → ${next}`)
  }
  const existing = sessions.get(userId)
  sessions.set(userId, { ...(existing ?? {}), phase: next, lastActivity: Date.now() })
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
  persistPendingMessage(userId, msg)
}

export function clearSession(userId: string): void {
  sessions.delete(userId)
  persistPendingMessage(userId, null)
}

export function setTranslationTarget(userId: string, targetLanguage: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, translationTarget: targetLanguage, lastActivity: Date.now() })
}

export function clearTranslationTarget(userId: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, translationTarget: undefined, detectedLanguage: undefined, lastActivity: Date.now() })
}

export function setDetectedLanguage(userId: string, language: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, detectedLanguage: language, lastActivity: Date.now() })
}

export function setNavigationSession(
  userId: string,
  nav: SessionState['navigationSession']
): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, navigationSession: nav, lastActivity: Date.now() })
}

export function clearNavigationSession(userId: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, navigationSession: undefined, lastActivity: Date.now() })
}

const MAX_HISTORY_TURNS = 10

export function appendConversationTurn(userId: string, userText: string, assistantText: string): void {
  const s = getState(userId)
  const history = s.conversationHistory ?? []
  const updated = [
    ...history,
    { role: 'user' as const, content: userText },
    { role: 'assistant' as const, content: assistantText },
  ].slice(-MAX_HISTORY_TURNS)
  sessions.set(userId, { ...s, conversationHistory: updated, lastActivity: Date.now() })
}

export function getConversationHistory(userId: string): ConversationTurn[] {
  return getState(userId).conversationHistory ?? []
}
