---
plan: 3
phase: 1
title: Session State Machine + Intent Classifier
wave: 1
depends_on: none
files_modified:
  - src/session/machine.ts
  - src/agent/classifier.ts
  - src/lib/phone.ts
  - src/lib/errors.ts
  - tests/session.test.ts
  - tests/classifier.test.ts
  - tests/phone.test.ts
requirements:
  - INFRA-06
  - ISO-01
  - ISO-02
autonomous: true
must_haves:
  truths:
    - "transition(userId, 'idle → awaiting_approval') throws an error (invalid transition)"
    - "transition(userId, 'idle → listening') succeeds and getPhase(userId) returns 'listening'"
    - "All 5 valid states exist as SessionPhase type: idle, listening, composing, awaiting_approval, playing"
    - "classifyIntent('read my messages') returns 'read_messages' without any LLM call"
    - "classifyIntent('LOAD SHEDDING TODAY') returns 'load_shedding' (case-insensitive)"
    - "classifyIntent('blah blah unintelligible') returns null (falls through to LLM)"
    - "normaliseE164('0821234567') returns '+27821234567'"
    - "normaliseE164('27821234567') returns '+27821234567'"
    - "formatPhoneForSpeech('+27821234567') returns '0 8 2 1 2 3 4 5 6 7'"
    - "All agent tool queries that use the supabase client include .eq('user_id', userId) — enforced by convention and tested in isolation.test.ts"
  artifacts:
    - path: "src/session/machine.ts"
      provides: "SessionPhase type, SessionState interface, transition(), getState(), getPhase(), setPendingMessage(), clearSession()"
      exports: ["transition", "getState", "getPhase", "setPendingMessage", "clearSession", "SessionPhase", "SessionState"]
    - path: "src/agent/classifier.ts"
      provides: "FastPathIntent type, classifyIntent() function with 10 regex patterns"
      exports: ["classifyIntent", "FastPathIntent"]
    - path: "src/lib/phone.ts"
      provides: "normaliseE164(), formatPhoneForSpeech()"
      exports: ["normaliseE164", "formatPhoneForSpeech"]
    - path: "src/lib/errors.ts"
      provides: "spokenError() utility for TTS-ready error messages"
      exports: ["spokenError"]
  key_links:
    - from: "src/session/machine.ts"
      to: "TRANSITIONS lookup table"
      via: "transition() guard — throws if next not in TRANSITIONS[current]"
      pattern: "TRANSITIONS\\[current\\]"
    - from: "src/agent/classifier.ts"
      to: "FAST_PATH array"
      via: "classifyIntent() iterates FAST_PATH and returns first match"
      pattern: "for.*FAST_PATH"
---

# Plan 3: Session State Machine + Intent Classifier

## Objective

Implement the two pure-logic modules that every agent flow in Phases 2–4 depends on: the session state machine (explicit transition guard with 5 states) and the fast-path intent classifier (10 regex patterns evaluated before any LLM call). Also adds the phone utility and error utility that surface throughout the voice flow.

All modules are pure TypeScript — no external dependencies, no I/O, no Supabase calls. This makes them fast to implement, easy to unit test, and independently verifiable with `bun test` before the server is even running.

## must_haves

- `TRANSITIONS` map defines exactly these allowed transitions and no others:
  - `idle → ['listening']`
  - `listening → ['composing', 'idle']`
  - `composing → ['awaiting_approval', 'playing', 'idle']`
  - `awaiting_approval → ['playing', 'idle']`
  - `playing → ['idle']`
- `transition()` throws `Error: Invalid session transition for ${userId}: ${current} → ${next}` on disallowed transitions (exact format tested in session.test.ts)
- `classifyIntent()` evaluates patterns in this exact priority order: confirm_send, cancel, message_digest, send_message, read_messages, save_contact, set_priority, load_shedding, weather, web_search
- `classifyIntent()` returns `null` for any transcript not matching a pattern (never returns undefined)
- All 10 regex patterns are case-insensitive (`/i` flag)

