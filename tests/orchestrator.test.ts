// tests/orchestrator.test.ts
// Unit tests for the Claude orchestrator — tool dispatch, fast-path check, sanitiser applied.
// AGENT-01, AGENT-02, AGENT-03, AGENT-04: Manual tool-use agentic loop tests.
//
// MOCK STRATEGY: Only '@anthropic-ai/sdk' is mocked at the module level.
// All other dependencies (supabase, session, tavily) are left unmocked — tools handle
// connection failures gracefully (return fallback strings), so no real I/O is needed.
// This avoids mock.module cross-contamination that occurs in Bun 1.3.x when running
// the full test suite (bun test) where module mocks persist across test files.
import { describe, expect, test, mock, beforeEach } from 'bun:test'

// ---- Mock @anthropic-ai/sdk BEFORE any import ----
// Bun hoists mock.module so the orchestrator's lazy singleton sees our mock class.
const mockMessagesCreate = mock(() =>
  Promise.resolve({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Hello world' }],
  })
)

const MockAnthropicClass = class {
  messages = { create: mockMessagesCreate }
}

mock.module('@anthropic-ai/sdk', () => ({
  default: MockAnthropicClass,
}))

// Mock memory recall to return empty array — prevents cross-test contamination from memory.test.ts
// when bun test runs the full suite (mocks persist in single-process test runner).
mock.module('../src/memory/recall', () => ({
  recallMemories: async () => [],
}))

// ---- Import after mocks ----
import { runOrchestrator, ALL_TOOLS, ORCHESTRATOR_SYSTEM_PROMPT } from '../src/agent/orchestrator'

const TEST_USER_ID = 'user-123'
const TEST_SIGNAL = new AbortController().signal

function makeEndTurnResponse(text: string) {
  return Promise.resolve({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
  })
}

function makeToolUseResponse(toolName: string, toolId: string, toolInput: Record<string, unknown>) {
  return Promise.resolve({
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: toolId, name: toolName, input: toolInput },
    ],
  })
}

describe('runOrchestrator', () => {
  beforeEach(() => {
    mockMessagesCreate.mockClear()
    // Block real network in tests — all tools handle fetch errors gracefully
    globalThis.fetch = mock(async () => new Response('{"events":[]}', { status: 200 })) as typeof fetch
  })

  // Test 1: end_turn with plain text — basic happy path
  test('returns text from end_turn response', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('Hello world'))

    const result = await runOrchestrator(TEST_USER_ID, 'Hi there', TEST_SIGNAL)
    expect(result).toBe('Hello world')
  })

  // Test 2: sanitiser is applied — markdown stripped
  test('strips markdown from end_turn response (sanitiser applied)', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('**bold** text'))

    const result = await runOrchestrator(TEST_USER_ID, 'some query', TEST_SIGNAL)
    expect(result).toBe('bold text')
    expect(result).not.toContain('**')
  })

  // Test 3: tool_use loop — SDK called twice, tool_result fed back
  // Uses GetLoadShedding which depends only on fetch (no supabase)
  test('handles tool_use loop — calls SDK twice when tool needed', async () => {
    // Mock fetch to return valid load shedding response
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ events: [], schedule: { days: [] } }), { status: 200 })
    ) as typeof fetch

    let callCount = 0
    let capturedSecondCallMessages: unknown[] = []
    mockMessagesCreate.mockImplementation((args: { messages: unknown[] }) => {
      callCount++
      if (callCount === 1) {
        return makeToolUseResponse('GetLoadShedding', 'tool-1', {})
      }
      capturedSecondCallMessages = JSON.parse(JSON.stringify(args.messages))
      return makeEndTurnResponse('There is no load shedding scheduled.')
    })

    const result = await runOrchestrator(TEST_USER_ID, 'load shedding', TEST_SIGNAL)
    // SDK called twice: once with user message, once with tool_result
    expect(mockMessagesCreate.mock.calls.length).toBe(2)
    // Second call messages: user(transcript) + assistant(tool_use) + user(tool_result) = 3
    expect(capturedSecondCallMessages.length).toBe(3)
    // Third message should be the tool_result
    const toolResultMsg = capturedSecondCallMessages[2] as { role: string; content: unknown[] }
    expect(toolResultMsg.role).toBe('user')
    const toolResult = toolResultMsg.content[0] as { type: string; tool_use_id: string }
    expect(toolResult.type).toBe('tool_result')
    expect(toolResult.tool_use_id).toBe('tool-1')
    expect(result).toBe('There is no load shedding scheduled.')
  })

  // Test 4: caps at MAX_TOOL_CALLS=10 and returns fallback
  // Uses GetWeather (fetch-based, no supabase) to avoid DB dependencies
  test('caps at 10 tool calls and returns fallback error string', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        current: { temp: 22, weather: [{ description: 'clear' }] },
        daily: [{ temp: { max: 28, min: 15 } }],
      }), { status: 200 })
    ) as typeof fetch

    mockMessagesCreate.mockImplementation(() =>
      makeToolUseResponse('GetWeather', 'tool-loop', {})
    )

    const result = await runOrchestrator(TEST_USER_ID, 'endless loop', TEST_SIGNAL)
    expect(result).toContain('ran into a problem')
    expect(mockMessagesCreate.mock.calls.length).toBe(10)
  })

  // Test 5: correct model string used (CRITICAL — must be claude-sonnet-4-6)
  test('calls anthropic.messages.create with model claude-sonnet-4-6', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('OK'))

    await runOrchestrator(TEST_USER_ID, 'test', TEST_SIGNAL)

    const callArgs = mockMessagesCreate.mock.calls[0][0] as { model: string }
    expect(callArgs.model).toBe('claude-sonnet-4-6')
  })

  // Test 6: passes signal to SDK
  test('passes AbortSignal to anthropic.messages.create', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('OK'))

    const controller = new AbortController()
    await runOrchestrator(TEST_USER_ID, 'test', controller.signal)

    const callOptions = mockMessagesCreate.mock.calls[0][1] as { signal: AbortSignal }
    expect(callOptions.signal).toBe(controller.signal)
  })

  // Test 7: fallback for unknown stop_reason
  test('returns sanitised fallback when stop_reason is not end_turn or tool_use', async () => {
    mockMessagesCreate.mockImplementation(() =>
      Promise.resolve({ stop_reason: 'max_tokens', content: [] })
    )

    const result = await runOrchestrator(TEST_USER_ID, 'test', TEST_SIGNAL)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toContain('**')
  })

  // Test 8: SDK called with correct system prompt
  test('calls anthropic.messages.create with ORCHESTRATOR_SYSTEM_PROMPT', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('OK'))

    await runOrchestrator(TEST_USER_ID, 'test', TEST_SIGNAL)

    const callArgs = mockMessagesCreate.mock.calls[0][0] as { system: string }
    expect(callArgs.system).toBe(ORCHESTRATOR_SYSTEM_PROMPT)
  })

  // Test 9: SDK called with ALL_TOOLS (10 tools)
  test('calls anthropic.messages.create with all 10 tools', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('OK'))

    await runOrchestrator(TEST_USER_ID, 'test', TEST_SIGNAL)

    const callArgs = mockMessagesCreate.mock.calls[0][0] as { tools: unknown[] }
    expect(callArgs.tools).toHaveLength(10)
  })

  // Test 10: initial message contains transcript
  test('sends transcript as first user message to SDK', async () => {
    mockMessagesCreate.mockImplementation(() => makeEndTurnResponse('OK'))

    await runOrchestrator(TEST_USER_ID, 'what is the weather?', TEST_SIGNAL)

    const callArgs = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }
    expect(callArgs.messages[0].role).toBe('user')
    expect(callArgs.messages[0].content).toBe('what is the weather?')
  })

  // Test 11: sanitiser applied on fallback when tool cap exceeded
  test('no markdown in cap-exceeded fallback response', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ events: [] }), { status: 200 })
    ) as typeof fetch

    mockMessagesCreate.mockImplementation(() =>
      makeToolUseResponse('GetLoadShedding', 'tool-loop', {})
    )

    const result = await runOrchestrator(TEST_USER_ID, 'test', TEST_SIGNAL)
    expect(result).not.toContain('**')
    expect(result).not.toContain('##')
  })
})

