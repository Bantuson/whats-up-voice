// tests/webhookHandler.test.ts
// GAP 2 — WA-04 PARTIAL (enhance): Status callback discard at handler level
//
// Tests the actual HTTP POST handler behaviour for the status-callback discard path.
// Verifies that a statuses payload returns 200 { received: true } and does NOT
// call enqueueHeartbeat.
//
// MOCK STRATEGY: mock ioredis, bullmq, heartbeat, supabase, and phone lib
// before importing the router so no live services are required.

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

// Build the test app exactly as server.ts does:
// raw-body middleware first, then the router mounted at /webhook
const app = new Hono()

app.use('/webhook/*', async (c, next) => {
  const rawBody = await c.req.text()
  c.set('rawBody', rawBody)
  await next()
})

app.route('/webhook', webhookRouter)

// ---------------------------------------------------------------------------
// Helper: sign a payload body with WHATSAPP_APP_SECRET
// ---------------------------------------------------------------------------
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? 'test-app-secret'

function signPayload(body: string): string {
  const hex = crypto.createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')
  return `sha256=${hex}`
}

async function postWebhook(payload: unknown) {
  const body = JSON.stringify(payload)
  return app.request('/webhook/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': signPayload(body),
    },
    body,
  })
}

// ---------------------------------------------------------------------------
// Tests — WA-04
// ---------------------------------------------------------------------------

describe('WA-04: POST /webhook/whatsapp — status callback discard', () => {
  beforeEach(() => {
    mockEnqueueHeartbeat.mockClear()
  })

  test('returns 200 with { received: true } for a statuses payload', async () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.001', status: 'delivered', timestamp: '1700000000' }],
          },
        }],
      }],
    }

    const res  = await postWebhook(payload)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
  })

  test('does NOT call enqueueHeartbeat for a statuses payload', async () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.002', status: 'read', timestamp: '1700000001' }],
          },
        }],
      }],
    }

    await postWebhook(payload)

    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(0)
  })

  test('returns 401 when HMAC signature is wrong (tampered payload)', async () => {
    const body   = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] })
    const tamper = body + ' '  // tampered — sig is for `body` but we send `tamper`

    const res = await app.request('/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signPayload(body),  // sig for original body
      },
      body: tamper,  // different payload
    })

    expect(res.status).toBe(401)
  })

  test('returns 200 with { received: true } for an empty messages array (no-op event)', async () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [],  // empty — no real message
          },
        }],
      }],
    }

    const res  = await postWebhook(payload)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(mockEnqueueHeartbeat).toHaveBeenCalledTimes(0)
  })
})
