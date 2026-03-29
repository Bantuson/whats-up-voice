// src/server.ts
// CRITICAL REGISTRATION ORDER — DO NOT REORDER:
//   1. validateEnv() — before any imports that use process.env
//   2. Raw body capture on /webhook/* — BEFORE all app.route() calls
//   3. CORS — all routes
//   4. Bearer auth — /api/* only
//   5. Route registration
//   6. WebSocket upgrade
// Violating step 2 will cause HMAC verification to silently fail in Phase 2.

import { validateEnv } from './env'

// Must throw before any other work if env is incomplete
validateEnv()

import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import { cors } from 'hono/cors'
import { healthRouter } from './routes/health'
import { webhookRouter } from './routes/webhook'
import { apiRouter } from './routes/api'
import { authRouter } from './routes/auth'
import { registerConnection, removeConnection } from './ws/connections'
import './queue/worker'  // boots heartbeat worker at startup
import { syncUserRoutines } from './cron/routines'
import { processMorningBriefing } from './cron/morningBriefing'
import { Worker as CronWorker } from 'bullmq'

const app = new Hono()

// Register BullMQ cron worker — processes morning_briefing and evening_digest jobs
// Wrapped in try/catch so a Redis outage at startup doesn't prevent the HTTP server from booting.
let cronWorker: CronWorker | null = null
try {
  cronWorker = new CronWorker(
    'cron',
    async (job) => {
      if (job.name === 'morning_briefing') {
        await processMorningBriefing(job as { data: { userId: string } })
      } else if (job.name === 'evening_digest') {
        await processMorningBriefing(job as { data: { userId: string } })
      }
    },
    {
      connection: (await import('./queue/heartbeat')).redis,
      concurrency: 3,
    }
  )
  cronWorker.on('completed', (job) => console.log(`[Cron Worker] Job completed: ${job.id}`))
  cronWorker.on('failed', (job, err) => console.error(`[Cron Worker] Job failed: ${job?.id}`, err))
} catch (err) {
  console.error('[Cron Worker] Failed to start — Redis may be unavailable:', err)
}

// Sync all user routines at startup (idempotent — safe to run on every restart)
syncUserRoutines().catch((err) => console.error('[Cron] syncUserRoutines failed at startup:', err))

// STEP 1: RAW BODY CAPTURE — must precede all route registration
// Reads c.req.text() into context so HMAC middleware (Phase 2) can verify
// the signature against the original payload without double-consuming the stream.
app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

// STEP 2: CORS — applies to all routes
// Allow any localhost origin in dev; FRONTEND_ORIGIN pins it in production.
app.use('*', cors({
  origin: (origin) => {
    if (process.env.FRONTEND_ORIGIN) return process.env.FRONTEND_ORIGIN
    if (!origin || origin.startsWith('http://localhost')) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// STEP 3: Bearer token auth on /api/* routes only
// /health and /webhook/* are intentionally not protected.
// SSE routes (/api/sse/*) accept token via ?token= query param because
// EventSource does not support custom headers.
app.use('/api/*', async (c, next) => {
  const expected = process.env.API_BEARER_TOKEN!
  // SSE routes: check ?token= query param
  if (c.req.path.startsWith('/api/sse/')) {
    const q = c.req.query('token')
    if (q === expected) return next()
    return c.json({ error: 'Unauthorized' }, 401)
  }
  // All other /api/* routes: standard Authorization: Bearer header
  const auth = c.req.header('Authorization') ?? ''
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (tok === expected) return next()
  return c.json({ error: 'Unauthorized' }, 401)
})

// STEP 4: Register routes AFTER all middleware
app.route('/health', healthRouter)
app.route('/webhook', webhookRouter)
app.route('/api', apiRouter)
app.route('/api/auth', authRouter)

// STEP 5: WebSocket upgrade — ISO-03: scoped per userId, no cross-user delivery
// Each connection stored in connections Map by userId via registerConnection.
// Use pushInterrupt(userId, text) from ./ws/connections to push audio frames to the correct device.
app.get('/ws/session/:userId', upgradeWebSocket((c) => {
  const userId = c.req.param('userId')
  return {
    onOpen(_event, ws) {
      registerConnection(userId, ws)
      console.log(`[WS] Connected: ${userId}`)
    },
    onClose() {
      removeConnection(userId)
      console.log(`[WS] Disconnected: ${userId}`)
    },
    onMessage(event) {
      // Phase 4 handles inbound audio frames
      console.log(`[WS] Message from ${userId}: ${event.data}`)
    },
  }
}))

// STEP 6: Export both fetch and websocket — Bun requires both for WS support
export default {
  fetch: app.fetch,
  websocket,
  port: 3000,
}

console.log('Server running on port 3000')

// Optional ngrok tunnel — only starts if NGROK_AUTHTOKEN is set in env.
// Logs the public URL and Twilio webhook URL to paste into the sandbox settings.
if (process.env.NGROK_AUTHTOKEN) {
  import('@ngrok/ngrok').then(({ default: ngrok }) =>
    ngrok.forward({ addr: 3000, authtoken_from_env: true })
  ).then((listener) => {
    const publicUrl = listener.url()
    console.log(`[ngrok] Tunnel active: ${publicUrl}`)
    console.log(`[ngrok] Twilio webhook → ${publicUrl}/webhook/whatsapp`)
    console.log(`[ngrok] Paste the webhook URL above into Twilio sandbox "When a message comes in" field`)
  }).catch((err) => console.error('[ngrok] Failed to start tunnel:', err))
}
