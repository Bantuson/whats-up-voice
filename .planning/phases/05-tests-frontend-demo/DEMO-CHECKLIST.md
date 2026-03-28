# VoiceApp Demo Checklist

**Phase:** Demo day — run this checklist in order, top to bottom.
**Time budget:** 30 minutes before demo start.

**Test suite status (automated — run before demo):** 201 pass, 0 fail (verified 2026-03-28 after Twilio migration)

---

## 1. Test Suite (run first)

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| All tests pass | `bun test` | 85+ passing, 0 failing | [ ] |
| 11 suite names in output | grep in bun test output | All 11 present | [ ] |

## 2. Environment Variables

| Variable | Where to find | Status |
|----------|---------------|--------|
| TWILIO_ACCOUNT_SID | console.twilio.com → Account Info | [ ] |
| TWILIO_AUTH_TOKEN | console.twilio.com → Account Info | [ ] |
| TWILIO_WHATSAPP_NUMBER | console.twilio.com → Messaging → Senders (e.g. +14155238886) | [ ] |
| ANTHROPIC_API_KEY | console.anthropic.com | [ ] |
| OPENAI_API_KEY | platform.openai.com | [ ] |
| ELEVENLABS_API_KEY | elevenlabs.io → Profile | [ ] |
| ELEVENLABS_VOICE_ID_EN | elevenlabs.io → Voice Library → note ID of EN voice | [ ] |
| ELEVENLABS_VOICE_ID_AF | elevenlabs.io → Voice Library → note ID of AF voice | [ ] |
| REDIS_URL | Upstash or Railway dashboard | [ ] |
| SUPABASE_URL | Supabase project settings | [ ] |
| SUPABASE_SERVICE_ROLE_KEY | Supabase project settings → API | [ ] |
| API_BEARER_TOKEN | Your .env file (any string) | [ ] |
| ESKOMSEPUSH_API_KEY | eskomsepush.app → API | [ ] |
| OPENWEATHER_API_KEY | openweathermap.org → API keys | [ ] |
| TAVILY_API_KEY | app.tavily.com | [ ] |

## 3. Twilio / WhatsApp

| Check | Action | Status |
|-------|--------|--------|
| Sandbox joined | Twilio console → Messaging → Try it out → Send a WhatsApp message to join sandbox | [ ] |
| Webhook URL configured | Twilio → Messaging → Senders → your sandbox number → Webhook URL = `https://YOUR_URL/webhook/whatsapp` | [ ] |
| Test phone registered | Send "join [sandbox-word]" from test phone — confirm Twilio shows it joined | [ ] |
| Inbound round-trip | Send a WhatsApp message from test phone → confirm server logs show [Webhook] and job enqueued | [ ] |

## 4. Backend Health

| Check | Command | Expected | Status |
|-------|---------|----------|--------|
| Server starts | `bun run src/server.ts` | No errors | [ ] |
| Health check | `curl http://localhost:3000/health` | `{"status":"ok"}` | [ ] |
| Redis connected | Server logs on start | No "ECONNREFUSED" | [ ] |
| Supabase connected | `bun test tests/schema.test.ts` | 0 failing | [ ] |

## 5. Frontend

| Check | Action | Status |
|-------|--------|--------|
| Dev server starts | `cd frontend` then `bunx vite` (not `bun run dev` — bun Windows bug with .exe scripts) | Port 5173, no errors | [ ] |
| Login page loads | Open http://localhost:5173 | Redirects to /login | [ ] |
| Enter phone + Connect | Enter +27 number | Redirects to /dashboard | [ ] |
| Dashboard renders | Check waveform shows | 24 grey bars visible | [ ] |
| All 7 nav pages load | Click each nav item | No blank pages | [ ] |

## 6. ElevenLabs Voice IDs

| Check | Action | Status |
|-------|--------|--------|
| English SA voice selected | elevenlabs.io → Voice Library → filter "South Africa" | Note voice ID | [ ] |
| ELEVENLABS_VOICE_ID set in .env | Check .env | Correct voice ID | [ ] |
| Afrikaans voice selected (if needed) | elevenlabs.io → Voice Library → filter "Afrikaans" | Note voice ID | [ ] |
| TTS test | `POST /api/voice/command` with "hello" | Audio plays via WebSocket | [ ] |

## 7. EskomSePush

| Check | Action | Status |
|-------|--------|--------|
| Area ID confirmed | eskomsepush.app → Search your area | Note area ID | [ ] |
| ESKOMSEPUSH_AREA_ID in .env | Check .env | Valid ID or "johannesburg" | [ ] |
| Load shedding query | Ask agent "load shedding today" | Response in < 3 seconds | [ ] |

## 8. End-to-End Demo Rehearsal

Run this at least 24 hours before demo day. Run again 1 hour before.

| Step | Action | Expected | Status |
|------|--------|----------|--------|
| 1. Receive WhatsApp | Send message from test phone | Appears in heartbeat feed | [ ] |
| 2. Heartbeat interrupt | Confirm decision = interrupt | Feed row is green | [ ] |
| 3. TTS read-aloud | WebSocket client receives audio | Spoken aloud | [ ] |
| 4. Voice compose | POST /api/voice/command "send message to Naledi, I'll be late" | session = awaiting_approval | [ ] |
| 5. Approval | POST with "yes" transcript | message_log has direction=out row | [ ] |
| 6. Morning briefing | Trigger via BullMQ | Load shedding spoken before weather | [ ] |
| 7. Memory stored | Check memory_store | New row with non-null embedding | [ ] |
| 8. Memory recalled | Ask about topic from step 4 | Memory snippet in system prompt log | [ ] |

---

**Signed off by:** ___________  **Date/time:** ___________
