---
plan: 1
phase: 1
title: Supabase Schema + RLS
wave: 1
depends_on: none
files_modified:
  - supabase/migrations/001_schema.sql
  - supabase/migrations/002_functions.sql
requirements:
  - INFRA-01
  - INFRA-02
  - INFRA-03
autonomous: true
must_haves:
  truths:
    - "All 8 tables exist in the Supabase project: users, user_profile, user_contacts, sessions, message_log, memory_store, routines, heartbeat_log"
    - "RLS is enabled on every table and a service_role bypass policy exists on every table"
    - "pgvector extension is enabled in the Supabase project"
    - "match_memories SQL function is deployed and callable via supabase.rpc()"
    - "resolve_contact_name SQL function is deployed and callable via supabase.rpc()"
    - "HNSW index exists on memory_store.embedding with vector_cosine_ops"
    - "A query using a fabricated user_id (not in the users table) against any table via the service_role client returns zero rows when the app-layer .eq('user_id', userId) filter is applied"
  artifacts:
    - path: "supabase/migrations/001_schema.sql"
      provides: "All 8 table DDL statements with RLS enabled and two policies per table"
      contains: "CREATE TABLE IF NOT EXISTS users"
    - path: "supabase/migrations/002_functions.sql"
      provides: "HNSW index, match_memories function, resolve_contact_name function"
      contains: "CREATE OR REPLACE FUNCTION match_memories"
  key_links:
    - from: "supabase/migrations/001_schema.sql"
      to: "Supabase project SQL editor"
      via: "Manual paste-and-run or supabase CLI"
      pattern: "ALTER TABLE .* ENABLE ROW LEVEL SECURITY"
    - from: "supabase/migrations/002_functions.sql"
      to: "memory_store.embedding column"
      via: "HNSW index creation using vector_cosine_ops"
      pattern: "USING hnsw \\(embedding vector_cosine_ops\\)"
---

# Plan 1: Supabase Schema + RLS

## Objective

Create and deploy the complete database foundation: all 8 tables with Row Level Security and a service_role bypass policy on each, the pgvector HNSW index on `memory_store.embedding`, and two SQL helper functions (`match_memories`, `resolve_contact_name`) that later phases call via `supabase.rpc()`.

This plan must complete before any code writes to the database. The schema is the single source of truth for every table shape used in Phases 2–5.

## must_haves

- All 8 tables exist with correct column definitions and NOT NULL constraints as specified in 001_schema.sql
- `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` is present for every table
- Every table has exactly two RLS policies: one `auth.uid()` user policy and one `service_role` bypass
- pgvector extension is enabled (`CREATE EXTENSION IF NOT EXISTS vector`)
- HNSW index created: `CREATE INDEX IF NOT EXISTS memory_store_embedding_hnsw_idx ON memory_store USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`
- `match_memories` function returns `(id UUID, content TEXT, similarity FLOAT)` and accepts `(query_embedding VECTOR(1536), match_threshold FLOAT, match_count INT, p_user_id UUID)`
- `resolve_contact_name` function accepts `(p_user_id UUID, p_phone TEXT)` and returns `TEXT`

## Wave

Wave 1 — no dependencies. Can deploy immediately. Plans 02 and 03 run in parallel with this plan (they do not depend on Supabase being live to write TypeScript modules, though integration tests need it).

## Prerequisites

- Supabase project must exist with a known `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- These two values must be in `.env` before the integration test in Task 2 can run
- Recommended region: `af-south-1` (Cape Town, lowest latency for SA users)

## Tasks

<task id="1-01-01">
<title>Write 001_schema.sql — all 8 tables with RLS</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — contains the complete verified SQL DDL for all 8 tables (lines 440–671); use this verbatim, do not improvise column types
</read_first>
<action>
Create the file `supabase/migrations/001_schema.sql` (create the `supabase/migrations/` directory if it does not exist).

The file must contain the following SQL in this exact order:

1. Enable pgvector extension:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

2. Table: `users`
```sql
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users: user can access own row"
  ON users FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY "users: service_role bypass"
  ON users FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

3. Table: `user_profile`
```sql
CREATE TABLE IF NOT EXISTS user_profile (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language          TEXT NOT NULL DEFAULT 'en',
  location          TEXT,
  quiet_hours_start TIME,
  quiet_hours_end   TIME,
  briefing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profile: user can access own row"
  ON user_profile FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_profile: service_role bypass"
  ON user_profile FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

4. Table: `user_contacts`
```sql
CREATE TABLE IF NOT EXISTS user_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_priority BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone)
);
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_contacts: user can access own rows"
  ON user_contacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_contacts: service_role bypass"
  ON user_contacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

5. Table: `sessions`
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL DEFAULT 'idle',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  UNIQUE (user_id)
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions: user can access own row"
  ON sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessions: service_role bypass"
  ON sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

