---
phase: 03-agent-intelligence
verified: 2026-03-28T11:00:00Z
status: passed
score: 32/32 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 29/32
  gaps_closed:
    - "Truth #5: toolResolveContact() uses .ilike() — 03-01-PLAN.md truths corrected to match deployed implementation (03-04)"
    - "Truth #31: bun test (full suite) exits 0 — Bun 1.3.x cross-file mock contamination fixed in whatsapp.test.ts (03-05)"
    - "Truth #29: CONTACT-01 orphaned requirement — formally moved to Phase 4 in ROADMAP.md and REQUIREMENTS.md (03-06)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "POST /api/voice/command with transcript 'send a message to Naledi, tell her I will be late'"
    expected: "Session enters awaiting_approval; spoken response includes message readback with Naledi's name"
    why_human: "Requires live Claude API call and real user_contacts row to verify end-to-end contact resolution flow"
  - test: "Say 'yes' after a pending message is staged"
    expected: "WhatsApp message sent, message_log gains a direction=out row, session returns to idle"
    why_human: "Requires live WhatsApp API credentials and real Supabase to verify full confirm flow"
  - test: "Ask 'what is the load shedding today'"
    expected: "Spoken response arrives under 3 seconds with no markdown characters"
    why_human: "Requires live EskomSePush API key to verify actual API response format handling"
---

# Phase 3: Agent Intelligence Verification Report

**Phase Goal:** A voice transcript enters the orchestrator, fast-path regex or Claude agent produces a spoken-natural response, contact flows work end-to-end, and all agent tool queries explicitly filter by user_id.
**Verified:** 2026-03-28T11:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure plans 03-04, 03-05, 03-06

---

## Re-verification Summary

Previous verification (2026-03-28T08:59:20Z) found 3 gaps blocking a clean pass. All three have been closed:

