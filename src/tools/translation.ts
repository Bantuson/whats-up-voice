// src/tools/translation.ts
// VI-TRANSLATE-01, VI-TRANSLATE-02: Realtime language translation tool.
// Session-based: activateTranslation sets translating phase + stores targetLanguage.
// translateUtterance: Claude translates text → streamSpeechInLanguage delivers TTS in target language.
// SA language support: Zulu (zu), Xhosa (xh), Sesotho (st), Afrikaans (af), English (en).
import Anthropic from '@anthropic-ai/sdk'
import { transition, getState, setTranslationTarget, clearTranslationTarget } from '../session/machine'
import { streamSpeechInLanguage } from '../tts/openai-tts'
import { sanitiseForSpeech } from '../agent/sanitiser'

// BCP-47 code to full language name mapping for Claude prompts
export const LANGUAGE_NAMES: Record<string, string> = {
  zu: 'Zulu',
  xh: 'Xhosa',
  st: 'Sesotho',
  af: 'Afrikaans',
  en: 'English',
  fr: 'French',
  pt: 'Portuguese',
  sw: 'Swahili',
  // Extend as needed — Claude handles any language
}

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code
}

// Lazy singleton — same pattern as orchestrator.ts
let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  return _anthropic
}

export interface ActivationResult {
  active: boolean
  targetLanguage: string
  spokenConfirmation: string
}

export interface TranslationSession {
  userId: string
  targetLanguage: string
  active: boolean
}

export async function activateTranslation(userId: string, targetLanguage: string): Promise<ActivationResult> {
  const langName = getLanguageName(targetLanguage)
  // Transition to translating — from whatever current phase
  try {
    transition(userId, 'translating')
  } catch {
    // If direct transition fails, reset to idle then transition
    try {
      transition(userId, 'idle')
    } catch {
      // Already idle or in a non-recoverable state — ignore
    }
    transition(userId, 'translating')
  }
  setTranslationTarget(userId, targetLanguage)

  const spokenConfirmation = sanitiseForSpeech(
    `Translation mode is now active. I will translate everything you say into ${langName}. Say stop translating to exit.`
  )

  return { active: true, targetLanguage, spokenConfirmation }
}

export async function deactivateTranslation(userId: string): Promise<{ active: false }> {
  clearTranslationTarget(userId)
  try {
    transition(userId, 'idle')
  } catch {
    // Already idle or in a state that can't transition — silently accept
  }
  return { active: false }
}

export async function translateUtterance(userId: string, text: string): Promise<string> {
  const state = getState(userId)
  const targetLanguage = state.translationTarget ?? 'en'
  const targetName = getLanguageName(targetLanguage)
  const sourceName = state.detectedLanguage ? getLanguageName(state.detectedLanguage) : 'the user\'s language'

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are a real-time interpreter. Translate the following speech from ${sourceName} into ${targetName}.
Output ONLY the translated text — no explanations, no labels, no markdown, no quotes.
The translation will be spoken aloud via text-to-speech. Use natural spoken ${targetName}.`,
    messages: [{ role: 'user', content: text }],
  })

  const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined
  const translated = sanitiseForSpeech(textBlock?.text ?? text)

  // Deliver via ElevenLabs using target language voice
  await streamSpeechInLanguage(translated, userId, targetLanguage)

  return translated
}
