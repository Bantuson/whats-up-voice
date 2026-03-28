// src/cron/morningBriefing.ts
// Morning briefing processor.
// Briefing spoken order (CRON-03): greeting → load shedding → weather → overnight digest.
// Double-fire guard (CRON-02): skip if last_run within 55 seconds.
// TTS delivery: pushInterrupt — no direct ws.send here.
import { supabase } from '../db/client'
import { pushInterrupt } from '../ws/connections'
import { toolGetLoadShedding, toolGetWeather } from '../tools/ambient'

// ---------------------------------------------------------------------------
// Double-fire guard
// ---------------------------------------------------------------------------

const DOUBLE_FIRE_WINDOW_MS = 55_000

function wasRecentlyRun(lastRun: string | null): boolean {
  if (!lastRun) return false
  const elapsed = Date.now() - new Date(lastRun).getTime()
  return elapsed < DOUBLE_FIRE_WINDOW_MS
}

// ---------------------------------------------------------------------------
// Overnight digest helper
// ---------------------------------------------------------------------------

/**
 * Query message_log since last briefing run, sort priority contacts first.
 */
async function getOvernightDigest(userId: string, since: Date): Promise<string> {
  // Fetch messages received since last briefing run
  const { data: messages } = await supabase
    .from('message_log')
    .select('from_phone, body, media_type')
    .eq('user_id', userId)
    .eq('direction', 'in')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })

  if (!messages || messages.length === 0) {
    return 'You have no new messages.'
  }

  // Fetch contacts to identify priority senders
  const { data: contacts } = await supabase
    .from('user_contacts')
    .select('phone, name, is_priority')
    .eq('user_id', userId)

  const contactMap = new Map((contacts ?? []).map(c => [c.phone, c]))

  // Sort: priority contacts first, then non-priority
  const sorted = [...messages].sort((a, b) => {
    const aPriority = contactMap.get(a.from_phone)?.is_priority ? 0 : 1
    const bPriority = contactMap.get(b.from_phone)?.is_priority ? 0 : 1
    return aPriority - bPriority
  })

  const summaries = sorted.map((msg) => {
    const contact = contactMap.get(msg.from_phone)
    const name = contact?.name ?? msg.from_phone
    if (msg.media_type === 'audio' || msg.media_type === 'voice') {
      return `${name} sent you a voice note.`
    }
    const preview = msg.body ? msg.body.slice(0, 80) : 'a message'
    return `${name}: ${preview}`
  })

  return `You have ${messages.length} new message${messages.length !== 1 ? 's' : ''}. ${summaries.join(' ')}`
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export interface BriefingJobData {
  userId: string
}

export async function processMorningBriefing(job: { data: BriefingJobData }): Promise<void> {
  const { userId } = job.data

  // CRON-02: Double-fire protection — check last_run on the routines table
  const { data: routine } = await supabase
    .from('routines')
    .select('last_run')
    .eq('user_id', userId)
    .eq('type', 'morning_briefing')
    .single()

  if (wasRecentlyRun(routine?.last_run ?? null)) {
    console.log(`[Cron] Morning briefing skipped for ${userId} — last_run within 55s`)
    return
  }

  const since = routine?.last_run ? new Date(routine.last_run) : new Date(Date.now() - 24 * 60 * 60 * 1000)

  // CRON-03: Parallel fetch — all three data sources at once
  const signal = AbortSignal.timeout(8_000)
  const [loadSheddingText, weatherText, digestText] = await Promise.all([
    toolGetLoadShedding(signal),
    toolGetWeather(signal),
    getOvernightDigest(userId, since),
  ])

  // CRON-03: Spoken order — greeting → load shedding → weather → digest
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.'

  const briefingText = [greeting, loadSheddingText, weatherText, digestText].join(' ')

  // Deliver via TTS → WebSocket (CRON-04: Afrikaans handled transparently by streamSpeech)
  await pushInterrupt(userId, briefingText)

  // Update last_run timestamp — upsert in case routine row does not exist yet
  await supabase
    .from('routines')
    .upsert(
      { user_id: userId, type: 'morning_briefing', last_run: new Date().toISOString(), enabled: true },
      { onConflict: 'user_id,type' }
    )

  console.log(`[Cron] Morning briefing delivered to ${userId}`)
}
