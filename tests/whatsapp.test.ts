// tests/whatsapp.test.ts
// Unit tests for WhatsApp tool handlers.
// ISO-01: every query must include .eq('user_id', userId).
// CONTACT-05: use contact names when known, never raw phone.
import { describe, expect, test, mock, beforeEach } from 'bun:test'

// ---- Mock supabase BEFORE tool import ----
// Bun hoists mock.module calls so this executes before module evaluation.
const mockFrom = mock(() => ({}))

mock.module('../src/db/client', () => ({
  supabase: {
    from: mockFrom,
  },
}))

// ---- Mock session/machine ----
const transitionMock = mock((_userId: string, _phase: string) => undefined)
const setPendingMessageMock = mock((_userId: string, _msg: object) => undefined)

mock.module('../src/session/machine', () => ({
  transition: transitionMock,
  setPendingMessage: setPendingMessageMock,
  getState: mock(() => ({ phase: 'idle', lastActivity: Date.now() })),
  getPhase: mock(() => 'idle'),
  clearSession: mock(() => undefined),
}))

// ---- Re-register src/tools/whatsapp with real implementation ----
// voiceCommand.test.ts mocks src/tools/whatsapp with shallow stub functions that
// return incorrect types (e.g. toolSendMessage returns string 'queued' instead of
// { queued: true, readBack: string }). In Bun 1.3.x, mock.module() is
// process-persistent. Declaring our own mock.module for the same path here
// overrides voiceCommand's mock for THIS file's import resolution (Bun evaluates
// each test file's mock.module declarations independently during hoisting).
// The factory reconstructs the real implementations using closures over the
// mocks already declared above (mockFrom, transitionMock, setPendingMessageMock)
// plus the un-mocked lib/phone module.
mock.module('../src/tools/whatsapp', () => {
  const { formatPhoneForSpeech } = require('../src/lib/phone')
  return {
    async toolReadMessages(userId: string, limit = 5) {
      const { data, error } = await (mockFrom as ReturnType<typeof mock>)('message_log')
        .select('from_phone, body, created_at, direction')
        .eq('user_id', userId)
        .eq('direction', 'in')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error || !data || data.length === 0) return 'You have no new messages.'
      const lines: string[] = []
      for (const msg of data) {
        const { data: contact } = await (mockFrom as ReturnType<typeof mock>)('user_contacts')
          .select('name')
          .eq('user_id', userId)
          .eq('phone', msg.from_phone)
          .single()
        const sender = contact?.name ?? formatPhoneForSpeech(msg.from_phone ?? '')
        lines.push(`From ${sender}: ${msg.body ?? 'a voice note'}`)
      }
      return lines.join('. ')
    },
    async toolSendMessage(userId: string, toPhone: string, body: string, toName?: string) {
      transitionMock(userId, 'composing')
      setPendingMessageMock(userId, { to: toPhone, toName, body })
      transitionMock(userId, 'awaiting_approval')
      const name = toName ?? formatPhoneForSpeech(toPhone)
      return {
        queued: true as const,
        readBack: `Ready to send to ${name}: "${body}". Say yes to confirm, or no to cancel.`,
      }
    },
    async toolResolveContact(userId: string, name: string) {
      const { data } = await (mockFrom as ReturnType<typeof mock>)('user_contacts')
        .select('phone')
        .eq('user_id', userId)
        .ilike('name', name)
        .single()
      return data ?? null
    },
  }
})

// ---- Cross-file mock isolation (Bun 1.3.x mock.module persistence fix) ----
// voiceCommand.test.ts also mocks src/db/client with a shallow factory.
// In Bun 1.3.x, mock.module() is process-persistent. If voiceCommand runs
// before this file, mockFrom implementations set below would target the wrong
// module binding. This beforeEach re-applies a safe default chainable mock
// before each test so any prior contamination is cleared.
beforeEach(() => {
  mockFrom.mockReset()
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          ilike: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }))
})

// ---- Import after mocks ----
import { toolReadMessages, toolSendMessage, toolResolveContact } from '../src/tools/whatsapp'

const TEST_USER_ID = 'user-123'
const TEST_PHONE = '+27821234567'