6. Table: `message_log`
```sql
CREATE TABLE IF NOT EXISTS message_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  from_phone    TEXT NOT NULL,
  to_phone      TEXT NOT NULL,
  body          TEXT,
  media_type    TEXT,
  media_id      TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_log: user can access own rows"
  ON message_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "message_log: service_role bypass"
  ON message_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS message_log_user_created_idx
  ON message_log (user_id, created_at DESC);
```

7. Table: `memory_store`
```sql
CREATE TABLE IF NOT EXISTS memory_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE memory_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memory_store: user can access own rows"
  ON memory_store FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "memory_store: service_role bypass"
  ON memory_store FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

8. Table: `routines`
```sql
CREATE TABLE IF NOT EXISTS routines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_type    TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  label           TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "routines: user can access own rows"
  ON routines FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "routines: service_role bypass"
  ON routines FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

9. Table: `heartbeat_log`
```sql
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES message_log(id),
  decision    TEXT NOT NULL CHECK (decision IN ('interrupt', 'batch', 'silent', 'skip')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE heartbeat_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heartbeat_log: user can access own rows"
  ON heartbeat_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "heartbeat_log: service_role bypass"
  ON heartbeat_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS heartbeat_log_user_created_idx
  ON heartbeat_log (user_id, created_at DESC);
```

After writing the file, apply it to the Supabase project. Two options:
- Option A (recommended for hackathon speed): Open the Supabase project dashboard → SQL Editor → paste the full file contents → Run.
- Option B: Run `supabase db push` if the Supabase CLI is installed and the project is linked.

Do NOT split the SQL across multiple editor windows — run the entire 001_schema.sql as a single execution so foreign key references resolve in order.
</action>
<acceptance_criteria>
- `supabase/migrations/001_schema.sql` file exists
- File contains `CREATE EXTENSION IF NOT EXISTS vector` on line 1
- File contains exactly 8 occurrences of `ALTER TABLE` and `ENABLE ROW LEVEL SECURITY` (one per table)
- File contains exactly 16 `CREATE POLICY` statements (2 per table × 8 tables)
- Every policy for service_role ends with `USING (true) WITH CHECK (true)`
- File contains `CREATE INDEX IF NOT EXISTS message_log_user_created_idx`
- File contains `CREATE INDEX IF NOT EXISTS heartbeat_log_user_created_idx`
- grep check: `grep -c "ENABLE ROW LEVEL SECURITY" supabase/migrations/001_schema.sql` outputs `8`
- grep check: `grep -c "service_role bypass" supabase/migrations/001_schema.sql` outputs `8`
- grep check: `grep -c "CREATE TABLE IF NOT EXISTS" supabase/migrations/001_schema.sql` outputs `8`
</acceptance_criteria>
</task>

<task id="1-01-02">
<title>Write 002_functions.sql — HNSW index + match_memories + resolve_contact_name</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — contains the exact SQL for the HNSW index and both function signatures (lines 673–735); use verbatim
- supabase/migrations/001_schema.sql — confirm memory_store and user_contacts tables exist before writing the index/functions that reference them
</read_first>
<action>
Create `supabase/migrations/002_functions.sql` with the following exact SQL:

```sql
-- HNSW index on memory_store.embedding
-- Must be created AFTER the table exists (001_schema.sql must run first).
CREATE INDEX IF NOT EXISTS memory_store_embedding_hnsw_idx
  ON memory_store
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- FUNCTION: match_memories
-- Cosine similarity search over a user's memory_store rows.
-- Called via supabase.rpc('match_memories', {...}) — PostgREST cannot use <=> directly.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memory_store
  WHERE user_id = p_user_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- FUNCTION: resolve_contact_name
-- Returns the user-assigned contact name for a phone number, or NULL if not saved.
CREATE OR REPLACE FUNCTION resolve_contact_name(
  p_user_id UUID,
  p_phone   TEXT
)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT name
  FROM user_contacts
  WHERE user_id = p_user_id
    AND phone = p_phone
  LIMIT 1;
$$;
```

Apply to Supabase AFTER 001_schema.sql has been applied successfully. Same method — paste into SQL Editor and Run, or `supabase db push`.

CRITICAL: 002_functions.sql depends on the `memory_store` and `user_contacts` tables existing. If 001_schema.sql has not been applied yet, 002_functions.sql will fail with a "relation does not exist" error. Apply in order.
</action>
<acceptance_criteria>
- `supabase/migrations/002_functions.sql` file exists
- File contains `USING hnsw (embedding vector_cosine_ops)` exactly once
- File contains `WITH (m = 16, ef_construction = 64)` exactly once
- File contains `CREATE OR REPLACE FUNCTION match_memories` exactly once
- File contains `RETURNS TABLE` block with `id UUID`, `content TEXT`, `similarity FLOAT`
- `match_memories` function signature includes `p_user_id UUID` parameter (user isolation)
- File contains `CREATE OR REPLACE FUNCTION resolve_contact_name` exactly once
- `resolve_contact_name` includes `WHERE user_id = p_user_id` (user isolation)
- grep check: `grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/002_functions.sql` outputs `2`
- grep check: `grep "p_user_id" supabase/migrations/002_functions.sql | wc -l` outputs at least `2` (parameter appears in both functions)
</acceptance_criteria>
</task>

