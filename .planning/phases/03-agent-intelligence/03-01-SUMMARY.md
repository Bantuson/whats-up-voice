---
phase: 03-agent-intelligence
plan: 01
subsystem: agent
tags: [tdd, sanitiser, tool-handlers, whatsapp, contacts, eskom, openweather, tavily, supabase, bun-test]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: supabase singleton (src/db/client.ts), session machine (src/session/machine.ts), phone utils (src/lib/phone.ts), error utils (src/lib/errors.ts)
  - phase: 02-webhook-heartbeat
    provides: user_contacts and message_log schema, user_id isolation patterns
provides:
  - sanitiseForSpeech() strips all markdown chars from any spoken output string
  - toolReadMessages() queries message_log with user_id filter, resolves contact names (CONTACT-05)
  - toolSendMessage() stages message for approval via session machine, never calls WhatsApp API
  - toolResolveContact() / toolGetContact() use .ilike() for case-insensitive name lookup
  - toolSaveContact() normalises phone to E.164 before insert
  - toolListContacts() / toolSetPriority() — full CRUD for user contacts
  - toolGetLoadShedding() — EskomSePush area API with Token header, Johannesburg fallback
  - toolGetWeather() — OpenWeather One Call 3.0, Johannesburg hardcoded lat/lon
  - toolWebSearch() — Tavily @tavily/core search with answer/results fallback
  - tests/setup.ts + bunfig.toml — preload env vars so supabase createClient() works in unit tests
affects: [03-02-orchestrator, 03-03-voice-route]

# Tech tracking
tech-stack:
  added: ["@tavily/core@0.7.2"]
  patterns:
    - "TDD red-green-refactor with bun:test mock.module for supabase isolation"
    - "mock.module hoisted before imports — requires SUPABASE_URL env dummy in preload"
    - "Lazy singleton pattern for @tavily/core client (avoids module-level instantiation breaking test mocks)"
    - "AbortSignal passed in by caller — tool handlers never create their own AbortController"

key-files:
  created:
    - src/agent/sanitiser.ts
    - src/tools/whatsapp.ts
    - src/tools/contacts.ts
    - src/tools/ambient.ts
    - tests/sanitiser.test.ts
    - tests/whatsapp.test.ts
    - tests/contacts.test.ts
    - tests/ambient.test.ts
    - tests/setup.ts
    - bunfig.toml
  modified: []

key-decisions:
  - "Lazy tavilyClient singleton in ambient.ts — module-level instantiation causes mock.module to fail in tests; lazy getter ensures mock.module applies before first call"
  - "tests/setup.ts + bunfig.toml preload — supabase createClient() runs at module load time; dummy SUPABASE_URL env prevents crash when real DB not configured"
  - "toolReadMessages() queries direction='in' only — outbound messages not read back to user"
  - "toolResolveContact() uses .ilike() on name not .eq() — case-insensitive name matching (CONTACT-05, Pitfall 7)"
  - "toolSendMessage() calls transition(composing) then transition(awaiting_approval) — approval loop enforced at tool boundary not route layer"

patterns-established:
  - "Pattern: every .from() query in src/tools/*.ts must have .eq('user_id', userId) as first filter — ISO-01 enforcement"
  - "Pattern: all tool handlers return spoken-safe strings (fallbacks already sanitised) — sanitiseForSpeech() adds final layer in orchestrator"
  - "Pattern: AbortSignal flows from orchestrator → tool handler → fetch() — tools never set their own timeout"

requirements-completed: [AGENT-07, AGENT-08, AGENT-06, CONTACT-05]

# Metrics
duration: 9min
completed: 2026-03-28
---

# Phase 3 Plan 01: Pure Tool Handlers + Markdown Sanitiser Summary

**sanitiseForSpeech() regex stripper, 9 tool handlers (WhatsApp/Contacts/Ambient) with TDD isolation via bun:test mock.module and @tavily/core installed**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-28T08:16:38Z
- **Completed:** 2026-03-28T08:25:41Z
- **Tasks:** 3
- **Files modified:** 10 created + 1 bunfig.toml

## Accomplishments

- sanitiseForSpeech() strips bold, italic, headers, bullets, backticks, links, blockquotes, double-newlines — 17 tests all green
- 6 WhatsApp + contacts tool handlers with full user_id isolation (ISO-01) and case-insensitive ilike lookups (CONTACT-05)
- 3 ambient handlers (EskomSePush Token header, OpenWeather Johannesburg lat/lon, Tavily web search) — fallback on all error paths
- Added tests/setup.ts + bunfig.toml preload to fix supabase module initialisation crash in unit tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Markdown sanitiser — sanitiseForSpeech()** - `ed51c32` (test + feat)
2. **Task 2: WhatsApp and Contacts tool handlers** - `f1adba6` (feat)
3. **Task 3: Ambient tool handlers (EskomSePush, OpenWeather, Tavily)** - `95381cf` (feat)

