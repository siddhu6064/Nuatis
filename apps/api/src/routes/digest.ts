import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { buildDigestData } from '../lib/digest-builder.js'
import { renderWeeklyDigest } from '../lib/email-templates/weekly-digest.js'
import { sendEmail } from '../lib/email-client.js'
import { createHmac, timingSafeEqual } from 'crypto'

const router = Router()

// ── Supabase factory ──────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
  )
}

// ── HMAC token helpers ────────────────────────────────────────────────────────

export function signDigestToken(tenantId: string): string {
  const secret = process.env['AUTH_SECRET'] ?? ''
  return createHmac('sha256', secret).update(tenantId).digest('hex')
}

export function verifyDigestToken(tenantId: string, token: string): boolean {
  const expected = signDigestToken(tenantId)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.byteLength !== b.byteLength) return false
  return timingSafeEqual(a, b)
}

// ── GET /api/digest/unsubscribe?token=&tenantId= — PUBLIC ─────────────────────

router.get('/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  const { token, tenantId } = req.query as Record<string, string | undefined>

  if (!token || !tenantId) {
    res.status(400)
      .send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>Invalid Link</h2>
<p>Missing required parameters.</p>
</body></html>`)
    return
  }

  if (!verifyDigestToken(tenantId, token)) {
    res.status(400)
      .send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>Invalid Link</h2>
<p>This unsubscribe link is invalid or has expired.</p>
</body></html>`)
    return
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('tenants')
    .update({ digest_enabled: false })
    .eq('id', tenantId)

  if (error) {
    console.error('[digest] unsubscribe DB error:', error.message)
    res.status(500)
      .send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>Error</h2>
<p>Something went wrong. Please try again.</p>
</body></html>`)
    return
  }

  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
  res.status(200)
    .send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>Unsubscribed</h2>
<p>You've been unsubscribed from weekly digests.</p>
<p><a href="${webUrl}/settings/notifications">Manage preferences</a></p>
</body></html>`)
})

// ── PUT /api/digest/preferences — authenticated ───────────────────────────────

router.put('/preferences', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authedReq = req as AuthenticatedRequest
  const { digest_enabled } = req.body as { digest_enabled?: unknown }

  if (typeof digest_enabled !== 'boolean') {
    res.status(400).json({ error: 'digest_enabled must be a boolean' })
    return
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('tenants')
    .update({ digest_enabled })
    .eq('id', authedReq.tenantId)

  if (error) {
    console.error('[digest] preferences update error:', error.message)
    res.status(500).json({ error: 'Failed to update preferences' })
    return
  }

  res.status(200).json({ success: true })
})

// ── POST /api/digest/send-test — authenticated ────────────────────────────────

router.post('/send-test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authedReq = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Get owner email
  const { data: ownerRow } = await supabase
    .from('users')
    .select('email')
    .eq('tenant_id', authedReq.tenantId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (!ownerRow?.email) {
    res.status(404).json({ error: 'No owner found for this tenant' })
    return
  }

  const ownerEmail: string = ownerRow.email as string

  let data
  try {
    data = await buildDigestData(authedReq.tenantId)
  } catch (err) {
    console.error('[digest] send-test buildDigestData error:', err)
    res.status(500).json({ error: 'Failed to build digest data' })
    return
  }

  const unsubToken = signDigestToken(authedReq.tenantId)
  const { subject, html } = renderWeeklyDigest(data, unsubToken)

  const sent = await sendEmail({
    to: ownerEmail,
    subject,
    html,
    tenantId: authedReq.tenantId,
  })

  if (!sent) {
    res.status(500).json({ error: 'Failed to send test email' })
    return
  }

  res.status(200).json({ sent_to: ownerEmail })
})

export default router
