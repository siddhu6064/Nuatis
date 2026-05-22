import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import type { ScheduledReportJobData } from './scheduled-report-worker.js'

const SCANNER_QUEUE = 'scheduled-report-scanner'
const REPORT_QUEUE = 'scheduled-reports'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ScheduledReport {
  id: string
  tenant_id: string
  report_type: string
  frequency: string
  day_of_week: number | null
  day_of_month: number | null
  recipients: string[]
  last_sent_at: string | null
}

function isDue(report: ScheduledReport): boolean {
  const now = new Date()
  const todayDow = now.getDay() // 0=Sunday
  const todayDom = now.getDate()

  if (report.frequency === 'weekly') {
    if (report.day_of_week === null || report.day_of_week !== todayDow) return false
    if (!report.last_sent_at) return true
    const msAgo = now.getTime() - new Date(report.last_sent_at).getTime()
    return msAgo >= 6 * 86400000 // at least 6 days since last send
  }

  if (report.frequency === 'monthly') {
    if (report.day_of_month === null || report.day_of_month !== todayDom) return false
    if (!report.last_sent_at) return true
    const msAgo = now.getTime() - new Date(report.last_sent_at).getTime()
    return msAgo >= 25 * 86400000 // at least 25 days since last send
  }

  return false
}

export async function scanScheduledReports(): Promise<void> {
  console.info('[scheduled-report-scanner] scanning...')
  const supabase = getSupabase()

  const { data: reports, error } = await supabase
    .from('scheduled_reports')
    .select(
      'id, tenant_id, report_type, frequency, day_of_week, day_of_month, recipients, last_sent_at'
    )
    .eq('enabled', true)

  if (error) {
    console.error(`[scheduled-report-scanner] query error: ${error.message}`)
    return
  }

  const due = (reports ?? []).filter((r) => isDue(r as ScheduledReport))
  if (due.length === 0) {
    console.info('[scheduled-report-scanner] no reports due')
    return
  }

  const reportQueue = new Queue(REPORT_QUEUE, {
    connection: createBullMQConnection(),
    skipVersionCheck: true,
  })

  for (const r of due) {
    const report = r as ScheduledReport
    const payload: ScheduledReportJobData = {
      scheduledReportId: report.id,
      tenantId: report.tenant_id,
      reportType: report.report_type,
      recipients: report.recipients,
    }
    await reportQueue.add('send', payload)
    console.info(
      `[scheduled-report-scanner] enqueued report id=${report.id} type=${report.report_type} tenant=${report.tenant_id}`
    )
  }

  await reportQueue.close()
  console.info(`[scheduled-report-scanner] enqueued ${due.length} report(s)`)
}

export function createScheduledReportScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(SCANNER_QUEUE, { connection, skipVersionCheck: true })
  const worker = new Worker(SCANNER_QUEUE, async () => scanScheduledReports(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[scheduled-report-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
