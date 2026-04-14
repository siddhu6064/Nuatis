import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'appointment-reminder'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

async function sendSms(from: string, to: string, text: string): Promise<boolean> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) return false

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[appointment-reminder] SMS failed (${res.status}): ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[appointment-reminder] SMS error:', err)
    return false
  }
}

async function scan(): Promise<void> {
  console.info('[appointment-reminder] scanning for upcoming appointments...')

  try {
    const supabase = getSupabase()
    const now = Date.now()

    // 24h window: 23h to 25h from now
    const window24hStart = new Date(now + 23 * 3600000).toISOString()
    const window24hEnd = new Date(now + 25 * 3600000).toISOString()

    // 1h window: 45min to 75min from now
    const window1hStart = new Date(now + 45 * 60000).toISOString()
    const window1hEnd = new Date(now + 75 * 60000).toISOString()

    // Query both windows
    const { data: reminders24h } = await supabase
      .from('appointments')
      .select('id, tenant_id, contact_id, title, start_time')
      .eq('status', 'scheduled')
      .eq('reminder_24h_sent', false)
      .gte('start_time', window24hStart)
      .lte('start_time', window24hEnd)

    const { data: reminders1h } = await supabase
      .from('appointments')
      .select('id, tenant_id, contact_id, title, start_time')
      .eq('status', 'scheduled')
      .eq('reminder_2h_sent', false)
      .gte('start_time', window1hStart)
      .lte('start_time', window1hEnd)

    let sentCount = 0

    // Process 24h reminders
    for (const appt of reminders24h ?? []) {
      const contact = await getContactPhone(supabase, appt.contact_id)
      if (!contact) continue

      const location = await getTelnyxNumber(supabase, appt.tenant_id)
      if (!location) continue

      const businessName = await getBusinessName(supabase, appt.tenant_id)
      const time = formatTime(appt.start_time)

      console.info(
        `[appointment-reminder] sending 24h reminder: appointment=${appt.id} contact=${contact.phone} at=${appt.start_time}`
      )

      const text = `Reminder: You have an appointment '${appt.title}' tomorrow at ${time}. Reply CANCEL to cancel. - ${businessName}`
      const sent = await sendSms(location.telnyx_number, contact.phone, text)

      if (sent) {
        await supabase.from('appointments').update({ reminder_24h_sent: true }).eq('id', appt.id)
        sentCount++
      }
    }

    // Process 1h reminders
    for (const appt of reminders1h ?? []) {
      const contact = await getContactPhone(supabase, appt.contact_id)
      if (!contact) continue

      const location = await getTelnyxNumber(supabase, appt.tenant_id)
      if (!location) continue

      const businessName = await getBusinessName(supabase, appt.tenant_id)
      const time = formatTime(appt.start_time)

      console.info(
        `[appointment-reminder] sending 1h reminder: appointment=${appt.id} contact=${contact.phone} at=${appt.start_time}`
      )

      const text = `Your appointment '${appt.title}' is in 1 hour at ${time}. See you soon! - ${businessName}`
      const sent = await sendSms(location.telnyx_number, contact.phone, text)

      if (sent) {
        await supabase.from('appointments').update({ reminder_2h_sent: true }).eq('id', appt.id)
        console.info('[appointment-reminder] reminder sent, marked reminder_sent=true')
        sentCount++
      }
    }

    console.info(`[appointment-reminder] scan complete: sent ${sentCount} reminders`)
  } catch (err) {
    console.error('[appointment-reminder] scan error:', err)
  }
}

async function getContactPhone(
  supabase: ReturnType<typeof createClient>,
  contactId: string
): Promise<{ phone: string } | null> {
  const { data } = await supabase.from('contacts').select('phone').eq('id', contactId).single()
  if (!data?.phone) return null
  return { phone: data.phone }
}

async function getTelnyxNumber(
  supabase: ReturnType<typeof createClient>,
  tenantId: string
): Promise<{ telnyx_number: string } | null> {
  const { data } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()
  if (!data?.telnyx_number) return null
  return { telnyx_number: data.telnyx_number }
}

async function getBusinessName(
  supabase: ReturnType<typeof createClient>,
  tenantId: string
): Promise<string> {
  const { data } = await supabase.from('tenants').select('name').eq('id', tenantId).single()
  return data?.name ?? 'your business'
}

export function createAppointmentReminderWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[appointment-reminder] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
