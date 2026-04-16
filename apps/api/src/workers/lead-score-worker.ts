import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { computeLeadScore } from '../lib/lead-scoring.js'
import { logActivity } from '../lib/activity.js'
import { getLeadScoreQueue } from '../lib/lead-score-queue.js'

const COMPUTE_QUEUE_NAME = 'lead-score-compute'
const BULK_QUEUE_NAME = 'lead-score-bulk'
const DECAY_QUEUE_NAME = 'lead-score-decay'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ComputeJobData {
  tenantId: string
  contactId: string
  trigger: string
}

interface BulkJobData {
  tenantId: string
}

async function processCompute(data: ComputeJobData): Promise<void> {
  const { tenantId, contactId, trigger } = data
  const supabase = getSupabase()

  // Fetch current score before update
  const { data: current } = await supabase
    .from('contacts')
    .select('lead_score, lead_grade')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .single()

  const oldScore: number = current?.lead_score ?? 0
  const oldGrade: string = current?.lead_grade ?? ''

  // Compute new score
  const { score, grade } = await computeLeadScore(tenantId, contactId)

  // Update contacts table
  await supabase
    .from('contacts')
    .update({
      lead_score: score,
      lead_grade: grade,
      lead_score_updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', contactId)

  console.info(
    `[lead-score-compute] contact=${contactId} tenant=${tenantId} trigger=${trigger} score=${oldScore}->${score} grade=${oldGrade}->${grade}`
  )

  // Log activity if score changed by >=10 or grade changed
  const scoreDelta = Math.abs(score - oldScore)
  if (scoreDelta >= 10 || grade !== oldGrade) {
    await logActivity({
      tenantId,
      contactId,
      type: 'lead_score',
      body: `Lead score updated: ${oldScore} → ${score} (${grade})`,
      metadata: { oldScore, newScore: score, oldGrade, newGrade: grade, trigger },
      actorType: 'system',
    })
  }
}

async function processBulk(data: BulkJobData): Promise<void> {
  const { tenantId } = data
  const supabase = getSupabase()

  // Fetch all non-archived contacts for the tenant
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)

  if (error) {
    console.error(`[lead-score-bulk] query error for tenant=${tenantId}: ${error.message}`)
    return
  }

  if (!contacts || contacts.length === 0) {
    console.info(`[lead-score-bulk] no contacts found for tenant=${tenantId}`)
    return
  }

  const queue = getLeadScoreQueue()
  let enqueued = 0

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]!
    await queue.add(
      'compute',
      { tenantId, contactId: contact.id, trigger: 'bulk' },
      {
        delay: i * 100,
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      }
    )
    enqueued++
  }

  console.info(`[lead-score-bulk] enqueued ${enqueued} compute jobs for tenant=${tenantId}`)
}

async function processDecay(): Promise<void> {
  const supabase = getSupabase()

  // Find all distinct tenants with contacts that have a positive lead_score
  const { data: rows, error } = await supabase
    .from('contacts')
    .select('id, tenant_id')
    .gt('lead_score', 0)
    .eq('is_archived', false)

  if (error) {
    console.error(`[lead-score-decay] query error: ${error.message}`)
    return
  }

  if (!rows || rows.length === 0) {
    console.info('[lead-score-decay] no contacts with positive score found')
    return
  }

  const queue = getLeadScoreQueue()
  let enqueued = 0
  let i = 0

  for (const row of rows) {
    await queue.add(
      'compute',
      { tenantId: row.tenant_id, contactId: row.id, trigger: 'decay' },
      {
        delay: i * 100,
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      }
    )
    enqueued++
    i++
  }

  console.info(`[lead-score-decay] enqueued ${enqueued} compute jobs for decay run`)
}

export function createLeadScoreComputeWorker(): { queues: Queue[]; workers: Worker[] } {
  const connection = createBullMQConnection()

  const queue = new Queue(COMPUTE_QUEUE_NAME, { connection })
  const worker = new Worker(
    COMPUTE_QUEUE_NAME,
    async (job) => {
      await processCompute(job.data as ComputeJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[lead-score-compute] job ${job?.id} failed:`, err)
  })

  return { queues: [queue], workers: [worker] }
}

export function createLeadScoreBulkWorker(): { queues: Queue[]; workers: Worker[] } {
  const connection = createBullMQConnection()

  const queue = new Queue(BULK_QUEUE_NAME, { connection })
  const worker = new Worker(
    BULK_QUEUE_NAME,
    async (job) => {
      await processBulk(job.data as BulkJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[lead-score-bulk] job ${job?.id} failed:`, err)
  })

  return { queues: [queue], workers: [worker] }
}

export function createLeadScoreDecayWorker(): { queues: Queue[]; workers: Worker[] } {
  const connection = createBullMQConnection()

  const queue = new Queue(DECAY_QUEUE_NAME, { connection })
  const worker = new Worker(DECAY_QUEUE_NAME, async () => processDecay(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[lead-score-decay] job ${job?.id} failed:`, err)
  })

  return { queues: [queue], workers: [worker] }
}