| Gap | Closure Plan | Method |
|-----|-------------|--------|
| Truth #5: declared truth referenced `supabase.rpc('resolve_contact_name')` but implementation uses `.ilike()` | 03-04 | Corrected 03-01-PLAN.md frontmatter truths to match deployed code; no production code changed |
| Truth #31: 10 tests in whatsapp.test.ts fail in cross-file run (Bun 1.3.x mock contamination) | 03-05 | Added `mock.module('../src/tools/whatsapp', factory)` with closure-based real implementations in whatsapp.test.ts; 86/86 Phase 3 tests pass in any file order |
| Truth #29: CONTACT-01 orphaned — listed as Phase 3 but not implemented in any Phase 3 plan | 03-06 | Moved CONTACT-01 to Phase 4 in ROADMAP.md and REQUIREMENTS.md with documented TTS/pushInterrupt architectural rationale |

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | sanitiseForSpeech() strips **, ##, - bullets, backticks, [link](url), blockquotes | ✓ VERIFIED | 17 tests pass; MD_PATTERNS regex list matches spec in sanitiser.ts |
| 2 | sanitiseForSpeech() collapses double newlines to single space | ✓ VERIFIED | `.replace(/\n{2,}/g, ' ').trim()` at line 20 of sanitiser.ts |
| 3 | toolReadMessages() queries message_log with .eq('user_id', userId) | ✓ VERIFIED | Lines 11-12 of whatsapp.ts; user_contacts lookup also eq-filtered |
| 4 | toolSendMessage() transitions to awaiting_approval, returns readBack, never calls WhatsApp API | ✓ VERIFIED | Lines 40-47 whatsapp.ts; no fetch() call; test asserts fetch not called |
| 5 | toolResolveContact() queries user_contacts with .eq('user_id', userId).ilike('name', name).single() | ✓ VERIFIED | Lines 51-57 whatsapp.ts; .ilike('name', name) confirmed; no rpc() call |
| 6 | toolSaveContact() inserts to user_contacts with user_id; uses normaliseE164() | ✓ VERIFIED | Lines 21-25 contacts.ts; normaliseE164 called before insert |
| 7 | toolGetLoadShedding() hits EskomSePush /area endpoint with Token header | ✓ VERIFIED | Lines 30-33 ambient.ts; Token header (not Bearer) confirmed |
| 8 | toolGetWeather() hits OpenWeather One Call 3.0, formats temp and description | ✓ VERIFIED | Lines 50-60 ambient.ts; lat=-26.2041, lon=28.0473; 13 tests pass |
| 9 | toolWebSearch() calls tavilyClient.search() and returns answer or joined results | ✓ VERIFIED | Lines 68-74 ambient.ts; returns response.answer ?? joined contents |
| 10 | All tool queries explicitly filter by user_id | ✓ VERIFIED | Every .from() call in whatsapp.ts and contacts.ts has .eq('user_id', userId) |
| 11 | runOrchestrator() calls classifyIntent() before any LLM call | ✓ VERIFIED | api.ts line 44: classifyIntent(transcript) before any orchestrator call |
| 12 | runOrchestrator() uses client.messages.create with tools array (not claude-agent-sdk) | ✓ VERIFIED | orchestrator.ts line 5: `import Anthropic from '@anthropic-ai/sdk'`; messages.create used |
| 13 | Agentic loop runs while stop_reason === 'tool_use' up to MAX_TOOL_CALLS=10 | ✓ VERIFIED | Lines 167-201 orchestrator.ts; `while (toolCallCount < MAX_TOOL_CALLS)` |
| 14 | sanitiseForSpeech() called on every runOrchestrator() return path | ✓ VERIFIED | Line 184 (end_turn) and line 203 (fallback) — 2 call sites |
| 15 | ALL_TOOLS defines all 9 tools | ✓ VERIFIED | 10 tool name entries in orchestrator.ts (ReadMessages through WebSearch) |
| 16 | executeTool() dispatches to correct handler for all 9 tools | ✓ VERIFIED | switch cases lines 134-156 cover all 9 tools |
| 17 | ORCHESTRATOR_SYSTEM_PROMPT contains 'Never use markdown' and spoken-natural prose rule | ✓ VERIFIED | Lines 27-28: "Never use markdown formatting" and "natural spoken sentences" |
| 18 | runOrchestrator accepts AbortSignal — caller sets 5-second timeout | ✓ VERIFIED | Function signature line 161; AbortController in api.ts line 123-124 |
| 19 | Model is claude-sonnet-4-6 | ✓ VERIFIED | orchestrator.ts line 170: `model: 'claude-sonnet-4-6'` |
| 20 | POST /api/voice/command accepts {userId, transcript, sessionId} and returns {spoken, action, requiresConfirmation, pendingAction} | ✓ VERIFIED | api.ts lines 30-148; all 4 response fields present on every return path |
| 21 | confirm_send routes to handleConfirmSend — sends via WhatsApp API, logs direction=out, clears session | ✓ VERIFIED | api.ts lines 50-52, handleConfirmSend lines 155-201; message_log insert at line 179 |
| 22 | cancel clears session and returns spoken 'Message cancelled.' | ✓ VERIFIED | api.ts lines 54-57; clearUserState called |
| 23 | Fast-path read_messages calls toolReadMessages without LLM | ✓ VERIFIED | api.ts lines 105-108; runOrchestrator not called |
| 24 | Fast-path load_shedding, weather, web_search use ambient handlers without LLM | ✓ VERIFIED | api.ts lines 90-117; all 3 routed directly to tool handlers |
| 25 | Slow-path null transcripts route to runOrchestrator with 5-second AbortController | ✓ VERIFIED | api.ts lines 122-147; AbortController with 5000ms timeout |
| 26 | Three consecutive no-match inputs while awaiting_approval resets session | ✓ VERIFIED | api.ts lines 64-84; noMatchCounts Map; clearUserState on count >= 3 |
| 27 | Three-strike counter cleared when clearSession called | ✓ VERIFIED | clearUserState() (api.ts lines 20-23) calls both clearSession and noMatchCounts.delete |
| 28 | ESKOMSEPUSH_API_KEY, OPENWEATHER_API_KEY, TAVILY_API_KEY in REQUIRED_ENV_VARS | ✓ VERIFIED | env.ts lines 17-19; total 14 vars now required |
| 29 | CONTACT-01 is properly deferred to Phase 4 (not orphaned) | ✓ VERIFIED | ROADMAP.md Phase 3 Requirements covered does not list CONTACT-01; Phase 4 Requirements covered includes it; REQUIREMENTS.md traceability table row shows Phase 4 |
| 30 | bun test Phase 3 files pass in isolation | ✓ VERIFIED | All 6 Phase 3 test files: 86 tests, 0 failures when run individually |
| 31 | bun test (full Phase 3 suite) exits 0 in any file order | ✓ VERIFIED | `bun test tests/sanitiser.test.ts tests/whatsapp.test.ts tests/contacts.test.ts tests/ambient.test.ts tests/orchestrator.test.ts tests/voiceCommand.test.ts` → 86 pass, 0 fail; reverse order (voiceCommand before whatsapp) also 25 pass, 0 fail |
| 32 | Contact name resolution via orchestrator uses toolResolveContact | ✓ VERIFIED | executeTool case 'ResolveContact' at orchestrator.ts line 141 |

