// src/tools/contacts.ts
// ISO-01: EVERY Supabase query includes .eq('user_id', userId) — service_role bypasses RLS
import { supabase } from '../db/client'
import { normaliseE164 } from '../lib/phone'

export async function toolGetContact(userId: string, name: string): Promise<{ name: string; phone: string; is_priority: boolean } | null> {
  const { data } = await supabase
    .from('user_contacts')
    .select('name, phone, is_priority')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .limit(1)
  return data?.[0] ?? null
}

export async function toolSaveContact(
  userId: string,
  name: string,
  phone: string,
): Promise<{ saved: true; name: string; phone: string }> {
  const normalisedPhone = normaliseE164(phone)
  await supabase
    .from('user_contacts')
    .insert({ user_id: userId, name, phone: normalisedPhone, is_priority: false })
  return { saved: true, name, phone: normalisedPhone }
}

export async function toolListContacts(userId: string): Promise<Array<{ name: string; phone: string; is_priority: boolean }>> {
  const { data } = await supabase
    .from('user_contacts')
    .select('name, phone, is_priority')
    .eq('user_id', userId)
    .order('name')
  return data ?? []
}

export async function toolSetPriority(
  userId: string,
  name: string,
  priority: boolean,
): Promise<{ updated: boolean }> {
  const { data } = await supabase
    .from('user_contacts')
    .update({ is_priority: priority })
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .select('name')
  return { updated: (data?.length ?? 0) > 0 }
}
