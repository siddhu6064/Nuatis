import { createClient } from '@supabase/supabase-js'

export type EmailEventType =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced_hard'
  | 'bounced_soft'
  | 'complained'
  | 'unsubscribed'

const SUPPRESS_THRESHOLD = 90

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function updateEmailRiskScore(
  contactId: string,
  tenantId: string,
  eventType: EmailEventType
): Promise<void> {
  // For non-risk event types, do nothing
  if (['sent', 'opened', 'clicked'].includes(eventType)) {
    return
  }

  const supabase = getSupabase()

  const { data: contact, error: selectErr } = await supabase
    .from('contacts')
    .select('email_risk_score, email_status')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .single()

  if (selectErr) throw new Error(`email-risk SELECT failed: ${selectErr.message}`)

  if (!contact) {
    console.warn(`[email-risk] contact not found: contactId=${contactId} tenantId=${tenantId}`)
    return
  }

  const currentScore: number = contact.email_risk_score ?? 0
  const currentStatus: string = contact.email_status ?? 'ok'

  let newScore = currentScore
  let newStatus = currentStatus

  if (eventType === 'bounced_hard') {
    newStatus = 'hard_bounce'
    newScore = 100
  } else if (eventType === 'bounced_soft') {
    newScore = Math.min(currentScore + 25, 75)
    newStatus = 'soft_bounce'
  } else if (eventType === 'complained') {
    newStatus = 'complained'
    newScore = 100
  } else if (eventType === 'unsubscribed') {
    newStatus = 'unsubscribed'
    newScore = 90
  } else if (eventType === 'delivered') {
    if (currentScore > 0) {
      newScore = Math.max(currentScore - 5, 0)
    }
    if (newScore === 0 && currentStatus === 'soft_bounce') {
      newStatus = 'ok'
    }
  } else {
    // Unknown event type — do nothing
    return
  }

  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ email_risk_score: newScore, email_status: newStatus })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)

  if (updateErr) throw new Error(`email-risk UPDATE failed: ${updateErr.message}`)
}

export function shouldSuppressEmail(contact: {
  email_status: string | null
  email_risk_score: number | null
}): boolean {
  const status = contact.email_status ?? 'ok'
  const score = contact.email_risk_score ?? 0

  if (status === 'hard_bounce' || status === 'complained' || status === 'unsubscribed') {
    return true
  }
  if (score >= SUPPRESS_THRESHOLD) {
    return true
  }
  return false
}

export function getRiskLabel(score: number): 'healthy' | 'at_risk' | 'suppressed' {
  if (score <= 30) return 'healthy'
  if (score <= SUPPRESS_THRESHOLD - 1) return 'at_risk'
  return 'suppressed'
}
