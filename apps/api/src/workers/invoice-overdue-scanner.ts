import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'invoice-overdue-scanner'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function scan(): Promise<void> {
  console.info('[invoice-overdue-scanner] scanning for overdue invoices...')

  try {
    const supabase = getSupabase()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    // Find all sent/due invoices whose due_date < today
    const { data: overdueInvoices, error } = await supabase
      .from('invoices')
      .select('id, tenant_id, invoice_number, due_date')
      .in('status', ['sent', 'due'])
      .lt('due_date', today)

    if (error) {
      console.error('[invoice-overdue-scanner] query error:', error.message)
      return
    }

    if (!overdueInvoices || overdueInvoices.length === 0) {
      console.info('[invoice-overdue-scanner] no overdue invoices found')
      return
    }

    // Filter out paused tenants
    const activeInvoices = overdueInvoices.filter((inv) => !pausedTenants.has(inv.tenant_id))

    if (activeInvoices.length === 0) {
      console.info('[invoice-overdue-scanner] all affected tenants are paused')
      return
    }

    // Batch update to overdue
    const ids = activeInvoices.map((inv) => inv.id)
    const { error: updateErr } = await supabase
      .from('invoices')
      .update({ status: 'overdue' })
      .in('id', ids)

    if (updateErr) {
      console.error('[invoice-overdue-scanner] update error:', updateErr.message)
      return
    }

    // Log per-tenant counts
    const tenantCounts: Record<string, number> = {}
    for (const inv of activeInvoices) {
      tenantCounts[inv.tenant_id] = (tenantCounts[inv.tenant_id] ?? 0) + 1
    }
    for (const [tenantId, count] of Object.entries(tenantCounts)) {
      console.info(
        `[invoice-overdue-scanner] marked ${count} invoices overdue for tenant ${tenantId}`
      )
    }

    console.info(
      `[invoice-overdue-scanner] scan complete — marked ${activeInvoices.length} invoice(s) overdue`
    )
  } catch (err) {
    console.error('[invoice-overdue-scanner] scan error:', err)
  }
}

export function createInvoiceOverdueScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[invoice-overdue-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
