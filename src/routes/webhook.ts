// src/routes/webhook.ts
// Phase 2: GET (hub verification), POST (HMAC check + message handling)
// Raw body is available as c.get('rawBody') — set by middleware in server.ts
import { Hono } from 'hono'
import { supabase } from '../db/client'
import { normaliseE164 } from '../lib/phone'
import { verifyWhatsAppHmac } from '../lib/hmac'
import { enqueueHeartbeat } from '../queue/heartbeat'

export const webhookRouter = new Hono()

// GET /webhook/whatsapp — Meta hub verification handshake (WA-01)
webhookRouter.get('/whatsapp', (c) => {
  const mode      = c.req.query('hub.mode')
  const token     = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge ?? '', 200)
  }
  return c.text('Forbidden', 403)
})

// POST /webhook/whatsapp — HMAC verification + message handler (WA-02 through WA-05)
webhookRouter.post('/whatsapp', async (c) => {
  // STEP 1: HMAC VERIFICATION
  // rawBody was captured by Phase 1 middleware in server.ts.
  // NEVER call c.req.json() here — that would consume the stream
  // after the middleware has already consumed it (it would return '').
  const rawBody = c.get('rawBody') as string

  const signature = c.req.header('x-hub-signature-256') ?? ''

  const signatureValid = verifyWhatsAppHmac(
    rawBody,
    signature,
    process.env.WHATSAPP_APP_SECRET!
  )

  if (!signatureValid) {
    console.warn('[Webhook] HMAC verification failed')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // STEP 2: PARSE PAYLOAD (only after HMAC passes)
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  // STEP 3: EVENT TYPE BRANCHING
  // WhatsApp sends two top-level event types:
  //   - value.messages  → real inbound text/media messages
  //   - value.statuses  → delivery receipts, read receipts — DISCARD (WA-04)
  const entry   = payload?.entry?.[0]
  const changes = entry?.changes?.[0]
  const value   = changes?.value

  // Discard status callbacks immediately — never enqueue (WA-04)
  if (value?.statuses) {
    return c.json({ received: true }, 200)
  }

  // Only continue for message events
  if (!value?.messages?.length) {
    return c.json({ received: true }, 200)
  }

  const message = value.messages[0]
  const waMessageId: string = message.id
  const rawPhone: string    = message.from // WhatsApp sends without + prefix, e.g. "27821234567"

  // STEP 4: NORMALISE SENDER PHONE (ISO-02)
  const phone = normaliseE164(rawPhone)

  // STEP 5: UPSERT SENDER TO users (WA-03)
  // Use .upsert() with onConflict on 'phone' — idempotent for repeat senders
  const { data: userRow, error: upsertErr } = await supabase
    .from('users')
    .upsert({ phone }, { onConflict: 'phone' })
    .select('id')
    .single()

  if (upsertErr || !userRow) {
    console.error('[Webhook] User upsert failed:', upsertErr)
    return c.json({ error: 'DB error' }, 500)
  }

  const userId: string = userRow.id

  // STEP 6: PERSIST MESSAGE TO message_log (WA-05)
  // direction = 'in'; our WABA phone number ID is the 'to' side
  const messageBody: string | null = message.text?.body ?? null
  const mediaType: string | null   = message.type !== 'text' ? message.type : null
  const mediaId: string | null     = message[message.type]?.id ?? null

  const { data: logRow, error: logErr } = await supabase
    .from('message_log')
    .insert({
      user_id:      userId,
      wa_message_id: waMessageId,
      direction:    'in',
      from_phone:   phone,
      to_phone:     `+${process.env.WHATSAPP_PHONE_NUMBER_ID}`,
      body:         messageBody,
      media_type:   mediaType,
      media_id:     mediaId,
    })
    .select('id')
    .single()

  if (logErr || !logRow) {
    console.error('[Webhook] message_log insert failed:', logErr)
    return c.json({ error: 'DB error' }, 500)
  }

  const messageLogId: string = logRow.id

  // STEP 7: REDIS DEDUP GATE + BullMQ ENQUEUE
  // enqueueHeartbeat performs: SET msg:{waMessageId} 1 EX 7200 NX
  // NX = only set if NOT exists. Returns true on first occurrence, false on duplicate.
  // This prevents double-processing if WhatsApp retries the webhook delivery.
  const deduped = await enqueueHeartbeat({
    userId,
    messageLogId,
    waMessageId,
    phone,
    messageBody,
    mediaType,
    mediaId,
  })

  if (!deduped) {
    // Duplicate delivery — already processed, return 200 to stop WhatsApp retrying
    console.warn(`[Webhook] Duplicate message ignored: ${waMessageId}`)
    return c.json({ received: true }, 200)
  }

  // STEP 8: RETURN 200 IMMEDIATELY (never block on worker)
  return c.json({ received: true }, 200)
})
