// src/ws/manager.ts
// Per-user WebSocket connection registry.
// ISO-03: keyed by userId — only the correct user receives audio pushes.
// Populated by the /ws/session/:userId route in server.ts on connection open.
// Cleared on connection close — no stale entries.
import type { WSContext } from 'hono/ws'

export const wsConnections = new Map<string, WSContext>()
