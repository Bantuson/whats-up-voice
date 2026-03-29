# Phase 05 — UI Review

**Audited:** 2026-03-28
**Baseline:** 05-UI-SPEC.md (approved design contract)
**Screenshots:** Captured — dev server running on localhost:5173
**Screenshot directory:** `.planning/ui-reviews/05-20260328-224132/`

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Dashboard "Send" button deviates from spec "Send Command"; error/SSE-disconnect states missing |
| 2. Visuals | 4/4 | Strong visual identity — animated orb, collapsible sidebar, waveform all exceed spec intent |
| 3. Color | 3/4 | Font families changed to Space Mono/Grotesk (not IBM Plex); btn-primary is dark-green-on-green, not green-on-black |
| 4. Typography | 2/4 | Eight distinct hardcoded font sizes used (9–18px) instead of four declared token sizes; two forbidden weights (500, 700) alongside 600 |
| 5. Spacing | 3/4 | Three hardcoded pixel gaps in Dashboard (gap:20, gap:8, marginTop:12) break the 8pt spacing scale |
| 6. Experience Design | 2/4 | No loading states anywhere; no error handling on API calls in Contacts, Routines, Log; no SSE disconnection UI |

**Overall: 17/24**

---

## Top 3 Priority Fixes

1. **No loading or error states on data-fetch pages** — Contacts, Routines, and Log pages all fire `fetch()` calls with no loading indicator and no error branch. If the backend is slow or returns a non-200 response, the user sees an empty state that is indistinguishable from "no data exists." Fix: add `isLoading` boolean state to each page; render a muted "Loading..." text in place of the empty state while the request is in flight; add a catch branch that sets an `error` state and renders the spec's error copy "Request failed. Check your connection and try again."

2. **Typography scale has exploded beyond the four-role spec** — CSS contains hardcoded font sizes at 9px, 10px, 11px, 12px, 13px, 14px, 15px, and 18px. The spec declares exactly four sizes (12px label, 14px body/data, 20px heading). The 9px sizes fall below the 12px accessibility floor stated in the spec. Font weight 700 appears 14+ times in CSS classes; the spec explicitly forbids weight 700 ("never 700/Bold"). Fix: audit every CSS class using hardcoded sizes and replace with `var(--size-label)`, `var(--size-body)`, `var(--size-data)`, or `var(--size-heading)`; replace all `font-weight: 700` with `var(--weight-semibold)` (600).

3. **Font family substitution violates the design contract** — index.html loads Space Grotesk and Space Mono from Google Fonts. The spec mandates IBM Plex Sans and IBM Plex Mono. `--font-data` is wired to `'Space Mono'` and `--font-prose` to `'Space Grotesk'`. The btn-primary button renders dark-green text on a dark-green background (`var(--green3)` background with `var(--green)` text) rather than the spec's high-contrast black-on-green. Fix: update `index.html` Google Fonts URL to load IBM Plex Mono and IBM Plex Sans; update `--mono` and `--sans` root values accordingly; update `.btn-primary` to `background: var(--green); color: #0D0D0D;`.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Conformant copy (verified against spec):**
- Login CTA: "Connect" — exact match (`Login.tsx:41`)
- Setup CTA: "Save Settings" — exact match (`Setup.tsx:61`)
- Add Contact CTA: "Add Contact" — exact match (`Contacts.tsx:124`)
- Contacts empty state: "No contacts saved. Add the first contact below." — exact match (`Contacts.tsx:66-68`)
- Routines empty state: "No routines configured." — exact match (`Routines.tsx:51-53`)
- Log message empty state: "No messages in history." — exact match (`Log.tsx:62-64`)
- Memory empty state: "No memories stored yet. Memories are created after completed sessions." — exact match (`Log.tsx:141-143`)
- Delete confirmation: "Delete [Name]? This cannot be undone." — exact match (`Contacts.tsx:131-133`)
- Login error: "Enter a valid phone number in international format, e.g. +27831000000." — exact match (`Login.tsx:15`)

**Deviations:**

