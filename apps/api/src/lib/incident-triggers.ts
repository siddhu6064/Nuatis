import { getServiceClient } from './supabase.js'

/**
 * Emit an incident event into the automation engine.
 *
 * Built-in escalation rules (`incident_rules`) are what make the incidents
 * module work on its own; this is the extra reach for tenants who ALSO have
 * the automation module. A tenant without one simply has no listener, and that
 * must never turn into a failed incident report.
 */
export type IncidentTrigger = 'incident_created' | 'incident_breached'

/**
 * The actions that mean something for an incident.
 *
 * The automation engine is contact-centric: `send_sms`, `send_email`,
 * `add_tag`, `update_field` and `send_to_campaign` all act on a contact row,
 * and an incident has none — a broken fryer has no customer attached. Running
 * them anyway would write rows with a null contact_id, which is worse than
 * doing nothing because it looks like it worked.
 *
 * `routes/custom-automations.ts` refuses to save an incident-triggered
 * automation whose action is not in this set, so a tenant cannot configure one
 * that would silently do nothing.
 */
export const INCIDENT_SAFE_ACTIONS = new Set(['create_task', 'send_webhook'])

interface IncidentAutomation {
  id: string
  tenant_id: string
  action_type: string
  action_config: Record<string, unknown>
  run_count: number | null
}

/**
 * Run every active automation listening for this incident event.
 *
 * Awaitable so tests can assert on it. Production calls
 * {@link fireIncidentTrigger} instead, which must not make the caller wait.
 */
export async function runIncidentTrigger(
  tenantId: string,
  trigger: IncidentTrigger,
  incident: Record<string, unknown>
): Promise<void> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('custom_automations')
    .select('id, tenant_id, action_type, action_config, run_count')
    .eq('tenant_id', tenantId)
    .eq('trigger_type', trigger)
    .eq('status', 'active')

  if (error) {
    console.error(`[incident-triggers] ${trigger} lookup failed:`, error.message)
    return
  }

  const automations = (data ?? []) as IncidentAutomation[]
  if (automations.length === 0) return

  for (const automation of automations) {
    // One tenant's broken webhook must not cost the others their task.
    try {
      if (!INCIDENT_SAFE_ACTIONS.has(automation.action_type)) {
        console.warn(
          `[incident-triggers] automation=${automation.id} action ${automation.action_type} needs a contact, skipping`
        )
        continue
      }

      await runIncidentAction(supabase, automation, trigger, incident, tenantId)

      await supabase
        .from('custom_automations')
        .update({
          run_count: (automation.run_count ?? 0) + 1,
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', automation.id)
        .eq('tenant_id', tenantId)
    } catch (err) {
      console.error(`[incident-triggers] automation=${automation.id} failed:`, err)
    }
  }
}

async function runIncidentAction(
  supabase: ReturnType<typeof getServiceClient>,
  automation: IncidentAutomation,
  trigger: IncidentTrigger,
  incident: Record<string, unknown>,
  tenantId: string
): Promise<void> {
  const config = automation.action_config ?? {}
  const incidentId = typeof incident['id'] === 'string' ? incident['id'] : null
  const reference = typeof incident['reference'] === 'string' ? incident['reference'] : null

  if (automation.action_type === 'create_task') {
    const dueDate = new Date(Date.now() + 86400000).toISOString()
    const { error } = await supabase.from('tasks').insert({
      tenant_id: tenantId,
      // Contactless on purpose. `tasks.incident_id` from migration 0199 is the
      // designed link: follow-up work points back at its cause rather than
      // duplicating incident fields onto the task.
      contact_id: null,
      incident_id: incidentId,
      title: (config['title'] as string) ?? `Follow up on ${reference ?? 'incident'}`,
      status: 'open',
      due_date: dueDate,
      priority: 'medium',
    })
    if (error) throw new Error(error.message)
    return
  }

  if (automation.action_type === 'send_webhook') {
    const url = config['url'] as string | undefined
    if (!url) throw new Error('send_webhook: missing url')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation_id: automation.id,
          tenant_id: tenantId,
          trigger_type: trigger,
          triggered_at: new Date().toISOString(),
          // The incident stands where contact_id does for the other triggers.
          incident,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * Fire-and-forget wrapper. Returns immediately and never throws: a tenant
 * without the automation module, a misconfigured webhook or a database blip
 * must not fail the incident report that fired it.
 */
export function fireIncidentTrigger(
  tenantId: string,
  trigger: IncidentTrigger,
  incident: Record<string, unknown>
): void {
  void runIncidentTrigger(tenantId, trigger, incident).catch((err) => {
    console.error(`[incident-triggers] ${trigger} failed:`, err)
  })
}
