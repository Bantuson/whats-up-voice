// src/ws/connections.ts
// Per-user WebSocket connection registry — Phase 4.
// Replaces the raw wsConnections Map from ws/manager.ts.
// ISO-03: keyed by userId — only the correct user receives audio pushes.
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
 * Push spoken text to the user via TTS + WebSocket audio stream.
 * Uses dynamic import to break the mutual dependency cycle with tts/elevenlabs.ts.
 * If no WebSocket is connected, logs only — does not throw.
 */
export async function pushInterrupt(userId: string, text: string): Promise<void> {
  const { streamSpeech } = await import('../tts/elevenlabs')
  await streamSpeech(text, userId)
}
