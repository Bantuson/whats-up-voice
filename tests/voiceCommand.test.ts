// tests/voiceCommand.test.ts
// Integration tests for POST /api/voice/command — fast-path routing, approval loop, three-strike reset.
// AGENT-05, CONTACT-02, CONTACT-03, CONTACT-04
//
// MOCK STRATEGY:
//   - src/agent/classifier is mocked to control intent routing
//   - src/agent/orchestrator is mocked to avoid live Claude calls
//   - src/session/machine is mocked to control session state in tests
//   - src/db/client is mocked to avoid real Supabase calls
//   - src/tools/whatsapp is mocked for toolReadMessages
//   - src/tools/ambient is mocked for ambient fast-paths
//   - global fetch is mocked to intercept WhatsApp API calls
//
// Hono apps are tested by importing the router and constructing a minimal Hono app
// with the same middleware chain as server.ts.
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'

// ---- Mock src/agent/classifier ----
const mockClassifyIntent = mock(() => null as string | null)
mock.module('../src/agent/classifier', () => ({
  classifyIntent: mockClassifyIntent,
}))

// ---- Mock src/agent/orchestrator ----
const mockRunOrchestrator = mock(async () => 'Agent response')
mock.module('../src/agent/orchestrator', () => ({
  runOrchestrator: mockRunOrchestrator,
}))

// ---- Mock src/session/machine ----
let mockPhase = 'idle'
let mockPendingMessage: { to: string; toName?: string; body: string } | undefined = undefined
const mockGetState = mock(() => ({ phase: mockPhase, pendingMessage: mockPendingMessage, lastActivity: Date.now() }))
const mockGetPhase = mock(() => mockPhase)
const mockClearSession = mock(() => { mockPhase = 'idle'; mockPendingMessage = undefined })
mock.module('../src/session/machine', () => ({
  getState: mockGetState,
  getPhase: mockGetPhase,
  clearSession: mockClearSession,
}))

// ---- Mock src/db/client ----
const mockInsert = mock(async () => ({ data: null, error: null }))
const mockFrom = mock(() => ({ insert: mockInsert }))
mock.module('../src/db/client', () => ({
  supabase: { from: mockFrom },
}))

// ---- Mock src/tools/whatsapp ----
const mockToolReadMessages = mock(async () => 'You have 2 messages.')
mock.module('../src/tools/whatsapp', () => ({
  toolReadMessages: mockToolReadMessages,
  toolSendMessage: mock(async () => 'queued'),
  toolResolveContact: mock(async () => null),
}))

// ---- Mock src/tools/ambient ----
const mockToolGetLoadShedding = mock(async () => 'No load shedding scheduled.')
const mockToolGetWeather = mock(async () => 'Sunny, 24 degrees.')
const mockToolWebSearch = mock(async () => 'Search result for your query.')
mock.module('../src/tools/ambient', () => ({
  toolGetLoadShedding: mockToolGetLoadShedding,
  toolGetWeather: mockToolGetWeather,
  toolWebSearch: mockToolWebSearch,
}))

// ---- Mock src/lib/errors ----
mock.module('../src/lib/errors', () => ({
  spokenError: (context: string) => `Sorry, I had a problem with ${context}. Please try again.`,
}))

// ---- Import AFTER all mocks ----
import { apiRouter } from '../src/routes/api'

const TEST_USER_ID = 'user-voice-test-001'
const TOKEN = 'test-bearer-token'

// Build a minimal Hono app matching server.ts middleware chain
function buildApp() {
  const { bearerAuth } = require('hono/bearer-auth')
  const app = new Hono()
  process.env.API_BEARER_TOKEN = TOKEN
  app.use('/api/*', bearerAuth({ token: TOKEN }))
  app.route('/api', apiRouter)
  return app
}

async function postCommand(
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown>,
  authed = true
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authed) headers['Authorization'] = `Bearer ${TOKEN}`
  const req = new Request('http://localhost/api/voice/command', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return app.fetch(req)
}

