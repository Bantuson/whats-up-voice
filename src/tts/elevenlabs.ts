// src/tts/elevenlabs.ts
// ElevenLabs REST API wrapper — direct fetch, no SDK (avoids v2.x SDK incompatibilities).
// All audio output: mp3_44100_128 for both HTTP delivery and WebSocket streaming.
import { supabase } from '../db/client'
import { getConnection } from '../ws/connections'

const BASE = 'https://api.elevenlabs.io'

// SA + international language voice ID mapping
const VOICE_ID_MAP: Record<string, string | undefined> = {
  af: process.env.ELEVENLABS_VOICE_ID_AF,
  zu: process.env.ELEVENLABS_VOICE_ID_ZU,
  xh: process.env.ELEVENLABS_VOICE_ID_XH,
  st: process.env.ELEVENLABS_VOICE_ID_ST,
  en: process.env.ELEVENLABS_VOICE_ID_EN,
}

function selectModel(language: string | null): string {
  if (!language || language === 'en') return 'eleven_flash_v2_5'
  return 'eleven_multilingual_v2'
}

function selectVoiceId(language: string | null): string {
  const mapped = language ? VOICE_ID_MAP[language] : undefined
  const voiceId = mapped ?? process.env.ELEVENLABS_VOICE_ID_EN
  if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID_EN is not configured — set it in .env')
  return voiceId
}

async function getUserLanguage(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_profile')
    .select('language')
    .eq('user_id', userId)
    .single()
  return data?.language ?? null
}

// fetchTTSBuffer — shared low-level helper for both HTTP and WebSocket paths.
async function fetchTTSBuffer(text: string, voiceId: string, modelId: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, model_id: modelId }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`ElevenLabs TTS ${res.status}: ${err}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// synthesiseSpeech — collects full MP3 buffer for HTTP delivery (/api/tts).
export async function synthesiseSpeech(text: string, userId: string): Promise<Buffer> {
  const language = await getUserLanguage(userId)
  return fetchTTSBuffer(text, selectVoiceId(language), selectModel(language))
}

// synthesiseSpeechForVoice — explicit voice ID, used by podcast two-host stitching.
export async function synthesiseSpeechForVoice(
  text: string,
  voiceId: string,
  language: string | null = 'en',
): Promise<Buffer> {
  return fetchTTSBuffer(text, voiceId, selectModel(language))
}

// streamSpeech — streams MP3 chunks over WebSocket (navigation, translation, confirm_send).
export async function streamSpeech(text: string, userId: string): Promise<void> {
  try {
    const language = await getUserLanguage(userId)
    const voiceId = selectVoiceId(language)
    const modelId = selectModel(language)

    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeech: no WebSocket for ${userId}`)
      return
    }

    const res = await fetch(`${BASE}/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`)
      console.error(`[TTS] streamSpeech error: ${res.status} ${errText}`)
      return
    }

    ws.send(JSON.stringify({ type: 'audio_start' }))
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Send the Uint8Array view directly — value.buffer is the full backing ArrayBuffer
      // which may be larger than this chunk (shared pool), corrupting the audio stream.
      if (value?.length) ws.send(value)
    }
    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    console.error(`[TTS] streamSpeech error for ${userId}:`, err)
  }
}

// streamSpeechInLanguage — bypasses user profile; used by real-time translation.
export async function streamSpeechInLanguage(
  text: string,
  userId: string,
  languageCode: string,
): Promise<void> {
  try {
    const voiceId = selectVoiceId(languageCode)
    const modelId = selectModel(languageCode)

    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeechInLanguage: no connection for ${userId}`)
      return
    }

    const res = await fetch(`${BASE}/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`)
      console.error(`[TTS] streamSpeechInLanguage failed: ${res.status} ${errText}`)
      return
    }

    ws.send(JSON.stringify({ type: 'audio_start' }))
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.length) ws.send(value)
    }
    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    console.error(`[TTS] streamSpeechInLanguage error for ${userId}:`, err)
  }
}
