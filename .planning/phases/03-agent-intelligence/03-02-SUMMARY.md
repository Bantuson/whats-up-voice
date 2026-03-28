---
phase: 03-agent-intelligence
plan: 02
subsystem: api
tags: [anthropic, claude-sonnet-4-6, tool-use, agentic-loop, orchestrator, tdd]

# Dependency graph
requires:
  - phase: 03-01
    provides: classifier.ts, sanitiser.ts, whatsapp.ts, contacts.ts, ambient.ts — all tool handlers and speech utilities

provides:
  - runOrchestrator() — manual tool-use agentic loop using anthropic.messages.create() with while(stop_reason=tool_use)
  - ALL_TOOLS array — 10 tool definitions (ReadMessages, SendMessage, ResolveContact, GetContact, SaveContact, ListContacts, SetPriority, GetLoadShedding, GetWeather, WebSearch)
  - ORCHESTRATOR_SYSTEM_PROMPT — spoken-natural response rules
  - executeTool() dispatcher — routes all 10 tool names to correct handler functions

affects:
  - 03-03 (voice command route — wires runOrchestrator into the Hono POST /api/voice endpoint)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy Anthropic singleton: _anthropic initialized on first getAnthropic() call — enables mock.module to intercept before first use in tests"
    - "Agentic loop: while(toolCallCount < MAX_TOOL_CALLS) — exits on end_turn, non-tool_use stop_reason, or after 10 tool calls"
    - "Tool dispatch: switch(name) in executeTool() — all 9 tools dispatched, default returns error object"
    - "Sanitise-on-exit: sanitiseForSpeech() called on every code path that returns a string"
    - "AbortSignal threading: caller sets the 5-second timeout — orchestrator passes signal to SDK and all ambient tools"

key-files:
  created:
    - src/agent/orchestrator.ts
    - tests/orchestrator.test.ts
  modified: []

key-decisions:
  - "Lazy Anthropic singleton (_anthropic = null, getAnthropic() factory) — Bun 1.3.x mock.module hoisting requires lazy instantiation so test mocks intercept before first client creation"
  - "Only @anthropic-ai/sdk mocked in orchestrator tests — tool module mocks (mock.module('../src/tools/...')) cause cross-file contamination in Bun 1.3.x single-process test runner; supabase-dependent tools avoided in tool_use test cases"
  - "tool_use tests use fetch-based tools (GetLoadShedding, GetWeather) not supabase-based tools — avoids cross-file mock contamination while still testing the agentic loop"
  - "ALL_TOOLS has 10 entries — plan said 9 tools but counting: ReadMessages(1) SendMessage(2) ResolveContact(3) GetContact(4) SaveContact(5) ListContacts(6) SetPriority(7) GetLoadShedding(8) GetWeather(9) WebSearch(10) — 10 correct"

patterns-established:
  - "Orchestrator is the only file that imports @anthropic-ai/sdk — all LLM calls go through runOrchestrator()"
  - "Tool handlers are pure functions (no orchestrator state) — orchestrator wires them via executeTool()"
  - "Fallback strings are always sanitised — sanitiseForSpeech() called even on internal error strings"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03, AGENT-04]

# Metrics
duration: 13min
completed: 2026-03-28
---

# Phase 3 Plan 02: Claude Orchestrator Summary

**Manual tool-use agentic loop with 10 tool definitions, executeTool dispatcher, and sanitiseForSpeech on all return paths using claude-sonnet-4-6 via @anthropic-ai/sdk**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-28T08:30:33Z
- **Completed:** 2026-03-28T08:43:29Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files created:** 2

## Accomplishments

- `runOrchestrator(userId, transcript, signal)` implements the `while (stop_reason === 'tool_use')` agentic loop capped at MAX_TOOL_CALLS=10
- `ALL_TOOLS` array defines all 10 tool schemas for the Anthropic SDK (ReadMessages through WebSearch)
- `executeTool()` dispatcher routes all 10 tool names to the correct imported handler functions
- `ORCHESTRATOR_SYSTEM_PROMPT` enforces spoken-natural rules: no markdown, one question at a time, digit-by-digit phone numbers
- `sanitiseForSpeech()` called on every return path — end_turn text, fallback string, unknown stop_reason
- 21 orchestrator tests added; full test suite remains at same failure count as baseline (10 pre-existing Supabase-requiring tests)

## Task Commits