describe('POST /api/voice/command', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    // Reset session mock state
    mockPhase = 'idle'
    mockPendingMessage = undefined

    // Clear all mock call records
    mockClassifyIntent.mockClear()
    mockRunOrchestrator.mockClear()
    mockGetState.mockClear()
    mockGetPhase.mockClear()
    mockClearSession.mockClear()
    mockInsert.mockClear()
    mockFrom.mockClear()
    mockToolReadMessages.mockClear()
    mockToolGetLoadShedding.mockClear()
    mockToolGetWeather.mockClear()
    mockToolWebSearch.mockClear()

    // Reset mock implementations to defaults
    mockClassifyIntent.mockImplementation(() => null)
    mockRunOrchestrator.mockImplementation(async () => 'Agent response')
    mockGetState.mockImplementation(() => ({ phase: mockPhase, pendingMessage: mockPendingMessage, lastActivity: Date.now() }))
    mockGetPhase.mockImplementation(() => mockPhase)

    // Mock fetch for WhatsApp API calls
    globalThis.fetch = mock(async (_url: string | URL | Request) => {
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test123' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    app = buildApp()
  })

  // --- Test 1: 400 on missing userId ---
  test('returns 400 when userId is missing', async () => {
    const res = await postCommand(app, { transcript: 'hello' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  // --- Test 2: 400 on missing transcript ---
  test('returns 400 when transcript is missing', async () => {
    const res = await postCommand(app, { userId: TEST_USER_ID })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  // --- Test 3: confirm_send fast-path — sends via WhatsApp, logs message_log, clears session ---
  test('confirm_send fast-path: sends WhatsApp message and returns action=confirm', async () => {
    mockPhase = 'awaiting_approval'
    mockPendingMessage = { to: '+27831234567', toName: 'Naledi', body: 'Hello there' }
    mockClassifyIntent.mockImplementation(() => 'confirm_send')
    mockGetState.mockImplementation(() => ({ phase: 'awaiting_approval', pendingMessage: mockPendingMessage, lastActivity: Date.now() }))
    mockGetPhase.mockImplementation(() => 'awaiting_approval')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'yes' })
    expect(res.status).toBe(200)
    const body = await res.json() as { spoken: string; action: string; requiresConfirmation: boolean }
    expect(body.action).toBe('confirm')
    expect(body.requiresConfirmation).toBe(false)
    expect(body.spoken).toContain('Naledi')
  })

  // --- Test 4: confirm_send with no pending message (idle phase) ---
  test('handleConfirmSend with no pending message returns spoken error', async () => {
    mockPhase = 'idle'
    mockPendingMessage = undefined
    mockClassifyIntent.mockImplementation(() => 'confirm_send')
    mockGetState.mockImplementation(() => ({ phase: 'idle', pendingMessage: undefined, lastActivity: Date.now() }))
    mockGetPhase.mockImplementation(() => 'idle')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'yes' })
    expect(res.status).toBe(200)
    const body = await res.json() as { spoken: string; action: string }
    expect(body.spoken).toContain('no pending message')
    expect(body.action).toBe('error')
  })

  // --- Test 5: cancel fast-path — clears session, returns action=cancel ---
  test('cancel fast-path: clears session and returns action=cancel', async () => {
    mockClassifyIntent.mockImplementation(() => 'cancel')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'no' })
    expect(res.status).toBe(200)
    const body = await res.json() as { spoken: string; action: string; requiresConfirmation: boolean }
    expect(body.action).toBe('cancel')
    expect(body.requiresConfirmation).toBe(false)
    expect(body.spoken).toContain('cancelled')
    // clearSession (via clearUserState) must have been called
    expect(mockClearSession.mock.calls.length).toBeGreaterThan(0)
  })

  // --- Test 6: read_messages fast-path — calls toolReadMessages, no LLM ---
  test('read_messages fast-path: calls toolReadMessages and returns action=fast_path', async () => {
    mockClassifyIntent.mockImplementation(() => 'read_messages')
    mockToolReadMessages.mockImplementation(async () => 'You have 3 new messages.')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'read my messages' })
    expect(res.status).toBe(200)
    const body = await res.json() as { spoken: string; action: string; requiresConfirmation: boolean }
    expect(body.action).toBe('fast_path')
    expect(body.requiresConfirmation).toBe(false)
    expect(body.spoken).toContain('messages')
    expect(mockRunOrchestrator.mock.calls.length).toBe(0)
  })

  // --- Test 7: unknown transcript (null intent) — routes to orchestrator ---
  test('unknown transcript routes to runOrchestrator and returns action=agent', async () => {
    mockClassifyIntent.mockImplementation(() => null)
    mockRunOrchestrator.mockImplementation(async () => 'Here is what I found.')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'what is the meaning of life?' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; spoken: string }
    expect(body.action).toBe('agent')
    expect(mockRunOrchestrator.mock.calls.length).toBe(1)
  })

  // --- Test 8: three-strike reset — third unknown input while awaiting_approval resets session ---
  test('three consecutive unknown inputs while awaiting_approval resets session on third call', async () => {
    mockClassifyIntent.mockImplementation(() => null)

    // First call
    mockPhase = 'awaiting_approval'
    mockPendingMessage = { to: '+27831234567', toName: 'Mom', body: 'Hi' }
    mockGetPhase.mockImplementation(() => 'awaiting_approval')
    mockGetState.mockImplementation(() => ({ phase: 'awaiting_approval', pendingMessage: mockPendingMessage, lastActivity: Date.now() }))
    const res1 = await postCommand(app, { userId: TEST_USER_ID, transcript: 'blah blah' })
    const body1 = await res1.json() as { action: string }
    expect(body1.action).toBe('awaiting')

    // Second call
    const res2 = await postCommand(app, { userId: TEST_USER_ID, transcript: 'something else' })
    const body2 = await res2.json() as { action: string }
    expect(body2.action).toBe('awaiting')

    // Third call — session must be reset
    const res3 = await postCommand(app, { userId: TEST_USER_ID, transcript: 'still nothing' })
    const body3 = await res3.json() as { action: string; spoken: string }
    expect(body3.action).toBe('error')
    expect(body3.spoken).toContain("didn't understand")
    // clearSession should have been called
    expect(mockClearSession.mock.calls.length).toBeGreaterThan(0)
  })

  // --- Test 9: load_shedding fast-path ---
  test('load_shedding fast-path: calls toolGetLoadShedding and skips LLM', async () => {
    mockClassifyIntent.mockImplementation(() => 'load_shedding')
    mockToolGetLoadShedding.mockImplementation(async () => 'Stage 2 from 18:00 to 20:30.')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'load shedding today' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; spoken: string }
    expect(body.action).toBe('fast_path')
    expect(body.spoken).toContain('Stage 2')
    expect(mockRunOrchestrator.mock.calls.length).toBe(0)
  })

  // --- Test 10: weather fast-path ---
  test('weather fast-path: calls toolGetWeather and skips LLM', async () => {
    mockClassifyIntent.mockImplementation(() => 'weather')
    mockToolGetWeather.mockImplementation(async () => 'Partly cloudy, 22 degrees Celsius.')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'what is the weather today?' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; spoken: string }
    expect(body.action).toBe('fast_path')
    expect(body.spoken).toContain('cloudy')
    expect(mockRunOrchestrator.mock.calls.length).toBe(0)
  })

  // --- Test 11: web_search fast-path ---
  test('web_search fast-path: calls toolWebSearch and skips LLM', async () => {
    mockClassifyIntent.mockImplementation(() => 'web_search')
    mockToolWebSearch.mockImplementation(async () => 'Bun is a fast JavaScript runtime.')

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'search for Bun runtime' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; spoken: string }
    expect(body.action).toBe('fast_path')
    expect(body.spoken).toContain('Bun')
    expect(mockRunOrchestrator.mock.calls.length).toBe(0)
  })

  // --- Test 12: orchestrator timeout returns spoken error ---
  test('orchestrator timeout returns spoken error and action=error', async () => {
    mockClassifyIntent.mockImplementation(() => null)
    mockRunOrchestrator.mockImplementation(async (_userId: string, _transcript: string, signal: AbortSignal) => {
      // Simulate aborted request
      const err = new Error('The operation was aborted')
      throw err
    })

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'something complex' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; spoken: string }
    expect(body.action).toBe('error')
    expect(body.spoken).toContain('Sorry')
  })

  // --- Test 13: orchestrator returns awaiting_approval state ---
  test('after orchestrator call, returns requiresConfirmation=true when session is awaiting_approval', async () => {
    mockClassifyIntent.mockImplementation(() => null)
    mockPendingMessage = { to: '+27831234567', toName: 'Lebo', body: 'See you tomorrow' }
    mockRunOrchestrator.mockImplementation(async () => {
      // Simulate orchestrator setting session to awaiting_approval
      mockPhase = 'awaiting_approval'
      mockGetPhase.mockImplementation(() => 'awaiting_approval')
      mockGetState.mockImplementation(() => ({ phase: 'awaiting_approval', pendingMessage: mockPendingMessage, lastActivity: Date.now() }))
      return 'I will send "See you tomorrow" to Lebo. Say yes to confirm.'
    })

    const res = await postCommand(app, { userId: TEST_USER_ID, transcript: 'message Lebo see you tomorrow' })
    expect(res.status).toBe(200)
    const body = await res.json() as { action: string; requiresConfirmation: boolean; pendingAction?: { type: string } }
    expect(body.action).toBe('agent')
    expect(body.requiresConfirmation).toBe(true)
    expect(body.pendingAction?.type).toBe('send_message')
  })
})
