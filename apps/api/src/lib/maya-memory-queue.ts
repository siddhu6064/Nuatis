import { Queue } from 'bullmq'
import { createBullMQConnection } from './bullmq-connection.js'

let _queue: Queue | null = null

function getMayaMemoryQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('voice-session-complete', { connection: createBullMQConnection() })
  }
  return _queue
}

/**
 * Fire-and-forget: enqueue a memory extraction job after a Maya voice session ends.
 * Never throws — failure is logged and silently dropped.
 */
export function enqueueMayaMemoryExtraction(
  tenantId: string,
  sessionId: string,
  phone: string
): void {
  getMayaMemoryQueue()
    .add('extract', { tenantId, sessionId, phone })
    .catch((err) => console.warn('[maya-memory-queue] failed to enqueue memory extraction:', err))
}
