---
phase: 06-auth-contacts-overhaul
type: context
created: 2026-03-28
---

# Phase 06 — Auth Gate + Contacts Overhaul: Context

## Why this phase exists

Phase 5 shipped a working dashboard but exposed two structural gaps:

1. **Login and Setup are permanent sidebar nav items** — accessible to anyone at any time, with no
   real auth enforcement. There is no gate preventing an unauthenticated user from reaching the
   dashboard. The current "login" is just a phone number entry that sets `userId` in localStorage.

2. **Setup has no contact management** — the caregiver cannot register the visually impaired (VI)
   user's contacts during setup. The agent can save contacts via voice command but there is no
   manual entry UI, no bulk import path, and no clear ownership of who created which contact.

---

## Problem 1: Auth gate redesign

### Current state
- `Login` and `Setup` are routes in the main sidebar nav (`NAV_ITEMS` in `App.tsx`).
- Auth is faked: entering any valid phone number sets `userId` in `localStorage` and redirects to
  `/dashboard`.
- No Supabase Auth session exists. No JWT. No email verification. No phone OTP.
- Any user who clears localStorage is bounced to `/login` but there is no actual session backing it.

### Target state
- **LOGIN and SETUP are removed from the sidebar entirely.** They are pre-auth routes, not dashboard
  sections. The sidebar only renders after both auth identities are established.
- **Unauthenticated entry point** (`/`) is an auth gate — not a page in the nav. App.tsx guards all
  dashboard routes: if no valid Supabase session, redirect to `/auth`.
- **The auth flow is two-step, always performed by the caregiver on behalf of the VI user:**

  **Step 1 — Caregiver signup / sign-in (email, Supabase Auth)**
  - Caregiver enters their email address.
  - Supabase sends a magic link / OTP email (default 8-digit code, standard Supabase email template).
  - On verification, Supabase issues a JWT. The caregiver identity is now established.
  - Persisted via `supabase.auth.getSession()` — stays valid until explicit sign-out or uninstall.

  **Step 2 — VI user registration (phone + 4-digit SMS OTP, done during setup)**
  - After caregiver auth, if no VI user is linked, redirect to `/setup`.
  - Caregiver enters the VI user's WhatsApp phone number and display name.
  - A 4-digit OTP is sent to that phone number via Twilio (existing credentials).
  - Caregiver enters the OTP on behalf of the VI user to verify phone ownership.
  - On success, a row is created in `users` (VI user phone) and a `caregiver_links` join record
    links `auth.uid()` (caregiver) to `users.id` (VI user).
  - From this point forward, the caregiver JWT grants access to all VI user data via RLS policies
    that check `caregiver_links`.

  **Staying signed in**
  - Supabase session is persisted to `localStorage` via the JS client.
  - App re-hydrates session on load via `supabase.auth.onAuthStateChange`.
  - No re-authentication unless the user explicitly signs out or the session is invalidated.
  - When session is valid + VI user is linked → go to `/dashboard`. No auth gate shown.

### Security model
- All backend routes that accept `userId` must validate the JWT and confirm the calling caregiver
  has a `caregiver_links` row for that `userId`. The existing `API_BEARER_TOKEN` header auth on
  `/api/*` is supplemented by a JWT check or replaced by it.
- The VI user never interacts with the frontend — they only communicate via WhatsApp (phone).
- The caregiver is the sole operator of the dashboard and is responsible for the VI user's account.

---

## Problem 2: Schema — dual account ownership

### Current schema gap
The current `users` table stores only VI user phone numbers. There is no concept of a caregiver
identity or a link between a caregiver and a VI user.

```sql
-- Current: users table only has phone, no caregiver reference
CREATE TABLE users (
  id    UUID PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  ...
);
```

### Required schema additions (new migration: `003_caregiver_auth.sql`)

```sql
-- caregivers table: maps Supabase auth.uid() (caregiver) to display info
CREATE TABLE caregivers (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- caregiver_links: many-to-one (one caregiver manages one VI user; design allows future M:1)
CREATE TABLE caregiver_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (caregiver_id, user_id)
);
```

RLS policies on all VI-user tables (`user_profile`, `user_contacts`, `message_log`, `memory_store`,
`heartbeat_log`, `sessions`, `routines`) must be updated to allow access when:
```sql
EXISTS (
  SELECT 1 FROM caregiver_links
  WHERE caregiver_id = auth.uid()
  AND   user_id = <table>.user_id
)
```
The `users` table service_role bypass policies stay in place for backend webhook writes.

### Store changes (`appStore.ts`)
Current store has `userId: string | null` set from localStorage.
New store needs:
- `caregiverId: string | null` — Supabase `auth.uid()` from session
- `userId: string | null` — VI user UUID (from `caregiver_links`)
- `session: Session | null` — full Supabase session (JWT, expiry)
- `isAuthenticated: boolean` — derived: session exists + user linked
- Methods: `signIn(email)`, `verifyOtp(email, code)`, `linkViUser(phone, name, smsOtp)`, `signOut()`

---

## Problem 3: Setup page — contact management

