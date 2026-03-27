// src/routes/api.ts
// All routes here are protected by Bearer auth middleware in server.ts.
// Phase 4 adds: POST /api/voice/command
import { Hono } from 'hono'

export const apiRouter = new Hono()

// POST /api/voice/command — Phase 4 voice pipeline (scaffold)
apiRouter.post('/voice/command', (c) => {
  return c.json({ error: 'not implemented — Phase 4' }, 501)
})
