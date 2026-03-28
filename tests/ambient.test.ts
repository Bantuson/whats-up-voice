// tests/ambient.test.ts
// Unit tests for ambient tool handlers — EskomSePush, OpenWeather, Tavily.
// AGENT-06: external API wrappers tested with mocked fetch / mocked tavily client.
import { describe, expect, test, mock, beforeEach } from 'bun:test'

// ---- Mock @tavily/core BEFORE tool import ----
const mockTavilySearch = mock(() =>
  Promise.resolve({
    answer: 'The capital of SA is Pretoria.',
    results: [],
  })
)
const mockTavilyClient = { search: mockTavilySearch }
const mockTavily = mock(() => mockTavilyClient)

mock.module('@tavily/core', () => ({
  tavily: mockTavily,
}))

// ---- Import after mocks ----
import { toolGetLoadShedding, toolGetWeather, toolWebSearch } from '../src/tools/ambient'

// ---- Test signal helper ----
function makeSignal(): AbortSignal {
  return new AbortController().signal
}

// ---- Fetch mock helpers ----
function mockFetch(status: number, body: unknown) {
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify(body), { status })
  ) as typeof fetch
}

describe('toolGetLoadShedding', () => {
  beforeEach(() => {
    // Restore fetch to a clean state
    globalThis.fetch = globalThis.fetch
  })

  test('returns formatted string when events are present (200 response)', async () => {
    mockFetch(200, {
      events: [
        {
          note: 'Stage 2',
          start: '2026-03-28 10:00',
          end: '2026-03-28 12:30',
        },
      ],
      schedule: { days: [] },
    })

    const result = await toolGetLoadShedding(makeSignal())
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('2026-03-28 10:00')
    expect(result).toContain('2026-03-28 12:30')
    expect(result).not.toContain('I could not fetch')
  })

  test('returns "no load shedding" message when events array is empty', async () => {
    mockFetch(200, {
      events: [],
      schedule: { days: [] },
    })

    const result = await toolGetLoadShedding(makeSignal())
    expect(result).toContain('no load shedding scheduled')
  })

  test('returns fallback string on non-200 response (never throws)', async () => {
    mockFetch(503, { error: 'Service Unavailable' })

    const result = await toolGetLoadShedding(makeSignal())
    expect(result).toBe('I could not fetch load shedding information right now.')
  })

  test('returns fallback string on network error (never throws)', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network error')
    }) as typeof fetch

    const result = await toolGetLoadShedding(makeSignal())
    expect(result).toBe('I could not fetch load shedding information right now.')
  })

  test('uses Token header (not Authorization: Bearer)', async () => {
    let capturedHeaders: Record<string, string> = {}
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {})
      )
      return new Response(JSON.stringify({ events: [] }), { status: 200 })
    }) as typeof fetch

    await toolGetLoadShedding(makeSignal())
    expect(capturedHeaders['Token']).toBeDefined()
    expect(capturedHeaders['Authorization']).toBeUndefined()
  })
})

describe('toolGetWeather', () => {
  test('returns formatted spoken weather string on 200 response', async () => {
    mockFetch(200, {
      current: {
        temp: 22.7,
        weather: [{ description: 'clear sky' }],
      },
      daily: [
        { temp: { max: 28.3, min: 15.1 } },
      ],
    })

    const result = await toolGetWeather(makeSignal())
    expect(result).toContain('23') // Math.round(22.7)
    expect(result).toContain('clear sky')
    expect(result).toContain('28') // Math.round(28.3)
    expect(result).toContain('15') // Math.round(15.1)
    expect(result).not.toContain('I could not fetch')
  })

  test('returns fallback string on non-200 response (never throws)', async () => {
    mockFetch(401, { message: 'Invalid API key' })

    const result = await toolGetWeather(makeSignal())
    expect(result).toBe('I could not fetch the weather right now.')
  })

  test('returns fallback string on network error (never throws)', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('DNS lookup failed')
    }) as typeof fetch

    const result = await toolGetWeather(makeSignal())
    expect(result).toBe('I could not fetch the weather right now.')
  })

  test('formats degrees rounded to integer', async () => {
    mockFetch(200, {
      current: {
        temp: 18.9,
        weather: [{ description: 'partly cloudy' }],
      },
      daily: [{ temp: { max: 24.5, min: 12.4 } }],
    })

    const result = await toolGetWeather(makeSignal())
    expect(result).toContain('19') // Math.round(18.9)
    expect(result).toContain('partly cloudy')
  })
})

describe('toolWebSearch', () => {
  beforeEach(() => {
    mockTavilySearch.mockClear()
  })

  test('returns response.answer when present', async () => {
    mockTavilySearch.mockImplementation(() =>
      Promise.resolve({
        answer: 'The capital of South Africa is Pretoria.',
        results: [],
      })
    )

    const result = await toolWebSearch('capital of South Africa', makeSignal())
    expect(result).toBe('The capital of South Africa is Pretoria.')
  })

  test('falls back to joined result contents when answer is missing', async () => {
    mockTavilySearch.mockImplementation(() =>
      Promise.resolve({
        answer: undefined,
        results: [
          { content: 'Pretoria is the executive capital.' },
          { content: 'Cape Town is the legislative capital.' },
        ],
      })
    )

    const result = await toolWebSearch('SA capitals', makeSignal())
    expect(result).toContain('Pretoria is the executive capital.')
    expect(result).toContain('Cape Town is the legislative capital.')
  })

  test('returns fallback on tavilyClient error (never throws)', async () => {
    mockTavilySearch.mockImplementation(() => {
      throw new Error('Tavily API error')
    })

    const result = await toolWebSearch('something', makeSignal())
    expect(result).toContain('I could not find information')
  })

  test('calls tavilyClient.search with correct options', async () => {
    mockTavilySearch.mockImplementation(() =>
      Promise.resolve({ answer: 'answer', results: [] })
    )

    await toolWebSearch('test query', makeSignal())
    expect(mockTavilySearch).toHaveBeenCalledWith('test query', {
      searchDepth: 'basic',
      maxResults: 3,
      includeAnswer: true,
      topic: 'general',
    })
  })
})
