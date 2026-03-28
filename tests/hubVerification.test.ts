// tests/hubVerification.test.ts
// Phase 05.1: GET /webhook/whatsapp was the Meta hub-verification endpoint.
// It has been removed — Twilio does NOT use a GET verification step.
// This test confirms the route no longer exists and returns 404.

import { describe, test, expect, mock } from 'bun:test'

mock.module('ioredis', () => ({
  default: function MockIORedis() {
    return { on: () => {}, set: async () => 'OK', get: async () => null }
  },
}))

mock.module('bullmq', () => {
  class MockQueue { add = mock(async () => {}); on() {} }
  class MockWorker { on() {} }
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

import { Hono } from 'hono'
import { webhookRouter } from '../src/routes/webhook'

const app = new Hono()
app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})
app.route('/webhook', webhookRouter)

describe('GET /webhook/whatsapp — removed (Twilio uses POST only)', () => {
  test('returns 404 — GET handler no longer exists after Twilio migration', async () => {
    const res = await app.request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=test&hub.challenge=abc')
    expect(res.status).toBe(404)
  })
})
