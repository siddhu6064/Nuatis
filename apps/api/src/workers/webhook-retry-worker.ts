import { Queue, Worker } from 'bullmq'
import { randomUUID } from 'crypto'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import type { OpsActivityEvent } from '../lib/ops-copilot-client.js'

const QUEUE_NAME = 'ops-copilot-retry'

let retryQueue: Queue | null = null

export function getRetryQueue(): Queue {
  if (!retryQueue) {
    retryQueue = new Queue(QUEUE_NAME, { connection: createBullMQConnection() })
  }
  return retryQueue
}

/** Enqueue a failed event for retry with exponential backoff. */
export async function enqueueRetry(payload: OpsActivityEvent): Promise<void> {
  try {
    const queue = getRetryQueue()
    await queue.add('retry', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    })
    console.info(
      `[webhook-retry] enqueued retry for event_type=${payload.event_type} event_id=${payload.event_id}`
    )
  } catch (err) {
    console.error('[webhook-retry] failed to enqueue retry:', err)
  }
}

async function processRetry(payload: OpsActivityEvent): Promise<void> {
  const baseUrl = process.env['OPS_COPILOT_URL'] ?? 'http://localhost:8001'
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${baseUrl}/internal/events/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_event_id: randomUUID(),
        tenant_id: payload.tenant_id,
        event_id: payload.event_id,
        event_type: payload.event_type,
        event_source: 'nuatis_crm',
        occurred_at: new Date().toISOString(),
        payload_json: payload.payload_json,
      }),
      signal: controller.signal,
    })

    if (res.status !== 201) {
      throw new Error(`Non-201 response: ${res.status}`)
    }

    console.info(
      `[webhook-retry] successfully retried event_type=${payload.event_type} event_id=${payload.event_id}`
    )
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export function createWebhookRetryWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()
  const queue = getRetryQueue()

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const payload = job.data as OpsActivityEvent
      await processRetry(payload)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    const attempt = job?.attemptsMade ?? 0
    const maxAttempts = job?.opts?.attempts ?? 3
    const payload = job?.data as OpsActivityEvent | undefined

    if (attempt >= maxAttempts) {
      console.error(
        `[webhook-retry] permanently failed for event=${payload?.event_id} tenant=${payload?.tenant_id} — dead letter`
      )
    } else {
      console.warn(
        `[webhook-retry] attempt ${attempt}/${maxAttempts} failed for event=${payload?.event_id}: ${err.message}`
      )
    }
  })

  return { queue, worker }
}
