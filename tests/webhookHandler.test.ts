// tests/webhookHandler.test.ts
// Phase 05.1 — WA-04 UPDATED: Twilio form-encoded webhook handler tests
//
// Verifies that the POST /webhook/whatsapp handler correctly validates
// Twilio signatures, parses form-encoded payloads, discards non-message
// events, and calls enqueueHeartbeat for real messages.
//
// MOCK STRATEGY: same as before — ioredis, bullmq, heartbeat, supabase, phone

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Mocks — declared before any production imports (Bun hoists mock.module)
// ---------------------------------------------------------------------------

const mockEnqueueHeartbeat = mock(async () => true)

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
  enqueueHeartbeat: mockEnqueueHeartbeat,
}))

mock.module('../src/db/client', () => ({
  supabase: {
    from: (_table: string) => ({
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'user-001' }, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'log-001' }, error: null }),
        }),
      }),
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

const app = new Hono()

app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

app.route('/webhook', webhookRouter)

// ---------------------------------------------------------------------------
// Helper: compute a valid Twilio signature for the test URL
// The URL must match what c.req.url returns when called via app.request()
// ---------------------------------------------------------------------------
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN ?? 'test-twilio-auth-token'
const WEBHOOK_URL = 'http://localhost/webhook/whatsapp'

function twilioSign(params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort()
  const paramStr = sortedKeys.map(k => `${k}${params[k]}`).join('')
  const data = WEBHOOK_URL + paramStr
  return crypto.createHmac('sha256', AUTH_TOKEN).update(data, 'utf8').digest('base64')
}

function buildFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

async function postWebhook(params: Record<string, string>) {
  const body = buildFormBody(params)
  return app.request(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': twilioSign(params),
    },
    body,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TEXT_MESSAGE_PARAMS = {
  From:       'whatsapp:+27821234567',
  To:         'whatsapp:+14155238886',
  Body:       'Hello there',
  MessageSid: 'SMtest0000000000000000000000000001',
  NumMedia:   '0',
}

describe('POST /webhook/whatsapp — Twilio form-encoded handler', () => {
  beforeEach(() => {
    mockEnqueueHeartbeat.mockClear()
  })

  test('returns 200 { received: true } for a valid text message', async () => {
    const res  = await postWebhook(TEXT_MESSAGE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
  })

  test('calls enqueueHeartbeat for a valid text message', async () => {
    await postWebhook(TEXT_MESSAGE_PARAMS)

    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(1)
    const [jobData] = mockEnqueueHeartbeat.mock.calls[0]
    expect(jobData.messageSid).toBe('SMtest0000000000000000000000000001')
    expect(jobData.phone).toBe('+27821234567')
  })

  test('returns 401 when X-Twilio-Signature is wrong (tampered payload)', async () => {
    const body = buildFormBody(TEXT_MESSAGE_PARAMS)
    const res = await app.request(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': 'invalidsignature==',
      },
      body,
    })

    expect(res.status).toBe(401)
    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(0)
  })

  test('returns 401 when X-Twilio-Signature header is missing', async () => {
    const body = buildFormBody(TEXT_MESSAGE_PARAMS)
    const res = await app.request(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    expect(res.status).toBe(401)
  })

  test('returns 200 { received: true } for empty body (no MessageSid) — early exit', async () => {
    const params = {
      From: 'whatsapp:+27821234567',
      Body: '',
    }
    const res  = await postWebhook(params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(0)
  })

  test('does NOT call enqueueHeartbeat when signature is invalid', async () => {
    const params = { ...TEXT_MESSAGE_PARAMS, MessageSid: 'SMtest_tamper' }
    const body = buildFormBody(params)
    // Intentionally sign different params to trigger 401
    await app.request(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': twilioSign({ different: 'params' }),
      },
      body,
    })

    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(0)
  })
})
