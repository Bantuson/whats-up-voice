---
phase: 01-foundation
plan: 01
subsystem: database
tags: [supabase, postgresql, pgvector, rls, hnsw, sql, typescript, bun]

# Dependency graph
requires: []
provides:
  - "8-table Supabase schema with RLS enabled and service_role bypass policies"
  - "pgvector HNSW index on memory_store.embedding (cosine similarity)"
  - "match_memories() SQL function for episodic memory retrieval via supabase.rpc()"
  - "resolve_contact_name() SQL function for phone-to-name lookup via supabase.rpc()"
  - "Integration test suite: schema.test.ts + isolation.test.ts"
  - ".env.example documenting all 11 required environment variables"
affects:
  - "02-webhook-heartbeat"
  - "03-agent-intelligence"
  - "04-voice-pipeline-cron"
  - "05-tests-frontend-demo"

# Tech tracking
tech-stack:
  added:
    - "@supabase/supabase-js (client for integration tests)"
    - "pgvector (PostgreSQL extension for VECTOR(1536))"
    - "bun:test (test runner for schema + isolation tests)"
  patterns:
    - "service_role client with autoRefreshToken:false, persistSession:false — used in all backend queries"
    - "Every query includes .eq('user_id', userId) — service_role bypasses RLS so app-layer filter is mandatory"
    - "supabase.rpc() for all vector similarity queries — PostgREST cannot use <=> operator directly"
    - "HNSW index with m=16, ef_construction=64 for cosine ops on 1536-dim embeddings"

key-files:
  created:
    - "supabase/migrations/001_schema.sql"
    - "supabase/migrations/002_functions.sql"
    - "tests/schema.test.ts"
    - "tests/isolation.test.ts"
    - ".env.example"
  modified: []

key-decisions:
  - "Two policies per table: one auth.uid() user policy + one service_role bypass — RLS enforced at DB layer for user isolation, service_role used by backend"
  - "HNSW index in separate 002_functions.sql file — must run after 001_schema.sql creates the memory_store table"
  - "match_memories LIMIT capped at LEAST(match_count, 20) — prevents unbounded result sets from RPC calls"
  - "resolve_contact_name returns NULL for unknown phone — caller must handle null and synthesize phone display"

patterns-established:
  - "Pattern 1: Migration ordering — 001_schema.sql always before 002_functions.sql (foreign key and index dependency)"
  - "Pattern 2: User isolation — every query against user-scoped table must include .eq('user_id', userId) even with service_role client"
  - "Pattern 3: RPC for vector ops — all cosine similarity searches go through supabase.rpc('match_memories', ...) never raw PostgREST"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

# Metrics
duration: 10min
completed: 2026-03-27
---

# Phase 1 Plan 01: Supabase Schema + RLS Summary

**8-table Supabase schema with pgvector HNSW index, service_role RLS bypass policies, and two callable SQL functions (match_memories + resolve_contact_name) forming the complete database foundation for Phases 2-5.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-27T19:58:53Z
- **Completed:** 2026-03-27T20:08:32Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Complete 8-table schema with RLS enabled and 16 policies (2 per table) deployed as `supabase/migrations/001_schema.sql`
- HNSW index (m=16, ef_construction=64, cosine_ops) and two SQL helper functions deployed as `supabase/migrations/002_functions.sql`
- Live integration tests covering all 8 tables, both RPC functions, and app-layer user isolation using fabricated UUIDs

## Task Commits

Each task was committed atomically:

1. **Task 1: Write 001_schema.sql — all 8 tables with RLS** - `d881fcd` (feat)
2. **Task 2: Write 002_functions.sql — HNSW index + match_memories + resolve_contact_name** - `9a2848b` (feat)
3. **Task 3: Write tests/schema.test.ts — live integration tests** - `21df487` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `supabase/migrations/001_schema.sql` — All 8 table DDL with RLS enabled (8 ALTER TABLE statements, 16 CREATE POLICY statements, 2 composite indexes)
- `supabase/migrations/002_functions.sql` — HNSW index on memory_store.embedding + match_memories() + resolve_contact_name()
- `tests/schema.test.ts` — Integration tests: 8 table existence checks + 2 RPC function smoke tests
- `tests/isolation.test.ts` — App-layer isolation: 7 user-scoped tables queried with fabricated user_id expect zero rows
- `.env.example` — 11 required environment variables documented with empty values

## Decisions Made

- Two policies per table enforces defense-in-depth: auth.uid() for authenticated users, service_role bypass for backend operations — RLS can never leak data even if application code has bugs
- HNSW parameters m=16, ef_construction=64 chosen as Supabase recommended defaults for 1536-dim embeddings — provides good recall/latency trade-off without tuning
- match_memories caps results at LEAST(match_count, 20) to prevent any caller from retrieving unbounded embeddings
- resolve_contact_name returns NULL (not empty string) for unknown phone — callers in Phase 3 must handle null and fall back to displaying the raw phone number

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration before integration tests can pass.**

To deploy the schema to Supabase:

1. Create a Supabase project (recommended region: `af-south-1` — Cape Town)
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. Open Supabase dashboard → SQL Editor → paste full contents of `supabase/migrations/001_schema.sql` → Run
4. After `001_schema.sql` succeeds, paste full contents of `supabase/migrations/002_functions.sql` → Run
5. Verify: `SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'memory_store_embedding_hnsw_idx';` returns 1
6. Verify: `SELECT * FROM pg_extension WHERE extname = 'vector';` returns a row
7. Run integration tests: `bun test tests/schema.test.ts tests/isolation.test.ts`

CRITICAL: 002_functions.sql will fail with "relation does not exist" if applied before 001_schema.sql.

## Next Phase Readiness

- Schema is the single source of truth for table shapes used in Phases 2-5 — all column names and types are fixed
- Plans 02 (Hono server skeleton) and 03 (session state machine + classifier) can proceed immediately — they do not need Supabase live to write TypeScript modules
- Integration tests require `.env` with real Supabase credentials to pass
- Redis hosting decision (Upstash vs Railway) still needed before Phase 2 BullMQ setup

## Known Stubs

None — all SQL is complete and fully operational. No placeholder values or hardcoded empty data.

## Self-Check

- `supabase/migrations/001_schema.sql` — exists
- `supabase/migrations/002_functions.sql` — exists
- `tests/schema.test.ts` — exists
- `tests/isolation.test.ts` — exists
- `.env.example` — exists

---
*Phase: 01-foundation*
*Completed: 2026-03-27*
