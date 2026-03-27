// src/queue/heartbeat.ts
// NOTE: This is a stub created by Plan 02-01 to satisfy TypeScript imports.
// Plan 02-02 replaces this with the full BullMQ + Redis dedup implementation.

export interface HeartbeatJobData {
  userId: string
  messageLogId: string
  waMessageId: string
  phone: string
  messageBody: string | null
  mediaType: string | null
  mediaId: string | null
}

/**
 * Enqueue a heartbeat job for a new inbound WhatsApp message.
 * Performs Redis dedup (SET NX) to prevent double-processing.
 *
 * @returns true if enqueued (first occurrence), false if duplicate
 *
 * STUB — Plan 02-02 provides the real implementation with BullMQ + ioredis.
 */
export async function enqueueHeartbeat(_job: HeartbeatJobData): Promise<boolean> {
  // Stub: always returns true (no dedup). Plan 02-02 overwrites this.
  return true
}