## Wave

Wave 1 — no dependencies on Plan 1 (Supabase) or Plan 2 (server). All three Wave 1 plans run in parallel. This plan's outputs are consumed by Plan 2's server scaffold (classifier imported in Phase 3) and the session machine is imported wherever agent code runs.

## Prerequisites

- `src/session/`, `src/agent/`, `src/lib/` directories exist (created in Plan 2 Task 1)
- `tests/` directory exists (created in Plan 2 Task 1)
- If running in parallel with Plan 2: create the directories in this plan if they do not exist yet

## Tasks

<task id="1-03-01">
<title>Create src/session/machine.ts, src/lib/phone.ts, and src/lib/errors.ts</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pattern 3 (session state machine, lines 200–273); use the code verbatim; the TRANSITIONS table and exact error message format are tested
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pattern 6 (E.164 normalisation, lines 366–398); Pattern 7 (spokenError, lines 402–413)
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pitfall 4 (idle → awaiting_approval must throw, lines 759–763)
</read_first>
<action>
Create all three files exactly as specified.

**File 1: src/session/machine.ts**

```typescript
// src/session/machine.ts
// Session state machine for voice interaction flow.
// Uses a plain Map — no XState, no external library (50KB overhead not justified for 5 states).
//
// Valid transitions:
//   idle              → listening
//   listening         → composing, idle (on error/timeout)
//   composing         → awaiting_approval, playing, idle (on error)
//   awaiting_approval → playing, idle (on cancel/timeout)
//   playing           → idle
//
// INVALID EXAMPLE: idle → awaiting_approval (throws — agent must compose before approval)

export type SessionPhase =
  | 'idle'
  | 'listening'
  | 'composing'
  | 'awaiting_approval'
  | 'playing'

export interface SessionState {
  phase: SessionPhase
  pendingMessage?: { to: string; toName?: string; body: string }
  lastActivity: number
}

const sessions = new Map<string, SessionState>()

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle:              ['listening'],
  listening:         ['composing', 'idle'],
  composing:         ['awaiting_approval', 'playing', 'idle'],
  awaiting_approval: ['playing', 'idle'],
  playing:           ['idle'],
}

export function transition(userId: string, next: SessionPhase): void {
  const current = sessions.get(userId)?.phase ?? 'idle'
  const allowed = TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(`Invalid session transition for ${userId}: ${current} → ${next}`)
  }
  const existing = sessions.get(userId)
  sessions.set(userId, {
    ...(existing ?? {}),
    phase: next,
    lastActivity: Date.now(),
  })
}

export function getState(userId: string): SessionState {
  return sessions.get(userId) ?? { phase: 'idle', lastActivity: Date.now() }
}

export function getPhase(userId: string): SessionPhase {
  return getState(userId).phase
}

export function setPendingMessage(
  userId: string,
  msg: { to: string; toName?: string; body: string }
): void {
  const s = getState(userId)
  sessions.set(userId, { ...s, pendingMessage: msg, lastActivity: Date.now() })
}

export function clearSession(userId: string): void {
  sessions.delete(userId)
}
```

**File 2: src/lib/phone.ts**

