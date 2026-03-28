---
phase: 06-auth-contacts-overhaul
plan: "01"
subsystem: backend-auth
tags: [auth, otp, supabase, rls, twilio, redis, migration]
dependency_graph:
  requires: []
  provides: [003_caregiver_auth.sql, POST /api/auth/send-otp, POST /api/auth/verify-otp, SUPABASE_ANON_KEY env validation]
  affects: [src/server.ts, src/env.ts, supabase RLS policies]
tech_stack:
  added: [caregiver_links table, caregivers table, authRouter]
  patterns: [Redis OTP key otp:${phone} with 10-min TTL, Twilio plain SMS (no whatsapp: prefix), Supabase service_role upsert for caregiver linking]
key_files:
  created:
    - supabase/migrations/003_caregiver_auth.sql
    - src/routes/auth.ts
  modified:
    - src/env.ts
    - src/server.ts
decisions:
  - "Twilio plain SMS used for VI user OTP (not WhatsApp) — works before sandbox join"
  - "Redis SET without NX allows OTP refresh on resend — caller controls retry flow"
  - "caregiver_links upsert uses onConflict: 'caregiver_id,user_id' — idempotent re-registration"
  - "authRouter mounted at /api/auth — under Bearer auth middleware, frontend passes API_BEARER_TOKEN"
metrics:
  duration: "3min"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_changed: 4
---

# Phase 06 Plan 01: Caregiver Auth Schema + OTP Backend Routes Summary

Supabase migration adding dual-account ownership tables (caregivers + caregiver_links) plus two OTP route handlers that link caregivers to VI users via phone verification.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Deploy 003_caregiver_auth.sql | 981a3ce | supabase/migrations/003_caregiver_auth.sql |
| 2 | SUPABASE_ANON_KEY + auth routes + server mount | c3a481f | src/env.ts, src/routes/auth.ts, src/server.ts |

## What Was Built

### Task 1: 003_caregiver_auth.sql

Migration file creating the dual-account ownership schema:

- `caregivers` table: maps `auth.uid()` (Supabase caregiver) to display info — `id UUID PRIMARY KEY REFERENCES auth.users(id)`, `email TEXT`, `display_name TEXT`
- `caregiver_links` table: join table linking caregivers to VI users — `caregiver_id FK caregivers`, `user_id FK users`, `UNIQUE(caregiver_id, user_id)`
- RLS policies on both new tables: caregiver can access own rows + service_role bypass
- 7 caregiver-via-link RLS policies added to all VI-user tables: `user_profile`, `user_contacts`, `sessions`, `message_log`, `memory_store`, `routines`, `heartbeat_log`

Each caregiver policy uses `EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = <table>.user_id)` — this means a caregiver JWT can read/write all their linked VI user's data without backend filtering changes.

Apply via: Supabase SQL Editor (paste file) or `bunx supabase db push`.

### Task 2: OTP routes + env + server mount

**src/env.ts:** `SUPABASE_ANON_KEY` added to `REQUIRED_ENV_VARS` — validated at startup before any route modules load.

**src/routes/auth.ts:** Two POST handlers:

- `POST /api/auth/send-otp`: Validates E.164 phone, generates 4-digit OTP via `Math.floor(1000 + Math.random() * 9000)`, stores in Redis as `otp:${phone}` with 600s TTL, sends plain SMS (no `whatsapp:` prefix) via Twilio REST API with 8s timeout.

- `POST /api/auth/verify-otp`: Validates Redis OTP, deletes key on match (one-time use), upserts `users` row (phone as unique key), upserts `caregivers` row, upserts `caregiver_links` row. Returns `{ userId, linked: true }`.

**src/server.ts:** `authRouter` imported and mounted at `/api/auth` — inherits Bearer auth middleware from `/api/*`.

## Verification Results

- `grep -c "CREATE TABLE IF NOT EXISTS caregivers" supabase/migrations/003_caregiver_auth.sql` → 1
- `grep -c "caregiver can access linked user rows" supabase/migrations/003_caregiver_auth.sql` → 7
- `grep "SUPABASE_ANON_KEY" src/env.ts` → match
- `grep "authRouter" src/server.ts` → match (import + app.route)
- TypeScript src/ files: no new errors introduced (pre-existing TS6059 in tests/ directory is a pre-existing tsconfig misconfiguration unrelated to this plan)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both route handlers are fully wired: Redis for OTP storage, Twilio for SMS delivery, Supabase service_role client for DB writes.

## Self-Check: PASSED

Files created:
- supabase/migrations/003_caregiver_auth.sql: FOUND
- src/routes/auth.ts: FOUND

Files modified:
- src/env.ts: FOUND (SUPABASE_ANON_KEY present)
- src/server.ts: FOUND (authRouter import + mount present)

Commits:
- 981a3ce (Task 1)
- c3a481f (Task 2)
