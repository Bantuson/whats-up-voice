// scripts/test-queue.ts
// Run once: bun run scripts/test-queue.ts
// Confirms ioredis connects, job is enqueued, worker processes it, and exits cleanly.
// Delete or ignore this file after Phase 2 validation.

import '../src/queue/worker'  // spawn worker in this process
import { enqueueHeartbeat } from '../src/queue/heartbeat'

const testJob = {
  userId:       '00000000-0000-0000-0000-000000000001',
  messageLogId: '00000000-0000-0000-0000-000000000002',
  waMessageId:  `test-${Date.now()}`,
  phone:        '+27821234567',
  messageBody:  'Test message from synthetic job',
  mediaType:    null,
  mediaId:      null,
}

console.log('[Test] Enqueueing synthetic heartbeat job...')
const queued = await enqueueHeartbeat(testJob)
console.log('[Test] Enqueued:', queued)

// Enqueue same job again — should return false (dedup)
const duplicate = await enqueueHeartbeat(testJob)
console.log('[Test] Duplicate blocked (should be false):', duplicate)

// Give the worker 2 seconds to process
await Bun.sleep(2000)
console.log('[Test] Check logs above for [Worker] Processing job and [Worker] Job completed')
process.exit(0)