```typescript
// src/lib/phone.ts
// ISO-02: Every inbound phone number is normalised to E.164 before any DB lookup or upsert.
// WhatsApp sends numbers without the + prefix (e.g. "27821234567").
// Local SA numbers arrive as "0821234567" (10 digits, leading 0).

/**
 * Normalise a phone number to E.164 format.
 * Handles:
 *   "+27821234567" → "+27821234567" (already E.164, returned as-is)
 *   "27821234567"  → "+27821234567" (WhatsApp omits the +)
 *   "0821234567"   → "+27821234567" (local SA format)
 *   "821234567"    → "+821234567"   (bare digits, + prepended)
 */
export function normaliseE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) {
    // Local SA format: 0821234567 → +27821234567
    return `+27${digits.slice(1)}`
  }
  if (!raw.startsWith('+')) {
    return `+${digits}`
  }
  return raw.startsWith('+') ? raw : `+${digits}`
}

/**
 * Format a phone number for spoken TTS output.
 * Converts to local format then spaces each digit.
 * +27821234567 → "0 8 2 1 2 3 4 5 6 7"
 * Users hear individual digits, not a cardinal number like "eight hundred million".
 * CONTACT-01 requirement: unknown numbers are spoken digit-by-digit.
 */
export function formatPhoneForSpeech(e164: string): string {
  const local = e164.startsWith('+27') ? '0' + e164.slice(3) : e164.replace(/^\+/, '')
  return local.split('').join(' ')
}
```

**File 3: src/lib/errors.ts**

```typescript
// src/lib/errors.ts
// TTS-ready spoken error messages for all unhappy paths in the voice flow.
// Using a shared utility ensures consistent phrasing across all error paths.
// Every place that would speak an error to the user calls spokenError().

/**
 * Returns a TTS-safe spoken error string.
 * @param context - human-readable description of what failed, e.g. "sending your message"
 * @returns spoken string like "Sorry, I had a problem with sending your message. Please try again."
 */
export function spokenError(context: string): string {
  return `Sorry, I had a problem with ${context}. Please try again.`
}
```
</action>
<acceptance_criteria>
- `src/session/machine.ts` exists
- `grep "TRANSITIONS" src/session/machine.ts` finds the lookup table
- `grep "'idle':.*\['listening'\]" src/session/machine.ts` confirms idle only allows listening
- `grep "awaiting_approval.*playing.*idle" src/session/machine.ts` confirms awaiting_approval allows playing and idle
- `grep "Invalid session transition for" src/session/machine.ts` confirms exact error message string
- `grep "export.*transition\|export.*getState\|export.*getPhase\|export.*setPendingMessage\|export.*clearSession" src/session/machine.ts | wc -l` outputs `5`
- `src/lib/phone.ts` exists
- `grep "normaliseE164\|formatPhoneForSpeech" src/lib/phone.ts | wc -l` outputs at least `4` (declaration + usage in each)
- `grep "startsWith\('+27'\)" src/lib/phone.ts` confirms SA-specific local format handling
- `src/lib/errors.ts` exists
- `grep "Sorry, I had a problem with" src/lib/errors.ts` confirms the exact spoken error template
</acceptance_criteria>
</task>

<task id="1-03-02">
<title>Create src/agent/classifier.ts</title>
<read_first>
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — Pattern 4 (fast-path classifier, lines 277–337); use the FAST_PATH array verbatim; includes 10 patterns (8 AGENT-02 intents + confirm_send + cancel)
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-RESEARCH.md — note on lines 293–296 explaining why confirm_send and cancel are included even though AGENT-02 lists 8 — the approval loop needs them in Phase 3
</read_first>
<action>
Create `src/agent/classifier.ts` exactly as follows:

