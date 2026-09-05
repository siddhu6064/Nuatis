import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'

const QUEUE_NAME = 'recurring-task-scanner'

interface RecurringTaskRule {
  id: string
  tenant_id: string
  title: string
  contact_id: string | null
  assigned_to_user_id: string | null
  priority: 'low' | 'medium' | 'high'
  frequency: 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number | null
  day_of_month: number | null
  last_generated_at: string | null
}

// Same shape as recurring-appointment-scanner.ts / recurring-expense-scanner.ts.
function isDue(r: RecurringTaskRule): boolean {
  const now = new Date()
  const dow = now.getDay()
  const dom = now.getDate()

  if (r.frequency === 'weekly') {
    if (r.day_of_week === null || r.day_of_week !== dow) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 6 * 86400000
  }
  if (r.frequency === 'biweekly') {
    if (r.day_of_week === null || r.day_of_week !== dow) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 13 * 86400000
  }
  if (r.frequency === 'monthly') {
    if (r.day_of_month === null || r.day_of_month !== dom) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 25 * 86400000
  }
  return false
}

export async function scanRecurringTasks(): Promise<void> {
  console.info('[recurring-task-scanner] scanning...')

  try {
    const supabase = getServiceClient()

    const { data: rules, error } = await supabase
      .from('recurring_task_rules')
      .select(
        'id, tenant_id, title, contact_id, assigned_to_user_id, priority, frequency, day_of_week, day_of_month, last_generated_at'
      )
      .eq('enabled', true)
      .is('deleted_at', null)

    if (error) {
      console.error(`[recurring-task-scanner] query error: ${error.message}`)
      return
    }

    const due = ((rules ?? []) as RecurringTaskRule[]).filter(isDue)
    if (due.length === 0) {
      console.info('[recurring-task-scanner] no rules due')
      return
    }

    for (const rule of due) {
      const now = new Date()

      const { data: task, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          tenant_id: rule.tenant_id,
          contact_id: rule.contact_id,
          title: rule.title,
          due_date: now.toISOString(),
          assigned_to_user_id: rule.assigned_to_user_id,
          priority: rule.priority,
          recurring_rule_id: rule.id,
        })
        .select('id')
        .single()

      if (insertErr || !task) {
        console.error(
          `[recurring-task-scanner] insert failed rule=${rule.id}: ${insertErr?.message}`
        )
        continue
      }

      await supabase
        .from('recurring_task_rules')
        .update({ last_generated_at: now.toISOString() })
        .eq('id', rule.id)
        .eq('tenant_id', rule.tenant_id)

      void logActivity({
        tenantId: rule.tenant_id,
        contactId: rule.contact_id ?? undefined,
        type: 'task',
        body: `Recurring task generated: "${rule.title}"`,
        metadata: { task_id: task.id, recurring_rule_id: rule.id },
        actorType: 'system',
      })
    }

    console.info(`[recurring-task-scanner] generated ${due.length} task(s)`)
  } catch (err) {
    console.error('[recurring-task-scanner] scan error:', err)
  }
}

export function createRecurringTaskScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scanRecurringTasks(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[recurring-task-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
