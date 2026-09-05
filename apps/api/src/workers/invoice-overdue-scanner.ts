import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'invoice-overdue-scanner'

export async function scan(): Promise<void> {
  console.info('[invoice-overdue-scanner] scanning for overdue invoices...')

  try {
    const supabase = getServiceClient()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    // Find all sent/due invoices whose due_date < today
    const { data: overdueInvoices, error } = await supabase
      .from('invoices')
      .select('id, tenant_id, invoice_number, due_date, total')
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

    // Log + notify per-tenant counts. The status transition itself
    // (sent/due -> overdue) is the natural once-only trigger — an invoice
    // marked overdue today won't match this query again tomorrow, so no
    // cooldown column is needed the way low-stock-scanner.ts needs one.
    const tenantStats: Record<string, { count: number; total: number }> = {}
    for (const inv of activeInvoices) {
      const stats = tenantStats[inv.tenant_id] ?? { count: 0, total: 0 }
      stats.count += 1
      stats.total += Number(inv.total ?? 0)
      tenantStats[inv.tenant_id] = stats
    }
    for (const [tenantId, stats] of Object.entries(tenantStats)) {
      console.info(
        `[invoice-overdue-scanner] marked ${stats.count} invoices overdue for tenant ${tenantId}`
      )
      void notifyOwner(tenantId, 'invoice_overdue', {
        pushTitle: 'Invoice(s) now overdue',
        pushBody: `${stats.count} invoice${stats.count === 1 ? '' : 's'} just went overdue — $${stats.total.toFixed(2)} outstanding.`,
        pushUrl: '/invoices',
      })
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

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[invoice-overdue-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
