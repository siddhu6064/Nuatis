import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'

const QUEUE_NAME = 'recurring-appointment-scanner'

interface RecurringAppointmentRule {
  id: string
  tenant_id: string
  contact_id: string
  title: string
  description: string | null
  location_id: string | null
  assigned_staff_id: string | null
  duration_minutes: number
  frequency: 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number | null
  day_of_month: number | null
  start_time: string
  last_generated_at: string | null
}

// Mirrors recurring-expense-scanner.ts's isDue — same shape, same tradeoff
// (elapsed-time guard as the sole de-dup check, not a unique constraint).
function isDue(r: RecurringAppointmentRule): boolean {
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

export async function scanRecurringAppointments(): Promise<void> {
  console.info('[recurring-appointment-scanner] scanning...')

  try {
    const supabase = getServiceClient()

    const { data: rules, error } = await supabase
      .from('recurring_appointment_rules')
      .select(
        'id, tenant_id, contact_id, title, description, location_id, assigned_staff_id, duration_minutes, frequency, day_of_week, day_of_month, start_time, last_generated_at'
      )
      .eq('enabled', true)
      .is('deleted_at', null)

    if (error) {
      console.error(`[recurring-appointment-scanner] query error: ${error.message}`)
      return
    }

    const due = ((rules ?? []) as RecurringAppointmentRule[]).filter(isDue)
    if (due.length === 0) {
      console.info('[recurring-appointment-scanner] no rules due')
      return
    }

    for (const rule of due) {
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10)
      const [hh, mm] = rule.start_time.split(':')
      const start = new Date(`${dateStr}T${hh}:${mm}:00.000Z`)
      const end = new Date(start.getTime() + rule.duration_minutes * 60000)

      // No conflict check here, deliberately — matches the existing PATCH
      // reschedule path's stance (see appointments.ts), and a recurring slot
      // is presumed already clear since it's the same standing appointment.
      const { data: appointment, error: insertErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id: rule.tenant_id,
          contact_id: rule.contact_id,
          title: rule.title,
          description: rule.description ?? '',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          location_id: rule.location_id,
          assigned_staff_id: rule.assigned_staff_id,
          status: 'scheduled',
          recurring_rule_id: rule.id,
        })
        .select('id')
        .single()

      if (insertErr || !appointment) {
        console.error(
          `[recurring-appointment-scanner] insert failed rule=${rule.id}: ${insertErr?.message}`
        )
        continue
      }

      await supabase
        .from('recurring_appointment_rules')
        .update({ last_generated_at: now.toISOString() })
        .eq('id', rule.id)
        .eq('tenant_id', rule.tenant_id)

      void logActivity({
        tenantId: rule.tenant_id,
        contactId: rule.contact_id,
        type: 'appointment',
        body: `Recurring appointment generated: "${rule.title}"`,
        metadata: { appointment_id: appointment.id, recurring_rule_id: rule.id },
        actorType: 'system',
      })
    }

    console.info(`[recurring-appointment-scanner] generated ${due.length} appointment(s)`)
  } catch (err) {
    console.error('[recurring-appointment-scanner] scan error:', err)
  }
}

export function createRecurringAppointmentScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scanRecurringAppointments(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[recurring-appointment-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