```typescript
// src/agent/classifier.ts
// Fast-path intent classifier — evaluated BEFORE any LLM invocation.
// Returns an intent string in < 1ms for the 10 covered patterns.
// Returns null for unknown transcripts — caller routes to Claude orchestrator.
//
// Pattern evaluation order matters:
//   1. confirm_send / cancel — short utterances, must be checked first to avoid
//      "yes" matching a later broader pattern
//   2. message_digest — checked before send/read to avoid "what did I miss" hitting send_message
//   3. send_message — before read_messages (avoids "send me my messages" misfiring)
//   4. read_messages, save_contact, set_priority, ambient (load_shedding, weather, web_search)
//
// AGENT-02 requires 8 intents; classifier also covers confirm_send + cancel (approval loop)
// Target: < 1ms per call (pure regex, no I/O, no await)

export type FastPathIntent =
  | 'confirm_send'
  | 'cancel'
  | 'send_message'
  | 'read_messages'
  | 'save_contact'
  | 'set_priority'
  | 'load_shedding'
  | 'weather'
  | 'web_search'
  | 'message_digest'

const FAST_PATH: Array<[RegExp, FastPathIntent]> = [
  // Confirmation loop — checked first (short utterances, no ambiguity)
  [/^(yes|yep|yeah|confirm|send it|go ahead|do it)\.?$/i, 'confirm_send'],
  [/^(no|nope|cancel|stop|don't send|abort|never mind)\.?$/i, 'cancel'],
  // Message digest — before send/read to avoid overlap
  [/digest|summary|what did i miss|overnight messages?/i, 'message_digest'],
  // Send message — before read (avoids "send me my messages" firing read_messages)
  [/send (a )?message to|message |text |whatsapp /i, 'send_message'],
  // Read messages
  [/read (my |new )?messages?|any new messages?|what messages?|my messages?/i, 'read_messages'],
  // Contact management
  [/save (a )?contact|add (a )?contact|save .+ as (a )?contact|add .+ as (a )?contact/i, 'save_contact'],
  [/make .+ (a )?priority|set .+ as priority|priority contact/i, 'set_priority'],
  // Ambient queries
  [/load.?shed|eskom|power cut|power outage|loadshed/i, 'load_shedding'],
  [/weather|temperature|rain|forecast|hot today|cold today|how warm|how cold/i, 'weather'],
  [/search for|look up|google|find out|tell me about|what is /i, 'web_search'],
]

/**
 * Classify a voice transcript to a fast-path intent.
 * @returns intent string if a pattern matches, or null to fall through to LLM
 */
export function classifyIntent(transcript: string): FastPathIntent | null {
  const t = transcript.trim()
  for (const [pattern, intent] of FAST_PATH) {
    if (pattern.test(t)) return intent
  }
  return null
}
```
</action>
<acceptance_criteria>
- `src/agent/classifier.ts` exists
- `grep -c "\[/" src/agent/classifier.ts` outputs `10` (10 pattern entries in FAST_PATH array)
- `grep "confirm_send\|cancel\|send_message\|read_messages\|save_contact\|set_priority\|load_shedding\|weather\|web_search\|message_digest" src/agent/classifier.ts | wc -l` — all 10 intent names appear
- All regex literals end with `/i` flag: `grep "\[/" src/agent/classifier.ts | grep -v "/i," | wc -l` outputs `0`
- `grep "return null" src/agent/classifier.ts` confirms null fallthrough exists
- `grep "export function classifyIntent" src/agent/classifier.ts` confirms the function is exported
- `grep "export type FastPathIntent" src/agent/classifier.ts` confirms the type is exported
</acceptance_criteria>
</task>

<task id="1-03-03">
<title>Write tests/session.test.ts, tests/classifier.test.ts, and tests/phone.test.ts</title>
<read_first>
- src/session/machine.ts — read the actual exported function signatures and TRANSITIONS table before writing tests; error message format must be exact
- src/agent/classifier.ts — read the FAST_PATH patterns to write matching test inputs; note the priority ordering
- src/lib/phone.ts — read both functions to understand exact E.164 handling before writing test cases
- C:/Users/Bantu/mzansi-agentive/voice-app/.planning/phases/01-foundation/01-VALIDATION.md — Wave 0 test stubs required for each file (lines 57–63)
</read_first>
<action>
Create all three test files.

**File 1: tests/session.test.ts**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  transition,
  getPhase,
  getState,
  setPendingMessage,
  clearSession,
  type SessionPhase,
} from '../src/session/machine'

const USER = 'test-user-001'

beforeEach(() => {
  // Reset session state between tests
  clearSession(USER)
})

