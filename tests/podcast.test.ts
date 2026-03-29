// tests/podcast.test.ts
// VI-PODCAST-01, VI-PODCAST-02, VI-PODCAST-03: Generated podcast feature tests.
// Tests mock @tavily/core and @anthropic-ai/sdk — no real API calls.
import { describe, test, expect, beforeAll, mock } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock @tavily/core BEFORE importing the module under test
// ---------------------------------------------------------------------------
const mockSearch = mock(async (_query: string, _opts: unknown) => ({
  answer: 'Kaizer Chiefs is a famous South African football club.',
  results: [
    { content: 'Kaizer Chiefs was founded in 1970 by Kaizer Motaung.' },
    { content: 'They are based in Johannesburg and have won numerous league titles.' },
  ],
}))

const mockTavilyClient = { search: mockSearch }
const mockTavilyFactory = mock((_opts: unknown) => mockTavilyClient)

mock.module('@tavily/core', () => ({
  tavily: mockTavilyFactory,
}))

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk BEFORE importing the module under test
// ---------------------------------------------------------------------------
const MOCK_SCRIPT =
  'Kaizer Chiefs is a legendary football club in South Africa. Founded by the great Kaizer Motaung in 1970, they have inspired millions of passionate fans across the country and beyond. Their story is truly one of passion, triumph, resilience, and deep community pride. And that is today story on Kaizer Chiefs.'

const MOCK_SHORT_SCRIPT =
  'Kaizer Chiefs is a legendary South African football club founded in 1970 by Kaizer Motaung. They have won numerous titles and remain one of the most beloved clubs on the continent. That is the short story on Kaizer Chiefs.'

const mockMessagesCreate = mock(async (params: { system?: string }) => {
  const isShortVersion =
    params.system?.includes('short') ||
    params.system?.includes('one minute') ||
    params.system?.includes('60 second')

  if (isShortVersion) {
    return {
      content: [{ type: 'text', text: MOCK_SHORT_SCRIPT }],
    }
  }

  return {
    content: [{ type: 'text', text: MOCK_SCRIPT }],
  }
})

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate }
  },
}))

// ---------------------------------------------------------------------------
// Mock streamSpeech so no real WebSocket calls are made
// ---------------------------------------------------------------------------
const mockStreamSpeech = mock(async (_text: string, _userId: string) => {})

mock.module('../src/tts/elevenlabs', () => ({
  streamSpeech: mockStreamSpeech,
}))

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------
let generatePodcast: (topic: string, userId: string, shortVersion?: boolean) => Promise<string>
let classifyIntent: (transcript: string) => import('../src/agent/classifier').FastPathIntent | null

beforeAll(async () => {
  const podcastMod = await import('../src/tools/podcast')
  generatePodcast = podcastMod.generatePodcast
  const classifierMod = await import('../src/agent/classifier')
  classifyIntent = classifierMod.classifyIntent
})

// ---------------------------------------------------------------------------
// Test 1: Tavily search is called with correct params
// ---------------------------------------------------------------------------
describe('generatePodcast — Tavily research', () => {
  test('calls Tavily search with topic and searchDepth advanced', async () => {
    mockSearch.mockClear()
    await generatePodcast('Kaizer Chiefs', 'user-1')
    expect(mockSearch.mock.calls.length).toBeGreaterThan(0)
    const [query, opts] = mockSearch.mock.calls[0] as [string, { searchDepth: string }]
    expect(query).toContain('Kaizer Chiefs')
    expect(opts.searchDepth).toBe('advanced')
  })
})

// ---------------------------------------------------------------------------
// Test 2: Script synthesis — length > 100 chars, no markdown
// ---------------------------------------------------------------------------
describe('generatePodcast — script synthesis', () => {
  test('returns a string with length > 100 chars and zero markdown chars', async () => {
    const result = await generatePodcast('Kaizer Chiefs', 'user-1')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(100)
    // No markdown characters
    expect(result).not.toMatch(/\*\*/)
    expect(result).not.toMatch(/##/)
    expect(result).not.toMatch(/`/)
  })
})

// ---------------------------------------------------------------------------
// Test 3: Short version — Anthropic called with short/60-second system prompt
// ---------------------------------------------------------------------------
describe('generatePodcast — short version', () => {
  test('passes short-version prompt to Anthropic when shortVersion=true', async () => {
    mockMessagesCreate.mockClear()
    await generatePodcast('Kaizer Chiefs', 'user-1', true)
    expect(mockMessagesCreate.mock.calls.length).toBeGreaterThan(0)
    const params = mockMessagesCreate.mock.calls[0][0] as { system: string }
    const systemLower = params.system.toLowerCase()
    const hasShortIndicator =
      systemLower.includes('one minute') ||
      systemLower.includes('60 second') ||
      systemLower.includes('short')
    expect(hasShortIndicator).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 4: Classifier — podcast_request intent
// ---------------------------------------------------------------------------
describe('classifyIntent — podcast_request', () => {
  test('tell me something about Kaizer Chiefs returns podcast_request', () => {
    expect(classifyIntent('tell me something about Kaizer Chiefs')).toBe('podcast_request')
  })

  test('make me a podcast about soccer returns podcast_request', () => {
    expect(classifyIntent('make me a podcast about soccer')).toBe('podcast_request')
  })

  test('tell me something about load shedding does NOT return podcast_request (load_shedding wins)', () => {
    const intent = classifyIntent('tell me something about load shedding')
    expect(intent).not.toBe('podcast_request')
  })

  test('I want to hear about the weather does NOT return podcast_request (weather wins)', () => {
    const intent = classifyIntent('I want to hear about the weather')
    expect(intent).not.toBe('podcast_request')
  })
})

// ---------------------------------------------------------------------------
// Test 5: Classifier — short_version intent
// ---------------------------------------------------------------------------
describe('classifyIntent — short_version', () => {
  test('give me the short version returns short_version', () => {
    expect(classifyIntent('give me the short version')).toBe('short_version')
  })

  test('short version returns short_version', () => {
    expect(classifyIntent('short version')).toBe('short_version')
  })

  test('summarise that returns short_version', () => {
    expect(classifyIntent('summarise that')).toBe('short_version')
  })
})
