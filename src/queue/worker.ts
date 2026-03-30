// src/queue/worker.ts
// BullMQ Worker for heartbeat jobs — six-priority surface decision gate.
// Imported once at server startup (in server.ts) to begin processing.
//
// Decision priority order (HB-02):
//   1. Quiet hours              → silent
//   2. Priority contact flag    → interrupt
//   3. Unknown number           → interrupt (CONTACT-01: digit-by-digit phone)
//   4. Session state            → skip (composing / awaiting_approval)
//   5. Message type (audio)     → interrupt; (text) → batch
//   6. Default                  → batch

import { Worker } from 'bullmq'
import { redis, type HeartbeatJobData } from './heartbeat'
import { supabase } from '../db/client'
import { getPhase } from '../session/machine'
import { formatPhoneForSpeech } from '../lib/phone'
import { isQuietHours, parseTimeHour } from '../lib/quietHours'

export async function processHeartbeat(job: { data: HeartbeatJobData }): Promise<void> {
  const { userId, messageLogId, phone, messageBody, mediaType } = job.data

  // ------------------------------------------------------------------
  // STEP 1: Load user_profile for quiet hours + contact list
  // All queries MUST include .eq('user_id', userId) — service_role bypasses RLS
  // ------------------------------------------------------------------
  const { data: profile } = await supabase
    .from('user_profile')
    .select('quiet_hours_start, quiet_hours_end')
    .eq('user_id', userId)
    .single()

  // ------------------------------------------------------------------
  // PRIORITY 1: Quiet hours (HB-06)
  // If user has quiet hours configured and current time is within them → silent
  // ------------------------------------------------------------------
  const startHour = parseTimeHour(profile?.quiet_hours_start ?? null)
  const endHour   = parseTimeHour(profile?.quiet_hours_end ?? null)

  if (startHour !== null && endHour !== null && isQuietHours(startHour, endHour)) {
    await logDecision(userId, messageLogId, 'silent', 'quiet hours active')
    return
  }

  // ------------------------------------------------------------------
  // PRIORITY 2 + 3: Look up sender in user_contacts
  // Returns contact row if known, null if unknown number
  // ------------------------------------------------------------------
  const { data: contact } = await supabase
    .from('user_contacts')
    .select('name, is_priority')
    .eq('user_id', userId)
    .eq('phone', phone)
    .single()

  // PRIORITY 2: Priority contact flag
  if (contact?.is_priority === true) {
    const spoken = `Priority message from ${contact.name}: ${messageBody ?? 'a voice note'}. Say reply to ${contact.name} to respond.`
    await pushInterrupt(userId, spoken, true)
    await markMessageRead(messageLogId, userId)
    await logDecision(userId, messageLogId, 'interrupt', 'priority contact')
    return
  }

  // PRIORITY 3: Unknown number (CONTACT-01)
  // contact is null → no row found for this phone
  if (!contact) {
    const spokenPhone = formatPhoneForSpeech(phone)
    const spoken = `You have a message from an unknown number: ${spokenPhone}. Would you like to save this contact?`
    await pushInterrupt(userId, spoken, true)
    await markMessageRead(messageLogId, userId)
    await logDecision(userId, messageLogId, 'interrupt', 'unknown number')
    return
  }

  // ------------------------------------------------------------------
  // PRIORITY 4: Session state (HB-02)
  // If user is composing or awaiting approval, do not interrupt → skip
  // ------------------------------------------------------------------
  const sessionPhase = getPhase(userId)
  if (sessionPhase === 'composing' || sessionPhase === 'awaiting_approval') {
    await logDecision(userId, messageLogId, 'skip', `session state: ${sessionPhase}`)
    return
  }

  // ------------------------------------------------------------------
  // PRIORITY 5: Message type
  // Voice notes (audio/ogg) warrant an interrupt; text goes to batch
  // ------------------------------------------------------------------
  if (mediaType === 'audio' || mediaType === 'voice') {
    const spoken = `Voice note from ${contact.name}. Say play voice note to listen.`
    await pushInterrupt(userId, spoken, true)
    await markMessageRead(messageLogId, userId)
    await logDecision(userId, messageLogId, 'interrupt', 'voice note')
    return
  }

  // ------------------------------------------------------------------
  // PRIORITY 6 (DEFAULT): Read message content directly + Batch
  // Known contact, normal session, text message → read body aloud,
  // then prompt for reply. Also log as batch for morning digest.
  // ------------------------------------------------------------------
  const spoken = messageBody
    ? `New message from ${contact.name}: ${messageBody}. Say reply to ${contact.name} to respond.`
    : `New message from ${contact.name}. Say read messages to hear the attachment.`
  await pushInterrupt(userId, spoken, true)
  await markMessageRead(messageLogId, userId)
  await logDecision(userId, messageLogId, 'batch', 'default: text message from known contact')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mark a message as read in message_log so it won't appear in the queue again
 * and won't be re-read by toolReadMessages.
 */
async function markMessageRead(messageLogId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('message_log')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageLogId)
    .eq('user_id', userId)
  if (error) console.error('[Worker] message_log read_at update failed:', error)
}

/**
 * Log a heartbeat decision to heartbeat_log.
 * HB-05: skip and silent always log here. interrupt and batch also log.
 */
async function logDecision(
  userId: string,
  messageLogId: string,
  decision: 'interrupt' | 'batch' | 'silent' | 'skip',
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('heartbeat_log')
    .insert({
      user_id:    userId,
      message_id: messageLogId,
      decision,
      reason,
    })
  if (error) console.error('[Worker] heartbeat_log insert failed:', error)
}

/**
 * Push spoken text to the user via TTS + WebSocket audio stream.
 * Replaced in Phase 4 — calls streamSpeech via connections.pushInterrupt.
 * If no WebSocket is connected, logs only — does not throw.
 */
async function pushInterrupt(userId: string, spoken: string, autoListen = false): Promise<void> {
  const { pushInterrupt: deliver } = await import('../ws/connections')
  await deliver(userId, spoken, autoListen)
  console.log(`[Worker] Interrupt pushed to ${userId}: ${spoken.slice(0, 60)}`)
}

export const heartbeatWorker = new Worker<HeartbeatJobData>(
  'heartbeat',
  processHeartbeat,
  {
    connection: redis,
    concurrency: 5,
  }
)

heartbeatWorker.on('completed', (job) => {
  console.log(`[Worker] Job completed: ${job.id}`)
})

heartbeatWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job failed: ${job?.id}`, err)
})
