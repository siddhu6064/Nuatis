import { getServiceClient } from './supabase.js'

export type SmsEventType = 'sent' | 'delivered' | 'failed' | 'opted_out'

const SUPPRESS_THRESHOLD = 90

export async function updateSmsRiskScore(
  contactId: string,
  tenantId: string,
  eventType: SmsEventType
): Promise<void> {
  if (eventType === 'sent') {
    return
  }

  const supabase = getServiceClient()

  const { data: contact, error: selectErr } = await supabase
    .from('contacts')
    .select('sms_risk_score, sms_status')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .single()

  if (selectErr) throw new Error(`sms-risk SELECT failed: ${selectErr.message}`)

  if (!contact) {
    console.warn(`[sms-risk] contact not found: contactId=${contactId} tenantId=${tenantId}`)
    return
  }

  const currentScore: number = contact.sms_risk_score ?? 0
  const currentStatus: string = contact.sms_status ?? 'ok'

  let newScore = currentScore
  let newStatus = currentStatus

  if (eventType === 'opted_out') {
    newStatus = 'suppressed'
    newScore = 100
  } else if (eventType === 'failed') {
    newScore = Math.min(currentScore + 25, 100)
    newStatus = newScore >= SUPPRESS_THRESHOLD ? 'suppressed' : 'at_risk'
  } else if (eventType === 'delivered') {
    if (currentScore > 0) {
      newScore = Math.max(currentScore - 5, 0)
    }
    if (newScore === 0 && currentStatus === 'at_risk') {
      newStatus = 'ok'
    }
  } else {
    return
  }

  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ sms_risk_score: newScore, sms_status: newStatus })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)

  if (updateErr) throw new Error(`sms-risk UPDATE failed: ${updateErr.message}`)
}

export function shouldSuppressSms(contact: {
  sms_status: string | null
  sms_risk_score: number | null
}): boolean {
  const status = contact.sms_status ?? 'ok'
  const score = contact.sms_risk_score ?? 0

  if (status === 'suppressed') return true
  if (score >= SUPPRESS_THRESHOLD) return true
  return false
}

export function getRiskLabel(score: number): 'healthy' | 'at_risk' | 'suppressed' {
  if (score <= 30) return 'healthy'
  if (score <= SUPPRESS_THRESHOLD - 1) return 'at_risk'
  return 'suppressed'
}