describe('INFRA-06: Session state machine — valid transitions', () => {
  test('new user starts in idle phase', () => {
    expect(getPhase(USER)).toBe('idle')
  })

  test('idle → listening is valid', () => {
    transition(USER, 'listening')
    expect(getPhase(USER)).toBe('listening')
  })

  test('listening → composing is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    expect(getPhase(USER)).toBe('composing')
  })

  test('listening → idle is valid (error/timeout reset)', () => {
    transition(USER, 'listening')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })

  test('composing → awaiting_approval is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    expect(getPhase(USER)).toBe('awaiting_approval')
  })

  test('composing → playing is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    expect(getPhase(USER)).toBe('playing')
  })

  test('awaiting_approval → idle is valid (cancel)', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })

  test('awaiting_approval → playing is valid (confirm send)', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'awaiting_approval')
    transition(USER, 'playing')
    expect(getPhase(USER)).toBe('playing')
  })

  test('playing → idle is valid', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    transition(USER, 'idle')
    expect(getPhase(USER)).toBe('idle')
  })
})

describe('INFRA-06: Session state machine — invalid transitions throw', () => {
  test('idle → awaiting_approval throws (must go through composing)', () => {
    expect(() => transition(USER, 'awaiting_approval')).toThrow(
      `Invalid session transition for ${USER}: idle → awaiting_approval`
    )
  })

  test('idle → composing throws', () => {
    expect(() => transition(USER, 'composing')).toThrow(
      `Invalid session transition for ${USER}: idle → composing`
    )
  })

  test('idle → playing throws', () => {
    expect(() => transition(USER, 'playing')).toThrow(
      `Invalid session transition for ${USER}: idle → playing`
    )
  })

  test('listening → awaiting_approval throws', () => {
    transition(USER, 'listening')
    expect(() => transition(USER, 'awaiting_approval')).toThrow(
      `Invalid session transition for ${USER}: listening → awaiting_approval`
    )
  })

  test('playing → composing throws', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    transition(USER, 'playing')
    expect(() => transition(USER, 'composing')).toThrow(
      `Invalid session transition for ${USER}: playing → composing`
    )
  })
})

describe('INFRA-06: pendingMessage storage', () => {
  test('setPendingMessage stores message and getState retrieves it', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    setPendingMessage(USER, { to: '+27821234567', toName: 'Naledi', body: 'I will be late' })
    const state = getState(USER)
    expect(state.pendingMessage?.to).toBe('+27821234567')
    expect(state.pendingMessage?.toName).toBe('Naledi')
    expect(state.pendingMessage?.body).toBe('I will be late')
  })

  test('clearSession removes pendingMessage', () => {
    transition(USER, 'listening')
    transition(USER, 'composing')
    setPendingMessage(USER, { to: '+27821234567', body: 'test' })
    clearSession(USER)
    const state = getState(USER)
    expect(state.phase).toBe('idle')
    expect(state.pendingMessage).toBeUndefined()
  })
})
```

**File 2: tests/classifier.test.ts**

```typescript
import { describe, test, expect } from 'bun:test'
import { classifyIntent } from '../src/agent/classifier'

