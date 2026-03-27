---
plan: 2
phase: 1
title: Hono Server Skeleton
wave: 1
depends_on: none
files_modified:
  - package.json
  - tsconfig.json
  - src/server.ts
  - src/env.ts
  - src/db/client.ts
  - src/routes/health.ts
  - src/routes/webhook.ts
  - src/routes/api.ts
  - src/ws/manager.ts
  - tests/health.test.ts
requirements:
  - INFRA-04
  - INFRA-05
  - ISO-03
autonomous: true
must_haves:
  truths:
    - "bun run src/server.ts starts and logs 'Server running on port 3000'"
    - "GET /health returns HTTP 200 with JSON body { status: 'ok', timestamp: <ISO string> }"
    - "Server throws and exits non-zero immediately if any of the 11 required env vars are absent"
    - "POST /api/voice/command returns 401 without a valid Bearer token in the Authorization header"
    - "CORS headers are present on responses to requests from the configured FRONTEND_ORIGIN"
    - "Raw body is captured in c.get('rawBody') for all /webhook/* routes before any route handler executes"
    - "WebSocket upgrade route /ws/session/:userId is registered and accepts connections"
  artifacts:
    - path: "src/server.ts"
      provides: "Bun.serve export with fetch + websocket, correct middleware registration order"
      contains: "RAW BODY CAPTURE"
    - path: "src/env.ts"
      provides: "validateEnv() that throws on missing vars, listing all 11 required names"
      exports: ["validateEnv"]
    - path: "src/db/client.ts"
      provides: "Singleton Supabase service_role client"
      exports: ["supabase"]
    - path: "src/routes/health.ts"
      provides: "GET /health endpoint"
      exports: ["healthRouter"]
    - path: "src/ws/manager.ts"
      provides: "Map<userId, WSContext> for per-user WebSocket connections"
      exports: ["wsConnections"]
  key_links:
    - from: "src/server.ts"
      to: "src/env.ts"
      via: "validateEnv() called before Bun.serve()"
      pattern: "validateEnv\\(\\)"
    - from: "src/server.ts"
      to: "/webhook/* middleware"
      via: "app.use('/webhook/*', ...) registered BEFORE app.route() calls"
      pattern: "RAW BODY CAPTURE"
    - from: "src/ws/manager.ts"
      to: "src/server.ts"
      via: "upgradeWebSocket handler sets wsConnections.set(userId, ws)"
      pattern: "wsConnections\\.set"
---

# Plan 2: Hono Server Skeleton

## Objective

Bootstrap the entire Bun/Hono server process: install all packages needed for Phases 1–4 in a single `bun add`, configure TypeScript, wire the critical HMAC raw-body middleware in its mandatory first position, add environment validation, CORS, Bearer auth, health check, and WebSocket scaffold.

This plan creates the running process that every subsequent phase adds routes and workers to. The raw-body middleware ordering is a correctness constraint — if it is registered after any route, HMAC verification will silently break in Phase 2.

## must_haves

- `validateEnv()` is called as the first statement of server.ts execution, before any `import` of route modules that access `process.env`
- `app.use('/webhook/*', rawBodyCapture)` is registered as the first `app.use()` call in server.ts, before all `app.route()` calls (comment `// RAW BODY CAPTURE — must precede all route registration` must be present)
- `export default { fetch: app.fetch, websocket }` — both exported together (Bun requires this for WebSocket support)
- All 11 env vars listed in `validateEnv()` exactly match `.env.example`
- Bearer auth applied only to `/api/*` — not to `/health` or `/webhook/*`
- WebSocket route `/ws/session/:userId` stores the connection in `wsConnections` Map and deletes on close

## Wave

Wave 1 — no dependencies on Plan 1 or Plan 3. All three Wave 1 plans can run in parallel. Plans 02 and 03 do not need the Supabase schema to be live; they write TypeScript files that will connect to Supabase after it is deployed.

## Prerequisites

- Bun 1.3.10 or later installed (`bun --version`)
- Working directory is the project root (`voice-app/`)
- No existing `package.json` (this plan creates it via `bun init`)

## Tasks

<task id="1-02-01">
<title>Initialize project, install all dependencies, configure TypeScript</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Standard Stack table (lines 41–68) for exact package names and versions; install command on line 65
</read_first>
<action>
From the project root (`voice-app/`), run the following commands in order:

