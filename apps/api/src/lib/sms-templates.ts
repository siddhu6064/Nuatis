// ── Vertical groups ───────────────────────────────────────────────────────────

const CLINICAL = new Set(['dental', 'medical', 'vet'])
const SERVICE = new Set([
  'salon',
  'spa',
  'gym',
  'nail_bar',
  'tattoo',
  'pet_grooming',
  'car_wash',
  'laundry',
])
const HOSPITALITY = new Set(['restaurant'])
const PROFESSIONAL = new Set(['contractor', 'law_firm', 'real_estate', 'sales_crm'])

export interface ConfirmationSmsParams {
  contactName?: string | null
  businessName: string
  /** Pre-formatted datetime string e.g. "Monday, April 27 at 10:00 AM". Omit for generic copy. */
  appointmentDateTime?: string | null
  vertical: string
}

export function buildConfirmationSms({
  contactName,
  businessName: biz,
  appointmentDateTime: dt,
  vertical,
}: ConfirmationSmsParams): string {
  const name = contactName?.trim() || null

  if (!dt) {
    if (CLINICAL.has(vertical)) {
      if (name)
        return `Hi ${name}, your appointment with ${biz} has been booked. We look forward to seeing you! Reply CANCEL to cancel.`
      return `Your appointment with ${biz} has been booked. We look forward to seeing you! Reply CANCEL to cancel.`
    }
    if (SERVICE.has(vertical)) {
      if (name)
        return `Hi ${name}, your booking at ${biz} is confirmed. See you soon! Reply CANCEL to cancel.`
      return `Your booking at ${biz} is confirmed. See you soon! Reply CANCEL to cancel.`
    }
    if (HOSPITALITY.has(vertical)) return `Your reservation at ${biz} is confirmed.`
    if (PROFESSIONAL.has(vertical)) return `Your appointment with ${biz} is confirmed.`
    return `Your appointment is confirmed. - ${biz}`
  }

  if (CLINICAL.has(vertical)) {
    if (name)
      return `Hi ${name}, your appointment with ${biz} is confirmed for ${dt}. Reply CANCEL to cancel.`
    return `Your appointment with ${biz} is confirmed for ${dt}. Reply CANCEL to cancel.`
  }
  if (SERVICE.has(vertical)) {
    if (name)
      return `Hi ${name}, your booking at ${biz} is confirmed for ${dt}. Reply CANCEL to cancel.`
    return `Your booking at ${biz} is confirmed for ${dt}. Reply CANCEL to cancel.`
  }
  if (HOSPITALITY.has(vertical)) return `Your reservation at ${biz} is confirmed for ${dt}.`
  if (PROFESSIONAL.has(vertical)) return `Your appointment with ${biz} is confirmed for ${dt}.`
  return `Your appointment with ${biz} is confirmed for ${dt}. Reply CANCEL to cancel.`
}

// ── Trigger Links in SMS ───────────────────────────────────────────────────────
// Example: embed a trigger link in an appointment reminder template:
// `Confirm your appointment: ${buildTriggerUrl(slug, contact.id)}`
// Import buildTriggerUrl from '@nuatis/shared'.
// Tenants configure which trigger link slug to use per template manually.
