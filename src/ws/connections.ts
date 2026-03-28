// src/ws/connections.ts
// Per-user WebSocket connection registry with TTS audio push support.
// ISO-03: keyed by userId — only the correct user receives audio pushes.
// pushInterrupt is the sole public entry point for sending TTS audio from outside this module.
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

export async function pushInterrupt(userId: string, text: string): Promise<void> {
  if (!connections.has(userId)) {
    console.log(`[WS] pushInterrupt: no connection for ${userId}`)
    return
  }
  const { streamSpeech } = await import('../tts/elevenlabs')
  await streamSpeech(text, userId)
}
