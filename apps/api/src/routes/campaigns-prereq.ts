import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface PrereqCheck {
  key: string
  label: string
  status: 'pass' | 'fail' | 'warning'
  detail: string
  action_url: string | null
}

export interface PrereqResult {
  ready: boolean
  checks: PrereqCheck[]
}

export async function getPrereqChecks(tenantId: string): Promise<PrereqResult> {
  const supabase = getSupabase()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Run all 5 checks in parallel
  const [
    smartListsResult,
    contactsResult,
    brandVoiceResult,
    emailHealthResult,
    smsComplianceResult,
  ] = await Promise.allSettled([
    // Check 1: smart_lists
    supabase
      .from('smart_lists')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),

    // Check 2: contacts
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),

    // Check 3: brand_voice
    supabase.from('tenants').select('brand_voice').eq('id', tenantId).single(),

    // Check 4: email_health (3 parallel sub-queries)
    Promise.all([
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('event_type', 'delivered')
        .gte('created_at', thirtyDaysAgo),
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('event_type', 'sent')
        .gte('created_at', thirtyDaysAgo),
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('event_type', 'bounced_hard')
        .gte('created_at', thirtyDaysAgo),
    ]),

    // Check 5: sms_compliance
    supabase
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('direction', 'outbound')
      .gte('created_at', thirtyDaysAgo),
  ])

  // ── Build each check ─────────────────────────────────────────────────────

  // Check 1: smart_lists
  let smartListsCheck: PrereqCheck
  if (smartListsResult.status === 'fulfilled' && !smartListsResult.value.error) {
    const count = smartListsResult.value.count ?? 0
    smartListsCheck = {
      key: 'smart_lists',
      label: 'Smart Lists',
      status: count >= 1 ? 'pass' : 'fail',
      detail:
        count >= 1
          ? `${count} smart list${count === 1 ? '' : 's'} configured`
          : 'No smart lists found — create at least one segment',
      action_url: '/contacts?tab=smart-lists',
    }
  } else {
    smartListsCheck = {
      key: 'smart_lists',
      label: 'Smart Lists',
      status: 'warning',
      detail: 'Unable to verify',
      action_url: '/contacts?tab=smart-lists',
    }
  }

  // Check 2: contacts
  let contactsCheck: PrereqCheck
  if (contactsResult.status === 'fulfilled' && !contactsResult.value.error) {
    const count = contactsResult.value.count ?? 0
    let status: 'pass' | 'fail' | 'warning'
    let detail: string
    if (count >= 10) {
      status = 'pass'
      detail = `${count} contacts available for targeting`
    } else if (count >= 1) {
      status = 'warning'
      detail = `Only ${count} contact${count === 1 ? '' : 's'} — add more for effective campaigns`
    } else {
      status = 'fail'
      detail = 'No contacts found'
    }
    contactsCheck = {
      key: 'contacts',
      label: 'Contacts',
      status,
      detail,
      action_url: '/contacts',
    }
  } else {
    contactsCheck = {
      key: 'contacts',
      label: 'Contacts',
      status: 'warning',
      detail: 'Unable to verify',
      action_url: '/contacts',
    }
  }

  // Check 3: brand_voice
  let brandVoiceCheck: PrereqCheck
  if (brandVoiceResult.status === 'fulfilled' && !brandVoiceResult.value.error) {
    const { data: row } = brandVoiceResult.value
    // row is now { brand_voice: unknown } | null
    const hasBrandVoice = row && row.brand_voice != null && row.brand_voice !== ''
    brandVoiceCheck = {
      key: 'brand_voice',
      label: 'Brand Voice',
      status: hasBrandVoice ? 'pass' : 'warning',
      detail: hasBrandVoice ? 'Brand voice configured' : 'Not set — AI will use generic copy',
      action_url: '/settings/brand-profile',
    }
  } else {
    brandVoiceCheck = {
      key: 'brand_voice',
      label: 'Brand Voice',
      status: 'warning',
      detail: 'Unable to verify',
      action_url: '/settings/brand-profile',
    }
  }

  // Check 4: email_health
  let emailHealthCheck: PrereqCheck
  if (
    emailHealthResult.status === 'fulfilled' &&
    !emailHealthResult.value[0].error &&
    !emailHealthResult.value[1].error &&
    !emailHealthResult.value[2].error
  ) {
    const delivered = emailHealthResult.value[0].count ?? 0
    const sent = emailHealthResult.value[1].count ?? 0
    const hardBounces = emailHealthResult.value[2].count ?? 0

    if (sent === 0) {
      emailHealthCheck = {
        key: 'email_health',
        label: 'Email Health',
        status: 'warning',
        detail: 'No emails sent in last 30 days',
        action_url: '/settings/email-health',
      }
    } else {
      const deliveryRate = delivered / sent
      const hardBounceRate = hardBounces / sent
      const deliveryPct = (deliveryRate * 100).toFixed(1)
      const hardBouncePct = (hardBounceRate * 100).toFixed(1)

      let status: 'pass' | 'fail' | 'warning'
      let detail: string

      if (hardBounceRate > 0.05) {
        status = 'fail'
        detail = `Hard bounce rate ${hardBouncePct}% — fix before sending campaigns`
      } else if (deliveryRate < 0.8) {
        status = 'fail'
        detail = `Delivery rate ${deliveryPct}% — address delivery issues first`
      } else if (deliveryRate < 0.95) {
        status = 'warning'
        detail = `Delivery rate ${deliveryPct}% — consider improving before campaigns`
      } else {
        status = 'pass'
        detail = `Delivery rate ${deliveryPct}%`
      }

      emailHealthCheck = {
        key: 'email_health',
        label: 'Email Health',
        status,
        detail,
        action_url: '/settings/email-health',
      }
    }
  } else {
    emailHealthCheck = {
      key: 'email_health',
      label: 'Email Health',
      status: 'warning',
      detail: 'No email data available',
      action_url: '/settings/email-health',
    }
  }

  // Check 5: sms_compliance
  let smsComplianceCheck: PrereqCheck
  if (smsComplianceResult.status === 'fulfilled' && !smsComplianceResult.value.error) {
    const count = smsComplianceResult.value.count ?? 0
    smsComplianceCheck = {
      key: 'sms_compliance',
      label: 'SMS Compliance',
      status: count > 0 ? 'pass' : 'warning',
      detail:
        count > 0
          ? 'Active SMS delivery confirmed'
          : 'No SMS sent in last 30 days — 10DLC status unknown',
      action_url: null,
    }
  } else {
    smsComplianceCheck = {
      key: 'sms_compliance',
      label: 'SMS Compliance',
      status: 'warning',
      detail: 'Unable to verify',
      action_url: null,
    }
  }

  const checks: PrereqCheck[] = [
    smartListsCheck,
    contactsCheck,
    brandVoiceCheck,
    emailHealthCheck,
    smsComplianceCheck,
  ]

  // brand_voice and sms_compliance are informational — only smart_lists, contacts, email_health gate launch
  const ready =
    smartListsCheck.status === 'pass' &&
    contactsCheck.status === 'pass' &&
    emailHealthCheck.status !== 'fail'

  return { ready, checks }
}

// ── GET /api/campaigns/prereq ──────────────────────────────────────────────────
router.get('/prereq', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  try {
    const result = await getPrereqChecks(authed.tenantId)
    res.json(result)
  } catch (err) {
    console.error('[campaigns/prereq] unexpected error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
