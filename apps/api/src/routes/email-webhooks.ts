import { Router, type Request, type Response } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { updateEmailRiskScore, type EmailEventType } from '../lib/email-risk.js'

const router = Router()

// Optional Resend/Svix webhook signature verification
// Resend uses Svix to deliver webhooks. Signature headers: svix-id, svix-timestamp, svix-signature
// Message to sign: `${svix-id}.${svix-timestamp}.${rawBody}`
// Signature format: "v1,<base64-hmac-sha256>"
function verifyWebhookSignature(req: Request): boolean {
  const secret = process.env['RESEND_WEBHOOK_SECRET']
  if (!secret) return true // verification disabled — skip

  const svixId = req.headers['svix-id'] as string | undefined
  const svixTimestamp = req.headers['svix-timestamp'] as string | undefined
  const svixSignature = req.headers['svix-signature'] as string | undefined

  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Reject if timestamp is older than 5 minutes (replay protection)
  const ts = parseInt(svixTimestamp, 10)
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false

  // req.body is a Buffer (from express.raw) when called on this route
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body)
  const message = `${svixId}.${svixTimestamp}.${rawBody}`
  const hmac = createHmac('sha256', Buffer.from(secret.replace('whsec_', ''), 'base64'))
    .update(message)
    .digest('base64')

  // svix-signature can be "v1,<base64sig> v1,<base64sig2>" (space-separated, multiple sigs)
  const signatures = svixSignature.split(' ')
  return signatures.some((sig) => {
    if (!sig.startsWith('v1,')) return false
    const sigValue = sig.slice(3)
    const a = Buffer.from(hmac)
    const b = Buffer.from(sigValue)
    if (a.byteLength !== b.byteLength) return false
    return timingSafeEqual(a, b)
  })
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  // Verify signature if secret is configured
  if (!verifyWebhookSignature(req)) {
    res.sendStatus(401)
    return
  }

  // Parse body (may be Buffer from express.raw, or already-parsed object from express.json)
  const body =
    req.body instanceof Buffer
      ? (JSON.parse(req.body.toString('utf8')) as Record<string, unknown>)
      : (req.body as Record<string, unknown>)

  const eventType: string = (body['type'] as string | undefined) ?? ''
  const data = (body['data'] as Record<string, unknown> | undefined) ?? {}

  // Map Resend event type to our internal type
  let internalEventType: EmailEventType | null = null
  if (eventType === 'email.sent') internalEventType = 'sent'
  else if (eventType === 'email.delivered') internalEventType = 'delivered'
  else if (eventType === 'email.opened') internalEventType = 'opened'
  else if (eventType === 'email.clicked') internalEventType = 'clicked'
  else if (eventType === 'email.bounced') {
    const bounce = data['bounce'] as Record<string, unknown> | undefined
    internalEventType = bounce?.['type'] === 'hard' ? 'bounced_hard' : 'bounced_soft'
  } else if (eventType === 'email.complained') internalEventType = 'complained'
  else if (eventType === 'email.unsubscribed') internalEventType = 'unsubscribed'

  if (!internalEventType) {
    console.info(`[email-webhook] unknown event type: ${eventType}`)
    res.sendStatus(200)
    return
  }

  const resendEmailId: string = (data['email_id'] as string | undefined) ?? ''
  const toRaw = data['to']
  const toAddress: string = Array.isArray(toRaw)
    ? ((toRaw[0] as string | undefined) ?? '')
    : ((toRaw as string | undefined) ?? '')
  const tags: Array<{ name: string; value: string }> = Array.isArray(data['tags'])
    ? (data['tags'] as Array<{ name: string; value: string }>)
    : []
  const tenantId: string = tags.find((t) => t.name === 'tenant_id')?.value ?? ''
  const bounce = data['bounce'] as Record<string, unknown> | undefined
  const bounceType: string | null = (bounce?.['type'] as string | undefined) ?? null
  const bounceSubtype: string | null = (bounce?.['subtype'] as string | undefined) ?? null

  if (!tenantId) {
    console.warn(`[email-webhook] no tenant_id tag in event ${eventType} email_id=${resendEmailId}`)
    res.sendStatus(200)
    return
  }

  const supabase = createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
  )

  // Look up contact by email address + tenant_id
  let contactId: string | null = null
  if (toAddress) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('email', toAddress)
      .limit(1)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  // Insert email_events row
  const { error: insertErr } = await supabase.from('email_events').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    email_address: toAddress,
    event_type: internalEventType,
    resend_email_id: resendEmailId || null,
    bounce_type: bounceType,
    bounce_subtype: bounceSubtype,
    raw_payload: req.body,
  })
  if (insertErr) {
    console.error('[email-webhook] insert failed:', insertErr.message)
    res.sendStatus(500)
    return
  }

  // Update contact risk score (fire-and-forget style, errors logged not thrown)
  if (contactId) {
    updateEmailRiskScore(contactId, tenantId, internalEventType).catch((err) =>
      console.error('[email-webhook] risk score update failed:', err)
    )
  }

  res.sendStatus(200)
})

export default router
