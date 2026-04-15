import { Queue } from 'bullmq'
import { createBullMQConnection } from './bullmq-connection.js'

let _queue: Queue | null = null

export function getLeadScoreQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('lead-score-compute', { connection: createBullMQConnection() })
  }
  return _queue
}

let _bulkQueue: Queue | null = null

export function getLeadScoreBulkQueue(): Queue {
  if (!_bulkQueue) {
    _bulkQueue = new Queue('lead-score-bulk', { connection: createBullMQConnection() })
  }
  return _bulkQueue
}

/**
 * Fire-and-forget: enqueue a score recompute for a contact.
 */
export function enqueueScoreCompute(tenantId: string, contactId: string, trigger: string): void {
  getLeadScoreQueue()
    .add(
      'compute',
      { tenantId, contactId, trigger },
      { attempts: 2, backoff: { type: 'fixed', delay: 5000 } }
    )
    .catch((err) => console.error('[lead-score-queue] Failed to enqueue:', err))
}
