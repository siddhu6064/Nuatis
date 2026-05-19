import { Router, type Request, type Response } from 'express'
import { Queue } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import type { AutomationOverview, ScannerStatus } from '@nuatis/shared'

const router = Router()

// ── Queue metadata ─────────────────────────────────────────────────────────────

const SCANNER_QUEUES: Array<{ key: string; name: string }> = [
  { key: 'lead-stalled-scanner', name: 'Stalled Lead Scanner' },
  { key: 'no-show-scanner', name: 'No-Show Scanner' },
  { key: 'follow-up-missed-scanner', name: 'Missed Follow-Up Scanner' },
  { key: 'appointment-reminder', name: 'Appointment Reminder' },
  { key: 'follow-up-cadence', name: 'Follow-Up Cadence' },
  { key: 'review-request', name: 'Review Request' },
  { key: 'quote-followup', name: 'Quote Follow-Up' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCANNER_KEY_SET = new Set(SCANNER_QUEUES.map((q) => q.key))

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/** Return the Monday of the ISO week that contains `date`. */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getUTCDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day // adjust to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

async function fetchScannerStatus(key: string, name: string): Promise<ScannerStatus> {
  try {
    const q = new Queue(key, { connection: createBullMQConnection() })
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'paused')
    const [failedJobs, completedJobs] = await Promise.all([
      q.getFailed(0, 4),
      q.getCompleted(0, 99),
    ])
    await q.close()

    const pausedCount = counts.paused ?? 0
    const failedCount = counts.failed ?? 0

    let status: ScannerStatus['status']
    if (pausedCount > 0) {
      status = 'paused'
    } else if (failedCount > 0) {
      status = 'error'
    } else {
      status = 'active'
    }

    // Fix 1: last_run_at — use whichever of failed/completed is more recent
    const lastFailed = failedJobs[0]?.finishedOn ?? null
    const lastCompleted = completedJobs[0]?.finishedOn ?? null
    const lastRunTs = Math.max(lastFailed ?? 0, lastCompleted ?? 0)
    const last_run_at = lastRunTs > 0 ? new Date(lastRunTs).toISOString() : null

    // Fix 2: jobs_processed_7d — filter completed jobs to 7-day window
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const jobs_processed_7d = completedJobs.filter(
      (j) => j.finishedOn != null && j.finishedOn >= sevenDaysAgo
    ).length

    const failed_jobs = failedJobs.map((job) => ({
      id: String(job.id),
      name: job.name,
      failed_at: job.processedOn != null ? new Date(job.processedOn).toISOString() : null,
      error_message: job.failedReason ?? 'Unknown error',
      attempt_count: job.attemptsMade,
    }))

    return {
      name,
      key,
      status,
      last_run_at,
      last_error: failedJobs[0]?.failedReason ?? null,
      failure_count: failedCount,
      jobs_processed_7d,
      failed_jobs,
      is_paused: false,
      pause_until: null,
    }
  } catch {
    return {
      name,
      key,
      status: 'error',
      last_run_at: null,
      last_error: 'Queue unavailable',
      failure_count: 0,
      jobs_processed_7d: 0,
      failed_jobs: [],
      is_paused: false,
      pause_until: null,
    }
  }
}

// ── GET /overview ──────────────────────────────────────────────────────────────

router.get('/overview', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // 1. Scanner health — all queues in parallel
  const scanners = await Promise.all(
    SCANNER_QUEUES.map(({ key, name }) => fetchScannerStatus(key, name))
  )

  // 2. Enrollments chart — last 7 weeks, aggregated in JS
  const sevenWeeksAgo = new Date(Date.now() - 7 * 7 * 24 * 60 * 60 * 1000)
  const { data: logs } = await supabase
    .from('audit_log')
    .select('created_at')
    .eq('tenant_id', authed.tenantId)
    .in('action', ['sms_sent', 'email_sent', 'bulk_sms', 'create', 'update'])
    .gte('created_at', sevenWeeksAgo.toISOString())
    .order('created_at', { ascending: false })

  // Group by Monday-aligned ISO week
  const weekMap = new Map<string, { monday: Date; count: number }>()
  for (const log of logs ?? []) {
    const monday = getMondayOfWeek(new Date(log.created_at as string))
    const key = monday.toISOString()
    const existing = weekMap.get(key)
    if (existing) {
      existing.count++
    } else {
      weekMap.set(key, { monday, count: 1 })
    }
  }

  const enrollments_chart = Array.from(weekMap.values())
    .sort((a, b) => b.monday.getTime() - a.monday.getTime())
    .slice(0, 7)
    .map(({ monday, count }) => ({
      week: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      count,
    }))

  // 3. Trigger analysis — last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const { data: allLogs } = await supabase
    .from('audit_log')
    .select('action')
    .eq('tenant_id', authed.tenantId)
    .gte('created_at', thirtyDaysAgo.toISOString())

  const attempted = allLogs?.length ?? 0
  const matched =
    allLogs?.filter((l) => ['sms_sent', 'email_sent', 'bulk_sms'].includes(l.action as string))
      .length ?? 0
  const unmatched = attempted - matched

  // 4. Totals from scanner array
  const total_active = scanners.filter((s) => s.status === 'active').length
  const total_paused = scanners.filter((s) => s.status === 'paused').length

  const overview: AutomationOverview = {
    scanners,
    enrollments_chart,
    trigger_analysis: { attempted, matched, unmatched },
    total_active,
    total_paused,
  }

  res.json(overview)
})

// ── POST /scanners/:key/retry-failed ──────────────────────────────────────────

router.post(
  '/scanners/:key/retry-failed',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params as { key: string }
    if (!SCANNER_KEY_SET.has(key)) {
      res.status(400).json({ error: 'Unknown scanner key' })
      return
    }
    const q = new Queue(key, { connection: createBullMQConnection() })
    try {
      const failedJobs = await q.getFailed(0, -1)
      let retried = 0
      for (const job of failedJobs) {
        await job.retry()
        retried++
      }
      res.json({ retried })
    } catch (err) {
      console.error(`[automation] retry-failed error for ${key}:`, err)
      res.status(500).json({ error: 'Retry failed' })
    } finally {
      await q.close()
    }
  }
)

// ── POST /scanners/:key/clear-failed ──────────────────────────────────────────

router.post(
  '/scanners/:key/clear-failed',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params as { key: string }
    if (!SCANNER_KEY_SET.has(key)) {
      res.status(400).json({ error: 'Unknown scanner key' })
      return
    }
    const q = new Queue(key, { connection: createBullMQConnection() })
    try {
      const cleaned = await q.clean(0, 100, 'failed')
      res.json({ cleared: cleaned.length })
    } catch (err) {
      console.error(`[automation] clear-failed error for ${key}:`, err)
      res.status(500).json({ error: 'Clear failed' })
    } finally {
      await q.close()
    }
  }
)

export default router