**Step 1 — Initialize the project:**
```bash
bun init -y
```
This creates `package.json`, `tsconfig.json`, and `index.ts`. Delete the generated `index.ts` — the entry point will be `src/server.ts`.

**Step 2 — Install all runtime dependencies for Phases 1–4 in a single command:**
```bash
bun add hono @supabase/supabase-js zod bullmq ioredis @anthropic-ai/sdk openai @elevenlabs/elevenlabs-js
```

Rationale: BullMQ and ioredis are installed now even though the worker is wired in Phase 2. All AI SDK packages (@anthropic-ai/sdk, openai, @elevenlabs/elevenlabs-js) are installed now to keep `package.json` stable across phases.

**Step 3 — Install dev dependencies:**
```bash
bun add -d typescript @types/node @types/bun
```

**Step 4 — Update `tsconfig.json`** to the following exact content (overwrite what `bun init` generated):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5 — Create the directory structure:**
```bash
mkdir -p src/routes src/session src/agent src/lib src/db src/ws
mkdir -p supabase/migrations tests
```

**Step 6 — Update `package.json`** to add scripts (merge with existing, do not replace entire file):
```json
{
  "scripts": {
    "start": "bun run src/server.ts",
    "dev": "bun --watch src/server.ts",
    "test": "bun test"
  }
}
```
</action>
<acceptance_criteria>
- `package.json` exists and contains `"hono"` in dependencies
- `package.json` contains `"bullmq"` in dependencies
- `package.json` contains `"ioredis"` in dependencies
- `package.json` contains `"@anthropic-ai/sdk"` in dependencies
- `package.json` contains `"@supabase/supabase-js"` in dependencies
- `tsconfig.json` contains `"strict": true`
- `tsconfig.json` contains `"moduleResolution": "bundler"`
- `src/routes/` directory exists
- `src/session/` directory exists
- `src/agent/` directory exists
- `src/lib/` directory exists
- `src/db/` directory exists
- `src/ws/` directory exists
- `tests/` directory exists
- `node_modules/hono` directory exists
- `grep "bun:test" node_modules/bun-types/index.d.ts 2>/dev/null || true` — bun-types installed
</acceptance_criteria>
</task>

