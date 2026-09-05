import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'

const QUEUE_NAME = 'revenue-drop-scanner'
const ALERT_COOLDOWN_DAYS = 7
const DROP_THRESHOLD_PCT = 40
// Below this, a tenant's prior week is too small for a % drop to mean
// anything — a $50 → $20 week is noise, not a signal worth paging anyone.
const MIN_PRIOR_WEEK_REVENUE = 200

interface TenantRow {
  id: string
  modules: Record<string, boolean> | null
  revenue_alert_last_sent_at: string | null
}

export async function scan(): Promise<void> {
  console.info('[revenue-drop-scanner] scanning for week-over-week revenue drops...')

  try {
    const supabase = getServiceClient()

    const { data: tenants, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, modules, revenue_alert_last_sent_at')

    if (tenantErr) {
      console.error(`[revenue-drop-scanner] tenants query error: ${tenantErr.message}`)
      return
    }

    const cooldownCutoff = new Date(Date.now() - ALERT_COOLDOWN_DAYS * 86400000).toISOString()

    const eligibleTenants = ((tenants ?? []) as TenantRow[]).filter((t) => {
      const mods = t.modules
      if (mods && mods['crm'] === false) return false
      if (!t.revenue_alert_last_sent_at) return true
      return t.revenue_alert_last_sent_at < cooldownCutoff
    })

    const now = Date.now()
    const weekAgo = new Date(now - 7 * 86400000).toISOString()
    const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString()

    let alerted = 0

    for (const tenant of eligibleTenants) {
      const { data: thisWeekPayments } = await supabase
        .from('quote_payments')
        .select('amount')
        .eq('tenant_id', tenant.id)
        .gte('recorded_at', weekAgo)

      const { data: priorWeekPayments } = await supabase
        .from('quote_payments')
        .select('amount')
        .eq('tenant_id', tenant.id)
        .gte('recorded_at', twoWeeksAgo)
        .lt('recorded_at', weekAgo)

      const thisWeekTotal = (thisWeekPayments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)
      const priorWeekTotal = (priorWeekPayments ?? []).reduce(
        (s, p) => s + Number(p.amount ?? 0),
        0
      )

      if (priorWeekTotal < MIN_PRIOR_WEEK_REVENUE) continue

      const dropPct = ((priorWeekTotal - thisWeekTotal) / priorWeekTotal) * 100
      if (dropPct < DROP_THRESHOLD_PCT) continue

      void logActivity({
        tenantId: tenant.id,
        type: 'revenue_drop_alert',
        body: `Revenue down ${Math.round(dropPct)}% this week ($${thisWeekTotal.toFixed(2)} vs $${priorWeekTotal.toFixed(2)})`,
        metadata: {
          this_week_total: thisWeekTotal,
          prior_week_total: priorWeekTotal,
          drop_pct: dropPct,
        },
        actorType: 'ai',
      })

      void notifyOwner(tenant.id, 'revenue_drop_alert', {
        pushTitle: '📉 Revenue Drop Alert',
        pushBody: `Revenue is down ${Math.round(dropPct)}% vs last week — tap to review`,
        pushUrl: '/insights',
      })

      const { error: markErr } = await supabase
        .from('tenants')
        .update({ revenue_alert_last_sent_at: new Date().toISOString() })
        .eq('id', tenant.id)

      if (markErr) {
        console.error(
          `[revenue-drop-scanner] mark-notified error tenant=${tenant.id}: ${markErr.message}`
        )
      }

      alerted++
    }

    console.info(
      `[revenue-drop-scanner] scan complete — alerted ${alerted} tenant(s) of ${eligibleTenants.length} checked`
    )
  } catch (err) {
    console.error('[revenue-drop-scanner] scan error:', err)
  }
}

export function createRevenueDropScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[revenue-drop-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
