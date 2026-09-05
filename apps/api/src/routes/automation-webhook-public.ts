import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { inboundAutomationWebhookLimiter } from '../middleware/rate-limit.js'
import { logActivity } from '../lib/activity.js'
import { runAction, type CustomAutomation } from '../workers/custom-automation-worker.js'

const router = Router()

interface WebhookTriggerConfig {
  match_by: 'email' | 'phone'
  field_mapping: Partial<Record<'email' | 'phone' | 'first_name' | 'last_name', string>>
}

// ── PUBLIC: POST /webhooks/automations/:token ────────────────────────────────
// External system (Zapier, a customer's own script) POSTs a JSON body here to
// fire one custom automation. The token in the URL is the auth — see
// migration 0182 for why there's no separate signing secret. Runs the
// automation's action synchronously for this one contact, unlike the poll-based
// scan() loop every other trigger type goes through.
router.post(
  '/:token',
  inboundAutomationWebhookLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params as { token: string }
    const supabase = getServiceClient()

    const { data: automation } = await supabase
      .from('custom_automations')
      .select('*')
      .eq('inbound_webhook_token', token)
      .eq('trigger_type', 'inbound_webhook')
      .maybeSingle()

    if (!automation || automation.status !== 'active') {
      res.status(404).json({ error: 'Webhook not found' })
      return
    }

    const payload = (req.body ?? {}) as Record<string, unknown>
    const config = (automation.trigger_config ?? {}) as unknown as WebhookTriggerConfig
    const mapping = config.field_mapping ?? {}

    function readMapped(field: keyof WebhookTriggerConfig['field_mapping']): string | null {
      const payloadKey = mapping[field]
      if (!payloadKey) return null
      const value = payload[payloadKey]
      return typeof value === 'string' && value.trim() ? value.trim() : null
    }

    const email = readMapped('email')
    const phone = readMapped('phone')
    const firstName = readMapped('first_name') ?? ''
    const lastName = readMapped('last_name') ?? ''

    const matchValue = config.match_by === 'email' ? email : phone
    if (!matchValue) {
      res.status(400).json({
        error: `Payload is missing a value for the mapped ${config.match_by} field`,
      })
      return
    }

    const tenantId = automation.tenant_id as string

    try {
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq(config.match_by, matchValue)
        .maybeSingle()

      let contactId: string
      if (existingContact) {
        contactId = existingContact.id as string
      } else {
        const fullName = `${firstName} ${lastName}`.trim() || email || phone || 'Webhook Contact'
        const { data: newContact, error: insertErr } = await supabase
          .from('contacts')
          .insert({
            tenant_id: tenantId,
            full_name: fullName,
            email: email || null,
            phone: phone || null,
            source: 'inbound_webhook',
            sms_opt_in: Boolean(phone),
          })
          .select('id')
          .single()

        if (insertErr || !newContact) {
          console.error('[automation-webhook] contact insert error:', insertErr?.message)
          res.status(500).json({ error: 'Failed to create contact' })
          return
        }
        contactId = newContact.id as string
      }

      await runAction(supabase, automation as CustomAutomation, {
        id: contactId,
        tenant_id: tenantId,
      })

      logActivity({
        tenantId,
        contactId,
        type: 'system',
        body: `Automation "${automation.name}" triggered via inbound webhook`,
        metadata: { automation_id: automation.id },
        actorType: 'system',
      })

      await supabase
        .from('custom_automations')
        .update({
          run_count: (automation.run_count as number) + 1,
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', automation.id)
        .eq('tenant_id', tenantId)

      res.json({ ok: true })
    } catch (err) {
      console.error('[automation-webhook] error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

export default router
