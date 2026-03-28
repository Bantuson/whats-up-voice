---
phase: 06-auth-contacts-overhaul
plan: "03"
subsystem: frontend-auth
tags: [auth, react, zustand, supabase, otp, navigation]
requires: [06-02]
provides: [Auth.tsx two-step gate, App.tsx auth guard, cleaned sidebar nav]
affects: [frontend/src/App.tsx, frontend/src/pages/Auth.tsx]
tech_stack:
  added: []
  patterns: [two-step OTP auth gate, Zustand auth guard, React Router auth redirect]
key_files:
  created:
    - frontend/src/pages/Auth.tsx
  modified:
    - frontend/src/App.tsx
  deleted:
    - frontend/src/pages/Login.tsx
decisions:
  - Auth.tsx step progression managed by local useState Step type (email|email-otp|phone|phone-otp) — no router-level sub-routes needed for a single-screen wizard
  - App.tsx pre-auth branch renders Routes with /auth only; post-auth branch renders full sidebar — clean separation avoids conditional route rendering bugs
  - initAuth() cleanup fn stored in closure within useEffect — matches appStore API that returns () => void from async Promise
metrics:
  duration: "4min"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_changed: 3
---

# Phase 06 Plan 03: Auth Gate + App.tsx Rewrite Summary

**One-liner:** Two-step auth gate (caregiver email OTP + VI user SMS OTP) with React Router auth guard and cleaned 5-item sidebar nav replacing Login.tsx stub.

---

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create Auth.tsx two-step caregiver + VI user auth gate | 95d4dbe | frontend/src/pages/Auth.tsx (created) |
| 2 | Rewrite App.tsx with auth guard + cleaned NAV_ITEMS + gear icon, delete Login.tsx | 933309a | frontend/src/App.tsx (modified), frontend/src/pages/Login.tsx (deleted) |

---

## What Was Built

### Auth.tsx
A fully typed two-step authentication page that operates in four sub-states (`email` → `email-otp` → `phone` → `phone-otp`):

- **Step 1a** (email): email regex validation → `signIn(email)` → Supabase sends 6-digit OTP
- **Step 1b** (email-otp): 6-digit digit-only input → `verifyOtp(email, token)` → caregiver session established
- **Step 2a** (phone): E.164 phone validation + display name → `POST /api/auth/send-otp` → Twilio sends 4-digit SMS
- **Step 2b** (phone-otp): 4-digit digit-only input → `linkViUser(phone, name, smsOtp)` → redirect to `/dashboard`

All CSS uses design tokens only (`var(--color-accent)`, `var(--color-surface)`, `.btn-primary`, `.field-input`). No raw hex colors.

### App.tsx (rewritten)
- **Auth guard**: `if (!isAuthenticated)` renders only `<Route path="/auth">` and `<Navigate to="/auth">` — dashboard pages completely inaccessible without session
- **`initAuth()` on mount**: rehydrates Supabase session from localStorage via `useEffect`
- **NAV_ITEMS reduced to 5**: Dashboard, Feed, Contacts, Routines, Log — Login and Setup removed
- **Gear icon in sidebar footer**: `NavLink to="/setup"` with `⚙` icon for post-auth reconfiguration
- **Sign-out button**: `signOut()` call in sidebar footer
- **`/auth` route** (post-auth): redirects to `/dashboard` — prevents returning to auth page while signed in

### Login.tsx
Deleted. Was a redirect stub that pointed to `/auth`. Auth.tsx is the canonical auth entry point.

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None. Auth.tsx wires real store methods (`signIn`, `verifyOtp`, `linkViUser`) and real backend fetch (`/api/auth/send-otp`). All flows are functional end-to-end given the appStore and backend routes from Plans 06-01 and 06-02.

---

## Build Verification

- `npx tsc --noEmit` exits 0 (TypeScript strict mode, no errors)
- `node_modules/.bin/vite build` from main repo frontend directory exits 0 (78 modules, built in 1.18s)
- Note: worktree does not have symlinked node_modules — build was verified from main repo where packages are installed (pre-existing worktree environment constraint, not a code issue)

---

## Self-Check: PASSED

Files verified:
- `frontend/src/pages/Auth.tsx` — EXISTS
- `frontend/src/App.tsx` — EXISTS, contains `isAuthenticated` guard
- `frontend/src/pages/Login.tsx` — DELETED (correct)

Commits verified:
- `95d4dbe` — feat(06-03): create Auth.tsx two-step caregiver + VI user auth gate
- `933309a` — feat(06-03): rewrite App.tsx with auth guard + cleaned nav, delete Login.tsx