describe('AGENT-02: Fast-path intent classifier — all 8 AGENT-02 intents', () => {
  test('send_message intent', () => {
    expect(classifyIntent('send a message to Naledi')).toBe('send_message')
    expect(classifyIntent('message Bongani')).toBe('send_message')
    expect(classifyIntent('text my wife')).toBe('send_message')
    expect(classifyIntent('whatsapp John')).toBe('send_message')
  })

  test('read_messages intent', () => {
    expect(classifyIntent('read my messages')).toBe('read_messages')
    expect(classifyIntent('read messages')).toBe('read_messages')
    expect(classifyIntent('any new messages')).toBe('read_messages')
    expect(classifyIntent('what messages do I have')).toBe('read_messages')
    expect(classifyIntent('my messages please')).toBe('read_messages')
  })

  test('save_contact intent', () => {
    expect(classifyIntent('save contact')).toBe('save_contact')
    expect(classifyIntent('add contact')).toBe('save_contact')
    expect(classifyIntent('save Naledi as a contact')).toBe('save_contact')
    expect(classifyIntent('add Bongani as a contact')).toBe('save_contact')
  })

  test('set_priority intent', () => {
    expect(classifyIntent('make Naledi a priority')).toBe('set_priority')
    expect(classifyIntent('set Bongani as priority')).toBe('set_priority')
    expect(classifyIntent('priority contact')).toBe('set_priority')
  })

  test('load_shedding intent', () => {
    expect(classifyIntent('load shedding today')).toBe('load_shedding')
    expect(classifyIntent('eskom schedule')).toBe('load_shedding')
    expect(classifyIntent('loadshed')).toBe('load_shedding')
    expect(classifyIntent('power cut today')).toBe('load_shedding')
  })

  test('weather intent', () => {
    expect(classifyIntent('weather today')).toBe('weather')
    expect(classifyIntent('what is the temperature')).toBe('weather')
    expect(classifyIntent('will it rain today')).toBe('weather')
    expect(classifyIntent('weather forecast for Johannesburg')).toBe('weather')
  })

  test('web_search intent', () => {
    expect(classifyIntent('search for news about South Africa')).toBe('web_search')
    expect(classifyIntent('look up the rugby results')).toBe('web_search')
    expect(classifyIntent('google this for me')).toBe('web_search')
    expect(classifyIntent('find out about loadshedding schedule')).toBe('web_search')
  })

  test('message_digest intent', () => {
    expect(classifyIntent('digest')).toBe('message_digest')
    expect(classifyIntent('summary of my messages')).toBe('message_digest')
    expect(classifyIntent('what did I miss')).toBe('message_digest')
    expect(classifyIntent('overnight messages')).toBe('message_digest')
  })
})

describe('AGENT-02: Fast-path classifier — confirm/cancel (approval loop)', () => {
  test('confirm_send intent', () => {
    expect(classifyIntent('yes')).toBe('confirm_send')
    expect(classifyIntent('yep')).toBe('confirm_send')
    expect(classifyIntent('yeah')).toBe('confirm_send')
    expect(classifyIntent('confirm')).toBe('confirm_send')
    expect(classifyIntent('send it')).toBe('confirm_send')
    expect(classifyIntent('go ahead')).toBe('confirm_send')
  })

  test('cancel intent', () => {
    expect(classifyIntent('no')).toBe('cancel')
    expect(classifyIntent('nope')).toBe('cancel')
    expect(classifyIntent('cancel')).toBe('cancel')
    expect(classifyIntent('stop')).toBe('cancel')
    expect(classifyIntent('abort')).toBe('cancel')
    expect(classifyIntent('never mind')).toBe('cancel')
  })
})

describe('AGENT-02: Fast-path classifier — case insensitivity', () => {
  test('all patterns match regardless of case', () => {
    expect(classifyIntent('LOAD SHEDDING TODAY')).toBe('load_shedding')
    expect(classifyIntent('READ MY MESSAGES')).toBe('read_messages')
    expect(classifyIntent('WEATHER TODAY')).toBe('weather')
    expect(classifyIntent('YES')).toBe('confirm_send')
    expect(classifyIntent('NO')).toBe('cancel')
  })
})

describe('AGENT-02: Fast-path classifier — null fallthrough', () => {
  test('unknown transcript returns null (falls through to LLM)', () => {
    expect(classifyIntent('blah blah unintelligible noise')).toBeNull()
    expect(classifyIntent('what is the meaning of life')).toBeNull()
    expect(classifyIntent('hello how are you')).toBeNull()
    expect(classifyIntent('')).toBeNull()
    expect(classifyIntent('   ')).toBeNull()
  })
})
```

**File 3: tests/phone.test.ts**

```typescript
import { describe, test, expect } from 'bun:test'
import { normaliseE164, formatPhoneForSpeech } from '../src/lib/phone'

