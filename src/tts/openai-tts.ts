// src/tts/openai-tts.ts
// OpenAI TTS — uses existing OPENAI_API_KEY, no paid ElevenLabs plan needed.
// Models: tts-1 (fast, good quality) | tts-1-hd (slower, higher quality)
// Voices: alloy · ash · coral · echo · fable · nova · onyx · sage · shimmer
// Default agent voice: nova (friendly female, clear diction)
// Podcast voices: onyx (THABO, male host) + nova (NALEDI, female expert)
import { getConnection } from '../ws/connections'

const BASE = 'https://api.openai.com/v1/audio/speech'

// Voice selection — env overrides or sensible defaults
const AGENT_VOICE  = (process.env.OPENAI_TTS_VOICE_AGENT  ?? 'nova')   as string
const THABO_VOICE  = (process.env.OPENAI_TTS_VOICE_THABO  ?? 'onyx')   as string
const NALEDI_VOICE = (process.env.OPENAI_TTS_VOICE_NALEDI ?? 'nova')   as string

async function fetchTTSBuffer(text: string, voice: string): Promise<Buffer> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', input: text, voice, response_format: 'mp3' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`OpenAI TTS ${res.status}: ${err}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// synthesiseSpeech — HTTP delivery path (/api/tts)
export async function synthesiseSpeech(_text: string, _userId: string): Promise<Buffer>
export async function synthesiseSpeech(text: string): Promise<Buffer>
export async function synthesiseSpeech(text: string, _userId?: string): Promise<Buffer> {
  return fetchTTSBuffer(text, AGENT_VOICE)
}

// synthesiseSpeechForVoice — podcast two-host stitching
// voiceId param is the speaker label ('THABO' | 'NALEDI') or an OpenAI voice name
export async function synthesiseSpeechForVoice(
  text: string,
  voiceId: string,
  _language?: string | null,
): Promise<Buffer> {
  const voice =
    voiceId === 'THABO'  ? THABO_VOICE  :
    voiceId === 'NALEDI' ? NALEDI_VOICE :
    voiceId  // fall through: accept raw OpenAI voice names too
  return fetchTTSBuffer(text, voice)
}

// streamSpeech — streams MP3 chunks over WebSocket (navigation, translation, confirm_send)
export async function streamSpeech(text: string, userId: string): Promise<void> {
  try {
    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeech: no WebSocket for ${userId}`)
      return
    }

    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: AGENT_VOICE, response_format: 'mp3' }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok || !res.body) {
      const err = await res.text().catch(() => `HTTP ${res.status}`)
      console.error(`[TTS] streamSpeech error: ${res.status} ${err}`)
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
    console.error(`[TTS] streamSpeech error for ${userId}:`, err)
  }
}

// streamSpeechInLanguage — real-time translation path (bypasses user profile)
// OpenAI TTS handles multilingual text natively in any voice.
export async function streamSpeechInLanguage(
  text: string,
  userId: string,
  _languageCode: string,
): Promise<void> {
  // Language is handled automatically by OpenAI — same implementation as streamSpeech
  return streamSpeech(text, userId)
}
