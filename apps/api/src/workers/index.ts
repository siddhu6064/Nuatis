import type { Queue, Worker } from 'bullmq'
import { createLeadStalledScanner } from './lead-stalled-scanner.js'
import { createNoShowScanner } from './no-show-scanner.js'
import { createFollowUpMissedScanner } from './follow-up-missed-scanner.js'
import { createWebhookRetryWorker } from './webhook-retry-worker.js'
import { createAppointmentReminderWorker } from './appointment-reminder-worker.js'
import { createFollowUpCadenceWorker } from './follow-up-cadence-worker.js'
import { createDataRetentionWorker } from './data-retention-worker.js'
import { createQuoteExpiryWorker } from './quote-expiry-worker.js'
import { createQuoteFollowupWorker } from './quote-followup-worker.js'
import { createTaskReminderWorker } from './task-reminder-worker.js'
import { createCsvImportWorker } from './csv-import-worker.js'
import {
  createLeadScoreComputeWorker,
  createLeadScoreBulkWorker,
  createLeadScoreDecayWorker,
} from './lead-score-worker.js'
import { createReviewRequestWorker } from './review-request-worker.js'

interface ManagedWorker {
  name: string
  queue: Queue
  worker: Worker
}

const managed: ManagedWorker[] = []

export async function startWorkers(): Promise<void> {
  if (process.env['SCANNERS_ENABLED'] === 'false') {
    console.info('[workers] SCANNERS_ENABLED=false — skipping worker initialization')
    return
  }

  if (!process.env['REDIS_URL']) {
    console.warn('[workers] REDIS_URL not set — skipping worker initialization')
    return
  }

  // 1. Lead stalled scanner — every hour at :00
  const leadScanner = createLeadStalledScanner()
  await leadScanner.queue.add(
    'scan',
    {},
    { repeat: { every: 3600000 }, jobId: 'lead-stalled-repeat' }
  )
  managed.push({ name: 'lead-stalled-scanner', ...leadScanner })
  console.info('[workers] lead-stalled-scanner started, repeating every 1h')

  // 2. No-show scanner — every 5 minutes
  const noShowScanner = createNoShowScanner()
  await noShowScanner.queue.add('scan', {}, { repeat: { every: 300000 }, jobId: 'no-show-repeat' })
  managed.push({ name: 'no-show-scanner', ...noShowScanner })
  console.info('[workers] no-show-scanner started, repeating every 5m')

  // 3. Follow-up missed scanner — every hour at :30
  const followUpScanner = createFollowUpMissedScanner()
  await followUpScanner.queue.add(
    'scan',
    {},
    { repeat: { every: 3600000 }, jobId: 'follow-up-missed-repeat' }
  )
  managed.push({ name: 'follow-up-missed-scanner', ...followUpScanner })
  console.info('[workers] follow-up-missed-scanner started, repeating every 1h')

  // 4. Appointment reminder — every 15 minutes
  const reminderWorker = createAppointmentReminderWorker()
  await reminderWorker.queue.add(
    'scan',
    {},
    { repeat: { every: 900000 }, jobId: 'appointment-reminder-repeat' }
  )
  managed.push({ name: 'appointment-reminder', ...reminderWorker })
  console.info('[workers] appointment-reminder started, repeating every 15m')

  // 5. Follow-up cadence — every hour
  const followUpCadence = createFollowUpCadenceWorker()
  await followUpCadence.queue.add(
    'scan',
    {},
    { repeat: { every: 3600000 }, jobId: 'follow-up-cadence-repeat' }
  )
  managed.push({ name: 'follow-up-cadence', ...followUpCadence })
  console.info('[workers] follow-up-cadence started, repeating every 1h')

  // 6. Webhook retry worker — processes on-demand retry jobs
  const retryWorker = createWebhookRetryWorker()
  managed.push({ name: 'webhook-retry', ...retryWorker })
  console.info('[workers] webhook-retry worker started')

  // 7. Quote expiry — every hour
  const quoteExpiry = createQuoteExpiryWorker()
  await quoteExpiry.queue.add(
    'scan',
    {},
    { repeat: { every: 3600000 }, jobId: 'quote-expiry-repeat' }
  )
  managed.push({ name: 'quote-expiry', ...quoteExpiry })
  console.info('[workers] quote-expiry started, repeating every 1h')

  // 8. Data retention — weekly cleanup
  const retentionWorker = createDataRetentionWorker()
  await retentionWorker.queue.add(
    'scan',
    {},
    { repeat: { every: 7 * 86400000 }, jobId: 'data-retention-weekly' }
  )
  managed.push({ name: 'data-retention', ...retentionWorker })
  console.info('[workers] data-retention started, repeating weekly')

  // 9. Quote follow-up — processes one-shot delayed jobs (48h after send)
  const quoteFollowup = createQuoteFollowupWorker()
  managed.push({ name: 'quote-followup', ...quoteFollowup })
  console.info('[workers] quote-followup worker started')

  // 10. Task reminder — processes one-shot delayed jobs (at task due date)
  const taskReminder = createTaskReminderWorker()
  managed.push({ name: 'task-reminder', ...taskReminder })
  console.info('[workers] task-reminder worker started')

  // 11. CSV import — processes large import jobs async
  const csvImport = createCsvImportWorker()
  managed.push({ name: 'csv-import', ...csvImport })
  console.info('[workers] csv-import worker started')

  // 12. Lead score compute — processes individual contact score jobs (on-demand)
  const leadScoreCompute = createLeadScoreComputeWorker()
  managed.push({
    name: 'lead-score-compute',
    queue: leadScoreCompute.queues[0],
    worker: leadScoreCompute.workers[0],
  })
  console.info('[workers] lead-score-compute worker started')

  // 13. Lead score bulk — processes per-tenant bulk recompute jobs (on-demand)
  const leadScoreBulk = createLeadScoreBulkWorker()
  managed.push({
    name: 'lead-score-bulk',
    queue: leadScoreBulk.queues[0],
    worker: leadScoreBulk.workers[0],
  })
  console.info('[workers] lead-score-bulk worker started')

  // 14. Lead score decay — every 24 hours
  const leadScoreDecay = createLeadScoreDecayWorker()
  await leadScoreDecay.queues[0].add(
    'decay',
    {},
    { repeat: { every: 86400000 }, jobId: 'lead-score-decay-repeat' }
  )
  managed.push({
    name: 'lead-score-decay',
    queue: leadScoreDecay.queues[0],
    worker: leadScoreDecay.workers[0],
  })
  console.info('[workers] lead-score-decay started, repeating every 24h')

  // 15. Review request — processes one-shot delayed jobs (on appointment completion)
  const reviewRequest = createReviewRequestWorker()
  managed.push({ name: 'review-request', ...reviewRequest })
  console.info('[workers] review-request worker started')
}

export async function stopWorkers(): Promise<void> {
  for (const { name, worker, queue } of managed) {
    try {
      await worker.close()
      await queue.close()
      console.info(`[workers] ${name} stopped`)
    } catch (err) {
      console.error(`[workers] error stopping ${name}:`, err)
    }
  }
  managed.length = 0
}

export function getWorkerStatus(): Record<string, { status: string }> {
  const result: Record<string, { status: string }> = {}
  for (const { name, worker } of managed) {
    result[name] = { status: worker.isRunning() ? 'running' : 'stopped' }
  }
  return result
}