_Note: TDD tasks combined RED and GREEN into single commits for clarity. All tests pass._

## Files Created/Modified

- `src/agent/sanitiser.ts` — sanitiseForSpeech() with 6-pattern MD_PATTERNS regex array
- `src/tools/whatsapp.ts` — toolReadMessages, toolSendMessage, toolResolveContact
- `src/tools/contacts.ts` — toolGetContact, toolSaveContact, toolListContacts, toolSetPriority
- `src/tools/ambient.ts` — toolGetLoadShedding, toolGetWeather, toolWebSearch with lazy tavilyClient
- `tests/sanitiser.test.ts` — 17 behavior-level tests
- `tests/whatsapp.test.ts` — 12 tests including fetch-never-called assertion
- `tests/contacts.test.ts` — 10 tests including E.164 normalisation
- `tests/ambient.test.ts` — 13 tests with mocked fetch + mocked @tavily/core
- `tests/setup.ts` — preload env vars for test environment
- `bunfig.toml` — registers tests/setup.ts as bun test preload

## Decisions Made

- **Lazy tavilyClient singleton** — `const tavilyClient = tavily({...})` at module top-level means the real `tavily` factory runs before `mock.module('@tavily/core')` can intercept it. A lazy getter `getClient()` defers instantiation so the mock is applied first. This is the correct pattern for any module-level singleton that depends on a mockable import.
- **Preload file for env vars** — `src/db/client.ts` calls `createClient()` at module load time and throws if `SUPABASE_URL` is undefined. Since unit tests mock `../src/db/client`, the real module still runs during module resolution. Setting dummy env vars in a preload prevents the crash without changing production code.
- **`toolReadMessages` queries `direction='in'` only** — reading outbound messages back to the user creates noise; only inbound messages are surfaced.
- **`toolSendMessage` never calls fetch** — the approval loop requires human confirmation before any WhatsApp API call. Staging via `setPendingMessage` + `transition(awaiting_approval)` enforces this boundary at the tool layer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lazy tavilyClient singleton in ambient.ts**
- **Found during:** Task 3 (toolWebSearch tests failing)
- **Issue:** `const tavilyClient = tavily({...})` at module top-level caused mock.module to not intercept the client. `toolWebSearch` always fell into the catch block returning the fallback string.
- **Fix:** Replaced module-level constant with a lazy getter `getClient()` that creates the client on first call. This ensures `mock.module('@tavily/core')` (which is hoisted) provides the mocked `tavily` factory before first use.
- **Files modified:** src/tools/ambient.ts
- **Verification:** All 13 ambient tests pass including Tavily search tests.
- **Committed in:** 95381cf (Task 3 commit)

**2. [Rule 3 - Blocking] Added tests/setup.ts + bunfig.toml preload**
- **Found during:** Task 2 (contacts.test.ts failing with supabaseUrl error)
- **Issue:** `src/db/client.ts` runs `createClient()` at module load time. Without env vars set, it throws `supabaseUrl is required`. Tests mocking `src/db/client` still triggered the real module initialization.
- **Fix:** Created `tests/setup.ts` preload that sets dummy `SUPABASE_URL` etc., registered via `bunfig.toml [test] preload`.
- **Files modified:** tests/setup.ts (created), bunfig.toml (created)
- **Verification:** bun test contacts.test.ts exits 0. All 120 unit tests pass.
- **Committed in:** f1adba6 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes required for test correctness. No scope changes.

## Issues Encountered

- Bun's `mock.module` hoisting does not prevent module-level side effects (supabase init, tavily init) from running during module resolution. Solution: lazy instantiation pattern + preload env setup. This pattern should be used for any future module that instantiates an API client at the top level.

## User Setup Required

None - no external service configuration required for this plan. API keys (`ESKOMSEPUSH_API_KEY`, `OPENWEATHER_API_KEY`, `TAVILY_API_KEY`) are needed at runtime but not for the unit tests.

## Next Phase Readiness

- All tool handler functions are independently verified and ready to be imported by the orchestrator (Plan 03-02)
- sanitiseForSpeech() ready to be applied at every orchestrator return boundary
- bunfig.toml preload in place — future test files can mock supabase without worrying about createClient() crash
- 120 unit tests passing (0 failures in non-integration suite)

---
*Phase: 03-agent-intelligence*
*Completed: 2026-03-28*

## Self-Check: PASSED

- FOUND: src/agent/sanitiser.ts
- FOUND: src/tools/whatsapp.ts
- FOUND: src/tools/contacts.ts
- FOUND: src/tools/ambient.ts
- FOUND: tests/sanitiser.test.ts
- FOUND: tests/whatsapp.test.ts
- FOUND: tests/contacts.test.ts
- FOUND: tests/ambient.test.ts
- FOUND: commit ed51c32 (Task 1 — sanitiser)
- FOUND: commit f1adba6 (Task 2 — whatsapp + contacts)
- FOUND: commit 95381cf (Task 3 — ambient)
