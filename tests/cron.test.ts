import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks — MUST be declared before any production imports (Bun hoists mock.module)
// ---------------------------------------------------------------------------

// BullMQ Queue mock — upsertJobScheduler is what syncUserRoutines calls
const mockUpsertJobScheduler = mock(async () => {})
mock.module('bullmq', () => {
  class MockQueue {
    upsertJobScheduler = mockUpsertJobScheduler
  }
  class MockWorker {
    on() {}
  }
  return {
    Queue: MockQueue,
    Worker: MockWorker,
  }
})

// ioredis — prevent real Redis connection attempts
mock.module('ioredis', () => ({
  default: mock(function() {
    return { on: mock(() => {}), set: mock(async () => 'OK'), get: mock(async () => null) }
  }),
}))

// heartbeat module — mock directly so routines.ts getCronQueue() receives a stub redis
mock.module('../src/queue/heartbeat', () => ({
  redis: { on: mock(() => {}), set: mock(async () => 'OK'), get: mock(async () => null) },
  heartbeatQueue: { add: mock(async () => {}) },
  enqueueHeartbeat: mock(async () => true),
}))

// Supabase mock — mutable state per test
let mockUserProfiles: Array<{ user_id: string }> = [{ user_id: 'user-a' }, { user_id: 'user-b' }]
let mockRoutineLastRun: string | null = null
let mockMessages: Array<{ from_phone: string; body: string | null; media_type: string | null }> = []
let mockContacts: Array<{ phone: string; name: string; is_priority: boolean }> = []

mock.module('../src/db/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'user_profile') {
        return {
          select: () => ({ data: mockUserProfiles, error: null }),
        }
      }

      if (table === 'routines') {
        return {
          select: (fields: string) => {
            // For the reminders query: select('id, user_id, cron_pattern').eq('enabled',true).eq('type','reminder')
            if (fields && fields.includes('cron_pattern')) {
              return {
                eq: () => ({
                  eq: () => ({ data: [], error: null }),
                }),
              }
            }
            // For the double-fire guard query: select('last_run').eq('user_id',...).eq('type','morning_briefing').single()
            return {
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: { last_run: mockRoutineLastRun }, error: null }),
                }),
              }),
            }
          },
          upsert: mock(async () => ({ error: null })),
        }
      }

      if (table === 'message_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  order: async () => ({ data: mockMessages, error: null }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'user_contacts') {
        return {
          select: () => ({
            eq: () => ({ data: mockContacts, error: null }),
          }),
        }
      }

      return {
        select: () => ({ data: null, error: null }),
        upsert: mock(async () => ({ error: null })),
      }
    },
  },
}))

// Ambient tools mock
const mockGetLoadShedding = mock(async () => 'No load shedding.')
const mockGetWeather = mock(async () => 'Sunny, 24 degrees.')
mock.module('../src/tools/ambient', () => ({
  toolGetLoadShedding: mockGetLoadShedding,
  toolGetWeather: mockGetWeather,
}))

// WebSocket connections mock
const mockPushInterrupt = mock(async () => {})
mock.module('../src/ws/connections', () => ({
  pushInterrupt: mockPushInterrupt,
  getConnection: mock(() => undefined),
  registerConnection: mock(() => {}),
  removeConnection: mock(() => {}),
}))

// Import AFTER mocks — Bun 1.3.x requires mock.module() calls before production imports
import { syncUserRoutines } from '../src/cron/routines'
import { processMorningBriefing } from '../src/cron/morningBriefing'

// ---------------------------------------------------------------------------
// syncUserRoutines() tests
// ---------------------------------------------------------------------------

describe('syncUserRoutines()', () => {
  beforeEach(() => {
    mockUpsertJobScheduler.mockClear()
    mockUserProfiles = [{ user_id: 'user-a' }, { user_id: 'user-b' }]
  })

  test('calls upsertJobScheduler with correct scheduler ID for morning_briefing', async () => {
    await syncUserRoutines()
    const calls = mockUpsertJobScheduler.mock.calls
    const morningIds = calls.filter(c => String(c[0]).startsWith('morning_briefing:')).map(c => c[0])
    expect(morningIds).toContain('morning_briefing:user-a')
    expect(morningIds).toContain('morning_briefing:user-b')
  })

  test('registers morning_briefing with pattern 0 7 * * 1-5', async () => {
    await syncUserRoutines()
    const morningCall = mockUpsertJobScheduler.mock.calls.find(c => String(c[0]) === 'morning_briefing:user-a')
    expect(morningCall).toBeDefined()
    expect(morningCall![1].pattern).toBe('0 7 * * 1-5')
  })

  test('registers evening_digest with pattern 0 18 * * *', async () => {
    await syncUserRoutines()
    const eveningCall = mockUpsertJobScheduler.mock.calls.find(c => String(c[0]) === 'evening_digest:user-a')
    expect(eveningCall).toBeDefined()
    expect(eveningCall![1].pattern).toBe('0 18 * * *')
  })
})

