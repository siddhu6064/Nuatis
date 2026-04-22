import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'

const QUEUE_NAME = 'low-stock-scanner'
const NOTIFY_COOLDOWN_HOURS = 24

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface InventoryRow {
  id: string
  name: string
  quantity: number
  reorder_threshold: number
  last_low_stock_notified_at: string | null
}

export async function scan(): Promise<void> {
  console.info('[low-stock-scanner] scanning for low-stock items...')

  try {
    const supabase = getSupabase()

    // 1. Active CRM tenants
    const { data: tenants, error: tenantErr } = await supabase.from('tenants').select('id, modules')

    if (tenantErr) {
      console.error(`[low-stock-scanner] tenants query error: ${tenantErr.message}`)
      return
    }

    const crmTenants = (tenants ?? []).filter((t) => {
      const mods = t.modules as Record<string, boolean> | null
      return !mods || mods['crm'] !== false
    })

    const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 3600000).toISOString()

    let totalAlerted = 0

    for (const tenant of crmTenants) {
      const { data: items, error: itemsErr } = await supabase
        .from('inventory_items')
        .select('id, name, quantity, reorder_threshold, last_low_stock_notified_at')
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null)

      if (itemsErr) {
        console.error(
          `[low-stock-scanner] items query error tenant=${tenant.id}: ${itemsErr.message}`
        )
        continue
      }

      // Apply low-stock + cooldown filter client-side (PostgREST can't compare two columns).
      const lowStock = ((items ?? []) as InventoryRow[]).filter((it) => {
        const qty = Number(it.quantity ?? 0)
        const thr = Number(it.reorder_threshold ?? 0)
        if (qty > thr) return false
        if (!it.last_low_stock_notified_at) return true
        return it.last_low_stock_notified_at < cooldownCutoff
      })

      if (lowStock.length === 0) continue

      const itemIds = lowStock.map((i) => i.id)
      const itemNames = lowStock.map((i) => i.name)

      void logActivity({
        tenantId: tenant.id,
        type: 'low_stock_alert',
        body: `${lowStock.length} item(s) at or below reorder threshold`,
        metadata: { item_ids: itemIds, item_names: itemNames },
        actorType: 'ai',
      })

      // Route via notifyOwner so the per-tenant inventory_low_stock pref is respected.
      void notifyOwner(tenant.id, 'inventory_low_stock', {
        pushTitle: '⚠️ Low Stock Alert',
        pushBody: `${lowStock.length} item(s) need restocking — tap to review`,
        pushUrl: '/inventory',
      })

      const { error: markErr } = await supabase
        .from('inventory_items')
        .update({ last_low_stock_notified_at: new Date().toISOString() })
        .in('id', itemIds)
        .eq('tenant_id', tenant.id)

      if (markErr) {
        console.error(
          `[low-stock-scanner] mark-notified error tenant=${tenant.id}: ${markErr.message}`
        )
      }

      totalAlerted += lowStock.length
    }

    console.info(
      `[low-stock-scanner] scan complete — alerted on ${totalAlerted} item(s) across ${crmTenants.length} tenant(s)`
    )
  } catch (err) {
    console.error('[low-stock-scanner] scan error:', err)
  }
}

export function createLowStockScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[low-stock-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
