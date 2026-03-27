# Feature Landscape

**Domain:** Voice-native AI messaging companion — WhatsApp integration, visually impaired users, South Africa
**Researched:** 2026-03-27
**Overall confidence:** HIGH (project scope well-defined; VUI, accessibility, and WhatsApp patterns are mature domains)

---

## Table Stakes

Features users expect. Missing any of these = product does not work for its target audience.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Voice compose + send WhatsApp messages | Core value proposition — screenless messaging is the product | Medium | Regex fast-path for common intents before LLM; keeps latency under 500ms |
| Pre-send approval confirmation loop | Users cannot undo a sent message; trust is destroyed without confirmation | Low | "Say yes to send, or say cancel" — single yes/no turn, not multi-step |
| Read incoming messages aloud with contact names | Without this, messages are inaccessible | Medium | Must resolve phone numbers to saved names; unknown numbers read as digits only |
| Contact name resolution (phone → human name) | Phone numbers read aloud are meaningless; "zero eight two..." creates cognitive overload | Medium | Requires `user_contacts` table lookup before every TTS output |
| Unknown contact identification flow | User receives message from unsaved number; they must be able to learn who it is | Low | Prompt: "Message from an unsaved number, zero eight two..." + offer to save |
| Voice-only contact creation | Users cannot use a screen to add contacts; must be completable entirely by voice | Medium | Multi-turn: name → confirm name → save. One question per turn |
| Error recovery and clarification prompts | Voice recognition misinterpretation is common; system must recover gracefully without loops | Medium | Max 3 no-match/no-input events before graceful fallback; rephrase on each failure |
| Natural spoken-first responses | Responses with markdown, lists, or visual formatting are unusable via TTS | Low | Agent system prompt must enforce spoken-natural prose; no bullet points, no headers in audio responses |
| Silence / no-response on irrelevant input | Unexpected silence is less disruptive than wrong outputs | Low | Heartbeat gate decides: interrupt / batch / skip; do not speak every event |
| HMAC webhook security | WhatsApp Cloud API requires HMAC x-hub-signature-256 verification | Low | Missing this means spoofed messages can be injected; table stakes for production security |
| User identity via phone number (E.164) | No separate auth system; WhatsApp number is the identity anchor | Low | Supabase RLS enforces cross-user isolation at DB layer |
| Session state machine | Voice interactions are stateful; each turn must know what confirmation or question is pending | Medium | Bun/Hono backend; BullMQ durable queue survives process restart |

---

## Differentiators

Features that create competitive advantage. Not expected by default, but high-value once experienced.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Load shedding briefing (EskomSePush) | South African daily reality; no other voice assistant surfaces this proactively | Low | EskomSePush API free tier: 50 req/day. Morning briefing leads with next outage window for user's area |
| Morning briefing cron (load shedding + weather + overnight digest) | Replaces the screen-check habit; one audio summary starts the day | Medium | Cron at configurable time; ordered: load shedding → weather → unread message count → priority messages |
| Priority contact interrupt vs batch decision | Not all messages need to wake the user; urgency routing is a quality-of-life feature | High | Heartbeat engine: interrupt (priority sender + urgent keyword) / batch (standard) / silent (spam signals) / skip (no context) |
| Afrikaans TTS (ElevenLabs) | 7 million Afrikaans first-language speakers in South Africa; no other WhatsApp assistant serves them natively | Low | ElevenLabs af-ZA voice; agent must detect user language preference and switch |
| Episodic memory via pgvector | Agent remembers context across sessions — "your sister called yesterday" not "an unknown number called" | High | OpenAI text-embedding-3-small; vector similarity for relevant memory retrieval; significantly raises perceived intelligence |
| Ambient queries (load shedding, weather, web search) | User can ask "is there load shedding tonight?" at any time, not only in the morning briefing | Low-Medium | EskomSePush + OpenWeather + Tavily; must return spoken answer under 3 seconds |
| Voice note playback handling | Received voice notes must be accessible — transcribe and read aloud, not silently discard | Medium | WhatsApp Cloud API delivers audio URL; transcribe server-side via Whisper or equivalent |
| Caregiver dashboard | Family members or caregivers can monitor activity, check-ins, and message summaries on a visual interface | High | Vite + React frontend; mission control aesthetic; read-only view of user's interactions for oversight |
| Voice-populated contacts (privacy-first model) | Agent only knows contacts the user has consciously introduced — not a wholesale sync of device contacts | Low | Architectural decision baked into data model; surfaces as a differentiator in privacy-sensitive markets |
| Fast-path intent classification | Common commands (read messages, send to X) skip LLM invocation entirely — sub-500ms response | Medium | Regex → intent → tool call; only ambiguous or novel intents escalate to Claude |