<task id="1-01-03">
<title>Write tests/schema.test.ts — live integration tests for tables and RPC functions</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-VALIDATION.md — Wave 0 requirements for schema.test.ts and isolation.test.ts (lines 41–63)
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pattern 5 (Supabase singleton client, lines 342–364) and Pitfall 3 (RLS bypass, lines 753–757)
</read_first>
<action>
Create `tests/schema.test.ts`. This is a live integration test — it connects to the real Supabase project. It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set in the environment.

Also create `tests/isolation.test.ts` for the app-layer isolation check.

**tests/schema.test.ts:**
```typescript
import { describe, test, expect } from 'bun:test'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const REQUIRED_TABLES = [
  'users',
  'user_profile',
  'user_contacts',
  'sessions',
  'message_log',
  'memory_store',
  'routines',
  'heartbeat_log',
]

describe('INFRA-01: All 8 tables exist', () => {
  for (const tableName of REQUIRED_TABLES) {
    test(`table "${tableName}" exists and is queryable`, async () => {
      // select count — service_role can read all rows (bypass policy)
      const { error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
      expect(error).toBeNull()
    })
  }
})

describe('INFRA-03: SQL functions are deployed', () => {
  test('match_memories RPC executes without error', async () => {
    // Call with a zero-vector and threshold 0.99 — expects empty result, not an error
    const fakeEmbedding = new Array(1536).fill(0)
    const fakeUserId = '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: fakeEmbedding,
      match_threshold: 0.99,
      match_count: 5,
      p_user_id: fakeUserId,
    })
    // No error — empty array is correct (no memories for fake user)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('resolve_contact_name RPC executes without error', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase.rpc('resolve_contact_name', {
      p_user_id: fakeUserId,
      p_phone: '+27000000000',
    })
    // Returns NULL for unknown user/phone — that is correct
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})
```

**tests/isolation.test.ts:**
```typescript
import { describe, test, expect } from 'bun:test'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const FABRICATED_USER_ID = '00000000-0000-0000-0000-000000000001'

// ISO-01: Even though service_role bypasses RLS, app-layer .eq('user_id', ...) must
// be applied to every query. These tests confirm that a fabricated user_id returns
// zero rows from tables that have user_id columns.
describe('ISO-01: App-layer user_id isolation', () => {
  const userScopedTables = [
    'user_profile',
    'user_contacts',
    'sessions',
    'message_log',
    'memory_store',
    'routines',
    'heartbeat_log',
  ]

  for (const tableName of userScopedTables) {
    test(`${tableName} returns zero rows for fabricated user_id`, async () => {
      const { data, error } = await supabase
        .from(tableName)
        .select('id')
        .eq('user_id', FABRICATED_USER_ID)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }
})
```

Also create a `.env.example` file at the project root listing all 11 required env vars (no values):
```
# Required — server will not start without these
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=
API_BEARER_TOKEN=

# Optional — defaults used if absent
FRONTEND_ORIGIN=http://localhost:5173
```
</action>
<acceptance_criteria>
- `tests/schema.test.ts` exists
- `tests/isolation.test.ts` exists
- `.env.example` exists at project root
- `grep -c "supabase.rpc" tests/schema.test.ts` outputs `2` (one per function)
- `grep "match_memories" tests/schema.test.ts` finds the rpc call
- `grep "resolve_contact_name" tests/schema.test.ts` finds the rpc call
- `grep -c "FABRICATED_USER_ID" tests/isolation.test.ts` outputs at least `1`
- `grep "eq('user_id'" tests/isolation.test.ts` finds at least one occurrence
- `.env.example` contains all 11 vars: `grep -c "=$" .env.example` outputs `11` (excluding FRONTEND_ORIGIN which has a default value)
- With valid `.env` credentials: `bun test tests/schema.test.ts` exits 0
- With valid `.env` credentials: `bun test tests/isolation.test.ts` exits 0
</acceptance_criteria>
</task>

## Verification

After all tasks complete:

1. Confirm 8 tables visible in Supabase dashboard → Table Editor
2. Confirm RLS toggle is ON for each table in Supabase dashboard → Table Authentication tab
3. Run integration tests: `bun test tests/schema.test.ts tests/isolation.test.ts`
4. Spot-check from Supabase SQL Editor: `SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'memory_store_embedding_hnsw_idx';` should return `1`
5. Confirm extension: `SELECT * FROM pg_extension WHERE extname = 'vector';` should return a row

All 5 checks must pass before marking Plan 1 complete.
