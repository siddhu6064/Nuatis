import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import { API_BASE_URL } from '../config/urls.js'

const router = Router()

function getSupabase() {
  return createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
  )
}

// ── HMAC token helpers — same scheme as digest.ts's tenant-level unsubscribe,
// scoped to one contact instead of a whole tenant. ────────────────────────────

export function signContactUnsubscribeToken(contactId: string): string {
  const secret = process.env['AUTH_SECRET'] ?? ''
  return createHmac('sha256', secret).update(contactId).digest('hex')
}

export function verifyContactUnsubscribeToken(contactId: string, token: string): boolean {
  const expected = signContactUnsubscribeToken(contactId)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.byteLength !== b.byteLength) return false
  return timingSafeEqual(a, b)
}

/** Builds the URL a List-Unsubscribe header (or an in-body link) points at. */
export function buildUnsubscribeUrl(contactId: string): string {
  const token = signContactUnsubscribeToken(contactId)
  return `${API_BASE_URL}/api/email/unsubscribe?contactId=${contactId}&token=${token}`
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>${title}</h2>
<p>${body}</p>
</body></html>`
}

// ── GET /api/email/unsubscribe?contactId=&token= — PUBLIC ───────────────────
// One-click unsubscribe target for the List-Unsubscribe email header, and a
// plain link works the same way if a client doesn't support one-click.
router.get('/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  const { contactId, token } = req.query as Record<string, string | undefined>

  if (!contactId || !token) {
    res.status(400).send(htmlPage('Invalid Link', 'Missing required parameters.'))
    return
  }

  if (!verifyContactUnsubscribeToken(contactId, token)) {
    res.status(400).send(htmlPage('Invalid Link', 'This unsubscribe link is invalid or expired.'))
    return
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('contacts')
    .update({ email_status: 'unsubscribed' })
    .eq('id', contactId)

  if (error) {
    console.error('[email-unsubscribe] DB error:', error.message)
    res.status(500).send(htmlPage('Error', 'Something went wrong. Please try again.'))
    return
  }

  res
    .status(200)
    .send(
      htmlPage('Unsubscribed', "You won't receive marketing emails from this business anymore.")
    )
})

// One-click unsubscribe (RFC 8058 List-Unsubscribe-Post): mail clients POST
// here with no body when the recipient clicks the built-in "Unsubscribe"
// button — same verification, same effect, no confirmation page needed.
router.post('/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  const { contactId, token } = req.query as Record<string, string | undefined>
  if (!contactId || !token || !verifyContactUnsubscribeToken(contactId, token)) {
    res.status(400).end()
    return
  }

  const supabase = getSupabase()
  await supabase.from('contacts').update({ email_status: 'unsubscribed' }).eq('id', contactId)
  res.status(200).end()
})

export default router
