interface Contact {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

interface Tenant {
  business_name?: string
  name?: string
  phone?: string
}

export function resolveMergeTags(templateBody: string, contact: Contact, tenant: Tenant): string {
  const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim()

  return templateBody
    .replaceAll('{{first_name}}', contact.first_name || '')
    .replaceAll('{{last_name}}', contact.last_name || '')
    .replaceAll('{{full_name}}', fullName)
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '')
    .replaceAll('{{business_name}}', tenant.business_name || tenant.name || '')
    .replaceAll('{{business_phone}}', tenant.phone || '')
}

export function resolveTemplate(
  template: { subject: string; body: string },
  contact: Contact,
  tenant: Tenant
): { subject: string; body: string } {
  return {
    subject: resolveMergeTags(template.subject, contact, tenant),
    body: resolveMergeTags(template.body, contact, tenant),
  }
}

// ── Appointment confirmation email ────────────────────────────────────────────

const CLINICAL = new Set(['dental', 'medical', 'vet'])
const SERVICE = new Set(['salon', 'spa', 'gym', 'nail_bar', 'tattoo', 'pet_grooming'])
const HOSPITALITY = new Set(['restaurant'])
const PROFESSIONAL = new Set(['contractor', 'law_firm', 'real_estate', 'sales_crm'])

export interface AppointmentConfirmationEmailParams {
  contactName?: string | null
  businessName: string
  /** Pre-formatted datetime string. Omit for generic copy. */
  appointmentDateTime?: string | null
  locationAddress?: string | null
  vertical: string
}

export interface ConfirmationEmail {
  subject: string
  html: string
  text: string
}

interface VerticalCopy {
  noun: string
  prep: string
  greeting: string
  confirmed: string
  followUp: string
}

function getEmailCopy(vertical: string): VerticalCopy {
  if (CLINICAL.has(vertical)) {
    return {
      noun: 'appointment',
      prep: 'with',
      greeting: 'Dear',
      confirmed: 'has been confirmed',
      followUp: 'If you need to reschedule or cancel, please call us directly.',
    }
  }
  if (SERVICE.has(vertical)) {
    return {
      noun: 'booking',
      prep: 'at',
      greeting: 'Hi',
      confirmed: 'is confirmed',
      followUp:
        "Need to reschedule? Just reply to this email or give us a call — we'll get you sorted.",
    }
  }
  if (HOSPITALITY.has(vertical)) {
    return {
      noun: 'reservation',
      prep: 'at',
      greeting: 'Hi',
      confirmed: 'has been confirmed',
      followUp: 'To modify or cancel your reservation, please contact us directly.',
    }
  }
  if (PROFESSIONAL.has(vertical)) {
    return {
      noun: 'appointment',
      prep: 'with',
      greeting: 'Hello',
      confirmed: 'has been confirmed',
      followUp: 'To reschedule, please reply to this email or contact our office.',
    }
  }
  return {
    noun: 'appointment',
    prep: 'with',
    greeting: 'Hi',
    confirmed: 'is confirmed',
    followUp: 'To reschedule or cancel, please reply to this email.',
  }
}

export function buildAppointmentConfirmationEmail(
  params: AppointmentConfirmationEmailParams
): ConfirmationEmail {
  const { businessName: biz, appointmentDateTime: dt, locationAddress: addr, vertical } = params
  const name = params.contactName?.trim() || null
  const copy = getEmailCopy(vertical)

  const subjectDate = dt ? ` — ${dt}` : ''
  const subject = `Your ${copy.noun} ${copy.prep} ${biz} is confirmed${subjectDate}`

  // ── Plain text ──────────────────────────────────────────────────────────────

  const lines: string[] = []
  lines.push(name ? `${copy.greeting} ${name},` : `${copy.greeting},`)
  lines.push('')
  lines.push(
    dt
      ? `Your ${copy.noun} ${copy.prep} ${biz} ${copy.confirmed} for ${dt}.`
      : `Your ${copy.noun} ${copy.prep} ${biz} ${copy.confirmed}.`
  )
  if (addr) lines.push('', `Location: ${addr}`)
  lines.push('', copy.followUp, '', `— ${biz}`)
  const text = lines.join('\n')

  // ── HTML ────────────────────────────────────────────────────────────────────

  const greetingHtml = `<p style="margin:0 0 16px;font-size:16px;color:#374151;">${name ? `${copy.greeting} ${name},` : `${copy.greeting},`}</p>`

  const confirmLine = dt
    ? `Your ${copy.noun} ${copy.prep} <strong>${biz}</strong> ${copy.confirmed} for <strong>${dt}</strong>.`
    : `Your ${copy.noun} ${copy.prep} <strong>${biz}</strong> ${copy.confirmed}.`

  const dtRow = dt
    ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;width:90px;">DATE &amp; TIME</td><td style="padding:6px 0;font-size:15px;color:#111827;">${dt}</td></tr>`
    : ''

  const addrRow = addr
    ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">LOCATION</td><td style="padding:6px 0;font-size:15px;color:#111827;">${addr}</td></tr>`
    : ''

  const summaryCard =
    dt || addr
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;border-radius:8px;padding:16px 20px;width:100%;box-sizing:border-box;margin-bottom:24px;"><tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${dtRow}${addrRow}</table></td></tr></table>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" style="max-width:640px;" cellpadding="0" cellspacing="0">
      <tr><td style="background-color:#0d9488;border-radius:12px 12px 0 0;padding:24px 32px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${biz}</p>
      </td></tr>
      <tr><td style="background-color:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;">
        ${greetingHtml}
        <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">${confirmLine}</p>
        ${summaryCard}
        <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">${copy.followUp}</p>
      </td></tr>
      <tr><td style="background-color:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">${biz}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
%%TRACKING_PIXEL%%
</body>
</html>`

  return { subject, html, text }
}
