// src/session/machine.ts
// Session state machine for voice interaction flow.
// Uses a plain Map — no XState, no external library (50KB overhead not justified for 5 states).
//
// Valid transitions:
//   idle              → listening, translating, navigating
//   listening         → composing, idle (on error/timeout), translating, navigating
//   composing         → awaiting_approval, playing, idle (on error)
//   awaiting_approval → playing, idle (on cancel/timeout)
//   playing           → idle, translating, navigating
//   translating       → idle, translating
//   navigating        → idle, navigating, listening
//
// INVALID EXAMPLE: idle → awaiting_approval (throws — agent must compose before approval)

export type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'
  | 'translating'
  | 'navigating'

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
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening', 'translating', 'navigating'],
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

export function setTranslationTarget(userId: string, target: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, translationTarget: target, lastActivity: Date.now() })
}

export function clearTranslationTarget(userId: string): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, translationTarget: undefined, detectedLanguage: undefined, lastActivity: Date.now() })
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
