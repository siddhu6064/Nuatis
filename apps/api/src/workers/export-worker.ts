import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { notifyOwner } from '../lib/notifications.js'
import { gzipSync } from 'node:zlib'

const QUEUE_NAME = 'data-export'

let _queue: Queue | null = null

export function getExportQueue(): Queue {
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

interface ExportJobData {
  tenantId: string
  exportJobId: string
  requestedBy: string
  tables: string[]
}

// ── CSV helpers ──────────────────────────────────────────────────────────────

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n')
  return header + '\n' + body
}

function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(row)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      // Flatten one level of joined objects (e.g. contact: { name: '...' })
      const nested = val as Record<string, unknown>
      for (const [nKey, nVal] of Object.entries(nested)) {
        flat[`${key}_${nKey}`] = nVal
      }
    } else {
      flat[key] = val
    }
  }
  return flat
}

// ── Table fetchers ───────────────────────────────────────────────────────────

async function fetchTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  table: string
): Promise<{ label: string; columns: string[]; rows: Record<string, unknown>[] }> {
  switch (table) {
    case 'contacts': {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, company:companies(name)')
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`contacts: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'CONTACTS', columns, rows }
    }

    case 'activity_log': {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, contact:contacts(name)')
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`activity_log: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'ACTIVITY LOG', columns, rows }
    }

    case 'appointments': {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, contact:contacts(name)')
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`appointments: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'APPOINTMENTS', columns, rows }
    }

    case 'deals': {
      const { data, error } = await supabase
        .from('deals')
        .select('*, contact:contacts(name), company:companies(name)')
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`deals: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'DEALS', columns, rows }
    }

    case 'quotes': {
      const { data, error } = await supabase
        .from('quotes')
        .select('*, contact:contacts(name)')
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`quotes: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'QUOTES', columns, rows }
    }

    case 'tasks': {
      const { data, error } = await supabase.from('tasks').select('*').eq('tenant_id', tenantId)
      if (error) throw new Error(`tasks: ${error.message}`)
      const rows = (data ?? []).map(flattenRow)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { label: 'TASKS', columns, rows }
    }

    default:
      throw new Error(`Unknown table: ${table}`)
  }
}

// ── Main processor ───────────────────────────────────────────────────────────

async function processExport(data: ExportJobData): Promise<void> {
  const { tenantId, exportJobId, tables } = data
  const supabase = getSupabase()

  // 1. Mark as processing
  await supabase
    .from('export_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', exportJobId)

  try {
    // 2. Fetch each table
    const sections: string[] = []

    for (const table of tables) {
      const { label, columns, rows } = await fetchTable(supabase, tenantId, table)
      const csv = columns.length > 0 ? toCsv(columns, rows) : '(no data)'
      sections.push(`=== ${label} ===\n${csv}`)
    }

    // 3. Combine into single CSV string
    const combined = sections.join('\n\n')

    // 4. Compress
    const compressed = gzipSync(Buffer.from(combined, 'utf-8'))

    // 5. Upload to Supabase Storage
    const storagePath = `exports/${tenantId}/${exportJobId}.csv.gz`

    const { error: uploadErr } = await supabase.storage
      .from('contact-attachments')
      .upload(storagePath, compressed, {
        contentType: 'application/gzip',
        upsert: true,
      })

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`)
    }

    // 6. Generate signed URL (48h = 172800s)
    const { data: signedData, error: signedErr } = await supabase.storage
      .from('contact-attachments')
      .createSignedUrl(storagePath, 172800)

    if (signedErr || !signedData?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${signedErr?.message ?? 'unknown'}`)
    }

    const expiresAt = new Date(Date.now() + 172800 * 1000).toISOString()

    // 7. Mark as completed
    await supabase
      .from('export_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        file_path: storagePath,
        file_size_bytes: compressed.length,
        download_url: signedData.signedUrl,
        expires_at: expiresAt,
      })
      .eq('id', exportJobId)

    // 8. Notify owner
    void notifyOwner(tenantId, 'form_submitted', {
      pushTitle: 'Data export ready',
      pushBody: 'Your CRM data export is ready for download',
    })

    console.info(
      `[export-worker] job=${exportJobId} complete: tables=${tables.join(',')} size=${compressed.length}b`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await supabase
      .from('export_jobs')
      .update({
        status: 'failed',
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJobId)

    console.error(`[export-worker] job=${exportJobId} failed:`, err)
    throw err
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createExportWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  _queue = queue

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processExport(job.data as ExportJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[export-worker] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