- `Dashboard.tsx:116` — Simulate command submit button reads `Send` (generic). Spec declares CTA as "Send Command". This is a one-word deviation but it is a spec miss.
- No component implements the SSE disconnection copy: "Live feed disconnected. Reconnecting..." The `subscribeToSSE` function in the store opens two `EventSource` connections but there is no `onerror` handler that surfaces this message in any page.
- `HeartbeatFeed.tsx:13` — Empty state copy reads "No heartbeat events yet. Waiting for WhatsApp messages." — spec contract reads "No heartbeat events yet. Waiting for WhatsApp messages..." (trailing ellipsis). One character difference; flagged for exactness.
- `Log.tsx:106-108` — Heartbeat audit empty state reads "No heartbeat events yet. Waiting for WhatsApp messages." — same trailing ellipsis deviation as above.

---

### Pillar 2: Visuals (4/4)

The implemented UI substantially exceeds the spec's two-column layout contract and delivers a strong, coherent terminal aesthetic. Key observations from screenshot analysis:

**Strengths:**
- Dashboard introduces an animated orb with ring layers and state-specific color coding (green for listening, amber for composing/awaiting, blue for playing) — not in the spec but meaningfully enhances the live view experience for a caregiver.
- Collapsible sidebar (48px icon rail → 200px on hover) is a clean improvement over the spec's fixed 160px sidebar. Nav items show unicode icon symbols that serve as at-a-glance navigation affordances.
- The cycle-bar state switcher on Dashboard is a well-considered demo affordance that lets caregivers and hackathon judges explore all states without needing real WhatsApp messages.
- Login page: clear focal point (centred card), correct visual hierarchy (title > subtitle > field > CTA), all at appropriate contrast on dark background.
- The waveform renders visibly at rest (faint green horizontal bar of 32 elements at low opacity) — confirms inactive state rendering.
- Info grid (load shedding, weather, batched messages, priority contacts) provides immediately useful context data that was not in the spec but is on-brand.
- Mobile viewport (375px): sidebar collapses correctly to icon rail, login card remains centred and fully readable.

**Minor observations (not scored down):**
- The sidebar icon symbols (◌, ◫, ◈, ◉, ◎, ◷, ◻) display without text labels until hover. On first load, a caregiver needs to hover to understand navigation. The spec specified text-label-only nav items; the icon-first approach shifts the learning curve but is visually elegant.

---

### Pillar 3: Color (3/4)

**Conformant:**
- Color roles (dominant/secondary/accent) are correct in intent: dark background, slightly lighter surface, green accent.
- CSS custom properties are aliased correctly so pages using `var(--color-accent)`, `var(--color-border)` etc. resolve to the short-form values.
- `--color-interrupt`, `--color-batch`, `--color-skip`, `--color-silent` all wired to correct variables (`index.css:35-38`).
- No hardcoded hex values in any `.tsx` component file (only in comments on lines 3 of `App.tsx` and `HeartbeatRow.tsx`).
- Destructive button correctly uses `var(--red)` (`FF4D4D`) — within 1 hex unit of spec `#FF4444`; visually indistinguishable.

**Deviations:**

**Accent hex mismatch:** The spec declares accent `#00FF88`. The implementation uses `--green: #00E87A` — a noticeably cooler, slightly darker green that reduces the neon terminal character of the design. While not a critical defect, it reduces the intended contrast pop.

**Primary button styling:**
Spec: `background: #00FF88; color: #0D0D0D` (bright green background, black text for maximum contrast).
Implementation: `.btn-primary { background: var(--green3) /* #004D28 */; color: var(--green) /* #00E87A */ }` — renders as dark green background with lighter green text. The contrast ratio between `#004D28` and `#00E87A` is approximately 2.8:1, below the WCAG AA minimum of 4.5:1 for normal text. This is both a color spec deviation and an accessibility issue.
Screenshot confirms: Login "CONNECT" button appears dark green, not the bright green-on-black CTA the spec intends.

**Unofficial `--blue: #3D8EFF`:** The spec does not include a blue color role. The implementation uses blue as the `playing` state color in the orb, sidebar state dot, and playing-card border. This is a reasonable extension for the orb enhancement but is undocumented in the spec.

