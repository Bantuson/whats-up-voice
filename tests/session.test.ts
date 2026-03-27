import { describe, test, expect, beforeEach } from 'bun:test'
import {
  transition,
  getPhase,
  getState,
  setPendingMessage,
  clearSession,
  type SessionPhase,
} from '../src/session/machine'

const USER = 'test-user-001'

beforeEach(() => {
  // Reset session state between tests
  clearSession(USER)
})

describe('INFRA-06: Session state machine — valid transitions', () => {
  test('new user starts in idle phase', () => {
    expect(getPhase(USER)).toBe('idle')
  })

  test('idle → listening is valid', () => {
    transition(USER, 'listening')
    expect(getPhase(USER)).toBe('listening')
  })

  test('listening → composing is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    expect(getPhase(USER)).toBe('composing')
  })

  test('listening → idle is valid (error/timeout reset)', () => {
    transition(USER, 'listening')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })

  test('composing → awaiting_approval is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    expect(getPhase(USER)).toBe('awaiting_approval')
  })

  test('composing → playing is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    expect(getPhase(USER)).toBe('playing')
  })

  test('awaiting_approval → idle is valid (cancel)', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })

  test('awaiting_approval → playing is valid (confirm send)', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    transition(USER, 'playing')
    expect(getPhase(USER)).toBe('playing')
  })

  test('playing → idle is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })
})

describe('INFRA-06: Session state machine — invalid transitions throw', () => {
  test('idle → awaiting_approval throws (must go through composing)', () => {
    expect(() => transition(USER, 'awaiting_approval')).toThrow(
      `Invalid session transition for ${USER}: idle → awaiting_approval`
    )
  })

  test('idle → composing throws', () => {
    expect(() => transition(USER, 'composing')).toThrow(
      `Invalid session transition for ${USER}: idle → composing`
    )
  })

  test('idle → playing throws', () => {
    expect(() => transition(USER, 'playing')).toThrow(
      `Invalid session transition for ${USER}: idle → playing`
    )
  })

  test('listening → awaiting_approval throws', () => {
    transition(USER, 'listening')
    expect(() => transition(USER, 'awaiting_approval')).toThrow(
      `Invalid session transition for ${USER}: listening → awaiting_approval`
    )
  })

  test('playing → composing throws', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    expect(() => transition(USER, 'composing')).toThrow(
      `Invalid session transition for ${USER}: playing → composing`
    )
  })
})

describe('INFRA-06: pendingMessage storage', () => {
  test('setPendingMessage stores message and getState retrieves it', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    setPendingMessage(USER, { to: '+27821234567', toName: 'Naledi', body: 'I will be late' })
    const state = getState(USER)
    expect(state.pendingMessage?.to).toBe('+27821234567')
    expect(state.pendingMessage?.toName).toBe('Naledi')
    expect(state.pendingMessage?.body).toBe('I will be late')
  })

  test('clearSession removes pendingMessage', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    setPendingMessage(USER, { to: '+27821234567', body: 'test' })
    clearSession(USER)
    const state = getState(USER)
    expect(state.phase).toBe('idle')
    expect(state.pendingMessage).toBeUndefined()
  })
})
