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
import { bearerAuth } from 'hono/bearer-auth'
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
const cronWorker = new CronWorker(
  'cron',
  async (job) => {
    if (job.name === 'morning_briefing') {
      await processMorningBriefing(job as { data: { userId: string } })
    } else if (job.name === 'evening_digest') {
      // Evening digest reuses morning briefing logic (same data, different greeting)
      await processMorningBriefing(job as { data: { userId: string } })
    }
    // reminder type jobs: future phases handle custom reminder content
  },
  {
    connection: (await import('./queue/heartbeat')).redis,
    concurrency: 3,
  }
)

cronWorker.on('completed', (job) => console.log(`[Cron Worker] Job completed: ${job.id}`))
cronWorker.on('failed', (job, err) => console.error(`[Cron Worker] Job failed: ${job?.id}`, err))

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
app.use('*', cors({
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}))

// STEP 3: Bearer token auth on /api/* routes only
// /health and /webhook/* are intentionally not protected
app.use('/api/*', bearerAuth({ token: process.env.API_BEARER_TOKEN! }))

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