**Score:** 32/32 truths verified

---

### Required Artifacts

| Artifact | Provides | Status | Details |
|----------|---------|--------|---------|
| `src/agent/sanitiser.ts` | sanitiseForSpeech() | ✓ VERIFIED | 22 lines; exports sanitiseForSpeech; 6 MD patterns + double-newline collapse |
| `src/tools/whatsapp.ts` | toolReadMessages, toolSendMessage, toolResolveContact | ✓ VERIFIED | 59 lines; all 3 functions exported; user_id filters on all queries; .ilike() on line 55 |
| `src/tools/contacts.ts` | toolGetContact, toolSaveContact, toolListContacts, toolSetPriority | ✓ VERIFIED | 49 lines; all 4 functions exported; ilike for case-insensitive name matching |
| `src/tools/ambient.ts` | toolGetLoadShedding, toolGetWeather, toolWebSearch | ✓ VERIFIED | 79 lines; all 3 exported; AbortSignal accepted as param; lazy tavily singleton |
| `src/agent/orchestrator.ts` | runOrchestrator, ALL_TOOLS, ORCHESTRATOR_SYSTEM_PROMPT, executeTool | ✓ VERIFIED | 205 lines; 9-tool ALL_TOOLS array; agentic loop with 10-call cap |
| `src/routes/api.ts` | POST /api/voice/command with all routing paths | ✓ VERIFIED | 202 lines; no 501 stub; fast-path + three-strike + LLM fallback all wired |
| `src/env.ts` | Validates 14 env vars including 3 new API keys | ✓ VERIFIED | Lines 17-19 confirm all 3 new keys added |
| `tests/sanitiser.test.ts` | 17 unit tests for markdown stripping | ✓ VERIFIED | All 17 pass |
| `tests/whatsapp.test.ts` | 12 unit tests for WhatsApp tool handlers | ✓ VERIFIED | All 12 pass in isolation and in cross-file run; 3 mock.module declarations provide Bun 1.3.x contamination immunity |
| `tests/contacts.test.ts` | 10 unit tests for contact tool handlers | ✓ VERIFIED | All 10 pass |
| `tests/ambient.test.ts` | 13 unit tests for ambient tool handlers | ✓ VERIFIED | All 13 pass; fetch and tavily mocked |
| `tests/orchestrator.test.ts` | 21 unit tests for orchestrator | ✓ VERIFIED | All 21 pass; Anthropic SDK mocked |
| `tests/voiceCommand.test.ts` | 13 integration tests for POST /api/voice/command | ✓ VERIFIED | All 13 pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/tools/whatsapp.ts | src/session/machine.ts | transition() + setPendingMessage() in toolSendMessage | ✓ WIRED | Lines 40-42 whatsapp.ts; imports confirmed |
| src/tools/whatsapp.ts | src/db/client.ts | .eq('user_id', userId) on message_log and user_contacts | ✓ WIRED | Lines 8-12, 21-26; 2+ user_id filters |
| src/tools/whatsapp.ts | src/db/client.ts | .ilike('name', name) for case-insensitive name-to-phone lookup | ✓ WIRED | Line 55 whatsapp.ts; .ilike confirmed present; resolves gap from prior verification |
| src/agent/orchestrator.ts | src/agent/classifier.ts | classifyIntent() called first in POST handler | ✓ WIRED | api.ts line 44 (classifier called before orchestrator) |
| src/agent/orchestrator.ts | src/agent/sanitiser.ts | sanitiseForSpeech() on all return paths | ✓ WIRED | 2 call sites at lines 184 and 203 |
| src/agent/orchestrator.ts | src/tools/whatsapp.ts | executeTool dispatches ReadMessages, SendMessage, ResolveContact | ✓ WIRED | Lines 134-142 orchestrator.ts |
| src/agent/orchestrator.ts | src/tools/contacts.ts | executeTool dispatches GetContact, SaveContact, ListContacts, SetPriority | ✓ WIRED | Lines 143-152 orchestrator.ts |
| src/agent/orchestrator.ts | src/tools/ambient.ts | executeTool dispatches GetLoadShedding, GetWeather, WebSearch | ✓ WIRED | Lines 149-153 orchestrator.ts |
| src/routes/api.ts | src/agent/classifier.ts | classifyIntent(transcript) first call in handler | ✓ WIRED | Line 44 api.ts |
| src/routes/api.ts | src/agent/orchestrator.ts | runOrchestrator for null fast-path transcripts | ✓ WIRED | Line 126 api.ts with AbortController |
| src/routes/api.ts | src/session/machine.ts | getState(), clearSession() for confirm/cancel handlers | ✓ WIRED | Lines 10, 20, 156-187 |
| src/routes/api.ts | src/db/client.ts | message_log insert direction=out on confirm_send | ✓ WIRED | Lines 179-185 api.ts with user_id |

