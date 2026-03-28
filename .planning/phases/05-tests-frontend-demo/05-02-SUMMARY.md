---
phase: 05-tests-frontend-demo
plan: 02
subsystem: memory
tags: [episodic-memory, pgvector, openai, embeddings, MEM-01, MEM-02, MEM-03]
dependency_graph:
  requires: [supabase/migrations/002_functions.sql, src/db/client.ts, src/agent/orchestrator.ts]
  provides: [src/memory/embed.ts, src/memory/store.ts, src/memory/recall.ts]
  affects: [src/agent/orchestrator.ts, tests/orchestrator.test.ts]
tech_stack:
  added: [openai text-embedding-3-small, lazy OpenAI singleton pattern]
  patterns: [lazy singleton for testability, try/catch non-fatal degradation, pgvector RPC via supabase.rpc]
key_files:
  created:
    - src/memory/embed.ts
    - src/memory/store.ts
    - src/memory/recall.ts
    - tests/memory.test.ts
  modified:
    - src/agent/orchestrator.ts
    - tests/orchestrator.test.ts
decisions:
  - Lazy OpenAI singleton (_openai = null, getOpenAI() factory) required for Bun 1.3.x mock.module hoisting in tests
  - Memory recall wrapped in try/catch — failure is non-fatal, orchestrator continues with base system prompt
  - mock.module('../src/memory/recall') added to orchestrator.test.ts to prevent Bun single-process mock contamination
  - match_memories RPC called with p_user_id (not user_id) — matches Phase 1 SQL function parameter name
metrics:
  duration: 4min
  completed_date: "2026-03-28"
  tasks: 3
  files: 6
---

# Phase 5 Plan 02: Episodic Memory Module Summary

**One-liner:** pgvector episodic memory using OpenAI text-embedding-3-small with lazy singleton pattern and non-fatal orchestrator injection.

## What Was Built

The episodic memory subsystem stores and recalls past session context for the VoiceApp agent:

- `src/memory/embed.ts` — `generateEmbedding(text)` uses OpenAI `text-embedding-3-small` to produce 1536-dim vectors. Uses a lazy singleton (`_openai = null`) so Bun test mocks can intercept before first client creation.
- `src/memory/store.ts` — `storeMemory(userId, summary, embedding)` inserts to `memory_store` table with explicit `user_id` for app-layer isolation (service_role bypasses RLS).
- `src/memory/recall.ts` — `recallMemories(userId, query, topK=5)` embeds the query then calls `supabase.rpc('match_memories', ...)` with `match_threshold: 0.75`, `match_count: topK`, `p_user_id: userId`. Returns `MemoryRow[]` or `[]` on null data.
- `src/agent/orchestrator.ts` — Modified `runOrchestrator` to call `recallMemories(userId, transcript)` before the agentic loop and prepend memory context to the system prompt. Failure is caught silently — memory is an enhancement not a core path.
- `tests/memory.test.ts` — 5 unit tests covering MEM-01, MEM-02, MEM-03 with fully mocked OpenAI and Supabase clients.

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Create src/memory/ module (embed.ts, store.ts, recall.ts) | b1c3acc |
| 2 | Create tests/memory.test.ts covering MEM-01, MEM-02, MEM-03 | ebe4b63 |
| 3 | Wire memory injection into orchestrator.ts (MEM-03) | 4020f72 |

## Test Results

- `bun test tests/memory.test.ts` — 5 pass, 0 fail
- `bun test tests/orchestrator.test.ts` — 21 pass, 0 fail (no regressions)
- `bun test tests/orchestrator.test.ts tests/memory.test.ts` — 26 pass, 0 fail

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Mock contamination guard in orchestrator.test.ts**
- **Found during:** Task 3 verification (running both test files together)
- **Issue:** Bun 1.3.x single-process test runner causes mock.module declarations from memory.test.ts (openai, ../src/db/client) to leak into orchestrator.test.ts. The memory mock returns 2 rows, causing Test 8 ("calls anthropic.messages.create with ORCHESTRATOR_SYSTEM_PROMPT") to fail because the system prompt gets memory context appended.
- **Fix:** Added `mock.module('../src/memory/recall', () => ({ recallMemories: async () => [] }))` to orchestrator.test.ts — makes recallMemories return empty array so system prompt stays as `ORCHESTRATOR_SYSTEM_PROMPT` in that test suite.
- **Files modified:** tests/orchestrator.test.ts
- **Commit:** 4020f72

## Known Stubs

None — all memory functions are fully implemented with real OpenAI and Supabase calls.

## Self-Check: PASSED

All created files confirmed present. All task commits confirmed in git log.

| Check | Result |
|-------|--------|
| src/memory/embed.ts | FOUND |
| src/memory/store.ts | FOUND |
| src/memory/recall.ts | FOUND |
| tests/memory.test.ts | FOUND |
| Commit b1c3acc | FOUND |
| Commit ebe4b63 | FOUND |
| Commit 4020f72 | FOUND |
