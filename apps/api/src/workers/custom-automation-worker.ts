import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'custom-automation-scanner'
const MAX_CONTACTS_PER_RUN = 50

const SAFE_UPDATE_FIELDS = ['status', 'stage', 'priority']

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

type CustomAutomation = {
  id: string
  tenant_id: string
  status: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  action_type: string
  action_config: Record<string, unknown>
  run_count: number
  last_run_at: string | null
  updated_at: string
}

type Contact = {
  id: string
  tenant_id: string
  [key: string]: unknown
}

async function getContactsForTrigger(
  supabase: ReturnType<typeof getSupabase>,
  automation: CustomAutomation
): Promise<Contact[]> {
  const { tenant_id, trigger_type, trigger_config } = automation
  const now = new Date()

  switch (trigger_type) {
    case 'no_response': {
      const days = (trigger_config.days as number) ?? 3
      const cutoff = new Date(now.getTime() - days * 86400000).toISOString()
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .eq('is_archived', false)
        .lt('last_contacted', cutoff)
        .limit(MAX_CONTACTS_PER_RUN)
      if (error) {
        console.error(`[custom-automation-scanner] no_response query error: ${error.message}`)
        return []
      }
      return (data ?? []) as Contact[]
    }

    case 'birthday': {
      const todayMonth = now.getMonth() + 1
      const todayDay = now.getDate()
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id, birthday')
        .eq('tenant_id', tenant_id)
        .eq('is_archived', false)
        .not('birthday', 'is', null)
        .limit(MAX_CONTACTS_PER_RUN * 10) // over-fetch, filter in JS
      if (error) {
        console.error(`[custom-automation-scanner] birthday query error: ${error.message}`)
        return []
      }
      const matched = ((data ?? []) as (Contact & { birthday: string })[]).filter((c) => {
        if (!c.birthday) return false
        const bday = new Date(c.birthday)
        return bday.getMonth() + 1 === todayMonth && bday.getDate() === todayDay
      })
      return matched.slice(0, MAX_CONTACTS_PER_RUN)
    }

    case 'overdue_invoice': {
      const { data: invoices, error: invError } = await supabase
        .from('invoices')
        .select('contact_id')
        .eq('tenant_id', tenant_id)
        .eq('status', 'overdue')
        .limit(MAX_CONTACTS_PER_RUN)
      if (invError) {
        console.error(
          `[custom-automation-scanner] overdue_invoice invoice query error: ${invError.message}`
        )
        return []
      }
      const contactIds = (invoices ?? [])
        .map((i: { contact_id: string }) => i.contact_id)
        .filter(Boolean)
      if (contactIds.length === 0) return []
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .in('id', contactIds)
        .limit(MAX_CONTACTS_PER_RUN)
      if (error) {
        console.error(
          `[custom-automation-scanner] overdue_invoice contact query error: ${error.message}`
        )
        return []
      }
      return (data ?? []) as Contact[]
    }

    case 'inactive_customer': {
      const days = (trigger_config.days as number) ?? 30
      const cutoff = new Date(now.getTime() - days * 86400000).toISOString()
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .eq('is_archived', false)
        .neq('status', 'lead')
        .lt('last_contacted', cutoff)
        .limit(MAX_CONTACTS_PER_RUN)
      if (error) {
        console.error(`[custom-automation-scanner] inactive_customer query error: ${error.message}`)
        return []
      }
      return (data ?? []) as Contact[]
    }

    case 'new_contact': {
      const cutoff = new Date(now.getTime() - 86400000).toISOString()
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .eq('is_archived', false)
        .gt('created_at', cutoff)
        .limit(MAX_CONTACTS_PER_RUN)
      if (error) {
        console.error(`[custom-automation-scanner] new_contact query error: ${error.message}`)
        return []
      }
      return (data ?? []) as Contact[]
    }

    case 'appointment_followup': {
      const hours = (trigger_config.hours as number) ?? 24
      const cutoff = new Date(now.getTime() - hours * 3600000).toISOString()
      const { data: appointments, error: apptError } = await supabase
        .from('appointments')
        .select('contact_id')
        .eq('tenant_id', tenant_id)
        .eq('status', 'completed')
        .gt('updated_at', cutoff)
        .limit(MAX_CONTACTS_PER_RUN)
      if (apptError) {
        console.error(
          `[custom-automation-scanner] appointment_followup appointments query error: ${apptError.message}`
        )
        return []
      }
      const contactIds = (appointments ?? [])
        .map((a: { contact_id: string }) => a.contact_id)
        .filter(Boolean)
      if (contactIds.length === 0) return []
      const { data, error } = await supabase
        .from('contacts')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .in('id', contactIds)
        .limit(MAX_CONTACTS_PER_RUN)
      if (error) {
        console.error(
          `[custom-automation-scanner] appointment_followup contact query error: ${error.message}`
        )
        return []
      }
      return (data ?? []) as Contact[]
    }

    default:
      console.warn(`[custom-automation-scanner] unknown trigger_type: ${trigger_type}`)
      return []
  }
}