---

## Anti-Features

Features to explicitly NOT build in v0.1. Documented here so scope creep has a named cost.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| isiZulu TTS in v0.1 | Google Cloud TTS complexity not justified for hackathon timeline; ElevenLabs Zulu quality inconsistent | Defer to v0.2 using Google Cloud TTS; architect TTS layer as pluggable from day one |
| Group message creation / reply | Send flow in groups adds significant complexity: sender disambiguation, group selection by voice, risk of wrong-group sends | Read groups only in v0.1; add send-to-group in v0.2 when approval flow is battle-tested |
| iOS background audio | Background audio restrictions make fully screenless operation near-impossible on iOS without a native app | Android first; iOS is a v1.x project after Android is validated |
| Multi-device session management | Single active session per user eliminates a class of state-conflict bugs | Hard-block second device at upsert; revisit in v0.2 |
| Proactive load shedding push alerts | Real-time push on stage changes requires persistent socket or polling loop; adds infra complexity | Morning briefing cron covers the primary use case; reactive ambient query covers the rest |
| WhatsApp device contact list sync | WhatsApp Cloud API does not expose device contact lists | Voice-populated contacts only; do not attempt to emulate a sync mechanism |
| Research-to-podcast synthesis | Multi-step research agent with audio output is a distinct product vertical | Defer entirely to v0.2 |
| Payments integration | Not relevant to the assistive communication use case | Out of scope; do not design data model to accommodate it |
| Markdown or formatted agent responses | Markdown is unspoken visual structure; renders as noise in TTS ("asterisk asterisk bold asterisk asterisk") | Agent system prompt must prohibit formatting; enforce in agent output parser |
| Wake-word / always-listening mode | Requires native app or OS-level integration; not feasible with WhatsApp Cloud API webhook model | User initiates all interactions by sending a WhatsApp message; always-listening is a v2+ native app feature |
| Visual-first onboarding | Visually impaired users cannot complete setup flows that require reading screens | All onboarding steps must be completable via voice; written confirmation is supplementary only |

---

## Feature Dependencies

```
Contact Name Resolution
  └── required by: Read Messages Aloud
  └── required by: Morning Briefing message digest
  └── required by: Priority Contact Interrupt decisions

Voice Contact Creation
  └── required by: Contact Name Resolution (contacts must exist to resolve)
  └── enables: Priority Contact Flagging

Session State Machine
  └── required by: Pre-send Approval Confirmation Loop
  └── required by: Multi-turn Contact Creation
  └── required by: Episodic Memory (session context tracking)

Heartbeat Engine (event-driven surface decision gate)
  └── required by: Priority Contact Interrupt vs Batch
  └── required by: Morning Briefing sequencing
  └── depends on: Priority Contact Flagging (to know which contacts trigger interrupt)
  └── depends on: BullMQ job queue (durable event processing)

Morning Briefing Cron
  └── depends on: EskomSePush API (load shedding times)
  └── depends on: OpenWeather API (weather)
  └── depends on: Contact Name Resolution (overnight message digest)
  └── depends on: Heartbeat Engine (digest ordering)

Ambient Queries
  └── depends on: EskomSePush API
  └── depends on: OpenWeather API
  └── depends on: Tavily web search API

Episodic Memory
  └── depends on: pgvector extension in Supabase
  └── depends on: Contact Name Resolution (memory entries reference named contacts)
  └── enhances: Read Messages Aloud (adds relational context)
  └── enhances: Morning Briefing (richer digest summaries)

Afrikaans TTS
  └── depends on: ElevenLabs API with af-ZA voice
  └── depends on: User language preference stored in DB
  └── enhances: All spoken output features

Caregiver Dashboard
  └── depends on: All core features being logged to Supabase
  └── depends on: Supabase RLS for read-only caregiver access scope
```

