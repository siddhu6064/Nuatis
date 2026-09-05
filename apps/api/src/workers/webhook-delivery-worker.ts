import { Queue, Worker } from 'bullmq'
import { createHmac } from 'crypto'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  setWebhookDeliveryQueue,
} from '../lib/webhook-delivery-queue.js'

interface WebhookDeliveryJobData {
  deliveryId: string
}

/**
 * Delivers one webhook_deliveries row: signs the payload, POSTs it, and
 * records the outcome. Throws on any failure (network error or non-2xx) so
 * BullMQ's own attempts/backoff (configured at enqueue time in
 * lib/webhook-dispatcher.ts) drives the retry — this function only needs to
 * record the final outcome, not manage retry timing itself.
 */
export async function processWebhookDelivery(data: WebhookDeliveryJobData): Promise<void> {
  const supabase = getServiceClient()
  const { deliveryId } = data

  const { data: delivery } = await supabase
    .from('webhook_deliveries')
    .select('id, subscription_id, event_type, payload, tenant_id, attempt_count')
    .eq('id', deliveryId)
    .single()

  if (!delivery) return

  const { data: sub } = await supabase
    .from('webhook_subscriptions')
    .select('url, secret, is_active')
    .eq('id', delivery.subscription_id as string)
    .single()

  if (!sub || !sub.is_active) {
    await supabase
      .from('webhook_deliveries')
      .update({ status: 'failed', error_message: 'subscription inactive or deleted' })
      .eq('id', deliveryId)
    return
  }

  const body = JSON.stringify({
    event: delivery.event_type,
    tenant_id: delivery.tenant_id,
    timestamp: new Date().toISOString(),
    data: delivery.payload,
  })
  const signature = sub.secret
    ? createHmac('sha256', sub.secret as string)
        .update(body)
        .digest('hex')
    : ''

  const attemptCount = (Number(delivery.attempt_count) || 0) + 1
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(sub.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Webhook-Signature': signature } : {}),
      },
      body,
      signal: controller.signal,
    })

    if (res.ok) {
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'delivered',
          attempt_count: attemptCount,
          last_attempted_at: new Date().toISOString(),
          response_status: res.status,
        })
        .eq('id', deliveryId)
      console.info(
        `[webhook-delivery] delivered ${delivery.event_type as string} to ${sub.url as string}`
      )
      return
    }

    await supabase
      .from('webhook_deliveries')
      .update({
        attempt_count: attemptCount,
        last_attempted_at: new Date().toISOString(),
        response_status: res.status,
        error_message: `Non-2xx response: ${res.status}`,
      })
      .eq('id', deliveryId)
    throw new Error(`Non-2xx response: ${res.status}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.startsWith('Non-2xx')) {
      await supabase
        .from('webhook_deliveries')
        .update({
          attempt_count: attemptCount,
          last_attempted_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', deliveryId)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export function createWebhookDeliveryWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()
  const queue = new Queue(WEBHOOK_DELIVERY_QUEUE_NAME, { connection, skipVersionCheck: true })
  setWebhookDeliveryQueue(queue)

  const worker = new Worker(
    WEBHOOK_DELIVERY_QUEUE_NAME,
    async (job) => {
      await processWebhookDelivery(job.data as WebhookDeliveryJobData)
    },
    { connection, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    const attempt = job?.attemptsMade ?? 0
    const maxAttempts = job?.opts?.attempts ?? 1

    if (attempt >= maxAttempts) {
      const deliveryId = (job?.data as WebhookDeliveryJobData | undefined)?.deliveryId
      if (deliveryId) {
        void getServiceClient()
          .from('webhook_deliveries')
          .update({ status: 'failed' })
          .eq('id', deliveryId)
      }
      console.error(`[webhook-delivery] permanently failed job ${job?.id}:`, err.message)
    } else {
      console.warn(
        `[webhook-delivery] attempt ${attempt}/${maxAttempts} failed for job ${job?.id}: ${err.message}`
      )
    }
  })

  return { queue, worker }
}