async function runAction(
  supabase: ReturnType<typeof getSupabase>,
  automation: CustomAutomation,
  contact: Contact
): Promise<void> {
  const { tenant_id, action_type, action_config } = automation
  const contact_id = contact.id
  const now = new Date()

  try {
    switch (action_type) {
      case 'send_sms': {
        const { error } = await supabase.from('sms_messages').insert({
          tenant_id,
          contact_id,
          body: (action_config.message as string) ?? 'Hello',
          status: 'queued',
          direction: 'outbound',
        })
        if (error) {
          if (error.message.includes('does not exist') || error.code === '42P01') {
            console.warn('[custom-automation-scanner] sms_messages table does not exist, skipping')
          } else {
            console.error(
              `[custom-automation-scanner] send_sms error for contact=${contact_id}: ${error.message}`
            )
          }
        }
        break
      }

      case 'send_email': {
        const { error } = await supabase.from('email_messages').insert({
          tenant_id,
          contact_id,
          subject: (action_config.subject as string) ?? 'Hello',
          body: (action_config.body as string) ?? '',
          status: 'queued',
        })
        if (error) {
          if (error.message.includes('does not exist') || error.code === '42P01') {
            console.warn(
              '[custom-automation-scanner] email_messages table does not exist, skipping'
            )
          } else {
            console.error(
              `[custom-automation-scanner] send_email error for contact=${contact_id}: ${error.message}`
            )
          }
        }
        break
      }

      case 'create_task': {
        const dueAt = new Date(now.getTime() + 86400000).toISOString()
        const { error } = await supabase.from('tasks').insert({
          tenant_id,
          contact_id,
          title: (action_config.title as string) ?? 'Follow up',
          status: 'pending',
          due_at: dueAt,
        })
        if (error) {
          console.error(
            `[custom-automation-scanner] create_task error for contact=${contact_id}: ${error.message}`
          )
        }
        break
      }

      case 'add_tag': {
        const tag = (action_config.tag as string) ?? 'auto'
        const { data: contactData, error: fetchErr } = await supabase
          .from('contacts')
          .select('tags')
          .eq('id', contact_id)
          .eq('tenant_id', tenant_id)
          .maybeSingle()
        if (fetchErr) {
          console.error(
            `[custom-automation-scanner] add_tag fetch error for contact=${contact_id}: ${fetchErr.message}`
          )
          break
        }
        const existingTags: string[] = Array.isArray(
          (contactData as { tags?: string[] } | null)?.tags
        )
          ? (contactData as { tags: string[] }).tags
          : []
        if (!existingTags.includes(tag)) {
          const { error: updateErr } = await supabase
            .from('contacts')
            .update({ tags: [...existingTags, tag] })
            .eq('id', contact_id)
            .eq('tenant_id', tenant_id)
          if (updateErr) {
            console.error(
              `[custom-automation-scanner] add_tag update error for contact=${contact_id}: ${updateErr.message}`
            )
          }
        }
        break
      }

      case 'update_field': {
        const field = action_config.field as string
        const value = action_config.value
        if (!SAFE_UPDATE_FIELDS.includes(field)) {
          console.warn(
            `[custom-automation-scanner] update_field: field '${field}' not in safelist, skipping`
          )
          break
        }
        const { error } = await supabase
          .from('contacts')
          .update({ [field]: value })
          .eq('id', contact_id)
          .eq('tenant_id', tenant_id)
        if (error) {
          console.error(
            `[custom-automation-scanner] update_field error for contact=${contact_id}: ${error.message}`
          )
        }
        break
      }

      case 'send_to_campaign': {
        const campaign_id = action_config.campaign_id as string
        if (!campaign_id) {
          console.warn(
            `[custom-automation-scanner] send_to_campaign: missing campaign_id, skipping`
          )
          break
        }
        const { error } = await supabase
          .from('campaign_contacts')
          .upsert(
            { campaign_id, contact_id, tenant_id, status: 'pending' },
            { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true }
          )
        if (error) {
          console.error(
            `[custom-automation-scanner] send_to_campaign error for contact=${contact_id}: ${error.message}`
          )
        }
        break
      }

      default:
        console.warn(`[custom-automation-scanner] unknown action_type: ${action_type}`)
    }
  } catch (err) {
    console.error(
      `[custom-automation-scanner] runAction uncaught error for contact=${contact_id} action=${action_type}:`,
      err
    )
  }
}

