// src/tts/elevenlabs.ts
// ElevenLabs TTS streaming wrapper — Phase 4.
// Streams Opus audio chunks to the user's active WebSocket connection.
// Uses lazy singleton so test mocks can intercept before first client creation.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { supabase } from '../db/client'
import { getConnection } from '../ws/connections'

let _client: ElevenLabsClient | null = null
function getClient(): ElevenLabsClient {
  if (!_client) _client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })
  return _client
}

function selectModel(language: string | null): string {
  return language === 'af' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5'
}

function selectVoiceId(language: string | null): string {
  return language === 'af'
    ? process.env.ELEVENLABS_VOICE_ID_AF!
    : process.env.ELEVENLABS_VOICE_ID_EN!
}

/**
 * Stream TTS audio for the given text to the user's WebSocket connection.
 * Sends { type: 'audio_start' } before first chunk and { type: 'audio_end' } after last.
 * Errors are logged — does not rethrow (audio failure must not crash the process).
 */
export async function streamSpeech(text: string, userId: string): Promise<void> {
  try {
    // Fetch user language for model/voice selection
    const { data: profile } = await supabase
      .from('user_profile')
      .select('language')
      .eq('user_id', userId)
      .single()
    const lang: string | null = profile?.language ?? null

    const modelId = selectModel(lang)
    const voiceId = selectVoiceId(lang)

    const ws = getConnection(userId)
    if (!ws) {
      console.log(`[TTS] streamSpeech: no connection for ${userId}`)
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
        ws.send(chunk)
      } catch {
        // Some WS implementations require ArrayBuffer — retry
        ws.send((chunk as Uint8Array).buffer)
      }
    }

    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    console.error(`[TTS] streamSpeech failed for ${userId}:`, err)
  }
}