describe('ALL_TOOLS', () => {
  test('defines exactly 10 tools', () => {
    expect(ALL_TOOLS).toHaveLength(10)
  })

  test('includes all required tool names', () => {
    const names = ALL_TOOLS.map((t) => t.name)
    expect(names).toContain('ReadMessages')
    expect(names).toContain('SendMessage')
    expect(names).toContain('ResolveContact')
    expect(names).toContain('GetContact')
    expect(names).toContain('SaveContact')
    expect(names).toContain('ListContacts')
    expect(names).toContain('SetPriority')
    expect(names).toContain('GetLoadShedding')
    expect(names).toContain('GetWeather')
    expect(names).toContain('WebSearch')
  })

  test('each tool has name, description, and valid input_schema', () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe('object')
    }
  })

  test('SendMessage requires toPhone and body (toName optional)', () => {
    const sendMsg = ALL_TOOLS.find((t) => t.name === 'SendMessage')!
    expect(sendMsg.input_schema.required).toContain('toPhone')
    expect(sendMsg.input_schema.required).toContain('body')
    expect(sendMsg.input_schema.required).not.toContain('toName')
  })

  test('WebSearch requires query', () => {
    const webSearch = ALL_TOOLS.find((t) => t.name === 'WebSearch')!
    expect(webSearch.input_schema.required).toContain('query')
  })

  test('SetPriority requires name and priority', () => {
    const setPriority = ALL_TOOLS.find((t) => t.name === 'SetPriority')!
    expect(setPriority.input_schema.required).toContain('name')
    expect(setPriority.input_schema.required).toContain('priority')
  })
})

describe('ORCHESTRATOR_SYSTEM_PROMPT', () => {
  test('contains "Never use markdown" instruction', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT.toLowerCase()).toContain('never use markdown')
  })

  test('contains "natural spoken sentences" instruction', () => {
    const lower = ORCHESTRATOR_SYSTEM_PROMPT.toLowerCase()
    expect(
      lower.includes('natural spoken') || lower.includes('spoken sentences') || lower.includes('spoken-natural')
    ).toBe(true)
  })

  test('contains instruction about phone numbers digit-by-digit', () => {
    const lower = ORCHESTRATOR_SYSTEM_PROMPT.toLowerCase()
    expect(lower.includes('digit') || lower.includes('phone number')).toBe(true)
  })

  test('contains "Ask only one question at a time" instruction', () => {
    const lower = ORCHESTRATOR_SYSTEM_PROMPT.toLowerCase()
    expect(lower.includes('one question')).toBe(true)
  })
})
