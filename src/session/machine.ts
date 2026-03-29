// src/session/machine.ts
// Session state machine for voice interaction flow.
// Uses a plain Map — no XState, no external library (50KB overhead not justified for 5 states).
//
// Valid transitions:
//   idle              → listening, translating
//   listening         → composing, idle (on error/timeout), translating
//   composing         → awaiting_approval, playing, idle (on error)
//   awaiting_approval → playing, idle (on cancel/timeout)
//   playing           → idle, translating
//   translating       → idle (stop command), translating (recursive — each utterance stays in mode)
//
// INVALID EXAMPLE: idle → awaiting_approval (throws — agent must compose before approval)

export type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'
  | 'translating'

export interface SessionState {
  phase: SessionPhase
  pendingMessage?: { to: string; toName?: string; body: string }
  translationTarget?: string   // BCP-47 language code e.g. 'zu', 'xh', 'st', 'af', 'en'
  detectedLanguage?: string    // from Whisper STT language detection
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening', 'translating'],
  listening:         ['composing', 'idle', 'translating'],
  composing:         ['awaiting_approval', 'playing', 'idle'],
  awaiting_approval: ['playing', 'idle'],
  playing:           ['idle', 'translating'],
  translating:       ['idle', 'translating'],
}

export function transition(userId: string, next: SessionPhase): void {
  const current = sessions.get(userId)?.phase ?? 'idle'
  const allowed = TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(`Invalid session transition for ${userId}: ${current} → ${next}`)
  }
  const existing = sessions.get(userId)
  sessions.set(userId, {
    ...(existing ?? {}),
    phase: next,
    lastActivity: Date.now(),
  })
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
}

export function clearSession(userId: string): void {
  sessions.delete(userId)
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
