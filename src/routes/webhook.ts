// src/routes/webhook.ts
// Phase 2 adds: GET (hub verification), POST (HMAC check + message handling)
// Raw body is available as c.get('rawBody') — set by middleware in server.ts
import { Hono } from 'hono'

export const webhookRouter = new Hono()

// GET /webhook/whatsapp — Phase 2 hub verification (scaffold)
webhookRouter.get('/whatsapp', (c) => {
  return c.text('webhook scaffold — Phase 2 implementation pending', 200)
})

// POST /webhook/whatsapp — Phase 2 message handler (scaffold)
webhookRouter.post('/whatsapp', (c) => {
  return c.json({ received: true }, 200)
})
