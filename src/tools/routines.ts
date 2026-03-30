// src/tools/routines.ts
// Agent tool for creating user-defined scheduled routines from voice commands.
import { supabase } from '../db/client'

export async function toolCreateRoutine(
  userId: string,
  routineType: string,
  cronExpression: string,
  label: string,
): Promise<{ created: true; message: string }> {
  const { data, error } = await supabase
    .from('routines')
    .insert({
      user_id: userId,
      routine_type: routineType,
      cron_expression: cronExpression,
      label,
      enabled: true,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create routine: ${error.message}`)

  // Register with BullMQ scheduler immediately (non-fatal if Redis unavailable)
  try {
    const { getCronQueue } = await import('../cron/routines')
    const queue = await getCronQueue()
    await queue.upsertJobScheduler(
      `reminder:${userId}:${data.id}`,
      { pattern: cronExpression },
      { name: 'reminder', data: { userId, routineId: data.id }, opts: { attempts: 1 } }
    )
  } catch {
    // Redis may not be available — routine is saved in DB and will sync on next restart
  }

  return {
    created: true,
    message: `Your routine has been saved. ${label} will run automatically on the schedule you set.`,
  }
}