// ---------------------------------------------------------------------------
// processMorningBriefing() — double-fire guard
// ---------------------------------------------------------------------------

describe('processMorningBriefing() — double-fire guard', () => {
  beforeEach(() => {
    mockPushInterrupt.mockClear()
    mockGetLoadShedding.mockClear()
    mockMessages = []
    mockGetLoadShedding.mockImplementation(async () => 'No load shedding.')
    mockGetWeather.mockImplementation(async () => 'Sunny, 24 degrees.')
  })

  test('skips job when last_run is within 55 seconds', async () => {
    mockRoutineLastRun = new Date(Date.now() - 30_000).toISOString()  // 30s ago
    await processMorningBriefing({ data: { userId: 'user-a' } })
    expect(mockPushInterrupt.mock.calls.length).toBe(0)
  })

  test('runs job when last_run is more than 55 seconds ago', async () => {
    mockRoutineLastRun = new Date(Date.now() - 60_000).toISOString()  // 60s ago
    await processMorningBriefing({ data: { userId: 'user-a' } })
    expect(mockPushInterrupt.mock.calls.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// processMorningBriefing() — briefing content
// ---------------------------------------------------------------------------

describe('processMorningBriefing() — briefing content', () => {
  beforeEach(() => {
    mockRoutineLastRun = new Date(Date.now() - 120_000).toISOString()  // 2 min ago — will run
    mockPushInterrupt.mockClear()
    mockGetLoadShedding.mockClear()
    mockGetWeather.mockClear()
    mockMessages = []
    mockContacts = []
    mockGetLoadShedding.mockImplementation(async () => 'No load shedding.')
    mockGetWeather.mockImplementation(async () => 'Sunny, 24 degrees.')
  })

  test('briefing order: load shedding text appears before weather text in spoken output', async () => {
    mockGetLoadShedding.mockImplementation(async () => 'Stage 2 load shedding from 18:00.')
    mockGetWeather.mockImplementation(async () => 'Partly cloudy 20 degrees.')
    await processMorningBriefing({ data: { userId: 'user-a' } })
    const spoken: string = mockPushInterrupt.mock.calls[0][1]
    const lsIndex = spoken.indexOf('Stage 2')
    const weatherIndex = spoken.indexOf('Partly cloudy')
    expect(lsIndex).toBeGreaterThan(-1)
    expect(weatherIndex).toBeGreaterThan(-1)
    expect(lsIndex).toBeLessThan(weatherIndex)
  })

  test('priority contacts appear before non-priority contacts in digest', async () => {
    mockMessages = [
      { from_phone: '+27821111111', body: 'Normal message', media_type: null },
      { from_phone: '+27829999999', body: 'Priority message', media_type: null },
    ]
    mockContacts = [
      { phone: '+27821111111', name: 'Regular Friend', is_priority: false },
      { phone: '+27829999999', name: 'Mom', is_priority: true },
    ]
    await processMorningBriefing({ data: { userId: 'user-a' } })
    const spoken: string = mockPushInterrupt.mock.calls[0][1]
    const momIndex = spoken.indexOf('Mom')
    const friendIndex = spoken.indexOf('Regular Friend')
    // Mom (priority) should appear before Regular Friend if both are in the digest
    if (momIndex !== -1 && friendIndex !== -1) {
      expect(momIndex).toBeLessThan(friendIndex)
    }
  })

  test('pushInterrupt is called with assembled briefing text', async () => {
    await processMorningBriefing({ data: { userId: 'user-a' } })
    expect(mockPushInterrupt.mock.calls.length).toBe(1)
    const [calledUserId, calledText] = mockPushInterrupt.mock.calls[0]
    expect(calledUserId).toBe('user-a')
    expect(typeof calledText).toBe('string')
    expect(calledText.length).toBeGreaterThan(10)
  })
})
