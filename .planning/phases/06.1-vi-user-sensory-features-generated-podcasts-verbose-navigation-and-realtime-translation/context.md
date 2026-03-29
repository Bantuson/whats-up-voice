# Phase 06.1 — VI User Sensory Features: Context

## Origin

Requested directly by a visually impaired user in a real conversation. Not a product assumption — a lived need stated by the actual target user.

---

## Feature 1: Generated Podcasts

**What they asked for:** Tailored entertainment delivered as audio. Research that is interest-based and fun, not just educational.

**Design intent:** The user wants to be entertained, not lectured. Think personalised radio, not a textbook. Content should feel like something they chose to listen to — sport, culture, music news, local SA stories — generated and read aloud on demand or on a schedule.

**Technical direction:**
- User states a topic or mood ("I want something about Kaizer Chiefs" / "tell me something interesting")
- Agent researches via Tavily/web search, synthesises into a short podcast-style script (2–5 min)
- ElevenLabs TTS reads it aloud with natural pacing
- Can be scheduled (morning briefing slot) or on-demand via voice command

---

## Feature 2: Verbose Navigation

**What they asked for:** Verbally rich directions when travelling — describe the world around them as they move through it.

**Design intent:** Not turn-by-turn. The VI user cannot see street signs, building facades, or landmarks. Navigation should paint the environment in words: "You're passing a busy market on your left, there's a taxi rank ahead, the road surface changes to cobblestone in 20 metres." Google Maps provides the spatial data; the agent provides the description layer.

**Technical direction:**
- Triggered by voice: "Help me get to Bree Street taxi rank"
- Google Maps Directions API for routing + Places API for POI enrichment along route
- Agent generates verbal descriptions of each waypoint and surrounding environment
- Delivered as sequential voice messages as the user moves — not a wall of text upfront
- Location updates via phone GPS (requires WhatsApp location sharing or a companion mechanism)

---

## Feature 3: Realtime Language Translation

**What they asked for:** When abroad and not speaking the local language, translate in real time to bridge communication with locals.

**Design intent:** Extends the communication layer beyond WhatsApp. The user speaks in their language, the agent translates and speaks back in the target language — and vice versa. Enables live conversation with vendors, officials, strangers. Not a novelty — a genuine safety and independence feature for a user travelling without sight.

**Technical direction:**
- Voice input → STT (Whisper/Deepgram) → detect source language
- Translate via Claude or Google Translate API
- TTS output in target language via ElevenLabs (multilingual model)
- Bidirectional: translate both what the user says and what they hear back
- Session-based: user activates "translation mode", sets target language, then speaks naturally

---

## Design Constraints (from VI user conversation)

- All interaction must remain voice-first — no screen, no visual confirmation
- Features must feel like natural extensions of the existing WhatsApp conversation loop
- Verbose navigation must be interruptible — user can say "stop" or ask a question mid-route
- Podcast content must be summarisable — "give me the short version" should always work
- Translation must handle SA languages (Zulu, Xhosa, Sotho) not just English/Afrikaans

---

## Priority Order

1. Generated podcasts — lowest integration complexity, highest daily use value
2. Realtime translation — medium complexity, high impact for travel scenarios
3. Verbose navigation — highest complexity (GPS + real-time + Maps API), most transformative

---

## Dependencies

- ElevenLabs multilingual TTS (already integrated — check model supports target languages)
- Google Maps Directions API + Places API (new credential needed)
- Tavily web search (already integrated for podcast research)
- STT pipeline (Whisper/Deepgram — confirm bidirectional for translation)
