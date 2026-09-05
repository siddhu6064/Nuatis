import { Queue } from 'bullmq'
import { createBullMQConnection } from './bullmq-connection.js'

export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-delivery'

let _queue: Queue | null = null

/** Lazily create and return the shared webhook-delivery queue (for enqueuing from lib/routes). */
export function getWebhookDeliveryQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: createBullMQConnection(),
      skipVersionCheck: true,
    })
  }
  return _queue
}

/** Only the worker module needs to swap in its own Queue instance at startup. */
export function setWebhookDeliveryQueue(queue: Queue): void {
  _queue = queue
}
