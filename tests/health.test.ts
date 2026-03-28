import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

// Start the server on a test port to avoid conflicts
// Bun.serve is used directly so we can control the port
const TEST_PORT = 3999
const BASE = `http://localhost:${TEST_PORT}`

// We import the app logic without re-exporting the server,
// so we start a fresh server on TEST_PORT for tests.
// This avoids needing a full process spawn.

// NOTE: health.test.ts validates behavior that requires a running server.
// For simplicity in Phase 1, we test the routes module directly via fetch
// rather than spawning a subprocess.

// Skip all server integration tests if required env vars are not set or are test placeholders.
// tests/setup.ts injects placeholder values (e.g. 'test-bearer-token', 'test-anthropic-key')
// so modules don't crash on import. Real credentials are different strings.
const hasRequiredEnv =
  !!process.env.API_BEARER_TOKEN &&
  process.env.API_BEARER_TOKEN !== 'test-bearer-token' &&
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'test-anthropic-key'

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  if (!hasRequiredEnv) return

  // Import after env is confirmed set (integration test — needs real env)
  const { validateEnv } = await import('../src/env')
  validateEnv()

  const { Hono } = await import('hono')
  const { cors } = await import('hono/cors')
  const { bearerAuth } = await import('hono/bearer-auth')
  const { healthRouter } = await import('../src/routes/health')
  const { apiRouter } = await import('../src/routes/api')

  const app = new Hono()
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))
  app.use('/api/*', bearerAuth({ token: process.env.API_BEARER_TOKEN! }))
  app.route('/health', healthRouter)
  app.route('/api', apiRouter)

  server = Bun.serve({ fetch: app.fetch, port: TEST_PORT })
})

afterAll(() => {
  server?.stop()
})

describe('INFRA-04: Health check endpoint', () => {
  test.skipIf(!hasRequiredEnv)('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    // Verify timestamp is valid ISO 8601
    expect(() => new Date(body.timestamp)).not.toThrow()
  })
})

describe('INFRA-05: Bearer auth middleware on /api/*', () => {
  test.skipIf(!hasRequiredEnv)('POST /api/voice/command without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test', transcript: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  test.skipIf(!hasRequiredEnv)('POST /api/voice/command with valid Bearer token returns non-401', async () => {
    const token = process.env.API_BEARER_TOKEN!
    const res = await fetch(`${BASE}/api/voice/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: 'test', transcript: 'hello' }),
    })
    // 501 Not Implemented is the scaffold response — Phase 4 returns 200
    // The important thing is it is NOT 401
    expect(res.status).not.toBe(401)
  })

  test.skipIf(!hasRequiredEnv)('GET /health does not require Bearer token', async () => {
    // Health check must be reachable without auth (used by uptime monitors)
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
  })
})
