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

// ── Appointment reminders ─────────────────────────────────────────────────────

export interface AppointmentReminder24hSmsParams {
  appointmentTitle: string
  /** Pre-formatted time string e.g. "10:00 AM". */
  time: string
  businessName: string
}

export function buildAppointmentReminder24hSms({
  appointmentTitle,
  time,
  businessName,
}: AppointmentReminder24hSmsParams): string {
  return `Reminder: You have an appointment '${appointmentTitle}' tomorrow at ${time}. Reply CANCEL to cancel or STOP to opt out. - ${businessName}`
}

export interface AppointmentReminder1hSmsParams {
  appointmentTitle: string
  /** Pre-formatted time string e.g. "10:00 AM". */
  time: string
  businessName: string
}

export function buildAppointmentReminder1hSms({
  appointmentTitle,
  time,
  businessName,
}: AppointmentReminder1hSmsParams): string {
  return `Your appointment '${appointmentTitle}' is in 1 hour at ${time}. See you soon! Reply CANCEL to cancel or STOP to opt out. - ${businessName}`
}

// ── No-show rebook ────────────────────────────────────────────────────────────

export interface NoShowRebookSmsParams {
  fromNumber: string
}

export function buildNoShowRebookSms({ fromNumber }: NoShowRebookSmsParams): string {
  return `We missed you today! Would you like to rebook? Reply YES or call us at ${fromNumber}.`
}

// ── Escalation transfer (internal owner alert — not a contact-facing message) ──

export interface EscalationTransferSmsParams {
  callerId?: string | null
  reason: string
}

export function buildEscalationTransferSms({
  callerId,
  reason,
}: EscalationTransferSmsParams): string {
  return `Incoming call transfer from Maya AI. Caller: ${callerId || 'unknown'}. Reason: ${reason}. Connecting now.`
}

// ── SMS webhook keyword replies ───────────────────────────────────────────────

/** Reply sent when a contact texts HELP. Contains TCPA-required opt-out wording — preserve byte-for-byte. */
export function buildSmsHelpReplySms(): string {
  return 'Reply STOP to unsubscribe. For help call us directly.'
}

// ── Trigger Links in SMS ───────────────────────────────────────────────────────
// Example: embed a trigger link in an appointment reminder template:
// `Confirm your appointment: ${buildTriggerUrl(slug, contact.id)}`
// Import buildTriggerUrl from '@nuatis/shared'.
// Tenants configure which trigger link slug to use per template manually.
