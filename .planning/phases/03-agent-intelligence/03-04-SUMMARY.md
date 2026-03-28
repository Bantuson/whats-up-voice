---
phase: 03-agent-intelligence
plan: 04
subsystem: documentation
tags: [planning, truths, verification, gap-closure]

# Dependency graph
requires:
  - phase: 03-agent-intelligence-01
    provides: "03-01-PLAN.md with must_haves truths and key_links"
provides:
  - "03-01-PLAN.md truths now accurately describe .ilike() name-to-phone lookup"
  - "key_links entry updated from contacts.ts/resolve_contact_name to whatsapp.ts/.ilike()"
  - "Verification gap 1 (declared truth mismatch) eliminated"
affects: [03-agent-intelligence-verification, 03-VERIFICATION.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan truths must describe deployed code, not design intent — ilike direct query preferred over RPC for name-to-phone lookup"

key-files:
  created: []
  modified:
    - ".planning/phases/03-agent-intelligence/03-01-PLAN.md"

key-decisions:
  - "ilike direct query on user_contacts is the intentional chosen strategy for name-to-phone resolution — avoids RPC round-trip, simpler to mock in tests, does not confuse phone-to-name (DB RPC) with name-to-phone (app layer)"
  - "resolve_contact_name SQL function handles phone-to-name lookup; toolResolveContact handles name-to-phone — these are distinct operations at different layers"

patterns-established:
  - "Pattern: Plan declared truths must reflect deployed implementation, not design artefacts from earlier drafts"

requirements-completed:
  - AGENT-03
  - CONTACT-02
  - CONTACT-03
  - CONTACT-04
  - CONTACT-05

# Metrics
duration: 3min
completed: 2026-03-28
---

# Phase 3 Plan 04: Correct 03-01-PLAN.md ilike Truth Summary

**Corrected three stale must_haves truths in 03-01-PLAN.md — replaced resolve_contact_name RPC declarations with accurate .ilike() direct-query truths matching deployed whatsapp.ts implementation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T09:00:00Z
- **Completed:** 2026-03-28T09:03:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Replaced truth declaring `supabase.rpc('resolve_contact_name')` with accurate `.eq('user_id', userId).ilike('name', name).single()` truth
- Replaced second stale RPC truth with accurate explanation distinguishing phone-to-name (DB RPC) from name-to-phone (app layer ilike)
- Updated key_links entry from `src/tools/contacts.ts / resolve_contact_name` to `src/tools/whatsapp.ts / .ilike('name')`
- Re-verification of truth #5 will now pass — declared truth matches deployed code on whatsapp.ts line 55

## Task Commits

Each task was committed atomically:

1. **Task 1: Correct 03-01-PLAN.md declared truths to match ilike implementation** - `8ea2606` (docs)

## Files Created/Modified

- `.planning/phases/03-agent-intelligence/03-01-PLAN.md` - Corrected three frontmatter entries (lines 29, 35, 70-73) to match deployed ilike implementation; no other sections changed

## Decisions Made

- ilike approach is intentionally correct and preferable to RPC: avoids a round-trip, simpler to mock in tests, does not depend on the `resolve_contact_name` SQL function which was designed for phone-to-name lookup (not name-to-phone)
- The `resolve_contact_name` SQL function is retained in the schema for its original purpose (phone-to-name lookup in DB layer); it is simply not called by `toolResolveContact`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 03-01-PLAN.md now accurately describes deployed implementation
- Re-running 03-VERIFICATION.md truth check for truth #5 should now pass
- Gap 1 from 03-VERIFICATION.md is resolved

---
*Phase: 03-agent-intelligence*
*Completed: 2026-03-28*
