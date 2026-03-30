// src/routes/auth.ts
// POST /api/auth/send-otp  — send 4-digit SMS OTP to VI user phone via Twilio
// POST /api/auth/verify-otp — verify OTP, create users + caregivers + caregiver_links rows
// OTP state is held in an in-memory Map (no Redis dependency for auth flow).
// These routes are under /api/* but OTP verification does not require a pre-existing caregiver
// session (it establishes one). The Bearer token on /api/* still applies for route protection.
import { Hono } from 'hono'
import { supabase } from '../db/client'

export const authRouter = new Hono()

// In-memory OTP store — avoids Redis dependency for auth flow.
// Map<phone, { otp: string; expiresAt: number }>
const otpStore = new Map<string, { otp: string; expiresAt: number }>()

// ---------------------------------------------------------------------------
// POST /api/auth/send-otp
// Body: { phone: string }  — E.164 format e.g. "+27831000000"
// Generates 4-digit OTP, stores in memory with 10-min TTL,
// sends plain SMS (not WhatsApp) via Twilio REST API.
// Returns: { sent: true } on success, { error: string } on failure.
// ---------------------------------------------------------------------------
authRouter.post('/send-otp', async (c) => {
  let phone: string
  try {
    const body = await c.req.json() as { phone?: string }
    if (!body.phone) return c.json({ error: 'phone is required' }, 400)
    phone = body.phone.trim()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate E.164 format
  if (!/^\+\d{10,15}$/.test(phone)) {
    return c.json({ error: 'phone must be in E.164 format e.g. +27831000000' }, 400)
  }

  // Generate 4-digit OTP: Math.floor(1000 + Math.random() * 9000)
  const otp = String(Math.floor(1000 + Math.random() * 9000))

  // Store OTP in memory with 10-minute expiry
  otpStore.set(phone, { otp, expiresAt: Date.now() + 600_000 })

  // Send via Twilio SMS (not WhatsApp — works before sandbox join)
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken  = process.env.TWILIO_AUTH_TOKEN!
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER! // E.164 with + prefix

  const formBody = new URLSearchParams({
    From: fromNumber,       // plain SMS — no "whatsapp:" prefix
    To:   phone,
    Body: `Your VoiceApp setup code is: ${otp}. Valid for 10 minutes.`,
  })

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      console.error('[auth/send-otp] Twilio error:', res.status, err)
      return c.json({ error: `Twilio ${res.status}: ${err}` }, 502)
    }
    return c.json({ sent: true })
  } catch (err) {
    console.error('[auth/send-otp] fetch error:', err)
    return c.json({ error: 'SMS delivery failed' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/link-vi-user
// Body: { phone: string, name: string, caregiverId: string, caregiverEmail: string }
// No OTP required — caregiver is already verified via Supabase email OTP.
// Creates users row + caregivers row + caregiver_links row.
// Returns: { userId: string, linked: true } on success, { error: string } on failure.
// ---------------------------------------------------------------------------
authRouter.post('/link-vi-user', async (c) => {
  let phone: string, name: string, caregiverId: string, caregiverEmail: string
  try {
    const body = await c.req.json() as {
      phone?: string; name?: string; caregiverId?: string; caregiverEmail?: string
    }
    if (!body.phone || !body.name || !body.caregiverId || !body.caregiverEmail) {
      return c.json({ error: 'phone, name, caregiverId and caregiverEmail are required' }, 400)
    }
    phone          = body.phone.trim()
    name           = body.name.trim()
    caregiverId    = body.caregiverId.trim()
    caregiverEmail = body.caregiverEmail.trim()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!/^\+\d{10,15}$/.test(phone)) {
    return c.json({ error: 'phone must be in E.164 format e.g. +27831000000' }, 400)
  }

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single()

    let userId: string
    if (existingUser?.id) {
      userId = existingUser.id
      // Update name in case it changed
      await supabase.from('users').update({ name }).eq('id', userId)
    } else {
      const { data: newUser, error: userErr } = await supabase
        .from('users')
        .insert({ phone, name })
        .select('id')
        .single()
      if (userErr || !newUser) {
        console.error('[auth/link-vi-user] users insert error:', userErr)
        return c.json({ error: 'Failed to create user' }, 500)
      }
      userId = newUser.id
    }

    const { error: caregiverErr } = await supabase
      .from('caregivers')
      .upsert({ id: caregiverId, email: caregiverEmail }, { onConflict: 'id' })
    if (caregiverErr) {
      console.error('[auth/link-vi-user] caregivers upsert error:', caregiverErr)
      return c.json({ error: `Failed to register caregiver: ${caregiverErr.message}` }, 500)
    }

    const { error: linkErr } = await supabase
      .from('caregiver_links')
      .upsert({ caregiver_id: caregiverId, user_id: userId }, { onConflict: 'caregiver_id,user_id' })

    if (linkErr) {
      console.error('[auth/link-vi-user] caregiver_links upsert error:', linkErr)
      return c.json({ error: `Failed to link caregiver to user: ${linkErr.message}` }, 500)
    }

    return c.json({ userId, linked: true })
  } catch (err) {
    console.error('[auth/link-vi-user] unexpected error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
// Body: { phone: string, otp: string, name: string, caregiverId: string, caregiverEmail: string }
// Checks Redis otp:${phone}, creates users row + caregivers row + caregiver_links row.
// Returns: { userId: string, linked: true } on success, { error: string } on failure.
// ---------------------------------------------------------------------------
authRouter.post('/verify-otp', async (c) => {
  let phone: string, otp: string, name: string, caregiverId: string, caregiverEmail: string
  try {
    const body = await c.req.json() as {
      phone?: string
      otp?: string
      name?: string
      caregiverId?: string
      caregiverEmail?: string
    }
    if (!body.phone || !body.otp || !body.name || !body.caregiverId || !body.caregiverEmail) {
      return c.json({ error: 'phone, otp, name, caregiverId and caregiverEmail are required' }, 400)
    }
    phone         = body.phone.trim()
    otp           = body.otp.trim()
    name          = body.name.trim()
    caregiverId   = body.caregiverId.trim()
    caregiverEmail = body.caregiverEmail.trim()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Check OTP in memory store
  const stored = otpStore.get(phone)
  if (!stored || stored.otp !== otp || Date.now() > stored.expiresAt) {
    otpStore.delete(phone)
    return c.json({ error: 'Invalid or expired OTP' }, 401)
  }

  // Delete OTP after successful verification (one-time use)
  otpStore.delete(phone)

  try {
    // 1. Upsert VI user in users table (phone as unique key)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single()

    let userId: string
    if (existingUser?.id) {
      userId = existingUser.id
    } else {
      const { data: newUser, error: userErr } = await supabase
        .from('users')
        .insert({ phone })
        .select('id')
        .single()
      if (userErr || !newUser) {
        console.error('[auth/verify-otp] users insert error:', userErr)
        return c.json({ error: 'Failed to create user' }, 500)
      }
      userId = newUser.id
    }

    // 2. Upsert caregiver in caregivers table (caregiverId = auth.uid() from Supabase session)
    await supabase
      .from('caregivers')
      .upsert({ id: caregiverId, email: caregiverEmail, display_name: name }, { onConflict: 'id' })

    // 3. Upsert caregiver_links row (idempotent — UNIQUE(caregiver_id, user_id) handles duplicates)
    const { error: linkErr } = await supabase
      .from('caregiver_links')
      .upsert({ caregiver_id: caregiverId, user_id: userId }, { onConflict: 'caregiver_id,user_id' })

    if (linkErr) {
      console.error('[auth/verify-otp] caregiver_links upsert error:', linkErr)
      return c.json({ error: 'Failed to link caregiver to user' }, 500)
    }

    return c.json({ userId, linked: true })
  } catch (err) {
    console.error('[auth/verify-otp] unexpected error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
