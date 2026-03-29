// src/tts/elevenlabs.ts
// ElevenLabsClient streaming TTS wrapper.
// ALWAYS use ElevenLabsClient — never the ElevenLabs constructor (throws TypeError at runtime).
// Output format is always opus_48000_32 — never mp3_44100_128 or SDK default.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { supabase } from '../db/client'
import { getConnection } from '../ws/connections'

// Lazy singleton — created on first use so tests can override env vars before import
let _client: ElevenLabsClient | null = null

function getClient(): ElevenLabsClient {
  if (!_client) _client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })
  return _client
}

// SA + international language voice ID mapping
const VOICE_ID_MAP: Record<string, string | undefined> = {
  af: process.env.ELEVENLABS_VOICE_ID_AF,
  zu: process.env.ELEVENLABS_VOICE_ID_ZU,
  xh: process.env.ELEVENLABS_VOICE_ID_XH,
  st: process.env.ELEVENLABS_VOICE_ID_ST,
  en: process.env.ELEVENLABS_VOICE_ID_EN,
}

function selectModel(language: string | null): string {
  // Use multilingual model for all non-English languages
  if (!language || language === 'en') return 'eleven_flash_v2_5'
  return 'eleven_multilingual_v2'
}

function selectVoiceId(language: string | null): string {
  const mapped = language ? VOICE_ID_MAP[language] : undefined
  return mapped ?? process.env.ELEVENLABS_VOICE_ID_EN!
}

export async function streamSpeech(text: string, userId: string): Promise<void> {
  try {
    // 1. Fetch user language from Supabase
    const { data } = await supabase
      .from('user_profile')
      .select('language')
      .eq('user_id', userId)
      .single()

    const language: string | null = data?.language ?? null

    // 2. Resolve model and voice ID
    const modelId = selectModel(language)
    const voiceId = selectVoiceId(language)

    // 3. Get WebSocket connection
    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeech: no connection for ${userId}`)
      return
    }

    // 4. Send audio_start control frame
    ws.send(JSON.stringify({ type: 'audio_start' }))

    // 5. Stream TTS from ElevenLabs
    const stream = await getClient().textToSpeech.stream(voiceId, {
      text,
      modelId,
      outputFormat: 'opus_48000_32',
    })

    // 6. Iterate stream and send binary chunks
    for await (const chunk of stream) {
      try {
        ws.send(chunk)
      } catch {
        // Retry with ArrayBuffer if Uint8Array is rejected
        ws.send(chunk.buffer)
      }
    }

    // 7. Send audio_end control frame
    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    // Audio failure must not crash the process
    console.error(`[TTS] streamSpeech error for ${userId}:`, err)
  }
}

// streamSpeechInLanguage — bypasses Supabase profile lookup.
// Used by translateUtterance to deliver TTS in the translation target language directly.
export async function streamSpeechInLanguage(text: string, userId: string, languageCode: string): Promise<void> {
  try {
    const modelId = selectModel(languageCode)
    const voiceId = selectVoiceId(languageCode)

    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeechInLanguage: no connection for ${userId}`)
      return
    }

    ws.send(JSON.stringify({ type: 'audio_start' }))

    const stream = await getClient().textToSpeech.stream(voiceId, {
      text,
      modelId,
      outputFormat: 'opus_48000_32',
    })

    for await (const chunk of stream) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.send(chunk as any)
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.send((chunk as any).buffer)
      }
    }

    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    console.error(`[TTS] streamSpeechInLanguage error for ${userId}:`, err)
  }
}
