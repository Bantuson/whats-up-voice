# Phase 05.1 — Twilio WhatsApp Migration

**Inserted:** 2026-03-28
**Reason:** Gap discovered during Phase 5 demo verification checkpoint.
**Priority:** Blocking — server cannot start without valid credentials.

---

## The Problem

Phases 2–4 built the WhatsApp integration against **Meta's Cloud API** (Business API).
The project's actual credentials (`.env.local`) are **Twilio**, not Meta.
These are incompatible at every layer — payload format, HMAC scheme, and send API.

---

## Protocol Mismatch Detail

| Layer | Current (Meta) | Required (Twilio) |
|---|---|---|
| Webhook payload | `entry[0].changes[0].value.messages[0]` (JSON) | Form-encoded: `From`, `To`, `Body`, `MessageSid` |
| Inbound phone format | `"27821234567"` (no `+`) | `"whatsapp:+27821234567"` (prefixed) |
| Signature header | `x-hub-signature-256: sha256=<hex>` | `X-Twilio-Signature: <base64 HMAC>` |
| HMAC input | `rawBody` string + `WHATSAPP_APP_SECRET` | URL + sorted POST params + `TWILIO_AUTH_TOKEN` |
| Hub verification | GET `hub.mode` / `hub.verify_token` / `hub.challenge` | Not used — Twilio uses POST only |
| Outbound send | `POST graph.facebook.com/v17.0/{PHONE_NUMBER_ID}/messages` (JSON) | Twilio SDK: `client.messages.create({ from, to, body })` |
| Message ID field | `waMessageId` (from Meta payload) | `MessageSid` (from Twilio payload) |
| Env credentials | `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` |

---

## Files to Change

### `src/env.ts`
Remove: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`
Add: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`

### `src/lib/hmac.ts`
Replace `verifyWhatsAppHmac` (HMAC-SHA256 of raw body) with `verifyTwilioSignature`:
- Twilio signature = base64(HMAC-SHA256(url + sorted_params_concat, TWILIO_AUTH_TOKEN))
- Use Twilio's helper library: `twilio.validateRequest(authToken, signature, url, params)`
- Or implement manually using `crypto.createHmac('sha256', authToken).update(url + sortedParams).digest('base64')`

### `src/routes/webhook.ts`
- Remove GET hub-verification handler (Twilio doesn't use it)
- Replace HMAC check: `x-hub-signature-256` → `X-Twilio-Signature`
- Replace payload parser: JSON `entry[0].changes[0].value.messages[0]` → form body `From`, `To`, `Body`, `MessageSid`
- Phone normalisation: strip `whatsapp:` prefix before calling `normaliseE164`
- `waMessageId` → `MessageSid` (rename field throughout, or alias)
- `to_phone`: use `process.env.TWILIO_WHATSAPP_NUMBER` instead of `+${WHATSAPP_PHONE_NUMBER_ID}`

### `src/routes/api.ts` (outbound send)
- Replace Meta graph API call with Twilio SDK:
  ```typescript
  import twilio from 'twilio'
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${recipientPhone}`,
    body: messageText,
  })
  ```

### `tests/webhookHandler.test.ts`
- Update mock payload to Twilio form-encoded format
- Update HMAC mock to Twilio signature scheme
- Rename `waMessageId` → `MessageSid` in test assertions

### `package.json`
- Add: `twilio` SDK (`bun add twilio`)
- The `openai` package stays (used for embeddings)

---

## What Does NOT Change

- `src/lib/phone.ts` — `normaliseE164` still correct, just called after stripping `whatsapp:` prefix
- `src/db/client.ts` — Supabase client unchanged
- `src/agent/orchestrator.ts` — Claude integration unchanged
- `src/memory/` — episodic memory unchanged
- `src/queue/heartbeat.ts` + `worker.ts` — BullMQ queue unchanged; `waMessageId` field rename is the only touch
- `frontend/` — entirely unchanged
- All other test files — only `webhookHandler.test.ts` needs updates

---

## Env Vars Summary

**Remove from `.env.local`:**
```
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_VERIFY_TOKEN
```

**Add to `.env.local`:**
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=+14155238886   # sandbox or your approved number
```

**Unchanged:**
```
ANTHROPIC_API_KEY
OPENAI_API_KEY
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID_EN
ELEVENLABS_VOICE_ID_AF
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
API_BEARER_TOKEN
ESKOMSEPUSH_API_KEY
OPENWEATHER_API_KEY
TAVILY_API_KEY
```

---

## Twilio WhatsApp Setup Notes

- Sandbox number: `+14155238886` (for testing without WABA approval)
- Sandbox join: user must send "join <sandbox-keyword>" to activate
- Production: requires WhatsApp Business profile approval via Twilio console
- Webhook URL: `POST /webhook/whatsapp` (no GET verification needed)
- Twilio console: console.twilio.com → Messaging → Try it out → Send a WhatsApp message
