// src/routes/webhook.ts
// Phase 05.1: Twilio WhatsApp inbound handler (replaces Meta Cloud API format)
// Raw body is available as c.get('rawBody') — set by middleware in server.ts
// Twilio sends form-encoded POST — never call c.req.json() here.
import { Hono } from 'hono'
import { supabase } from '../db/client'
import { normaliseE164 } from '../lib/phone'
import { verifyTwilioSignature } from '../lib/hmac'
import { enqueueHeartbeat } from '../queue/heartbeat'

export const webhookRouter = new Hono()

// POST /webhook/whatsapp — Twilio signature verification + message handler
// Twilio does NOT use a GET hub-verification step.
webhookRouter.post('/whatsapp', async (c) => {
  // STEP 1: TWILIO SIGNATURE VERIFICATION
  const rawBody  = c.get('rawBody') as string
  const signature = c.req.header('X-Twilio-Signature') ?? ''

  const params    = new URLSearchParams(rawBody)
  const paramsObj: Record<string, string> = {}
  params.forEach((v, k) => { paramsObj[k] = v })

  // Reconstruct public URL from forwarded headers (ngrok / reverse proxy)
  const proto = c.req.header('x-forwarded-proto') ?? (c.req.url.startsWith('https') ? 'https' : 'http')
  const host  = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host
  const url   = `${proto}://${host}${new URL(c.req.url).pathname}`

  console.log(`[Webhook] POST /whatsapp — url=${url} sig=${signature.slice(0, 10)}… body=${rawBody.slice(0, 80)}`)

  const signatureValid = verifyTwilioSignature(
    url,
    paramsObj,
    signature,
    process.env.TWILIO_AUTH_TOKEN!
  )

  if (!signatureValid) {
    console.warn(`[Webhook] Signature FAILED — reconstructed url: ${url}`)
    // In dev (no TWILIO_AUTH_TOKEN set or ngrok URL mismatch), skip verification
    // to unblock testing. Remove this bypass before going to production.
    if (process.env.NODE_ENV !== 'production' && process.env.SKIP_TWILIO_SIG === 'true') {
      console.warn('[Webhook] SKIP_TWILIO_SIG=true — proceeding without signature check')
    } else {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  // STEP 2: EXTRACT FIELDS
  // Twilio form fields (decoded by URLSearchParams):
  const fromRaw   = params.get('From') ?? ''   // "whatsapp:+27821234567"
  const messageSid: string = params.get('MessageSid') ?? ''
  const messageBody: string | null = params.get('Body') || null

  // Strip the "whatsapp:" prefix before normalising to E.164
  const rawPhone  = fromRaw.replace(/^whatsapp:/, '')   // "+27821234567"

  if (!messageSid || !rawPhone) {
    return c.json({ received: true }, 200)
  }

  // STEP 3: DETECT MEDIA TYPE
  const numMedia  = parseInt(params.get('NumMedia') ?? '0', 10)
  const mediaType: string | null = numMedia > 0
    ? (params.get('MediaContentType0')?.split(';')[0].trim() ?? null)
    : null
  const mediaId: string | null = numMedia > 0
    ? (params.get('MediaUrl0') ?? null)
    : null

  // DETECT LOCATION PIN MESSAGE (VI-NAV-02)
  // Twilio sends location pins with Latitude and Longitude form fields
  const latStr = params.get('Latitude')
  const lngStr = params.get('Longitude')
  const isLocationMessage = latStr !== null && lngStr !== null

  // STEP 4: NORMALISE SENDER PHONE (ISO-02)
  const phone = normaliseE164(rawPhone)

  // STEP 5: RESOLVE USER ID
  // If the sender is a known contact of an app user, route to that app user.
  // This handles the case where a contact (e.g. Fana) replies to a message sent
  // by the app's AI — the webhook must notify the APP USER, not create a user for
  // the contact. Falls back to upserting the sender as an app user (direct commands).
  let userId: string

  const { data: contactRow } = await supabase
    .from('user_contacts')
    .select('user_id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()

  if (contactRow) {
    console.log(`[Webhook] Sender ${phone} is a contact — routing to app user ${contactRow.user_id}`)
    userId = contactRow.user_id
  } else {
    const { data: userRow, error: upsertErr } = await supabase
      .from('users')
      .upsert({ phone }, { onConflict: 'phone' })
      .select('id')
      .single()
    if (upsertErr || !userRow) {
      console.error('[Webhook] User upsert failed:', upsertErr)
      return c.json({ error: 'DB error' }, 500)
    }
    userId = userRow.id
  }

  // NAVIGATION LOCATION UPDATE — if user is navigating and sends a location pin,
  // update their position and deliver next waypoint description.
  // This is processed asynchronously (fire-and-forget) to keep webhook response fast.
  if (isLocationMessage) {
    const lat = parseFloat(latStr!)
    const lng = parseFloat(lngStr!)
    if (!isNaN(lat) && !isNaN(lng)) {
      const { getPhase } = await import('../session/machine')
      if (getPhase(userId) === 'navigating') {
        const { updateLocation } = await import('../tools/navigation')
        updateLocation(userId, lat, lng).catch((err) => {
          console.error('[Webhook] navigation updateLocation error:', err)
        })
      }
    }
  }

  // STEP 6: PERSIST MESSAGE TO message_log (WA-05)
  // wa_message_id stores the Twilio MessageSid — column name unchanged in DB schema
  const { data: logRow, error: logErr } = await supabase
    .from('message_log')
    .insert({
      user_id:       userId,
      wa_message_id: messageSid,
      direction:     'in',
      from_phone:    phone,
      to_phone:      process.env.TWILIO_WHATSAPP_NUMBER!,
      body:          messageBody,
      media_type:    mediaType,
      media_id:      mediaId,
    })
    .select('id')
    .single()

  if (logErr || !logRow) {
    console.error('[Webhook] message_log insert failed:', logErr)
    return c.json({ error: 'DB error' }, 500)
  }

  const messageLogId: string = logRow.id

  // STEP 7: REDIS DEDUP GATE + BullMQ ENQUEUE
  // SET msg:{messageSid} 1 EX 7200 NX — prevents double-processing on Twilio retries
  const deduped = await enqueueHeartbeat({
    userId,
    messageLogId,
    messageSid,
    phone,
    messageBody,
    mediaType,
    mediaId,
  })

  if (!deduped) {
    console.warn(`[Webhook] Duplicate message ignored: ${messageSid}`)
    return c.json({ received: true }, 200)
  }

  // STEP 8: RETURN 200 IMMEDIATELY
  return c.json({ received: true }, 200)
})