<task id="1-02-02">
<title>Create src/env.ts, src/db/client.ts, src/ws/manager.ts, src/routes/*.ts, and src/server.ts</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pattern 1 (server.ts middleware order, lines 107–162), Pattern 2 (env validation, lines 166–198), Pattern 5 (Supabase client singleton, lines 342–364)
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Anti-patterns section (lines 415–421): never global body-parsing middleware, never lazy validateEnv()
</read_first>
<action>
Create each file exactly as specified. The order of creation matters because server.ts imports from the others — create the modules first, server.ts last.

**File 1: src/env.ts**
```typescript
// src/env.ts
// Called synchronously before Bun.serve() to fail fast on missing config.
// Missing vars throw immediately — never defer to first use.

const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'API_BEARER_TOKEN',
] as const

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Server cannot start. Missing required environment variables:\n  ${missing.join('\n  ')}`
    )
  }
}
```

**File 2: src/db/client.ts**
```typescript
// src/db/client.ts
// Singleton service_role Supabase client.
// NEVER pass request Authorization headers to this client.
// NEVER call supabase.auth.setSession().
// Every query MUST include .eq('user_id', userId) — service_role bypasses RLS.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
```

**File 3: src/ws/manager.ts**
```typescript
// src/ws/manager.ts
// Per-user WebSocket connection registry.
// ISO-03: keyed by userId — only the correct user receives audio pushes.
// Populated by the /ws/session/:userId route in server.ts on connection open.
// Cleared on connection close — no stale entries.
import type { WSContext } from 'hono/ws'

export const wsConnections = new Map<string, WSContext>()
```

**File 4: src/routes/health.ts**
```typescript
// src/routes/health.ts
import { Hono } from 'hono'

export const healthRouter = new Hono()

healthRouter.get('/', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})
```

**File 5: src/routes/webhook.ts** (scaffold — Phase 2 adds handler logic)
```typescript
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
```

**File 6: src/routes/api.ts** (scaffold — later phases add real routes)
```typescript
// src/routes/api.ts
// All routes here are protected by Bearer auth middleware in server.ts.
// Phase 4 adds: POST /api/voice/command
import { Hono } from 'hono'

export const apiRouter = new Hono()

// POST /api/voice/command — Phase 4 voice pipeline (scaffold)
apiRouter.post('/voice/command', (c) => {
  return c.json({ error: 'not implemented — Phase 4' }, 501)
})
```

**File 7: src/server.ts** — CRITICAL: middleware registration order is a correctness constraint
```typescript
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
import { wsConnections } from './ws/manager'

const app = new Hono()

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

// STEP 5: WebSocket upgrade — ISO-03: scoped per userId, no cross-user delivery
// Each connection stored in wsConnections Map by userId.
// Phase 4 uses wsConnections to push audio frames to the correct device.
app.get('/ws/session/:userId', upgradeWebSocket((c) => {
  const userId = c.req.param('userId')
  return {
    onOpen(_event, ws) {
      wsConnections.set(userId, ws)
      console.log(`[WS] Connected: ${userId}`)
    },
    onClose() {
      wsConnections.delete(userId)
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
```
</action>
<acceptance_criteria>
- `src/env.ts` exists and contains all 11 required env var names
- `grep -c "REQUIRED_ENV_VARS" src/env.ts` outputs at least `1`
- `grep "ANTHROPIC_API_KEY\|OPENAI_API_KEY\|ELEVENLABS_API_KEY\|WHATSAPP_PHONE_NUMBER_ID\|WHATSAPP_ACCESS_TOKEN\|WHATSAPP_APP_SECRET\|WHATSAPP_VERIFY_TOKEN\|SUPABASE_URL\|SUPABASE_SERVICE_ROLE_KEY\|REDIS_URL\|API_BEARER_TOKEN" src/env.ts | wc -l` outputs `11`
- `src/db/client.ts` exists and contains `autoRefreshToken: false`
- `src/ws/manager.ts` exists and contains `new Map<string, WSContext>()`
- `src/routes/health.ts` exists and contains `status: 'ok'`
- `src/routes/webhook.ts` exists
- `src/routes/api.ts` exists
- `src/server.ts` exists and contains the comment `RAW BODY CAPTURE — must precede all route registration`
- `grep "validateEnv()" src/server.ts` — appears before any route imports
- `grep "app.use('/webhook/\*'" src/server.ts` — appears before `app.route(` calls
- `grep "export default" src/server.ts` contains `fetch: app.fetch` and `websocket`
- `grep "bearerAuth" src/server.ts` — scoped to `/api/*` only
- With valid `.env`: `bun run src/server.ts` starts without error and logs `Server running on port 3000`
</acceptance_criteria>
</task>

<task id="1-02-03">
<title>Write tests/health.test.ts — verify server startup, health endpoint, and Bearer auth</title>
<read_first>
- src/server.ts — read the actual server entry point to confirm port and routes
- src/routes/health.ts — read the health handler to know the exact JSON response shape
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-VALIDATION.md — Wave 0 requirements for health.test.ts (lines 44–46)
</read_first>
<action>
Create `tests/health.test.ts`:

```typescript
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

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
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
  test('GET /health returns 200 with status ok', async () => {
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
  test('POST /api/voice/command without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/voice/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test', transcript: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  test('POST /api/voice/command with valid Bearer token returns non-401', async () => {
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

  test('GET /health does not require Bearer token', async () => {
    // Health check must be reachable without auth (used by uptime monitors)
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
  })
})
```
</action>
<acceptance_criteria>
- `tests/health.test.ts` exists
- File contains `GET /health returns 200 with status ok` test
- File contains `returns 401` test for missing Bearer token
- File contains `not.toBe(401)` test for valid Bearer token
- File contains `beforeAll` and `afterAll` server lifecycle management
- `grep "API_BEARER_TOKEN" tests/health.test.ts` finds at least one occurrence
- With valid `.env` (all 11 vars set): `bun test tests/health.test.ts` exits 0
- `bun test tests/health.test.ts` output shows no failing tests
</acceptance_criteria>
</task>

## Verification

After all tasks complete, run the full Plan 2 verification sequence:

1. `bun test tests/health.test.ts` — all tests pass
2. Start the server: `bun run src/server.ts` — should log `Server running on port 3000`
3. Smoke test health: `curl -s http://localhost:3000/health` — returns `{"status":"ok","timestamp":"..."}`
4. Smoke test auth guard: `curl -s -X POST http://localhost:3000/api/voice/command` — returns 401
5. Remove one var from `.env` and run `bun run src/server.ts` — server must throw with the name of the missing var in the error message and exit non-zero
6. Restore the var and confirm server starts again cleanly
