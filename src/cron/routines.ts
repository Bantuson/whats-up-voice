// src/cron/routines.ts
// Syncs user routines from Supabase to BullMQ job schedulers.
// Called at server startup — idempotent (upsertJobScheduler is safe to call multiple times).
// NEVER use node-cron or setInterval — BullMQ upsertJobScheduler only.
import { Queue } from 'bullmq'
import { redis } from '../queue/heartbeat'
import { supabase } from '../db/client'

export const cronQueue = new Queue('cron', { connection: redis })

const MORNING_BRIEFING_PATTERN = '0 7 * * 1-5'  // Mon–Fri 07:00
const EVENING_DIGEST_PATTERN   = '0 18 * * *'    // Daily 18:00

export async function syncUserRoutines(): Promise<void> {
  // Step 1: Fetch all users with an active row in user_profile
  const { data: profiles, error } = await supabase
    .from('user_profile')
    .select('user_id')

  if (error || !profiles) {
    console.error('[Cron] Failed to fetch user profiles:', error)
    return
  }

  for (const { user_id: userId } of profiles) {
    // Step 2: Register morning briefing for this user
    await cronQueue.upsertJobScheduler(
      `morning_briefing:${userId}`,
      { pattern: MORNING_BRIEFING_PATTERN },
      { name: 'morning_briefing', data: { userId }, opts: { attempts: 1 } }
    )

    // Step 3: Register evening digest for this user
    await cronQueue.upsertJobScheduler(
      `evening_digest:${userId}`,
      { pattern: EVENING_DIGEST_PATTERN },
      { name: 'evening_digest', data: { userId }, opts: { attempts: 1 } }
    )
  }

  // Step 4: Fetch and register custom reminders from routines table
  const { data: reminders } = await supabase
    .from('routines')
    .select('id, user_id, cron_pattern')
    .eq('enabled', true)
    .eq('type', 'reminder')

  for (const row of reminders ?? []) {
    await cronQueue.upsertJobScheduler(
      `reminder:${row.user_id}:${row.id}`,
      { pattern: row.cron_pattern },
      { name: 'reminder', data: { userId: row.user_id, routineId: row.id }, opts: { attempts: 1 } }
    )
  }

  console.log(`[Cron] syncUserRoutines: registered schedulers for ${profiles.length} users`)
}
