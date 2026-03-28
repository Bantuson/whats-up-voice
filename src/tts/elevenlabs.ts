// src/tts/elevenlabs.ts
// ElevenLabs TTS streaming wrapper.
// Plan 04-01 implements full streaming. This file is a dependency stub created by Plan 04-03.
//
// CONSTRAINTS (per research):
//   - Use ElevenLabsClient (NOT ElevenLabs constructor — throws TypeError at runtime)
//   - Model: eleven_flash_v2_5 for language='en', eleven_multilingual_v2 for language='af'
//   - Output format: opus_48000_32 always (never default MP3)
//   - Voice IDs from ELEVENLABS_VOICE_ID_EN and ELEVENLABS_VOICE_ID_AF env vars
//   - Control frames: { type: 'audio_start' } before first chunk, { type: 'audio_end' } after last
//
// Plan 04-01 will replace this stub with the full implementation.
import type { WSContext } from 'hono/ws'
import { getConnection } from '../ws/connections'

/**
 * Stream spoken text to the user's WebSocket connection via ElevenLabs TTS.
 * Sends audio_start control frame, binary audio chunks, then audio_end control frame.
 * If no connection exists for userId, logs and returns without error.
 */
export async function streamSpeech(text: string, userId: string): Promise<void> {
  const ws: WSContext | undefined = getConnection(userId)
  if (!ws) {
    console.log(`[TTS] streamSpeech: no connection for ${userId}`)
    return
  }

  try {
    const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js')
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })

    // Determine voice + model based on user language preference
    const { data: profile } = await (await import('../db/client')).supabase
      .from('user_profile')
      .select('language')
      .eq('user_id', userId)
      .single()

    const lang = profile?.language ?? 'en'
    const voiceId = lang === 'af'
      ? process.env.ELEVENLABS_VOICE_ID_AF!
      : process.env.ELEVENLABS_VOICE_ID_EN!
    const modelId = lang === 'af' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5'

    ws.send(JSON.stringify({ type: 'audio_start' }))

    const audioStream = await client.textToSpeech.convertAsStream(voiceId, {
      text,
      modelId,
      outputFormat: 'opus_48000_32',
    })

    for await (const chunk of audioStream) {
      ws.send(chunk)
    }

    ws.send(JSON.stringify({ type: 'audio_end' }))
  } catch (err) {
    console.error(`[TTS] streamSpeech failed for ${userId}:`, err)
  }
}
