---
phase: 06-auth-contacts-overhaul
plan: 02
subsystem: frontend-auth-store
tags: [supabase, auth, zustand, frontend, typescript]
dependency_graph:
  requires: []
  provides: [supabase-client-singleton, appstore-auth-state]
  affects: [frontend/src/pages/Auth.tsx, frontend/src/pages/Setup.tsx, frontend/src/App.tsx]
tech_stack:
  added: ["@supabase/supabase-js@2.100.1"]
  patterns: [supabase-magic-link-otp, zustand-auth-store, session-rehydration]
key_files:
  created:
    - frontend/src/lib/supabase.ts
    - frontend/.env.example
  modified:
    - frontend/src/store/appStore.ts
    - frontend/src/pages/Login.tsx
    - frontend/package.json
decisions:
  - "Supabase JS client singleton throws at module load if env vars missing — fast-fail for misconfiguration"
  - "isAuthenticated is true only when BOTH session exists AND userId (VI user) is non-null — prevents half-authenticated state"
  - "userId preserved in localStorage across rehydration cycles — initAuth reads it on every session restore"
  - "Login.tsx stubbed to redirect to /auth (Plan 03 deletes it) — preserves existing router without breaking build"
metrics:
  duration_minutes: 7
  completed_date: 2026-03-29
  tasks_completed: 2
  files_modified: 5
---

# Phase 06 Plan 02: Supabase Client Singleton + Auth Store Summary

**One-liner:** Supabase JS client singleton and Zustand auth store with email OTP + SMS OTP two-step auth flow using `signInWithOtp`, `verifyOtp`, and `linkViUser` methods.

---

## What Was Built

### Task 1: @supabase/supabase-js install + singleton (commit `54298fd`)

Installed `@supabase/supabase-js` v2.100.1 into `frontend/package.json`. Created `frontend/src/lib/supabase.ts` — a single-export module that initialises a Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The singleton uses all three Supabase client defaults: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`. Throws a descriptive error at module load time if either env var is missing. Also created `frontend/.env.example` documenting all required `VITE_` vars.

### Task 2: appStore.ts rewrite with full auth state (commit `067844b`)

Rewrote `frontend/src/store/appStore.ts`. Key changes:

**Auth state added:**
- `caregiverId: string | null` — Supabase `auth.uid()` from JWT session
- `userId: string | null` — VI user UUID from `caregiver_links` table
- `session: Session | null` — full Supabase session (JWT, refresh token, expiry)
- `isAuthenticated: boolean` — only `true` when session AND userId are both non-null

**Auth methods added:**
- `initAuth()` — rehydrates session via `getSession()` + registers `onAuthStateChange` listener; call on app mount, returns cleanup fn
- `signIn(email)` — calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`
- `verifyOtp(email, token)` — calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`
- `linkViUser(phone, name, smsOtp)` — POSTs to `/api/auth/verify-otp`, stores `userId` in localStorage, sets `isAuthenticated: true`
- `signOut()` — calls `supabase.auth.signOut()`, removes localStorage item, clears all auth state

**Preserved unchanged:**
- `HeartbeatEvent` interface (used by Dashboard, HeartbeatFeed)
- `subscribeToSSE(token)` — EventSource for heartbeat + agent state SSE streams
- `sessionPhase`, `setSessionPhase`, `addHeartbeatEvent`, `heartbeatLog`

**Removed:**
- `setUserId(id)` — old localStorage phone-based login
- `userId: localStorage.getItem('voiceapp_user_id')` initialization

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Login.tsx TypeScript error after removing setUserId**
- **Found during:** Task 2 — `tsc -b` failed with `Property 'setUserId' does not exist on type 'AppStore'`
- **Issue:** `frontend/src/pages/Login.tsx` referenced `useAppStore((s) => s.setUserId)` which no longer exists after the store rewrite
- **Fix:** Replaced Login.tsx with a stub that immediately redirects to `/auth`. This is the correct interim state — context.md specifies Login.tsx will be deleted in Plan 04 when Auth.tsx is created and wired into the router
- **Files modified:** `frontend/src/pages/Login.tsx`
- **Commit:** `067844b` (bundled with Task 2 commit)

---

## Known Stubs

None — all functionality is fully implemented. The `Login.tsx` redirect-stub is intentional and documented: Plan 03 creates `Auth.tsx` and Plan 04 wires the router; the stub prevents build failures in the interim.

---

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `frontend/src/lib/supabase.ts` exists | FOUND |
| `frontend/src/store/appStore.ts` exists | FOUND |
| `frontend/.env.example` exists | FOUND |
| Commit `54298fd` (Task 1) exists | FOUND |
| Commit `067844b` (Task 2) exists | FOUND |
| TypeScript build passes | PASSED |
| Vite build passes | PASSED |