### Current state
`Setup.tsx` contains: language selector, location field, quiet hours, morning briefing toggle.
No contact management. No way to add contacts during setup. Contacts are only created by the agent
via voice command mid-session.

### Target state
Setup page becomes a two-section post-auth wizard (only reachable after caregiver auth + VI user
registration):

**Section A — VI User Profile** (existing fields, already in Setup.tsx):
- Language, location (EskomSePush area), quiet hours, morning briefing toggle.

**Section B — Contact List** (new):
Three entry modes, shown in tab/toggle:

1. **Manual entry** (always available): caregiver types name + phone number, submits.
   - Inserts to `user_contacts` (same table used by agent today).
   - Shows existing contacts in a list below with delete option.

2. **Voice command** (agent-driven, already works): caregiver or VI user says "add Naledi, 083 500
   0000" and the agent creates the contact. No frontend change needed — the agent `save_contact`
   tool already writes to `user_contacts`. Setup page just surfaces the current list.

3. **Native contact import** (demo workaround):
   - **Production intent**: call the Web Contacts API (`navigator.contacts.select()`) — available
     on Android Chrome and iOS Safari. Caregiver selects contacts from device, app maps them to
     `user_contacts` rows.
   - **Demo workaround** (localhost has no native contacts): Show an "Import from device" button.
     On click, render a textarea that accepts a JSON array of `{ name, phone }` objects (or a
     simple CSV: `Name, +27831234567`). Parse and bulk-insert to `user_contacts` via existing
     `/api/contacts` endpoint. This simulates the import without needing device access.
   - **Detection**: feature-detect `'contacts' in navigator && 'ContactsManager' in window`.
     If available → real native picker. If not → show the JSON/CSV textarea workaround.
     No separate build flags needed.

---

## Constraints and locked decisions

- **Supabase Auth** is the caregiver auth provider. No custom JWT issuance. Use `@supabase/supabase-js`
  `signInWithOtp({ email })` for magic-link/OTP. The default Supabase email template is acceptable
  for the demo — no custom branding needed.
- **Twilio** sends the 4-digit SMS OTP to the VI user phone. This reuses existing Twilio credentials
  (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`). The OTP is sent as a
  plain SMS (not WhatsApp) so it works even before the VI user joins the Twilio sandbox.
  OTP generation: `Math.floor(1000 + Math.random() * 9000)` stored in Redis with a 10-minute TTL
  keyed as `otp:${phone}`. Backend route: `POST /api/auth/send-otp` + `POST /api/auth/verify-otp`.
- **Session persistence**: Supabase JS client handles `localStorage` persistence automatically when
  initialized with `persistSession: true` (default). No custom token management needed.
- **Sidebar nav after this phase**: LOGIN and SETUP items are removed. SETUP becomes accessible via
  a settings/gear icon in the sidebar footer (for re-configuration, not auth). The 5 remaining nav
  items are: DASHBOARD, FEED, CONTACTS, ROUTINES, LOG.
- **Existing agent contact tools are unchanged**: `save_contact`, `list_contacts`, `read_messages`
  continue to work as-is. The Setup contact UI writes to the same `user_contacts` table.
- **`user_contacts` table schema is unchanged** — it already has `user_id`, `name`, `phone`,
  `is_priority` columns. No migration needed for contacts.

---

## Files affected (reference only — plan will refine)

| File | Change |
|------|--------|
| `supabase/migrations/003_caregiver_auth.sql` | New: `caregivers` + `caregiver_links` tables, updated RLS policies |
| `src/routes/auth.ts` | New: `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` |
| `src/env.ts` | Add `SUPABASE_ANON_KEY` to required vars (Supabase JS client needs it) |
| `frontend/src/lib/supabase.ts` | New: Supabase JS client singleton |
| `frontend/src/store/appStore.ts` | Rewrite: add session, caregiverId, signIn/signOut/linkViUser |
| `frontend/src/App.tsx` | Auth guard, remove LOGIN/SETUP from nav, add `/auth` + `/setup` guarded routes |
| `frontend/src/pages/Auth.tsx` | New: two-step auth gate (caregiver email OTP → VI user phone OTP) |
| `frontend/src/pages/Setup.tsx` | Extend: add contact section with manual entry + import workaround |
| `frontend/src/pages/Login.tsx` | Delete (replaced by Auth.tsx) |
| `frontend/index.html` | No change |

---

## Open questions for planning

1. Should caregiver sign-in be magic link (email click) or OTP (enter 8-digit code)? Magic link is
   simpler UX but requires the caregiver to switch to their email app. OTP keeps the flow in-app.
   **Recommendation: OTP (enter code) — keeps caregiver on the dashboard tab.**

2. Should the 4-digit VI user OTP be sent via Twilio SMS or WhatsApp? SMS works before sandbox join;
   WhatsApp requires sandbox join first. **Recommendation: plain SMS for setup OTP.**

3. For the demo, will the caregiver use their real email? Or should there be a "skip auth for demo"
   bypass mode (e.g. `VITE_DEMO_MODE=true`)? **TBD — note for planner.**