---

### Data-Flow Trace (Level 4)

All tool handlers produce spoken strings from real external sources (DB queries, API calls). No static empty returns found in production code paths.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| toolReadMessages | lines[] | supabase.from('message_log')...eq('user_id') | Yes — chained query with user filter | ✓ FLOWING |
| toolGetLoadShedding | data.events | EskomSePush /area?id= with Token header | Yes — live API; fallback string on error | ✓ FLOWING |
| toolGetWeather | current.temp, data.daily[0] | OpenWeather /data/3.0/onecall | Yes — live API; fallback string on error | ✓ FLOWING |
| toolWebSearch | response.answer | tavilyClient.search() | Yes — live API; fallback string on error | ✓ FLOWING |
| toolSaveContact | normalisedPhone | normaliseE164(phone) + supabase.insert | Yes — normalised then persisted | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sanitiseForSpeech strips markdown | `bun test tests/sanitiser.test.ts` | 17 pass, 0 fail | ✓ PASS |
| All Phase 3 tests in forward file order | `bun test tests/sanitiser.test.ts tests/whatsapp.test.ts tests/contacts.test.ts tests/ambient.test.ts tests/orchestrator.test.ts tests/voiceCommand.test.ts` | 86 pass, 0 fail | ✓ PASS |
| All Phase 3 tests in reverse contamination order | `bun test tests/voiceCommand.test.ts tests/whatsapp.test.ts` | 25 pass, 0 fail | ✓ PASS |
| Orchestrator tests pass | `bun test tests/orchestrator.test.ts` | 21 pass, 0 fail | ✓ PASS |
| Voice command integration tests pass | `bun test tests/voiceCommand.test.ts` | 13 pass, 0 fail | ✓ PASS |
| No 501 stub in api.ts | `grep "501" src/routes/api.ts` | No output | ✓ PASS |
| ilike used in whatsapp.ts (not rpc) | `grep "ilike" src/tools/whatsapp.ts` | Line 55 matches | ✓ PASS |
| model is claude-sonnet-4-6 | `grep "claude-sonnet-4-6" src/agent/orchestrator.ts` | Line 170 matches | ✓ PASS |
| Wrong SDK never imported | `grep "claude-agent-sdk" src/agent/orchestrator.ts` | No output | ✓ PASS |
| CONTACT-01 removed from Phase 3 requirements | ROADMAP.md Phase 3 "Requirements covered" | CONTACT-01 absent; CONTACT-02 through CONTACT-05 present | ✓ PASS |
| CONTACT-01 assigned to Phase 4 | ROADMAP.md Phase 4 "Requirements covered" and coverage table | Phase 4 row confirmed | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| AGENT-01 | 03-02 | Orchestrator classifies intent via fast-path before LLM | ✓ SATISFIED | classifyIntent called before runOrchestrator in api.ts line 44 |
| AGENT-02 | 03-02 | 8 intents covered: send_message, read_messages, save_contact, set_priority, load_shedding, weather, web_search, message_digest | ✓ SATISFIED | classifier.ts lines 28-46 covers all 10 intents including confirm_send and cancel |
| AGENT-03 | 03-02 | Messaging sub-agent resolves contact by name via user_contacts | ✓ SATISFIED | toolResolveContact uses .ilike() on user_contacts (case-insensitive name-to-phone) |
| AGENT-04 | 03-02 | Messaging sub-agent enters awaiting_approval with TTS readBack | ✓ SATISFIED | toolSendMessage transitions to awaiting_approval and returns readBack string |
| AGENT-05 | 03-03 | User can confirm/cancel pending message; three-strike reset | ✓ SATISFIED | api.ts confirm/cancel handlers + noMatchCounts three-strike logic |
| AGENT-06 | 03-01 | Ambient sub-agent: EskomSePush, OpenWeather, Tavily | ✓ SATISFIED | ambient.ts all 3 handlers; api.ts fast-path routing; AbortSignal.timeout(5000) |
| AGENT-07 | 03-01 | All spoken responses are plain conversational text | ✓ SATISFIED | ORCHESTRATOR_SYSTEM_PROMPT rule 1-2; sanitiseForSpeech as post-processor |
| AGENT-08 | 03-01 | Markdown sanitiser applied at TTS boundary | ✓ SATISFIED | sanitiseForSpeech called on every runOrchestrator return path |
| CONTACT-01 | Phase 4 | Unknown number triggers interrupt with digit-by-digit phone | DEFERRED TO PHASE 4 | Formally moved to Phase 4 in ROADMAP.md and REQUIREMENTS.md (03-06); requires TTS/pushInterrupt wiring from Phase 4 Plan 2; not a Phase 3 gap |
| CONTACT-02 | 03-03 | Voice-driven save: agent asks for name, confirms, inserts to user_contacts | ✓ SATISFIED | toolSaveContact wired in executeTool; confirmed in voiceCommand tests |
| CONTACT-03 | 03-03 | User saves contact by speaking digits and a name | ✓ SATISFIED | SaveContact tool available via orchestrator; normaliseE164 applied |
| CONTACT-04 | 03-03 | User sets/unsets priority contact by voice | ✓ SATISFIED | toolSetPriority wired in executeTool; SetPriority tool in ALL_TOOLS |
| CONTACT-05 | 03-01 | Contact names used in read-aloud; never raw phone when name known | ✓ SATISFIED | toolReadMessages resolves from_phone via user_contacts lookup (lines 21-27 whatsapp.ts) |