export async function scan(): Promise<void> {
  console.info('[custom-automation-scanner] scanning active custom automations...')

  try {
    const supabase = getSupabase()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)

    const { data: automations, error } = await supabase
      .from('custom_automations')
      .select('*')
      .eq('status', 'active')

    if (error) {
      console.error(`[custom-automation-scanner] query error: ${error.message}`)
      return
    }

    if (!automations || automations.length === 0) {
      console.info('[custom-automation-scanner] no active automations found')
      console.info('[custom-automation-scanner] scan complete')
      return
    }

    console.info(`[custom-automation-scanner] found ${automations.length} active automation(s)`)

    for (const automation of automations as CustomAutomation[]) {
      if (pausedTenants.has(automation.tenant_id)) {
        console.info(
          `[custom-automation-scanner] tenant=${automation.tenant_id} is paused, skipping automation=${automation.id}`
        )
        continue
      }

      const contacts = await getContactsForTrigger(supabase, automation)

      if (contacts.length === 0) {
        console.info(
          `[custom-automation-scanner] automation=${automation.id} matched 0 contacts, skipping`
        )
        continue
      }

      console.info(
        `[custom-automation-scanner] automation=${automation.id} trigger=${automation.trigger_type} action=${automation.action_type} matched ${contacts.length} contact(s)`
      )

      const slice = contacts.slice(0, MAX_CONTACTS_PER_RUN)
      for (const contact of slice) {
        await runAction(supabase, automation, contact)
      }

      // Update run stats
      const { error: updateErr } = await supabase
        .from('custom_automations')
        .update({
          run_count: automation.run_count + 1,
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', automation.id)
        .eq('tenant_id', automation.tenant_id)

      if (updateErr) {
        console.error(
          `[custom-automation-scanner] failed to update run stats for automation=${automation.id}: ${updateErr.message}`
        )
      } else {
        console.info(
          `[custom-automation-scanner] automation=${automation.id} processed ${slice.length} contact(s), run_count=${automation.run_count + 1}`
        )
      }
    }

    console.info('[custom-automation-scanner] scan complete')
  } catch (err) {
    console.error('[custom-automation-scanner] scan error:', err)
  }
}

export function createCustomAutomationWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[custom-automation-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
