import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'stale-approval-scanner'
const ESCALATION_HOURS = 48
const NOTIFY_COOLDOWN_HOURS = 24

interface TimeOffRow {
  id: string
  tenant_id: string
  staff_id: string
  start_date: string
  end_date: string
  created_at: string
  last_reminder_sent_at: string | null
}

interface ExpenseRow {
  id: string
  tenant_id: string
  expense_number: string
  amount: number
  created_at: string
  last_reminder_sent_at: string | null
}

function isStale(
  createdAt: string,
  lastReminderAt: string | null,
  cutoff: string,
  cooldownCutoff: string
): boolean {
  if (createdAt >= cutoff) return false // not old enough to escalate yet
  if (!lastReminderAt) return true
  return lastReminderAt < cooldownCutoff
}

/**
 * Re-nudges the owner about approvals nobody has acted on — time-off
 * requests and expenses both sit at `status`/`approval_status: 'pending'`
 * indefinitely today with only a one-time notifyOwner at submission. This
 * scans both tables daily and re-notifies (respecting a per-record cooldown,
 * same shape as low-stock-scanner.ts) once a request has been pending past
 * ESCALATION_HOURS.
 */
export async function scan(): Promise<void> {
  console.info('[stale-approval-scanner] scanning for stale pending approvals...')

  try {
    const supabase = getServiceClient()
    const cutoff = new Date(Date.now() - ESCALATION_HOURS * 3600000).toISOString()
    const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 3600000).toISOString()

    let totalNudged = 0

    // ── Time-off requests ──────────────────────────────────────────────────
    const { data: timeOffRows, error: timeOffErr } = await supabase
      .from('time_off_requests')
      .select('id, tenant_id, staff_id, start_date, end_date, created_at, last_reminder_sent_at')
      .eq('status', 'pending')

    if (timeOffErr) {
      console.error(`[stale-approval-scanner] time_off_requests query error: ${timeOffErr.message}`)
    } else {
      const stale = ((timeOffRows ?? []) as TimeOffRow[]).filter((r) =>
        isStale(r.created_at, r.last_reminder_sent_at, cutoff, cooldownCutoff)
      )

      if (stale.length > 0) {
        const staffIds = [...new Set(stale.map((r) => r.staff_id))]
        const { data: staffRows } = await supabase
          .from('staff_members')
          .select('id, name')
          .in('id', staffIds)
        const staffNames = Object.fromEntries(
          (staffRows ?? []).map((s) => [s.id as string, (s.name as string) || 'A staff member'])
        )

        for (const row of stale) {
          void notifyOwner(row.tenant_id, 'time_off_requested', {
            pushTitle: 'Time off request still pending',
            pushBody: `${staffNames[row.staff_id] ?? 'A staff member'}'s request for ${row.start_date} to ${row.end_date} needs a decision.`,
            pushUrl: '/staff',
          })
        }

        const { error: markErr } = await supabase
          .from('time_off_requests')
          .update({ last_reminder_sent_at: new Date().toISOString() })
          .in(
            'id',
            stale.map((r) => r.id)
          )
        if (markErr) {
          console.error(`[stale-approval-scanner] time_off mark-notified error: ${markErr.message}`)
        }
        totalNudged += stale.length
      }
    }

    // ── Expense approvals ───────────────────────────────────────────────────
    const { data: expenseRows, error: expenseErr } = await supabase
      .from('expenses')
      .select('id, tenant_id, expense_number, amount, created_at, last_reminder_sent_at')
      .eq('approval_status', 'pending')

    if (expenseErr) {
      console.error(`[stale-approval-scanner] expenses query error: ${expenseErr.message}`)
    } else {
      const stale = ((expenseRows ?? []) as ExpenseRow[]).filter((r) =>
        isStale(r.created_at, r.last_reminder_sent_at, cutoff, cooldownCutoff)
      )

      for (const row of stale) {
        void notifyOwner(row.tenant_id, 'expense_pending_approval', {
          pushTitle: 'Expense approval still pending',
          pushBody: `${row.expense_number} — $${Number(row.amount).toFixed(2)} still needs a decision.`,
          pushUrl: `/expenses/${row.id}`,
        })
      }

      if (stale.length > 0) {
        const { error: markErr } = await supabase
          .from('expenses')
          .update({ last_reminder_sent_at: new Date().toISOString() })
          .in(
            'id',
            stale.map((r) => r.id)
          )
        if (markErr) {
          console.error(`[stale-approval-scanner] expenses mark-notified error: ${markErr.message}`)
        }
      }
      totalNudged += stale.length
    }

    console.info(
      `[stale-approval-scanner] scan complete — nudged on ${totalNudged} stale approval(s)`
    )
  } catch (err) {
    console.error('[stale-approval-scanner] scan error:', err)
  }
}

export function createStaleApprovalScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[stale-approval-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