describe('ISO-02: E.164 normalisation', () => {
  test('WhatsApp format (no + prefix) → E.164', () => {
    expect(normaliseE164('27821234567')).toBe('+27821234567')
  })

  test('Local SA format (leading 0) → E.164', () => {
    expect(normaliseE164('0821234567')).toBe('+27821234567')
  })

  test('Already E.164 (+ prefix) → unchanged', () => {
    expect(normaliseE164('+27821234567')).toBe('+27821234567')
  })

  test('Other country number without + → + prepended', () => {
    expect(normaliseE164('447700900000')).toBe('+447700900000')
  })

  test('Number with spaces and dashes stripped', () => {
    expect(normaliseE164('082 123 4567')).toBe('+27821234567')
    expect(normaliseE164('+27-82-123-4567')).toBe('+27821234567')
  })
})

describe('ISO-02: formatPhoneForSpeech', () => {
  test('+27 SA number → local format spaced digits', () => {
    // +27821234567 → local 0821234567 → "0 8 2 1 2 3 4 5 6 7"
    expect(formatPhoneForSpeech('+27821234567')).toBe('0 8 2 1 2 3 4 5 6 7')
  })

  test('Non-SA E.164 → digits spaced without +', () => {
    expect(formatPhoneForSpeech('+447700900000')).toBe('4 4 7 7 0 0 9 0 0 0 0 0')
  })

  test('Result contains no raw digit runs — each digit separated by space', () => {
    const spoken = formatPhoneForSpeech('+27821234567')
    // No two consecutive non-space characters
    expect(/\d\d/.test(spoken)).toBe(false)
  })
})
```
</action>
<acceptance_criteria>
- `tests/session.test.ts` exists
- `grep -c "test(" tests/session.test.ts` outputs at least `14` (valid transitions + invalid + pendingMessage)
- `grep "idle → awaiting_approval" tests/session.test.ts` confirms the exact error string is tested
- `grep "toThrow" tests/session.test.ts | wc -l` outputs at least `5` (one per invalid transition test)
- `tests/classifier.test.ts` exists
- `grep -c "toBe\|toBeNull" tests/classifier.test.ts` outputs at least `25` (all intent patterns covered)
- `grep "toBeNull" tests/classifier.test.ts | wc -l` outputs at least `4` (null fallthrough cases)
- `tests/phone.test.ts` exists
- `grep "+27821234567" tests/phone.test.ts | wc -l` outputs at least `4` (multiple normalisation cases)
- `grep "0 8 2 1 2 3 4 5 6 7" tests/phone.test.ts` confirms speech format test exists
- `bun test tests/session.test.ts` exits 0 (all session tests pass)
- `bun test tests/classifier.test.ts` exits 0 (all classifier tests pass)
- `bun test tests/phone.test.ts` exits 0 (all phone tests pass)
</acceptance_criteria>
</task>

## Verification

After all tasks complete:

1. Run the unit test suite: `bun test tests/session.test.ts tests/classifier.test.ts tests/phone.test.ts`
   - Expected: all tests pass, zero failures, ~1 second runtime
2. Verify invalid transition throws with correct message:
   ```bash
   bun -e "import { transition } from './src/session/machine'; transition('u1', 'awaiting_approval')"
   ```
   Expected: exits non-zero with `Invalid session transition for u1: idle → awaiting_approval`
3. Verify classifier performance (must be < 1ms):
   ```bash
   bun -e "
   import { classifyIntent } from './src/agent/classifier';
   const t = performance.now();
   for (let i = 0; i < 10000; i++) classifyIntent('read my messages');
   console.log((performance.now() - t) / 10000, 'ms per call');
   "
   ```
   Expected: < 0.1ms per call
4. Verify phone utilities:
   ```bash
   bun -e "
   import { normaliseE164, formatPhoneForSpeech } from './src/lib/phone';
   console.log(normaliseE164('0821234567'));      // +27821234567
   console.log(formatPhoneForSpeech('+27821234567'));  // 0 8 2 1 2 3 4 5 6 7
   "
   ```
