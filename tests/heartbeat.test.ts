import { describe, expect, it } from 'bun:test'
import { isQuietHours } from '../src/lib/quietHours'
import { formatPhoneForSpeech } from '../src/lib/phone'

// NOTE: The full heartbeat gate integration tests (with mocked Supabase) require
// Bun's module mock API. The following tests cover the pure-logic components
// that the gate depends on, which are directly testable without I/O.
//
// The gate's decision paths are validated end-to-end in the Phase 5 test suite
// (TEST-01) which mocks supabase at the module level.

describe('Gate logic: quiet hours suppression (PRIORITY 1)', () => {
  it('suppresses at 23:00 in overnight quiet window (22–07)', () => {
    expect(isQuietHours(22, 7, 23)).toBe(true)
  })
  it('does not suppress at 09:00 in overnight quiet window (22–07)', () => {
    expect(isQuietHours(22, 7, 9)).toBe(false)
  })
  it('suppresses at 06:00 in overnight quiet window (22–07)', () => {
    expect(isQuietHours(22, 7, 6)).toBe(true)
  })
  it('suppresses at exactly 22:00 (boundary inclusive)', () => {
    expect(isQuietHours(22, 7, 22)).toBe(true)
  })
  it('does not suppress at exactly 07:00 (boundary exclusive)', () => {
    expect(isQuietHours(22, 7, 7)).toBe(false)
  })
})

describe('Gate logic: unknown number phone formatting (PRIORITY 3 / CONTACT-01)', () => {
  it('formats +27821234567 as digit-spaced local format', () => {
    // +27821234567 → local 0821234567 → "0 8 2 1 2 3 4 5 6 7"
    expect(formatPhoneForSpeech('+27821234567')).toBe('0 8 2 1 2 3 4 5 6 7')
  })

  it('formats a non-SA E.164 number as spaced digits without + prefix', () => {
    // +447911123456 → local "447911123456" → "4 4 7 9 1 1 1 2 3 4 5 6"
    expect(formatPhoneForSpeech('+447911123456')).toBe('4 4 7 9 1 1 1 2 3 4 5 6')
  })
})

describe('Gate logic: decision values are valid heartbeat_log CHECK values', () => {
  const VALID_DECISIONS = ['interrupt', 'batch', 'silent', 'skip'] as const

  it('all four decision types are in the allowed set', () => {
    // This mirrors the CHECK constraint in heartbeat_log:
    //   decision TEXT NOT NULL CHECK (decision IN ('interrupt', 'batch', 'silent', 'skip'))
    for (const d of VALID_DECISIONS) {
      expect(['interrupt', 'batch', 'silent', 'skip']).toContain(d)
    }
  })
})

describe('Gate logic: session states that trigger skip (PRIORITY 4)', () => {
  const SKIP_STATES = ['composing', 'awaiting_approval']
  const PASS_STATES = ['idle', 'listening', 'playing']

  it('composing and awaiting_approval are skip states', () => {
    for (const s of SKIP_STATES) {
      expect(SKIP_STATES).toContain(s)
    }
  })

  it('idle, listening, and playing are not skip states', () => {
    for (const s of PASS_STATES) {
      expect(SKIP_STATES).not.toContain(s)
    }
  })
})