**rgba values in CSS:** Multiple `rgba()` values are used for orb ring overlays and hover states. These are all derived from the declared color tokens (green, amber, blue) at reduced opacity. This is appropriate for the orb visual effect and does not violate the spirit of the custom properties rule.

---

### Pillar 4: Typography (2/4)

**Conformant:**
- Four CSS custom property tokens declared correctly: `--size-label: 12px`, `--size-body: 14px`, `--size-data: 14px`, `--size-heading: 20px`.
- `--weight-regular: 400` and `--weight-semibold: 600` declared.
- Pages and components consistently use `var(--font-data)` and `var(--font-prose)` — no raw font family strings in TSX (except `Dashboard.tsx:119` which uses `var(--mono)` short form).

**Deviations:**

**Font family substitution (HIGH):**
`index.html:9` loads `Space Grotesk` and `Space Mono`. Spec mandates `IBM Plex Sans` and `IBM Plex Mono`. All `--font-data` and `--font-prose` references resolve to the wrong families. Space Mono and Space Grotesk are legitimate monospace/grotesque pairings and aesthetically coherent, but they are not what the spec contracts. The 05-04 SUMMARY.md incorrectly asserts "Frontend dashboard matches UI spec (Space Grotesk/Mono, dark theme, animated orb, 32-bar waveform)" — this reveals an intentional substitution that was not flagged as a deviation from the original spec.

**Eight distinct hardcoded font sizes in CSS (HIGH):**
Found in `index.css`: 9px (×5 occurrences), 10px, 11px (×3), 12px, 13px (×3), 14px (×2), 15px, 18px.
Spec permits: 12px (label), 14px (body/data), 20px (heading) — three sizes plus the heading.
Out-of-spec sizes: 9px, 10px, 11px, 13px, 15px, 18px.
The 9px occurrences (`.field-label`, `.card-label`, `.zone-label`, `.data-table th`) fall below the spec's stated 12px accessibility floor.

**Weight 700 used extensively (MEDIUM):**
Spec states "never 700/Bold." CSS uses `font-weight: 700` in 14+ class definitions: `.sidebar-logo-mark`, `.topbar-title`, `.pill`, `.btn-primary`, `.btn-destructive`, `.field-label`, `.data-table th`, `.cycle-btn`, `.orb-tag`, `.info-val`, `.btn-send`, `.btn-cancel`.
Weight 500 also appears on `.sidebar-link` (13px) and `.queue-name`. Neither 500 nor 700 is declared in the spec's weight system.

**`Dashboard.tsx:119`** — Inline style uses `var(--mono)` (short-form alias) and literal `fontSize: 12` (unitless integer, renders as 12px). Should use `var(--font-data)` and `var(--size-label)`.

---

### Pillar 5: Spacing (3/4)

**Conformant:**
- All seven spacing tokens declared correctly (`--space-xs` through `--space-3xl`).
- The majority of spacing in page components uses `var(--space-*)` tokens: Login, HeartbeatFeed, Contacts, Routines, Log, Setup — all consistent.
- Waveform gap exception (2px between bars) correctly excluded from the 8pt scale per spec exception note.
- Toggle 44px touch target confirmed in CSS: `--touch-target: 44px` used in `.field-input`, `.btn-primary`, `.btn-destructive`, `.data-table td`.

**Deviations:**

- `Dashboard.tsx:52` — Outer container: `gap: 20` (literal integer, renders 20px). Not on the 8pt scale (nearest tokens are 16px `--space-md` and 24px `--space-lg`). Should use `var(--space-md)` or `var(--space-lg)`.
- `Dashboard.tsx:108` — Transcript form row: `gap: 8` (literal integer). Numerically correct (matches `--space-sm: 8px`) but should use `var(--space-sm)` for consistency and theme-rebindability.
- `Dashboard.tsx:119` — Response paragraph: `marginTop: 8` (literal integer). Same as above — use `var(--space-sm)`.
- `Dashboard.tsx:186` — Queue zone label: `marginBottom: 10` — 10px is not on the scale. Should be `var(--space-sm)` (8px) or `var(--space-md)` (16px).
- `.card` in CSS: `padding: 16px 18px` — 18px horizontal padding is off-scale. Should be `var(--space-md)` (16px) for both axes.
- `.sidebar-logo`: `padding: 20px 0 20px` / `padding-left: 15px` — 20px and 15px are not scale values. Should use `var(--space-lg)` (24px) / `var(--space-md)` (16px).

