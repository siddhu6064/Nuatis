import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { sendEmail } from '../lib/email-client.js'
import { VERTICALS } from '@nuatis/shared'

const QUEUE_NAME = 'scheduled-reports'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export interface ScheduledReportJobData {
  scheduledReportId: string
  tenantId: string
  reportType: string
  recipients: string[]
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function wrapReport(title: string, businessName: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f5f5f5}
  .outer{max-width:600px;margin:0 auto;padding:24px 16px}
  .header{background:#0d9488;padding:20px 24px;border-radius:10px 10px 0 0}
  .header h1{color:#fff;margin:0;font-size:18px;font-weight:700}
  .header p{color:#ccfbf1;margin:4px 0 0;font-size:13px}
  .body{background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}
  th{text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155}
  tr:last-child td{border-bottom:none}
  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
  .stat{background:#f8fafc;border-radius:8px;padding:14px 16px;border:1px solid #e2e8f0}
  .stat .val{font-size:22px;font-weight:700;color:#0f172a}
  .stat .lbl{font-size:11px;color:#94a3b8;margin-top:2px}
  .footer{text-align:center;padding:16px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="outer">
  <div class="header">
    <h1>${title}</h1>
    <p>${businessName} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">Sent by Nuatis · <a href="https://nuatis.com" style="color:#0d9488">nuatis.com</a></div>
</div>
</body></html>`
}

function fmtDollars(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

// ── Report builders ──────────────────────────────────────────────────────────

async function buildVelocityReport(
  tenantId: string,
  businessName: string
): Promise<{ subject: string; html: string }> {
  const supabase = getSupabase()
  const now = new Date()
  const startDate = new Date(now.getTime() - 90 * 86400000).toISOString()

  const { data: wonDeals } = await supabase
    .from('deals')
    .select('value, created_at, updated_at, close_date')
    .eq('tenant_id', tenantId)
    .eq('is_closed_won', true)
    .eq('is_archived', false)
    .gte('updated_at', startDate)

  const deals = wonDeals ?? []
  const total = deals.length
  const rangeMonths = 3
  const totalValue = deals.reduce((s, d) => s + Number(d.value ?? 0), 0)
  const avgDealSize = total > 0 ? Math.round(totalValue / total) : 0
  const dealsPerMonth = Math.round((total / rangeMonths) * 10) / 10

  let totalDays = 0
  let daysCount = 0
  for (const d of deals) {
    const closeAt = new Date((d.close_date as string | null) ?? (d.updated_at as string)).getTime()
    const days = (closeAt - new Date(d.created_at as string).getTime()) / 86400000
    if (days >= 0) {
      totalDays += days
      daysCount++
    }
  }
  const avgDaysToClose = daysCount > 0 ? Math.round((totalDays / daysCount) * 10) / 10 : 0
  const velocityPerMonth = Math.round(dealsPerMonth * avgDealSize)

  const body = `
    <p style="color:#64748b;font-size:13px">Last 90 days</p>
    <div class="stat-grid">
      <div class="stat"><div class="val">${avgDaysToClose}d</div><div class="lbl">Avg Days to Close</div></div>
      <div class="stat"><div class="val">${dealsPerMonth}</div><div class="lbl">Deals / Month</div></div>
      <div class="stat"><div class="val">${fmtDollars(avgDealSize)}</div><div class="lbl">Avg Deal Size</div></div>
      <div class="stat"><div class="val">${fmtDollars(velocityPerMonth)}</div><div class="lbl">$/Month Velocity</div></div>
    </div>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Total Won Deals</td><td>${total}</td></tr>
        <tr><td>Total Won Value</td><td>${fmtDollars(totalValue)}</td></tr>
        <tr><td>Avg Days to Close</td><td>${avgDaysToClose} days</td></tr>
        <tr><td>Pipeline Velocity</td><td>${fmtDollars(velocityPerMonth)} / month</td></tr>
      </tbody>
    </table>`

  return {
    subject: `Sales Velocity Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    html: wrapReport('Sales Velocity', businessName, body),
  }
}

async function buildAppointmentsReport(
  tenantId: string,
  businessName: string
): Promise<{ subject: string; html: string }> {
  const supabase = getSupabase()
  const now = new Date()
  const startDate = new Date(now.getTime() - 30 * 86400000).toISOString()

  const { data: appts } = await supabase
    .from('appointments')
    .select('status, created_by_call')
    .eq('tenant_id', tenantId)
    .gte('start_time', startDate)
    .lte('start_time', now.toISOString())

  const statusCounts: Record<string, number> = {
    scheduled: 0,
    confirmed: 0,
    completed: 0,
    no_show: 0,
    canceled: 0,
    rescheduled: 0,
  }
  let phoneBookings = 0
  for (const a of appts ?? []) {
    const s = a.status as string
    if (s in statusCounts) statusCounts[s] = (statusCounts[s] ?? 0) + 1
    if (a.created_by_call) phoneBookings++
  }

  const total = (appts ?? []).length
  const showed = statusCounts['completed'] ?? 0
  const noShow = statusCounts['no_show'] ?? 0
  const showRate = showed + noShow > 0 ? Math.round((showed / (showed + noShow)) * 100) : 0

  const rows = Object.entries(statusCounts)
    .map(
      ([s, c]) =>
        `<tr><td style="text-transform:capitalize">${s.replace('_', ' ')}</td><td>${c}</td></tr>`
    )
    .join('')

  const body = `
    <p style="color:#64748b;font-size:13px">Last 30 days</p>
    <div class="stat-grid">
      <div class="stat"><div class="val">${total}</div><div class="lbl">Total Appointments</div></div>
      <div class="stat"><div class="val">${showRate}%</div><div class="lbl">Show Rate</div></div>
      <div class="stat"><div class="val">${phoneBookings}</div><div class="lbl">Booked by Phone</div></div>
      <div class="stat"><div class="val">${total - phoneBookings}</div><div class="lbl">Booked Manually</div></div>
    </div>
    <table>
      <thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  return {
    subject: `Appointments Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    html: wrapReport('Appointments Report', businessName, body),
  }
}

async function buildLeadSourceReport(
  tenantId: string,
  businessName: string
): Promise<{ subject: string; html: string }> {
  const supabase = getSupabase()

  const [{ data: contacts }, { data: deals }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, source')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false),
    supabase
      .from('deals')
      .select('contact_id, value, is_closed_won, is_closed_lost')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false),
  ])

  type SourceAgg = {
    lead_count: number
    won_count: number
    lost_count: number
    open_count: number
    won_value: number
  }
  const sourceMap = new Map<string, SourceAgg>()
  const contactSourceMap = new Map<string, string>()

  for (const c of contacts ?? []) {
    const src = (c.source as string | null) ?? 'unknown'
    contactSourceMap.set(c.id as string, src)
    if (!sourceMap.has(src))
      sourceMap.set(src, {
        lead_count: 0,
        won_count: 0,
        lost_count: 0,
        open_count: 0,
        won_value: 0,
      })
    sourceMap.get(src)!.lead_count++
  }

  for (const d of deals ?? []) {
    const src = contactSourceMap.get(d.contact_id as string) ?? 'unknown'
    if (!sourceMap.has(src))
      sourceMap.set(src, {
        lead_count: 0,
        won_count: 0,
        lost_count: 0,
        open_count: 0,
        won_value: 0,
      })
    const agg = sourceMap.get(src)!
    if (d.is_closed_won) {
      agg.won_count++
      agg.won_value += Number(d.value ?? 0)
    } else if (d.is_closed_lost) {
      agg.lost_count++
    } else {
      agg.open_count++
    }
  }

  const sources = [...sourceMap.entries()]
    .sort((a, b) => b[1].lead_count - a[1].lead_count)
    .slice(0, 10)

  const rows = sources
    .map(([src, s]) => {
      const winRate = s.lead_count > 0 ? Math.round((s.won_count / s.lead_count) * 100) : 0
      return `<tr><td style="text-transform:capitalize">${src.replace('_', ' ')}</td><td>${s.lead_count}</td><td>${s.won_count}</td><td>${fmtDollars(s.won_value)}</td><td>${winRate}%</td></tr>`
    })
    .join('')

  const body = `
    <p style="color:#64748b;font-size:13px">All time, top 10 sources</p>
    <table>
      <thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Won Value</th><th>Win Rate</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:#94a3b8;text-align:center">No data yet</td></tr>'}</tbody>
    </table>`

  return {
    subject: `Lead Source Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    html: wrapReport('Lead Source Report', businessName, body),
  }
}

async function buildPipelineFunnelReport(
  tenantId: string,
  businessName: string
): Promise<{ subject: string; html: string }> {
  const supabase = getSupabase()

  const { data: pipelines } = await supabase
    .from('pipelines')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .limit(1)

  const pipelineId = (pipelines?.[0]?.id as string | undefined) ?? null
  let rows =
    '<tr><td colspan="3" style="color:#94a3b8;text-align:center">No pipeline configured</td></tr>'

  if (pipelineId) {
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id, name, position')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true })

    if (stages && stages.length > 0) {
      const stageIds = stages.map((s) => s.id as string)
      const { data: deals } = await supabase
        .from('deals')
        .select('pipeline_stage_id, value')
        .eq('tenant_id', tenantId)
        .eq('is_archived', false)
        .eq('is_closed_won', false)
        .eq('is_closed_lost', false)
        .in('pipeline_stage_id', stageIds)

      const stageMap = new Map<string, { count: number; value: number }>()
      for (const id of stageIds) stageMap.set(id, { count: 0, value: 0 })
      for (const d of deals ?? []) {
        const sid = d.pipeline_stage_id as string
        const agg = stageMap.get(sid)
        if (agg) {
          agg.count++
          agg.value += Number(d.value ?? 0)
        }
      }

      rows = stages
        .map((s) => {
          const agg = stageMap.get(s.id as string) ?? { count: 0, value: 0 }
          return `<tr><td>${s.name as string}</td><td>${agg.count}</td><td>${fmtDollars(agg.value)}</td></tr>`
        })
        .join('')
    }
  }

  const body = `
    <p style="color:#64748b;font-size:13px">Open deals by stage (default pipeline)</p>
    <table>
      <thead><tr><th>Stage</th><th>Deals</th><th>Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  return {
    subject: `Pipeline Funnel Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    html: wrapReport('Pipeline Funnel', businessName, body),
  }
}

// ── Main processor ───────────────────────────────────────────────────────────

export async function processScheduledReport(data: ScheduledReportJobData): Promise<void> {
  const { scheduledReportId, tenantId, reportType, recipients } = data
  const supabase = getSupabase()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, vertical')
    .eq('id', tenantId)
    .single()
  const businessName = (tenant as { name?: string } | null)?.name ?? 'Your Business'
  const vertical = (tenant as { vertical?: string } | null)?.vertical ?? 'sales_crm'

  let result: { subject: string; html: string }

  try {
    switch (reportType) {
      case 'velocity':
        result = await buildVelocityReport(tenantId, businessName)
        break
      case 'appointments':
        result = await buildAppointmentsReport(tenantId, businessName)
        break
      case 'lead_source':
        result = await buildLeadSourceReport(tenantId, businessName)
        break
      case 'pipeline_funnel':
        result = await buildPipelineFunnelReport(tenantId, businessName)
        break
      default:
        console.warn(`[scheduled-report] unknown report_type=${reportType}`)
        return
    }
  } catch (err) {
    console.error(`[scheduled-report] failed to build report type=${reportType}:`, err)
    throw err
  }

  // vertical label for subject prefix
  const verticalLabel = VERTICALS[vertical]?.label ?? 'Nuatis'
  const subject = `${result.subject} · ${verticalLabel}`

  let sent = 0
  for (const email of recipients) {
    const ok = await sendEmail({ to: email, subject, html: result.html })
    if (ok) sent++
  }

  console.info(
    `[scheduled-report] sent id=${scheduledReportId} type=${reportType} to=${sent}/${recipients.length} recipients`
  )

  // Update last_sent_at
  await supabase
    .from('scheduled_reports')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', scheduledReportId)
}

export function createScheduledReportWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processScheduledReport(job.data as ScheduledReportJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[scheduled-report] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
