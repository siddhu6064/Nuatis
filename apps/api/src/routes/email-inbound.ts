import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Extract plain email address from a string like "Name <email@example.com>"
 * or return the string as-is if it's already a bare address.
 */
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return match ? match[1]!.trim().toLowerCase() : raw.trim().toLowerCase()
}

// ── Router 1: BCC settings (requires auth) ───────────────────────────────────

const router = Router()

// GET / — return current BCC address for the authenticated tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('tenants')
      .select('bcc_logging_address')
      .eq('id', authed.tenantId)
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ bccAddress: data?.bcc_logging_address ?? null })
  } catch (err) {
    console.error('[email-inbound] GET / error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /enable — generate and store a new BCC address for the tenant
router.post('/enable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const bccAddress = `log-${crypto.randomBytes(5).toString('hex')}@mail.nuatis.com`

    const { error } = await supabase
      .from('tenants')
      .update({ bcc_logging_address: bccAddress })
      .eq('id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ bccAddress })
  } catch (err) {
    console.error('[email-inbound] POST /enable error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

// ── Router 2: Inbound email webhook (PUBLIC — no auth) ───────────────────────

export const emailInboundWebhookRouter = Router()

// POST / — receive inbound email from mail provider (SendGrid / Mailgun / Postmark)
emailInboundWebhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Always return 200 to prevent mail provider retries
  try {
    const body = req.body as Record<string, unknown>

    let fromRaw: string
    let toAddresses: string[]
    let subject: string
    let html: string | undefined
    let text: string | undefined

    // ── Parse SendGrid format (has "envelope" field) ──────────────────────────
    if (body['envelope']) {
      const envelope =
        typeof body['envelope'] === 'string'
          ? (JSON.parse(body['envelope']) as Record<string, unknown>)
          : (body['envelope'] as Record<string, unknown>)

      fromRaw = String(envelope['from'] ?? body['from'] ?? '')

      const envelopeTo = envelope['to']
      if (Array.isArray(envelopeTo)) {
        toAddresses = envelopeTo.map((t) => String(t).trim().toLowerCase())
      } else {
        toAddresses = String(body['to'] ?? envelopeTo ?? '')
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      }

      subject = String(body['subject'] ?? '')
      html = body['html'] ? String(body['html']) : undefined
      text = body['text'] ? String(body['text']) : undefined
    } else {
      // ── Generic JSON format ───────────────────────────────────────────────
      fromRaw = String(body['from'] ?? '')

      const rawTo = body['to']
      if (Array.isArray(rawTo)) {
        toAddresses = rawTo.map((t) => String(t).trim().toLowerCase())
      } else {
        toAddresses = String(rawTo ?? '')
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      }

      subject = String(body['subject'] ?? '')
      html = body['html'] ? String(body['html']) : undefined
      text = body['text'] ? String(body['text']) : undefined
    }

    const fromEmail = extractEmail(fromRaw)
    // Normalise all to-addresses to bare emails
    const toEmails = toAddresses.map(extractEmail).filter(Boolean)

    if (!fromEmail || toEmails.length === 0) {
      res.sendStatus(200)
      return
    }

    const supabase = getSupabase()

    // ── Find tenant by matching any to[] address against bcc_logging_address ─
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id, bcc_logging_address')
      .in('bcc_logging_address', toEmails)

    if (tenantError || !tenants || tenants.length === 0) {
      // No matching tenant — silently accept
      res.sendStatus(200)
      return
    }

    const tenant = tenants[0] as { id: string; bcc_logging_address: string }
    const tenantId = tenant.id

    // ── Match sender to a contact ─────────────────────────────────────────────
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email')
      .eq('email', fromEmail)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    // ── Determine direction: outbound if from matches a user_email_accounts ──
    const { data: userAccount } = await supabase
      .from('user_email_accounts')
      .select('id')
      .eq('email_address', fromEmail)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const direction: 'outbound' | 'inbound' = userAccount ? 'outbound' : 'inbound'

    // ── Insert email_messages record ──────────────────────────────────────────
    const { data: message, error: insertError } = await supabase
      .from('email_messages')
      .insert({
        tenant_id: tenantId,
        contact_id: contact?.id ?? null,
        direction,
        from_address: fromEmail,
        to_address: toEmails.join(', '),
        subject: subject || null,
        body_html: html ?? null,
        body_text: text ?? null,
        source: 'bcc',
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[email-inbound webhook] insert error:', insertError)
      res.sendStatus(200)
      return
    }

    // ── Log activity if contact was found ─────────────────────────────────────
    if (contact?.id) {
      logActivity({
        tenantId,
        contactId: contact.id,
        type: 'email',
        body: `${direction === 'outbound' ? 'Sent' : 'Received'} email: ${subject || '(no subject)'}`,
        metadata: {
          email_message_id: message?.id,
          direction,
          from: fromEmail,
          source: 'bcc',
        },
        actorType: direction === 'outbound' ? 'user' : 'contact',
      })
    }
  } catch (err) {
    console.error('[email-inbound webhook] unhandled error:', err)
  }

  // Always 200
  res.sendStatus(200)
})