1. **Task 1: Claude orchestrator with manual tool-use loop** - `07a611b` (feat)

## Files Created/Modified

- `src/agent/orchestrator.ts` — runOrchestrator(), ALL_TOOLS, ORCHESTRATOR_SYSTEM_PROMPT, executeTool() — the agentic loop brain
- `tests/orchestrator.test.ts` — 21 tests covering end_turn, markdown sanitisation, tool_use loop, 10-call cap, model string, AbortSignal, system prompt, tool definitions

## Decisions Made

- **Lazy Anthropic singleton:** `_anthropic = null`, initialized in `getAnthropic()` on first call. Bun 1.3.x requires this because `mock.module('@anthropic-ai/sdk')` must execute before `new Anthropic()` is called — top-level instantiation would bypass the mock.
- **Minimal mock.module in tests:** Only `@anthropic-ai/sdk` is mocked at module level. Tool module mocks (`mock.module('../src/tools/whatsapp', ...)`) cause cross-file test contamination in Bun 1.3.x (module registry is shared across test files in a single process run). Removing tool module mocks eliminates regressions in whatsapp.test.ts and session.test.ts.
- **fetch-based tools for tool_use tests:** Tests that exercise the agentic loop use `GetLoadShedding` and `GetWeather` (which depend only on `globalThis.fetch`) rather than `ReadMessages` (which depends on supabase). This avoids needing a supabase mock while still testing the full loop.
- **ALL_TOOLS has 10 entries:** The plan said "9 tools" in the description but listed 10 names in the behavior spec. Counting confirms: ReadMessages, SendMessage, ResolveContact, GetContact, SaveContact, ListContacts, SetPriority, GetLoadShedding, GetWeather, WebSearch = 10. Tests verify `toHaveLength(10)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lazy Anthropic singleton required for test mock compatibility**
- **Found during:** Task 1 (GREEN phase — initial test run)
- **Issue:** Top-level `const anthropic = new Anthropic(...)` instantiated the real SDK before `mock.module('@anthropic-ai/sdk')` could intercept, causing 401 authentication errors in all tests
- **Fix:** Replaced with lazy singleton pattern: `let _anthropic: Anthropic | null = null; function getAnthropic() { ... }` — client created on first `getAnthropic()` call, not at module load
- **Files modified:** src/agent/orchestrator.ts
- **Verification:** bun test tests/orchestrator.test.ts passes; no HTTP calls to anthropic.com
- **Committed in:** 07a611b (Task 1 feat commit)

**2. [Rule 1 - Bug] Removed tool module mocks to prevent cross-file test contamination**
- **Found during:** Task 1 (full suite verification)
- **Issue:** `mock.module('../src/tools/whatsapp', ...)` and `mock.module('../src/session/machine', ...)` in orchestrator.test.ts persisted into whatsapp.test.ts and session.test.ts in Bun 1.3.x, causing 9 additional test failures (whatsapp/session real implementations replaced by orchestrator test mocks)
- **Fix:** Removed all tool and session module mocks from orchestrator.test.ts. Used `globalThis.fetch` mock for tools that only need fetch (GetLoadShedding, GetWeather). Real session machine and supabase client error gracefully without mocking.
- **Files modified:** tests/orchestrator.test.ts
- **Verification:** bun test exits with same 10 failures as baseline (pre-existing Supabase-requiring tests); no new regressions
- **Committed in:** 07a611b (Task 1 feat commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs discovered during TDD GREEN phase)
**Impact on plan:** Both fixes essential for correct test behavior. Implementation behavior unchanged from plan spec. All acceptance criteria met.

## Issues Encountered

- Bun 1.3.x on Windows shares module registry across test files in a single `bun test` run. `mock.module()` calls do not auto-reset between files. Solution: minimize `mock.module` surface area to only the SDK; use tools with graceful error handling for integration-style tests.

## Known Stubs

None — `runOrchestrator()` is fully wired with real tool handlers imported from 03-01. No placeholder return values or hardcoded responses.

## Next Phase Readiness

- `runOrchestrator(userId, transcript, signal)` is ready to be imported in Plan 03-03 (voice command route)
- The function accepts an `AbortSignal` — caller (the Hono route handler) should create `AbortSignal.timeout(5000)` for the 5-second deadline
- All 10 tools are wired; no missing dispatchers

---
*Phase: 03-agent-intelligence*
*Completed: 2026-03-28*
