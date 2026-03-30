// src/tools/whatsapp.ts
// ISO-01: EVERY Supabase query includes .eq('user_id', userId) — service_role bypasses RLS
import { supabase } from '../db/client'
import { transition, setPendingMessage } from '../session/machine'
import { formatPhoneForSpeech } from '../lib/phone'

export async function toolReadMessages(userId: string, limit = 5): Promise<string> {
  const { data, error } = await supabase
    .from('message_log')
    .select('id, from_phone, body, created_at, direction')
    .eq('user_id', userId)
    .eq('direction', 'in')
    .is('read_at', null)  // Only unread messages — prevents re-reading already-heard messages
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data || data.length === 0) return 'You have no new messages.'

  // Mark all fetched messages as read immediately
  const ids = data.map((m) => m.id as string)
  await supabase
    .from('message_log')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .eq('user_id', userId)

  const lines: string[] = []
  for (const msg of data) {
    // Resolve sender name — CONTACT-05: use name when known, never raw phone
    const { data: contact } = await supabase
      .from('user_contacts')
      .select('name')
      .eq('user_id', userId)
      .eq('phone', msg.from_phone)
      .single()
    const sender = contact?.name ?? formatPhoneForSpeech(msg.from_phone ?? '')
    lines.push(`From ${sender}: ${msg.body ?? 'a voice note'}`)
  }
  return lines.join('. ')
}

export async function toolSendMessage(
  userId: string,
  toPhone: string,
  body: string,
  toName?: string,
): Promise<{ queued: true; readBack: string }> {
  // NEVER call WhatsApp API here — only stage for approval (AGENT-04, Pitfall 3)
  transition(userId, 'composing')
  setPendingMessage(userId, { to: toPhone, toName, body })
  transition(userId, 'awaiting_approval')
  const name = toName ?? formatPhoneForSpeech(toPhone)
  return {
    queued: true,
    readBack: `Ready to send to ${name}: "${body}". Say yes to confirm, or no to cancel.`,
  }
}

export async function toolResolveContact(userId: string, name: string): Promise<{ phone: string; name: string } | null> {
  const { data } = await supabase
    .from('user_contacts')
    .select('phone, name')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .limit(1)
  return data?.[0] ?? null
}