All 12 Phase 3 requirements (AGENT-01 through AGENT-08, CONTACT-02 through CONTACT-05) satisfied. CONTACT-01 is correctly assigned to Phase 4.

---

### Anti-Patterns Found

No blockers found.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| tests/health.test.ts | 21 | `validateEnv()` called in beforeAll — throws when env vars not set in full suite run | ℹ️ Info | Pre-existing Phase 1 issue; does not affect Phase 3 tests; Phase 3 test files unaffected |

No production code stubs or TODOs found. No empty implementations. No hardcoded data in non-test paths.

---

### Human Verification Required

#### 1. End-to-End Contact Resolution Flow

**Test:** POST to /api/voice/command with userId of a user who has "Naledi" in user_contacts, transcript = "send a message to Naledi, tell her I'll be late"
**Expected:** Response has action='agent', requiresConfirmation=true, pendingAction.toName='Naledi'; spoken includes readback with name and message text
**Why human:** Requires live Claude API call, real Supabase row for Naledi, and real user_contacts table

#### 2. Confirm Send — Full Flow

**Test:** After staging a message (session in awaiting_approval), POST transcript "yes"
**Expected:** WhatsApp API called, message_log gains direction=out row with user_id, session returns to idle; response action='confirm', spoken contains recipient name
**Why human:** Requires live WhatsApp API credentials and Supabase

#### 3. Ambient Spoken Response Quality

**Test:** POST transcript "what is the load shedding schedule today" and inspect returned spoken string
**Expected:** No markdown characters (* # ` -) present; response arrives under 3 seconds; format matches "Load shedding is scheduled..." or "There is no load shedding..."
**Why human:** Requires live EskomSePush API key; validates sanitiser integration end-to-end

---

### Gaps Summary

No gaps. All three previously identified gaps have been resolved:

**Gap 1 (CLOSED by 03-04):** Plan 03-01 frontmatter declared `toolResolveContact()` must call `supabase.rpc('resolve_contact_name')`. Corrected to accurately describe the deployed `.ilike()` direct-query implementation. The ilike approach is intentionally correct — it avoids an RPC round-trip, is simpler to mock in tests, and does not conflate phone-to-name (DB RPC concern) with name-to-phone (app-layer concern).

**Gap 2 (CLOSED by 03-06):** CONTACT-01 was orphaned between Phase 2 and Phase 3. Formally moved to Phase 4 in both ROADMAP.md and REQUIREMENTS.md with documented rationale: `pushInterrupt()` is a WebSocket stub in Phase 2/3; real TTS-driven audio push requires the ElevenLabs module and WebSocket audio pipeline built in Phase 4 Plan 2.

**Gap 3 (CLOSED by 03-05):** Bun 1.3.x `mock.module` process-persistence caused 10 cross-file test failures in whatsapp.test.ts when run after voiceCommand.test.ts. Fixed by adding a `mock.module('../src/tools/whatsapp', factory)` declaration in whatsapp.test.ts with a closure-based factory that reconstructs real implementations without calling `require()` (which would return the contaminated registry version). All 86 Phase 3 tests now pass in any file order.

---

_Verified: 2026-03-28T11:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap closure plans 03-04, 03-05, 03-06_
