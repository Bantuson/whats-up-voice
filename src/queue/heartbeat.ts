// src/queue/heartbeat.ts
// BullMQ heartbeat queue + ioredis connection.
//
// CONSTRAINT: IORedis must be constructed with { maxRetriesPerRequest: null }
// or BullMQ will throw at startup. Never use Bun.redis here.
//
// enqueueHeartbeat() is called by the webhook handler (Plan 02-01).
// The Worker processor is registered separately in src/queue/worker.ts (Plan 02-03)
// to keep this file importable in tests without spawning real workers.

import { Queue } from 'bullmq'
import IORedis from 'ioredis'

// Singleton ioredis connection shared by Queue, Worker, and dedup key operations.
// maxRetriesPerRequest: null is REQUIRED by BullMQ — do not remove.
export const redis = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
})

redis.on('connect', () => console.log('[Redis] Connected'))
redis.on('error', (err) => console.error('[Redis] Error:', err))

// The heartbeat queue — jobs flow from webhook → queue → worker (Plan 02-03)
export const heartbeatQueue = new Queue('heartbeat', { connection: redis })

/**
 * Payload carried by every heartbeat BullMQ job.
 * Defined here so Plan 02-01 (webhook) and Plan 02-03 (worker) share the same type.
 */
export interface HeartbeatJobData {
  userId:        string   // UUID from users table
  messageLogId:  string   // UUID from message_log table
  waMessageId:   string   // WhatsApp message ID (used as dedup key)
  phone:         string   // E.164 sender phone
  messageBody:   string | null
  mediaType:     string | null
  mediaId:       string | null
}

/**
 * Enqueue a heartbeat job with Redis dedup protection.
 *
 * Dedup key: SET msg:{waMessageId} 1 EX 7200 NX
 *   - EX 7200 = 2-hour TTL (WhatsApp retries within this window)
 *   - NX      = only set if NOT exists → returns 'OK' on first call, null on duplicate
 *
 * @returns true  — job was enqueued (first occurrence)
 * @returns false — duplicate; job was NOT enqueued
 */
export async function enqueueHeartbeat(data: HeartbeatJobData): Promise<boolean> {
  const dedupKey = `msg:${data.waMessageId}`
  const result = await redis.set(dedupKey, '1', 'EX', 7200, 'NX')

  if (result === null) {
    // Key already existed — this is a duplicate delivery from WhatsApp
    return false
  }

  await heartbeatQueue.add('process', data, {
    attempts: 1,
    timeout:  15_000,  // ms — worker aborts if processor takes longer
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50 },
  })

  return true
}
