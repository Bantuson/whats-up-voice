// tests/hubVerification.test.ts
// GAP 1 — WA-01: GET /webhook/whatsapp hub verification handler test
//
// Tests the pure hub-verification logic in src/routes/webhook.ts using
// Hono's built-in app.request() test client.
//
// MOCK STRATEGY: webhook.ts imports from ../src/queue/heartbeat (which
// connects to Redis on import) and ../src/db/client (Supabase).
// We mock both before importing the router, plus ioredis and bullmq,
// to avoid any live service connections.

import { describe, test, expect, mock } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks — declared before any production imports (Bun hoists mock.module)
// ---------------------------------------------------------------------------

mock.module('ioredis', () => ({
  default: function MockIORedis() {
    return { on: () => {}, set: async () => 'OK', get: async () => null }
  },
}))

mock.module('bullmq', () => {
  class MockQueue {
    add = mock(async () => {})
    on() {}
  }
  class MockWorker {
    on() {}
  }
  return { Queue: MockQueue, Worker: MockWorker }
})

mock.module('../src/queue/heartbeat', () => ({
  redis: { on: () => {}, set: async () => 'OK' },
  heartbeatQueue: { add: mock(async () => {}) },
  enqueueHeartbeat: mock(async () => true),
}))

mock.module('../src/db/client', () => ({
  supabase: {
    from: () => ({
      upsert: () => ({ select: () => ({ single: async () => ({ data: { id: 'user-001' }, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'log-001' }, error: null }) }) }),
    }),
  },
}))

mock.module('../src/lib/phone', () => ({
  normaliseE164: (raw: string) => (raw.startsWith('+') ? raw : `+${raw}`),
  formatPhoneForSpeech: (e164: string) => e164.replace('+27', '0').split('').join(' '),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { Hono } from 'hono'
import { webhookRouter } from '../src/routes/webhook'

// Build a minimal Hono app that mirrors how server.ts mounts the router,
// including the raw-body capture middleware that webhook.ts depends on.
const app = new Hono()

app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

app.route('/webhook', webhookRouter)

// ---------------------------------------------------------------------------
// Tests — WA-01
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'test-verify-token'

describe('WA-01: GET /webhook/whatsapp — hub verification handshake', () => {
  test('returns challenge as plain text with 200 when mode=subscribe and token is correct', async () => {
    const url = `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test-challenge-abc`
    const res  = await app.request(url)

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('test-challenge-abc')
  })

  test('returns 403 when verify_token is wrong', async () => {
    const url = '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test-challenge-abc'
    const res  = await app.request(url)

    expect(res.status).toBe(403)
  })

  test('returns 403 when hub.mode is missing', async () => {
    const url = `/webhook/whatsapp?hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test-challenge-abc`
    const res  = await app.request(url)

    expect(res.status).toBe(403)
  })

  test('returns 403 when hub.mode is not subscribe', async () => {
    const url = `/webhook/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test-challenge-abc`
    const res  = await app.request(url)

    expect(res.status).toBe(403)
  })

  test('returns the exact challenge value provided in the query string', async () => {
    const challenge = 'unique-challenge-12345'
    const url = `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`
    const res  = await app.request(url)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(challenge)
  })
})
