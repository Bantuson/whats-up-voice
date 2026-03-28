// tests/contacts.test.ts
// Unit tests for contact tool handlers.
// ISO-01: every query must include .eq('user_id', userId).
// CONTACT-05: contact names used wherever possible.
import { describe, expect, test, mock } from 'bun:test'

// ---- Mock supabase BEFORE tool import ----
// Bun hoists mock.module calls so this executes before module evaluation.
const mockFrom = mock(() => ({}))

mock.module('../src/db/client', () => ({
  supabase: {
    from: mockFrom,
  },
}))

// ---- Import after mocks ----
import { toolGetContact, toolSaveContact, toolListContacts, toolSetPriority } from '../src/tools/contacts'

const TEST_USER_ID = 'user-456'

describe('toolGetContact', () => {
  test('returns contact row when found by name (case-insensitive)', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          ilike: () => ({
            single: () =>
              Promise.resolve({
                data: { name: 'Naledi', phone: '+27821234567', is_priority: false },
                error: null,
              }),
          }),
        }),
      }),
    }))

    const result = await toolGetContact(TEST_USER_ID, 'naledi')
    expect(result).toEqual({ name: 'Naledi', phone: '+27821234567', is_priority: false })
  })

  test('returns null when contact not found', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          ilike: () => ({
            single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }),
    }))

    const result = await toolGetContact(TEST_USER_ID, 'nobody')
    expect(result).toBeNull()
  })
})

describe('toolSaveContact', () => {
  test('normalises phone to E.164 and returns saved:true', async () => {
    mockFrom.mockImplementation(() => ({
      insert: () => Promise.resolve({ data: null, error: null }),
    }))

    const result = await toolSaveContact(TEST_USER_ID, 'Sipho', '0821234567')
    expect(result.saved).toBe(true)
    expect(result.name).toBe('Sipho')
    expect(result.phone).toBe('+27821234567')
  })

  test('normalises phone with +27 prefix (already E.164)', async () => {
    mockFrom.mockImplementation(() => ({
      insert: () => Promise.resolve({ data: null, error: null }),
    }))

    const result = await toolSaveContact(TEST_USER_ID, 'Alice', '+27821111222')
    expect(result.phone).toBe('+27821111222')
  })

  test('normalises phone with 27 prefix (no +)', async () => {
    mockFrom.mockImplementation(() => ({
      insert: () => Promise.resolve({ data: null, error: null }),
    }))

    const result = await toolSaveContact(TEST_USER_ID, 'Bob', '27821111222')
    expect(result.phone).toBe('+27821111222')
  })
})

describe('toolListContacts', () => {
  test('returns array of contacts for user', async () => {
    const contacts = [
      { name: 'Alice', phone: '+27821111111', is_priority: true },
      { name: 'Bob', phone: '+27822222222', is_priority: false },
    ]

    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: contacts, error: null }),
        }),
      }),
    }))

    const result = await toolListContacts(TEST_USER_ID)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Alice')
    expect(result[1].name).toBe('Bob')
  })

  test('returns empty array when user has no contacts', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }))

    const result = await toolListContacts(TEST_USER_ID)
    expect(result).toEqual([])
  })
})

describe('toolSetPriority', () => {
  test('returns updated:true when contact is found and updated', async () => {
    mockFrom.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          ilike: () => ({
            select: () => Promise.resolve({ data: [{ name: 'Naledi' }], error: null }),
          }),
        }),
      }),
    }))

    const result = await toolSetPriority(TEST_USER_ID, 'naledi', true)
    expect(result).toEqual({ updated: true })
  })

  test('returns updated:false when no contact matched the name', async () => {
    mockFrom.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          ilike: () => ({
            select: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }))

    const result = await toolSetPriority(TEST_USER_ID, 'nobody', false)
    expect(result).toEqual({ updated: false })
  })

  test('returns updated:false when data is null', async () => {
    mockFrom.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          ilike: () => ({
            select: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }))

    const result = await toolSetPriority(TEST_USER_ID, 'ghost', true)
    expect(result).toEqual({ updated: false })
  })
})
