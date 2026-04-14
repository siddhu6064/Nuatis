import { Resend } from 'resend'

export interface EmailAttachment {
  filename: string
  content: Buffer
}

export interface EmailParams {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
  attachments?: EmailAttachment[]
}

export interface TemplatedEmailParams {
  to: string
  subject: string
  templateName: 'appointment_reminder' | 'follow_up' | 'welcome'
  variables: Record<string, string>
}

function getClient(): Resend | null {
  const key = process.env['RESEND_API_KEY']
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — email disabled')
    return null
  }
  return new Resend(key)
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  const from = params.from ?? process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>'

  try {
    const sendParams: Record<string, unknown> = {
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo,
    }

    if (params.attachments?.length) {
      sendParams['attachments'] = params.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      }))
    }

    const { error } = await client.emails.send(
      sendParams as unknown as Parameters<typeof client.emails.send>[0]
    )

    if (error) {
      console.error(`[email] failed to=${params.to}: ${error.message}`)
      return false
    }

    console.info(`[email] sent to=${params.to} subject="${params.subject}"`)
    return true
  } catch (err) {
    console.error(`[email] failed to=${params.to}:`, err)
    return false
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

function wrapHtml(body: string, businessName: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.container{max-width:560px;margin:0 auto;padding:32px 24px}
.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}
p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.btn{display:inline-block;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}</style>
</head><body><div class="container"><div class="card">${body}</div>
<div class="footer">${businessName}</div></div></body></html>`
}

function appointmentReminderTemplate(vars: Record<string, string>): string {
  const name = vars['contactName'] ?? 'there'
  const title = vars['appointmentTitle'] ?? 'your appointment'
  const time = vars['appointmentTime'] ?? ''
  const business = vars['businessName'] ?? ''
  return wrapHtml(
    `<h1>Appointment Reminder</h1>
<p>Hi ${name},</p>
<p>This is a reminder that <strong>${title}</strong> is scheduled for <strong>${time}</strong>.</p>
<p>If you need to cancel or reschedule, please give us a call.</p>
<p>See you soon!</p>`,
    business
  )
}

function followUpTemplate(vars: Record<string, string>): string {
  const name = vars['contactName'] ?? 'there'
  const business = vars['businessName'] ?? ''
  const message = vars['message'] ?? ''
  const ctaText = vars['ctaText']
  const ctaUrl = vars['ctaUrl']
  const ctaHtml =
    ctaText && ctaUrl
      ? `<p style="margin-top:20px"><a class="btn" href="${ctaUrl}">${ctaText}</a></p>`
      : ''
  return wrapHtml(
    `<h1>Following Up</h1>
<p>Hi ${name},</p>
<p>${message}</p>${ctaHtml}`,
    business
  )
}

function welcomeTemplate(vars: Record<string, string>): string {
  const name = vars['contactName'] ?? 'there'
  const business = vars['businessName'] ?? ''
  return wrapHtml(
    `<h1>Welcome!</h1>
<p>Hi ${name},</p>
<p>Thank you for reaching out to ${business}. We're glad to have you!</p>
<p>If you have any questions, just reply to this email or give us a call.</p>`,
    business
  )
}

const TEMPLATES: Record<string, (vars: Record<string, string>) => string> = {
  appointment_reminder: appointmentReminderTemplate,
  follow_up: followUpTemplate,
  welcome: welcomeTemplate,
}

export async function sendTemplatedEmail(params: TemplatedEmailParams): Promise<boolean> {
  const templateFn = TEMPLATES[params.templateName]
  if (!templateFn) {
    console.error(`[email] unknown template: ${params.templateName}`)
    return false
  }

  const html = templateFn(params.variables)
  return sendEmail({ to: params.to, subject: params.subject, html })
}
