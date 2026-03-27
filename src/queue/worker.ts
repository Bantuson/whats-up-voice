// src/queue/worker.ts
// BullMQ Worker for heartbeat jobs.
// Imported once at server startup (in server.ts) to begin processing.
//
// PHASE 2 STUB: processor logs the job and marks it complete.
// Plan 02-03 replaces processHeartbeat with the full surface decision gate.

import { Worker } from 'bullmq'
import { redis, type HeartbeatJobData } from './heartbeat'

/**
 * Heartbeat job processor — stub for Phase 2 wiring validation.
 * Plan 02-03 replaces this function body with the real gate logic.
 */
export async function processHeartbeat(job: { data: HeartbeatJobData }): Promise<void> {
  console.log(`[Worker] Processing job ${job.data.waMessageId} for user ${job.data.userId}`)
  // Stub: no-op. Plan 02-03 implements the surface decision gate here.
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