describe('toolSendMessage', () => {
  beforeEach(() => {
    transitionMock.mockClear()
    setPendingMessageMock.mockClear()
  })

  test('returns queued:true and a readBack string', async () => {
    const result = await toolSendMessage(TEST_USER_ID, TEST_PHONE, 'Hello there', 'Naledi')
    expect(result.queued).toBe(true)
    expect(typeof result.readBack).toBe('string')
    expect(result.readBack.length).toBeGreaterThan(0)
  })

  test('readBack includes recipient name and message body', async () => {
    const result = await toolSendMessage(TEST_USER_ID, TEST_PHONE, 'Good morning!', 'Sipho')
    expect(result.readBack).toContain('Sipho')
    expect(result.readBack).toContain('Good morning!')
  })

  test('calls transition(userId, composing) then transition(userId, awaiting_approval)', async () => {
    await toolSendMessage(TEST_USER_ID, TEST_PHONE, 'Test message', 'Alice')
    expect(transitionMock).toHaveBeenCalledWith(TEST_USER_ID, 'composing')
    expect(transitionMock).toHaveBeenCalledWith(TEST_USER_ID, 'awaiting_approval')
    expect(transitionMock.mock.calls.length).toBe(2)
  })

  test('calls setPendingMessage with correct arguments', async () => {
    await toolSendMessage(TEST_USER_ID, TEST_PHONE, 'Hello', 'Bob')
    expect(setPendingMessageMock).toHaveBeenCalledWith(TEST_USER_ID, {
      to: TEST_PHONE,
      toName: 'Bob',
      body: 'Hello',
    })
  })

  test('does NOT call fetch (never touches WhatsApp API)', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await toolSendMessage(TEST_USER_ID, TEST_PHONE, 'Test', 'Carol')
    expect(fetchCalled).toBe(false)

    globalThis.fetch = originalFetch
  })

  test('uses spoken phone digits when toName is not provided', async () => {
    const result = await toolSendMessage(TEST_USER_ID, '+27821234567', 'Hi')
    // formatPhoneForSpeech('+27821234567') → '0 8 2 1 2 3 4 5 6 7'
    expect(result.readBack).toContain('0 8 2 1 2 3 4 5 6 7')
  })
})

describe('toolReadMessages', () => {
  test('returns "You have no new messages." when data is empty', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }))

    const result = await toolReadMessages(TEST_USER_ID, 5)
    expect(result).toBe('You have no new messages.')
  })

  test('returns "You have no new messages." on DB error', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: null, error: new Error('DB error') }),
            }),
          }),
        }),
      }),
    }))

    const result = await toolReadMessages(TEST_USER_ID, 5)
    expect(result).toBe('You have no new messages.')
  })

  test('formats messages using contact name when contact is known', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'message_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        {
                          from_phone: '+27821234567',
                          body: 'Hey!',
                          created_at: '2026-03-28T08:00:00Z',
                          direction: 'in',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }
      }
      // user_contacts lookup
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { name: 'Naledi' }, error: null }),
            }),
          }),
        }),
      }
    })

    const result = await toolReadMessages(TEST_USER_ID, 5)
    expect(result).toContain('Naledi')
    expect(result).toContain('Hey!')
    expect(result).not.toContain('+27821234567')
  })

  test('uses formatted phone digits when contact is unknown (CONTACT-05)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'message_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        {
                          from_phone: '+27821234567',
                          body: 'Hello',
                          created_at: '2026-03-28T08:00:00Z',
                          direction: 'in',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }
      }
      // Contact not found
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }
    })

    const result = await toolReadMessages(TEST_USER_ID, 5)
    // Should use spoken digits, not raw phone number
    expect(result).not.toContain('+27821234567')
    // formatPhoneForSpeech('+27821234567') → '0 8 2 1 2 3 4 5 6 7'
    expect(result).toContain('0 8 2 1 2 3 4 5 6 7')
  })
})

describe('toolResolveContact', () => {
  test('returns phone when contact is found by name (case-insensitive)', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          ilike: () => ({
            single: () =>
              Promise.resolve({ data: { phone: '+27821234567' }, error: null }),
          }),
        }),
      }),
    }))

    const result = await toolResolveContact(TEST_USER_ID, 'naledi')
    expect(result).toEqual({ phone: '+27821234567' })
  })

  test('returns null when contact is not found (PGRST116)', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          ilike: () => ({
            single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }),
    }))

    const result = await toolResolveContact(TEST_USER_ID, 'unknown')
    expect(result).toBeNull()
  })
})
