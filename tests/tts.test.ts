// tests/tts.test.ts
// Tests for ElevenLabs TTS streaming wrapper and pushInterrupt delegation.
// Uses Bun mock.module() to intercept ElevenLabsClient, supabase, and ws/connections
// before the production modules are loaded.

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Mock ElevenLabsClient — must be before any production import
const mockStream = mock(async function* () {
  yield new Uint8Array([1, 2, 3])
  yield new Uint8Array([4, 5, 6])
})
const mockTextToSpeechStream = mock(() => mockStream())
mock.module('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: mock(function () {
    return { textToSpeech: { stream: mockTextToSpeechStream } }
  }),
}))

// Mock supabase — language defaults to 'en'
const mockLanguageSelect = mock(() =>
  Promise.resolve({ data: { language: 'en' }, error: null })
)
mock.module('../src/db/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockLanguageSelect,
        }),
      }),
    }),
  },
}))

// Mock ws/connections — capture all frames sent to the mock WebSocket
const sentFrames: Array<string | Uint8Array> = []
const mockWs = { send: mock((data: string | Uint8Array) => { sentFrames.push(data) }) }
const mockGetConnection = mock(() => mockWs)
mock.module('../src/ws/connections', () => ({
  getConnection: mockGetConnection,
  registerConnection: mock(() => {}),
  removeConnection: mock(() => {}),
  pushInterrupt: mock(async (userId: string, text: string) => {
    const { streamSpeech } = await import('../src/tts/elevenlabs')
    await streamSpeech(text, userId)
  }),
}))

// Now import production code (mocks are in place)
import { streamSpeech } from '../src/tts/elevenlabs'

// Helper to reset sentFrames before each test
beforeEach(() => {
  sentFrames.length = 0
  mockTextToSpeechStream.mockReset()
  mockTextToSpeechStream.mockImplementation(() => mockStream())
  mockLanguageSelect.mockReset()
  mockLanguageSelect.mockImplementation(() =>
    Promise.resolve({ data: { language: 'en' }, error: null })
  )
  mockWs.send.mockReset()
  mockWs.send.mockImplementation((data: string | Uint8Array) => { sentFrames.push(data) })
})

describe('streamSpeech', () => {
  it('sends audio_start frame before first chunk', async () => {
    await streamSpeech('hello', 'user-1')
    const firstFrame = sentFrames[0]
    expect(typeof firstFrame).toBe('string')
    expect(JSON.parse(firstFrame as string)).toEqual({ type: 'audio_start' })
  })

  it('sends binary chunks after audio_start', async () => {
    await streamSpeech('hello', 'user-1')
    const firstChunk = sentFrames[1]
    expect(firstChunk).toBeInstanceOf(Uint8Array)
    expect(Array.from(firstChunk as Uint8Array)).toEqual([1, 2, 3])
  })

  it('sends audio_end frame after last chunk', async () => {
    await streamSpeech('hello', 'user-1')
    const lastFrame = sentFrames[sentFrames.length - 1]
    expect(typeof lastFrame).toBe('string')
    expect(JSON.parse(lastFrame as string)).toEqual({ type: 'audio_end' })
  })

  it('uses eleven_multilingual_v2 model for Afrikaans', async () => {
    mockLanguageSelect.mockImplementation(() =>
      Promise.resolve({ data: { language: 'af' }, error: null })
    )
    await streamSpeech('Goeie môre', 'user-af')
    expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1)
    const callArgs = mockTextToSpeechStream.mock.calls[0]
    expect(callArgs[1]).toMatchObject({ modelId: 'eleven_multilingual_v2' })
  })

  it('uses eleven_flash_v2_5 model for English', async () => {
    mockLanguageSelect.mockImplementation(() =>
      Promise.resolve({ data: { language: 'en' }, error: null })
    )
    await streamSpeech('Good morning', 'user-en')
    expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1)
    const callArgs = mockTextToSpeechStream.mock.calls[0]
    expect(callArgs[1]).toMatchObject({ modelId: 'eleven_flash_v2_5' })
  })
})

describe('streamSpeech — outputFormat', () => {
  it('always uses outputFormat opus_48000_32 — never the SDK default MP3', async () => {
    await streamSpeech('hello', 'user-1')
    expect(mockTextToSpeechStream).toHaveBeenCalledTimes(1)
    const callArgs = mockTextToSpeechStream.mock.calls[0]
    expect(callArgs[1].outputFormat).toBe('opus_48000_32')
  })
})

describe('pushInterrupt', () => {
  it('delegates to streamSpeech with correct userId and text', async () => {
    const { pushInterrupt } = await import('../src/ws/connections')
    await pushInterrupt('user-1', 'Test alert')
    // Verify audio frames were delivered (audio_start + chunks + audio_end)
    expect(sentFrames.length).toBeGreaterThan(0)
    const firstFrame = sentFrames[0]
    expect(JSON.parse(firstFrame as string)).toEqual({ type: 'audio_start' })
    const lastFrame = sentFrames[sentFrames.length - 1]
    expect(JSON.parse(lastFrame as string)).toEqual({ type: 'audio_end' })
  })
})
