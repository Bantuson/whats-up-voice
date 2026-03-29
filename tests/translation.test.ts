// tests/translation.test.ts
// VI-TRANSLATE-01, VI-TRANSLATE-02: Tests for realtime language translation tool.
// Tests cover: activateTranslation, deactivateTranslation, translateUtterance,
// language name mapping, session state updates, and invalid language handling.

import { describe, test, expect, beforeEach, mock } from 'bun:test'

// Mock Anthropic before importing translation module
const mockMessagesCreate = mock(() =>
  Promise.resolve({
    content: [{ type: 'text', text: 'Sawubona, intengo yini?' }],
  })
)
mock.module('@anthropic-ai/sdk', () => ({
  default: mock(function () {
    return { messages: { create: mockMessagesCreate } }
  }),
}))

// Mock streamSpeechInLanguage — translation.ts calls this to deliver TTS
const mockStreamSpeechInLanguage = mock(() => Promise.resolve())
mock.module('../src/tts/elevenlabs', () => ({
  streamSpeech: mock(() => Promise.resolve()),
  streamSpeechInLanguage: mockStreamSpeechInLanguage,
}))

// Import after mocks
import {
  activateTranslation,
  deactivateTranslation,
  translateUtterance,
  LANGUAGE_NAMES,
} from '../src/tools/translation'
import { getState, clearSession, setTranslationTarget } from '../src/session/machine'

const USER = 'translation-test-user'

beforeEach(() => {
  clearSession(USER)
  mockMessagesCreate.mockReset()
  mockMessagesCreate.mockImplementation(() =>
    Promise.resolve({
      content: [{ type: 'text', text: 'Sawubona, intengo yini?' }],
    })
  )
  mockStreamSpeechInLanguage.mockReset()
  mockStreamSpeechInLanguage.mockImplementation(() => Promise.resolve())
})

describe('VI-TRANSLATE-01: activateTranslation', () => {
  test('Test 1 (activate): returns active=true, correct targetLanguage, and confirmation containing language name', async () => {
    const result = await activateTranslation(USER, 'zu')
    expect(result.active).toBe(true)
    expect(result.targetLanguage).toBe('zu')
    expect(result.spokenConfirmation).toBeDefined()
    expect(typeof result.spokenConfirmation).toBe('string')
    // Confirmation must contain 'Zulu' not just 'zu'
    expect(result.spokenConfirmation).toContain('Zulu')
  })

  test('Test 5 (session state after activate): phase is translating and translationTarget is set', async () => {
    await activateTranslation(USER, 'xh')
    const state = getState(USER)
    expect(state.phase).toBe('translating')
    expect(state.translationTarget).toBe('xh')
  })

  test('Test 6 (invalid language): activateTranslation works for non-SA languages (fr)', async () => {
    const result = await activateTranslation(USER, 'fr')
    expect(result.active).toBe(true)
    expect(result.targetLanguage).toBe('fr')
    // Confirmation should still work — French is in LANGUAGE_NAMES
    expect(result.spokenConfirmation).toContain('French')
  })
})

describe('VI-TRANSLATE-02: deactivateTranslation', () => {
  test('Test 2 (deactivate): returns active=false and clears translationTarget from session', async () => {
    await activateTranslation(USER, 'zu')
    const result = await deactivateTranslation(USER)
    expect(result.active).toBe(false)
    const state = getState(USER)
    expect(state.translationTarget).toBeUndefined()
  })
})

describe('VI-TRANSLATE-02: translateUtterance', () => {
  test('Test 3 (translateUtterance): calls Anthropic with system prompt containing target language name', async () => {
    await activateTranslation(USER, 'zu')

    let capturedSystemPrompt = ''
    let capturedUserMessage = ''
    mockMessagesCreate.mockImplementation((params: { system?: string; messages?: Array<{ role: string; content: string }> }) => {
      capturedSystemPrompt = params.system ?? ''
      capturedUserMessage = params.messages?.[0]?.content ?? ''
      return Promise.resolve({
        content: [{ type: 'text', text: 'Sawubona, intengo yini?' }],
      })
    })

    const result = await translateUtterance(USER, 'Hello, how much is this?')
    expect(capturedSystemPrompt).toContain('Zulu')
    expect(capturedUserMessage).toBe('Hello, how much is this?')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('Test 4 (language name mapping): prompt contains full language name not just code', async () => {
    // Test Xhosa
    clearSession(USER)
    await activateTranslation(USER, 'xh')

    let capturedSystemPrompt = ''
    mockMessagesCreate.mockImplementation((params: { system?: string }) => {
      capturedSystemPrompt = params.system ?? ''
      return Promise.resolve({
        content: [{ type: 'text', text: 'Molo, ixabiso lixhantsi?' }],
      })
    })

    await translateUtterance(USER, 'Hello, how much is this?')
    expect(capturedSystemPrompt).toContain('Xhosa')
    expect(capturedSystemPrompt).not.toContain('"xh"')
  })
})

describe('LANGUAGE_NAMES mapping', () => {
  test('contains all required SA language codes', () => {
    expect(LANGUAGE_NAMES['zu']).toBe('Zulu')
    expect(LANGUAGE_NAMES['xh']).toBe('Xhosa')
    expect(LANGUAGE_NAMES['st']).toBe('Sesotho')
    expect(LANGUAGE_NAMES['af']).toBe('Afrikaans')
    expect(LANGUAGE_NAMES['en']).toBe('English')
  })

  test('contains French for non-SA language test', () => {
    expect(LANGUAGE_NAMES['fr']).toBe('French')
  })
})
