// tests/navigation.test.ts
// VI-NAV-01, VI-NAV-02, VI-NAV-03: Verbose Navigation tool tests
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- Mock @anthropic-ai/sdk before any import that uses it ----
const mockMessagesCreate = mock(async () => ({
  content: [{ type: 'text', text: 'You are passing a busy market on your left. Head towards Commissioner Street.' }],
  stop_reason: 'end_turn',
}))

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate }
  },
}))

// ---- Mock streamSpeech so TTS does not fire in tests ----
const mockStreamSpeech = mock(async (_text: string, _userId: string) => {})
mock.module('../src/tts/elevenlabs', () => ({
  streamSpeech: mockStreamSpeech,
}))

// ---- Mock fetch globally for Google Maps APIs ----
const mockFetch = mock(async (url: string) => {
  const urlStr = String(url)
  if (urlStr.includes('maps.googleapis.com/maps/api/directions')) {
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        routes: [{
          legs: [{
            steps: [
              {
                html_instructions: 'Head north on <b>Commissioner Street</b>',
                distance: { text: '200 m', value: 200 },
                duration: { text: '3 mins', value: 180 },
                start_location: { lat: -26.2041, lng: 28.0473 },
                end_location: { lat: -26.2021, lng: 28.0473 },
                maneuver: 'straight',
              },
              {
                html_instructions: 'Turn left onto <b>Bree Street</b>',
                distance: { text: '150 m', value: 150 },
                duration: { text: '2 mins', value: 120 },
                start_location: { lat: -26.2021, lng: 28.0473 },
                end_location: { lat: -26.2021, lng: 28.0453 },
                maneuver: 'turn-left',
              },
            ],
          }],
        }],
      }),
    }
  }
  if (urlStr.includes('maps.googleapis.com/maps/api/place/nearbysearch')) {
    return {
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [
          { name: 'Bree Street Taxi Rank', types: ['transit_station'], geometry: { location: { lat: -26.2041, lng: 28.0473 } } },
          { name: 'Shoprite', types: ['grocery_or_supermarket'], geometry: { location: { lat: -26.2042, lng: 28.0474 } } },
        ],
      }),
    }
  }
  return { ok: false, status: 404, json: async () => ({}) }
})

// Override global fetch
globalThis.fetch = mockFetch as unknown as typeof fetch

import {
  startNavigation,
  updateLocation,
  stopNavigation,
  describeWaypoint,
} from '../src/tools/navigation'
import { getState, clearSession, getPhase } from '../src/session/machine'

const USER = 'nav-test-user-001'

beforeEach(() => {
  clearSession(USER)
  mockFetch.mockClear()
  mockStreamSpeech.mockClear()
  mockMessagesCreate.mockClear()
})

// ---- Helper to parse location message like webhook does ----
function parseLocationMessage(rawBody: string): { lat: number; lng: number } | null {
  const params = new URLSearchParams(rawBody)
  const latStr = params.get('Latitude')
  const lngStr = params.get('Longitude')
  if (latStr === null || lngStr === null) return null
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  if (isNaN(lat) || isNaN(lng)) return null
  return { lat, lng }
}

describe('VI-NAV-01: startNavigation', () => {
  test('Test 1: calls Google Maps Directions API with destination and key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key'
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.ELEVENLABS_API_KEY = 'test-el-key'

    const result = await startNavigation(USER, 'Bree Street Taxi Rank')

    // At least one fetch call to Directions API
    const fetchCalls = mockFetch.mock.calls.map((c) => String(c[0]))
    const directionCall = fetchCalls.find((u) => u.includes('maps.googleapis.com/maps/api/directions'))
    expect(directionCall).toBeDefined()
    expect(directionCall).toContain('destination=Bree+Street+Taxi+Rank')
    expect(directionCall).toContain('key=test-maps-key')

    // Result has waypoints
    expect(result.started).toBe(true)
    expect(result.waypointCount).toBeGreaterThan(0)
  })
})

describe('VI-NAV-01: describeWaypoint', () => {
  test('Test 2: calls Anthropic with VI system prompt and returns plain text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

    const description = await describeWaypoint(
      'Turn left onto Commissioner Street',
      ['Bree Street Taxi Rank', 'Shoprite'],
      200,
    )

    // Anthropic was called
    expect(mockMessagesCreate.mock.calls.length).toBeGreaterThan(0)
    const callArgs = mockMessagesCreate.mock.calls[0][0] as { system: string; messages: Array<{ content: string }> }

    // System prompt contains 'visually impaired' and 'environment'
    expect(callArgs.system).toContain('visually impaired')
    expect(callArgs.system).toContain('environment')

    // Description contains no markdown
    expect(description).not.toMatch(/\*\*|##|```/)
    expect(typeof description).toBe('string')
    expect(description.length).toBeGreaterThan(0)
  })
})

describe('VI-NAV-02: updateLocation', () => {
  test('Test 3: returns { advanced: boolean, waypointDescription: string | null, completed: boolean }', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key'

    await startNavigation(USER, 'Bree Street Taxi Rank')

    // Update location — not yet at waypoint end (will return advanced: false)
    const result = await updateLocation(USER, -26.2041, 28.0473)

    expect(typeof result.advanced).toBe('boolean')
    // waypointDescription can be string or null
    expect(result.waypointDescription === null || typeof result.waypointDescription === 'string').toBe(true)
    expect(typeof result.completed).toBe('boolean')
  })
})

describe('VI-NAV-03: stopNavigation', () => {
  test('Test 4: stops navigation and resets session to idle', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key'

    await startNavigation(USER, 'Bree Street Taxi Rank')

    // Confirm we are now in navigating phase
    expect(getPhase(USER)).toBe('navigating')
    expect(getState(USER).navigationSession).toBeDefined()

    await stopNavigation(USER)

    // Phase should be idle and navigationSession cleared
    expect(getPhase(USER)).toBe('idle')
    expect(getState(USER).navigationSession).toBeUndefined()
  })
})

describe('VI-NAV-02: Webhook location message detection', () => {
  test('Test 5: Twilio form body with Latitude/Longitude is detected as location message', () => {
    const body = 'From=whatsapp%3A%2B27821234567&Latitude=-26.2041&Longitude=28.0473&Address=Johannesburg&Label=Bree+Street'
    const result = parseLocationMessage(body)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(-26.2041, 4)
    expect(result!.lng).toBeCloseTo(28.0473, 4)
  })

  test('Test 5b: Body without Latitude returns null (not a location message)', () => {
    const body = 'From=whatsapp%3A%2B27821234567&Body=Hello+there'
    const result = parseLocationMessage(body)
    expect(result).toBeNull()
  })
})

describe('VI-NAV-01: Places API enrichment', () => {
  test('Test 6: startNavigation calls Places API for nearby places enrichment', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key'

    await startNavigation(USER, 'Bree Street Taxi Rank')

    const fetchCalls = mockFetch.mock.calls.map((c) => String(c[0]))
    const placesCall = fetchCalls.find((u) => u.includes('maps.googleapis.com/maps/api/place/nearbysearch'))
    expect(placesCall).toBeDefined()
    // Should contain a location coordinate
    expect(placesCall).toContain('location=')
  })
})
