import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getGrade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  if (score >= 20) return 'D'
  return 'F'
}

export async function computeLeadScore(
  tenantId: string,
  contactId: string
): Promise<{ score: number; grade: string; breakdown: Record<string, number> }> {
  const supabase = getSupabase()

  // Fetch contact profile fields
  const { data: contact } = await supabase
    .from('contacts')
    .select('email, phone, address, referred_by_contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .single()

  // Fetch all activity logs for this contact ordered newest first
  const { data: activities } = await supabase
    .from('activity_log')
    .select('type, body, metadata, created_at')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })

  const activityList: Array<{
    type: string
    body: string
    metadata: Record<string, unknown>
    created_at: string
  }> = (activities ?? []).map((a) => ({
    type: a.type ?? '',
    body: a.body ?? '',
    metadata: (a.metadata ?? {}) as Record<string, unknown>,
    created_at: a.created_at ?? '',
  }))

  // Fetch appointments
  const { data: appointments } = await supabase
    .from('appointments')
    .select('status')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)

  const apptCompleted = (appointments ?? []).filter((a) => a.status === 'completed').length
  const apptNoShow = (appointments ?? []).filter((a) => a.status === 'no_show').length

  // Fetch quotes
  const { data: quotes } = await supabase
    .from('quotes')
    .select('status')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)

  const quotesAccepted = (quotes ?? []).filter((q) => q.status === 'accepted').length
  const quotesDeclined = (quotes ?? []).filter((q) => q.status === 'declined').length

  const breakdown: Record<string, number> = {}

  // --- ENGAGEMENT scoring ---

  // call_completed: type === 'call'
  const callCount = activityList.filter((a) => a.type === 'call').length
  breakdown['call_completed'] = Math.min(callCount, 5) * 10

  // appointment_booked: type === 'appointment' && body includes 'booked'
  const apptBookedCount = activityList.filter(
    (a) => a.type === 'appointment' && a.body.toLowerCase().includes('booked')
  ).length
  breakdown['appointment_booked'] = Math.min(apptBookedCount, 3) * 15

  // appointment_attended: completed appointments
  breakdown['appointment_attended'] = Math.min(apptCompleted, 3) * 20

  // email_opened: type === 'email' && body starts with 'Opened'
  const emailOpenedCount = activityList.filter(
    (a) => a.type === 'email' && a.body.startsWith('Opened')
  ).length
  breakdown['email_opened'] = Math.min(emailOpenedCount, 5) * 5

  // email_replied: type === 'email' && metadata.direction === 'inbound'
  const emailRepliedCount = activityList.filter(
    (a) => a.type === 'email' && a.metadata['direction'] === 'inbound'
  ).length
  breakdown['email_replied'] = Math.min(emailRepliedCount, 3) * 10

  // sms_replied: type === 'sms' && metadata.direction === 'inbound'
  const smsRepliedCount = activityList.filter(
    (a) => a.type === 'sms' && a.metadata['direction'] === 'inbound'
  ).length
  breakdown['sms_replied'] = Math.min(smsRepliedCount, 3) * 8

  // form_submitted: type === 'system' && body includes 'Intake form'
  const formSubmittedCount = activityList.filter(
    (a) => a.type === 'system' && a.body.includes('Intake form')
  ).length
  breakdown['form_submitted'] = Math.min(formSubmittedCount, 2) * 10

  // quote_viewed: type === 'quote' && body includes 'viewed'
  const quoteViewedCount = activityList.filter(
    (a) => a.type === 'quote' && a.body.toLowerCase().includes('viewed')
  ).length
  breakdown['quote_viewed'] = Math.min(quoteViewedCount, 3) * 5

  // quote_accepted: accepted quotes
  breakdown['quote_accepted'] = Math.min(quotesAccepted, 2) * 25

  // --- PROFILE scoring ---
  breakdown['has_email'] = contact?.email ? 5 : 0
  breakdown['has_phone'] = contact?.phone ? 5 : 0
  breakdown['has_address'] = contact?.address ? 3 : 0
  breakdown['referred_contact'] = contact?.referred_by_contact_id ? 10 : 0

  // --- BEHAVIOR (negative) scoring ---
  breakdown['appointment_no_show'] = Math.min(apptNoShow, 3) * -15
  breakdown['quote_declined'] = Math.min(quotesDeclined, 2) * -10

  // --- DECAY scoring ---
  let decayScore = 0
  if (activityList.length > 0) {
    const mostRecentDate = new Date(activityList[0].created_at)
    const now = new Date()
    const daysSinceLastActivity = Math.floor(
      (now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysSinceLastActivity >= 90) {
      decayScore = -30
    } else if (daysSinceLastActivity >= 60) {
      decayScore = -20
    } else if (daysSinceLastActivity >= 30) {
      decayScore = -10
    }
  }
  breakdown['decay'] = decayScore

  // Sum all breakdown values
  const raw = Object.values(breakdown).reduce((sum, v) => sum + v, 0)
  const score = clamp(raw, 0, 100)
  const grade = getGrade(score)

  return { score, grade, breakdown }
}
