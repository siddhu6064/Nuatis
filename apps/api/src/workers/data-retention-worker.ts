import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'data-retention'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface RetentionRule {
  table: string
  days: number
  column: string
}

const RULES: RetentionRule[] = [
  { table: 'audit_log', days: 365, column: 'created_at' },
  { table: 'voice_sessions', days: 180, column: 'created_at' },
  { table: 'push_subscriptions', days: 90, column: 'created_at' },
]

async function scan(): Promise<void> {
  console.info('[data-retention] running retention cleanup...')

  try {
    const supabase = getSupabase()

    for (const rule of RULES) {
      const cutoff = new Date(Date.now() - rule.days * 86400000).toISOString()

      try {
        const { count, error } = await supabase
          .from(rule.table)
          .delete({ count: 'exact' })
          .lt(rule.column, cutoff)

        if (error) {
          console.error(`[data-retention] ${rule.table} error: ${error.message}`)
          continue
        }

        if (count && count > 0) {
          console.info(
            `[data-retention] cleaned ${count} rows from ${rule.table} (older than ${rule.days} days)`
          )
        }
      } catch (err) {
        console.error(`[data-retention] ${rule.table} error:`, err)
      }
    }

    console.info('[data-retention] cleanup complete')
  } catch (err) {
    console.error('[data-retention] scan error:', err)
  }
}

export function createDataRetentionWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[data-retention] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