---

## Approval Loop Design: Authoritative Patterns

Based on Google Cloud Dialogflow CX voice agent design documentation and VUI best practices:

### The Correct Pattern

**Rule: One confirmation per send action. Single yes/no turn. No multi-step confirmation.**

```
User: "Send a message to Mama"
Agent: "What would you like to say?"
User: "Happy birthday, I'll call you later"
Agent: "Sending to Mama: Happy birthday, I'll call you later. Say yes to send, or say cancel."
User: "Yes"
Agent: "Sent."
```

**Why this works:**
- Repeats only the critical details (recipient + message content)
- One decision point per send action
- Short final confirmation word ("yes") minimises recognition errors
- Immediate positive feedback on completion ("Sent.")

### Error Recovery in Approval Loop

```
First no-match:  "Sorry, say yes to send or say cancel."
Second no-match: "I didn't catch that. To send, say yes. To cancel, say no."
Third no-match:  Cancel the send action, inform user, return to idle.
```

Never loop more than 3 times. On third failure, cancel silently and log.

### What NOT to Do

- Do not ask "Are you sure?" after "Yes" — that is a second confirmation loop and breeds frustration
- Do not read the entire message back twice
- Do not require spelling out "Y-E-S" — monosyllable recognition is more reliable
- Do not auto-send after timeout — always require affirmative; silence is not consent

---

## Message Batching vs Interrupt: Decision Model

Based on notification design research (Knock, Notification API) and voice assistant interrupt patterns:

### Surface Decision Matrix (Heartbeat Engine)

| Signal | Weight | Interpretation |
|--------|--------|----------------|
| Sender is in priority contacts list | +3 | High interrupt score |
| Message contains urgent keywords (help, emergency, urgent, please call) | +2 | Elevated interrupt score |
| Message received during quiet hours (22:00–07:00) | -3 | Strong suppression |
| More than 3 unread messages from same sender in 10 minutes | +1 (cap at +2) | Batch instead of N interrupts |
| Message is from an unsaved number | -1 | Lower interrupt priority |
| Message is from a group chat | -2 | Strong batch preference |

**Thresholds:**
- Score >= 3: Interrupt (speak immediately)
- Score 1–2: Batch (add to next digest window)
- Score <= 0: Silent (include in morning briefing only)
- Score < -2: Skip (group noise, mark read without surfacing)

### Batching Windows

- **Immediate window:** 0–30 seconds (priority contacts only; interrupt score >= 3)
- **Standard batch window:** 15-minute rolling window; deliver as single "you have 3 messages" summary
- **Morning digest:** All overnight messages not yet surfaced; delivered at cron time

**Cognitive cost basis:** Studies show 23-minute recovery time per interruption. A batch of 10 messages from the same sender that arrives over 10 minutes should produce one notification, not ten. Information value is identical; interruption cost is 10x lower with batching.

---

## South African Context Features

### Load Shedding

- **EskomSePush API** (free tier: 50 req/day) provides per-area schedules with suburb-level granularity
- Morning briefing **must lead with load shedding** — this is the single highest-priority ambient datum for South African users daily
- Format: "Load shedding in [area] today from [start] to [end]. Stage [N] is currently active."
- If no load shedding: "No load shedding scheduled for your area today."
- Area must be configured during onboarding (voice-prompted suburb name → EskomSePush area ID lookup)

### Language

- **English** (South African accent): Default. ElevenLabs SA English voice.
- **Afrikaans**: ElevenLabs af-ZA voice. 7 million first-language speakers. Activate via user preference ("Praat Afrikaans" or stored preference).
- **isiZulu**: Deferred to v0.2. Google Cloud TTS is the correct provider. Do not use ElevenLabs for isiZulu — quality is not production-ready.
- Agent responses must be natural in the chosen language — not translated literally from English idioms.
- Code-switching is common in SA conversations; agent should tolerate mixed-language input without requiring the user to switch modes.

