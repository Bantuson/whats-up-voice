// src/ws/connections.ts
// Per-user WebSocket connection registry with TTS audio push.
// ISO-03: keyed by userId — only the correct user receives audio pushes.
//
// pushInterrupt is the sole public entry point for sending TTS audio.
// No caller should ever call ws.send() directly.
//
// NOTE: This is a Phase 4 (Plan 04-01) stub. streamSpeech is imported lazily
// so tests can override the elevenlabs module before first import.
import type { WSContext } from 'hono/ws'

const connections = new Map<string, WSContext>()

export function registerConnection(userId: string, ws: WSContext): void {
  connections.set(userId, ws)
}

export function getConnection(userId: string): WSContext | undefined {
  return connections.get(userId)
}

export function removeConnection(userId: string): void {
  connections.delete(userId)
}

/**
 * Push spoken text to the user's active WebSocket connection via TTS.
 * If no WebSocket is connected (user offline), logs only — does not throw.
 */
export async function pushInterrupt(userId: string, text: string): Promise<void> {
  const ws = connections.get(userId)
  if (!ws) {
    console.log(`[WS] pushInterrupt: no connection for ${userId}`)
    return
  }
  // Lazy import so tests can mock '../tts/elevenlabs' before first call
  const { streamSpeech } = await import('../tts/elevenlabs')
  await streamSpeech(text, userId)
}
