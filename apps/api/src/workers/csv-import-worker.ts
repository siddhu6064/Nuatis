import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { processImportRows } from '../lib/import-processor.js'
import { sendPushNotification } from '../lib/push-client.js'

const QUEUE_NAME = 'csv-import'

let _queue: Queue | null = null

export function getCsvImportQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: createBullMQConnection() })
  }
  return _queue
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface CsvImportJobData {
  jobId: string
  tenantId: string
  userId: string
  rows: Record<string, string>[]
  mapping: Record<string, string>
  options: { skip_duplicates: boolean; update_existing: boolean }
}

async function processImport(data: CsvImportJobData): Promise<void> {
  const { jobId, tenantId, rows, mapping, options } = data
  const supabase = getSupabase()

  // Mark as processing
  await supabase
    .from('import_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)

  try {
    const result = await processImportRows(
      tenantId,
      rows,
      mapping,
      options,
      async (imp, skip, errCount) => {
        // Progress update every 50 rows
        await supabase
          .from('import_jobs')
          .update({ imported_count: imp, skipped_count: skip, error_count: errCount })
          .eq('id', jobId)
      }
    )

    // Mark complete
    await supabase
      .from('import_jobs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        imported_count: result.imported,
        skipped_count: result.skipped,
        error_count: result.errors.length,
        errors: result.errors,
      })
      .eq('id', jobId)

    // Push notification
    void sendPushNotification(tenantId, {
      title: 'Import complete',
      body: `${result.imported} contacts imported, ${result.skipped} skipped`,
      url: '/settings/import',
    })

    console.info(
      `[csv-import] job=${jobId} complete: imported=${result.imported} skipped=${result.skipped} errors=${result.errors.length}`
    )
  } catch (err) {
    await supabase
      .from('import_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', jobId)

    console.error(`[csv-import] job=${jobId} failed:`, err)
    throw err
  }
}

export function createCsvImportWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  _queue = queue

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processImport(job.data as CsvImportJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[csv-import] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