These are minor drift cases; they don't break the visual rhythm significantly but they accumulate technical debt.

---

### Pillar 6: Experience Design (2/4)

**Conformant:**
- Login validation is synchronous and immediate — error shown inline before any API call.
- Delete contact requires confirmation modal with Cancel + Delete — destructive action gating is correctly implemented.
- All empty states handled: Contacts, Routines, HeartbeatFeed, Log sections, Memory viewer.
- Toggle `aria-pressed` on priority contact, enable/disable routine, and morning briefing (`Contacts.tsx:90`, `Routines.tsx:76`, `Setup.tsx:57`).
- Waveform correctly reflects session state (active/inactive visual distinction).
- SSE subscription opens automatically when token is present.

**Gaps:**

**No loading states (HIGH):** No component implements an `isLoading` state. `Contacts.tsx`, `Routines.tsx`, and `Log.tsx` all fire `fetch()` on mount. During any latency, the user sees the empty state ("No contacts saved..."), which is indistinguishable from a genuinely empty data set. For a caregiver who may have 10 contacts already stored, this creates confusion. The spec's empty states are intended for the data-absent case, not the loading case.

**No error handling on data fetch (HIGH):** `loadContacts` (`Contacts.tsx:21-27`), `loadRoutines` (`Routines.tsx:25-31`), and the `Log.tsx:37-49` triple-fetch all only handle the `res.ok` success path. A 401, 500, or network failure silently leaves state unchanged. No error message is ever displayed. The spec declares: "Error state — API failure: 'Request failed. Check your connection and try again.'" This copy is unimplemented across all three data pages.

**No SSE error/reconnect UI (MEDIUM):** The store's `subscribeToSSE` opens two `EventSource` connections. Neither has an `onerror` handler that would surface the spec's "Live feed disconnected. Reconnecting..." message to the caregiver. If the backend restarts during demo, the feed silently stalls with no user feedback.

**Dashboard "Send" command has no error state (LOW):** `handleSend` in `Dashboard.tsx:38-49` awaits `fetch('/api/voice/command')` but does not catch rejections or non-200 responses. A failed command shows nothing to the user.

**No error boundary at app root (LOW):** `App.tsx` has no React `ErrorBoundary` wrapper. A render error in any page will produce a blank white screen with no recovery UI.

**Routines toggle has no aria-label (LOW):** `Routines.tsx:71-79` — the enable/disable toggle has `aria-pressed` but no `aria-label` to identify what is being toggled. Screen-reader users will hear "toggle button" with no context. Compare to `Contacts.tsx:91` which correctly adds `aria-label="Priority"`.

---

## Registry Safety

Registry audit: shadcn not initialized (`components.json` not found). No third-party registry blocks to audit. Skipped.

---

## Files Audited

| File | Lines |
|------|-------|
| `frontend/index.html` | 17 |
| `frontend/src/index.css` | 470 |
| `frontend/src/App.tsx` | 92 |
| `frontend/src/pages/Login.tsx` | 46 |
| `frontend/src/pages/Setup.tsx` | 65 |
| `frontend/src/pages/Dashboard.tsx` | 201 |
| `frontend/src/pages/HeartbeatFeed.tsx` | 23 |
| `frontend/src/pages/Contacts.tsx` | 143 |
| `frontend/src/pages/Routines.tsx` | 88 |
| `frontend/src/pages/Log.tsx` | 170 |
| `frontend/src/components/Waveform.tsx` | 27 |
| `frontend/src/components/HeartbeatRow.tsx` | 38 |
| `.planning/phases/05-tests-frontend-demo/05-UI-SPEC.md` | 410 |
| `.planning/phases/05-tests-frontend-demo/05-03-SUMMARY.md` | 165 |
| `.planning/phases/05-tests-frontend-demo/05-04-SUMMARY.md` | 97 |

Screenshots captured: `desktop.png` (1440×900), `mobile.png` (375×812), `dashboard.png` (1440×900)