### Network Resilience

- South African mobile data is expensive; responses must be payload-efficient
- TTS audio should be generated server-side and delivered as a single audio message, not streamed (WhatsApp Cloud API sends audio file, not stream)
- If EskomSePush API is down, morning briefing must proceed without load shedding data rather than failing entirely — partial delivery is better than silence

---

## MVP Recommendation

**Build these first (strictly ordered by dependency):**

1. Supabase schema + RLS (foundation; everything else writes to this)
2. WhatsApp webhook + HMAC verification + user upsert (messages flow in)
3. Session state machine (enables multi-turn flows)
4. Contact name resolution (unlocks readable message output)
5. Read incoming messages aloud (first complete user-facing feature)
6. Voice compose + pre-send approval loop (second complete user-facing feature)
7. Voice contact creation (enables name resolution for new contacts)
8. Heartbeat engine + priority contact flagging (interrupt vs batch)
9. Morning briefing cron (load shedding + weather + overnight digest)
10. Ambient queries (load shedding, weather, web search)

**Defer to P1 (add only if time allows):**
- Episodic memory (pgvector) — adds depth but not correctness
- Voice note playback transcription — nice, not blocking
- Caregiver dashboard — useful, not demo-critical
- Afrikaans TTS — high value, but English demo is complete without it

**Never build in v0.1:**
- See Anti-Features table above

---

## Sources

- [Battle for Blindness — Voice-Activated Assistants for Visually Impaired](https://battleforblindness.org/voice-activated-assistants-how-ai-is-empowering-the-visually-impaired)
- [RNIB — WhatsApp Accessibility and Features](https://www.rnib.org.uk/living-with-sight-loss/assistive-aids-and-technology/tv-audio-and-gaming/what-is-whatsapp/)
- [WhatsApp Help — About Accessibility Features](https://faq.whatsapp.com/3614672068767202)
- [AppleVis — WhatsApp Groups VoiceOver Issue (unknown contacts)](https://applevis.com/forum/ios-ipados/whatsapp-groups-annoying-voice-over-issue)
- [Google Cloud — Voice Agent Design Best Practices (Dialogflow CX)](https://docs.cloud.google.com/dialogflow/cx/docs/concept/voice-agent-design)
- [Parallel HQ — VUI Design Principles Guide 2026](https://www.parallelhq.com/blog/voice-user-interface-vui-design-principles)
- [Fuselab Creative — Voice UI Design Guide 2026](https://fuselabcreative.com/voice-user-interface-design-guide-2026/)
- [EskomSePush — API Subscription](https://eskomsepush.gumroad.com/l/api)
- [EskomSePush — App](https://sepush.co.za/)
- [Gadgeteer ZA — Load Shedding Integration with EskomSePush API](https://gadgeteer.co.za/load-shedding-integration-on-home-assistant-with-eskomsepush-api/)
- [The South African — Google AI Tools Now Fluent in SA Languages](https://www.thesouthafrican.com/news/google-ai-tools-now-fluent-in-four-sa-languages-including-afrikaans-isizulu/)
- [ElevenLabs — African Accent Text to Speech](https://elevenlabs.io/text-to-speech/african-accent)
- [Knock — Building a Batched Notification Engine](https://knock.app/blog/building-a-batched-notification-engine)
- [Courier — Notification Design Best Practices](https://www.courier.com/guides/how-to-build-a-notification-center/chapter-3-best-practices-for-notification-centers)
- [MEF — WhatsApp Business Calling API](https://mobileecosystemforum.com/2025/12/17/whatsapp-opens-a-new-front-in-business-voice-with-calling-api/)
- [Telnyx — How AI Voice Assistants Use Memory and Personalization](https://telnyx.com/resources/ai-assistant-personalization)
- [QKS Group — WhatsApp Voice Message Transcripts for Accessibility](https://qksgroup.com/blogs/a-step-towards-accessible-communication-with-whatsapp-voice-message-transcripts-913)
- [Home Assistant — Daily Summary by Assist](https://www.home-assistant.io/voice_control/assist_daily_summary/)
