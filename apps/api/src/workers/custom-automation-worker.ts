import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'custom-automation-scanner'
const MAX_CONTACTS_PER_RUN = 50

const SAFE_UPDATE_FIELDS = ['status', 'stage', 'priority']

export type CustomAutomation = {
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

export type Contact = {
  id: string
  tenant_id: string
  [key: string]: unknown
}

async function getContactsForTrigger(
  supabase: ReturnType<typeof getServiceClient>,
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

    case 'inbound_webhook':
      // Event-driven, not poll-based — fired synchronously by
      // automation-webhook-public.ts when the external system POSTs, not by
      // this scan loop.
      return []

    default:
      console.warn(`[custom-automation-scanner] unknown trigger_type: ${trigger_type}`)
      return []
  }
}

export async function runAction(
  supabase: ReturnType<typeof getServiceClient>,
  automation: CustomAutomation,
  contact: Contact,
  // Extra automation steps pass their own action_type/action_config here;
  // the base (AI-generated) action omits this and falls back to the
  // automation's own columns, unchanged from before steps existed.
  override?: { action_type: string; action_config: Record<string, unknown> }
): Promise<void> {
  const { tenant_id } = automation
  const action_type = override?.action_type ?? automation.action_type
  const action_config = override?.action_config ?? automation.action_config
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

      case 'send_webhook': {
        const url = action_config.url as string
        if (!url) {
          console.warn(`[custom-automation-scanner] send_webhook: missing url, skipping`)
          break
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              automation_id: automation.id,
              tenant_id,
              contact_id,
              trigger_type: automation.trigger_type,
              triggered_at: now.toISOString(),
            }),
            signal: controller.signal,
          })
        } catch (err) {
          console.warn(
            `[custom-automation-scanner] send_webhook failed for contact=${contact_id}:`,
            err
          )
        } finally {
          clearTimeout(timeout)
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
    const supabase = getServiceClient()
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

      const { data: extraSteps } = await supabase
        .from('custom_automation_steps')
        .select('id')
        .eq('automation_id', automation.id)
        .limit(1)
      const hasExtraSteps = (extraSteps ?? []).length > 0

      const slice = contacts.slice(0, MAX_CONTACTS_PER_RUN)
      for (const contact of slice) {
        if (!hasExtraSteps) {
          // No steps beyond the base action — exactly the pre-steps behavior.
          await runAction(supabase, automation, contact)
          continue
        }

        // With steps, the base action only fires once per contact (on first
        // enrollment) rather than on every trigger match, since a trigger
        // like no_response can keep matching the same contact for days.
        const { data: existingEnrollment } = await supabase
          .from('custom_automation_enrollments')
          .select('id')
          .eq('automation_id', automation.id)
          .eq('contact_id', contact.id)
          .maybeSingle()

        if (existingEnrollment) continue

        await runAction(supabase, automation, contact)
        await supabase.from('custom_automation_enrollments').insert({
          tenant_id: automation.tenant_id,
          automation_id: automation.id,
          contact_id: contact.id,
          current_step: 1,
          status: 'active',
          last_step_at: new Date().toISOString(),
        })
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

    await advanceSteps(supabase, pausedTenants)

    console.info('[custom-automation-scanner] scan complete')
  } catch (err) {
    console.error('[custom-automation-scanner] scan error:', err)
  }
}

function evaluateCondition(
  contactRow: Record<string, unknown>,
  field: string,
  op: string,
  value: string | null
): boolean {
  const actual = contactRow[field]
  switch (op) {
    case 'exists':
      return actual !== null && actual !== undefined && actual !== ''
    case 'eq':
      return String(actual ?? '') === (value ?? '')
    case 'neq':
      return String(actual ?? '') !== (value ?? '')
    case 'contains':
      if (Array.isArray(actual)) return actual.map(String).includes(value ?? '')
      return String(actual ?? '').includes(value ?? '')
    default:
      return true
  }
}

// Advances every active enrollment whose next step is due — the multi-step
// half of custom automations. current_step is a cursor into
// custom_automation_steps.step_order (starts at 1; step 0 is the base
// action already run by runAction() above at enrollment time).
async function advanceSteps(
  supabase: ReturnType<typeof getServiceClient>,
  pausedTenants: Set<string>
): Promise<void> {
  const { data: enrollments, error } = await supabase
    .from('custom_automation_enrollments')
    .select('id, tenant_id, automation_id, contact_id, current_step, last_step_at, enrolled_at')
    .eq('status', 'active')

  if (error) {
    console.error(`[custom-automation-scanner] enrollments query error: ${error.message}`)
    return
  }
  if (!enrollments || enrollments.length === 0) return

  const now = Date.now()
  let advanced = 0

  for (const enrollment of enrollments) {
    if (pausedTenants.has(enrollment.tenant_id)) continue
    try {
      const { data: automation } = await supabase
        .from('custom_automations')
        .select('*')
        .eq('id', enrollment.automation_id)
        .maybeSingle()
      if (!automation || automation.status !== 'active') continue

      const { data: step } = await supabase
        .from('custom_automation_steps')
        .select('*')
        .eq('automation_id', enrollment.automation_id)
        .eq('step_order', enrollment.current_step)
        .maybeSingle()

      if (!step) {
        await supabase
          .from('custom_automation_enrollments')
          .update({ status: 'completed' })
          .eq('id', enrollment.id)
        continue
      }

      const referenceDate = enrollment.last_step_at ?? enrollment.enrolled_at
      const daysSinceRef = (now - new Date(referenceDate).getTime()) / 86400000
      if (daysSinceRef < (step.delay_days ?? 0)) continue

      const { data: contact } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', enrollment.contact_id)
        .maybeSingle()
      if (!contact) continue

      const shouldRun =
        !step.condition_field ||
        evaluateCondition(
          contact as Record<string, unknown>,
          step.condition_field,
          step.condition_op ?? 'exists',
          step.condition_value
        )

      if (shouldRun) {
        await runAction(supabase, automation as CustomAutomation, contact as Contact, {
          action_type: step.action_type,
          action_config: (step.action_config as Record<string, unknown>) ?? {},
        })
      } else {
        console.info(
          `[custom-automation-scanner] step ${enrollment.current_step} skipped (condition false) contact=${enrollment.contact_id}`
        )
      }

      const nextStep = enrollment.current_step + 1
      const { data: nextStepRow } = await supabase
        .from('custom_automation_steps')
        .select('id')
        .eq('automation_id', enrollment.automation_id)
        .eq('step_order', nextStep)
        .maybeSingle()

      await supabase
        .from('custom_automation_enrollments')
        .update({
          current_step: nextStep,
          last_step_at: new Date().toISOString(),
          status: nextStepRow ? 'active' : 'completed',
        })
        .eq('id', enrollment.id)

      advanced++
    } catch (err) {
      console.error(`[custom-automation-scanner] error advancing enrollment=${enrollment.id}:`, err)
    }
  }

  if (advanced > 0) {
    console.info(`[custom-automation-scanner] advanced ${advanced} step(s) across enrollments`)
  }
}

export function createCustomAutomationWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[custom-automation-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
