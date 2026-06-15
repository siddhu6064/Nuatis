import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthUrl, exchangeCodeForTokens } from '../services/google.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import redis from '../lib/redis.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/auth/google — redirect business owner to Google consent screen
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  // CSRF/tenant-injection guard: issue a single-use nonce bound to the
  // authenticated tenant and pass it as `state`. The callback resolves the
  // tenant from Redis, never from the attacker-controllable `state` value.
  const nonce = randomBytes(32).toString('hex')
  await redis.set(`oauth:google:${nonce}`, authed.tenantId, 'EX', 600)
  const url = getAuthUrl(nonce)
  res.redirect(url)
})

// GET /api/auth/google/callback — Google redirects here after consent
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query as { code?: string; state?: string }

  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state' })
    return
  }

  // Resolve the tenant from the single-use nonce — never trust `state` directly.
  const nonceKey = `oauth:google:${state}`
  const tenantId = await redis.get(nonceKey)
  if (!tenantId) {
    res.status(400).json({ error: 'Invalid or expired OAuth state' })
    return
  }
  await redis.del(nonceKey)

  try {
    const tokens = await exchangeCodeForTokens(code)

    if (!tokens.refresh_token) {
      res.status(400).json({ error: 'No refresh token returned — ensure prompt=consent was set' })
      return
    }

    const supabase = getSupabase()

    // Store refresh token on the primary location for this tenant
    // If no location exists yet, store directly on tenant record
    const { error } = await supabase.from('locations').upsert(
      {
        tenant_id: tenantId,
        name: 'Primary',
        google_refresh_token: tokens.refresh_token,
        google_calendar_id: 'primary',
        is_primary: true,
      },
      { onConflict: 'tenant_id' }
    )

    if (error) {
      console.error('Failed to store refresh token:', error.message)
      res.status(500).json({ error: 'Failed to save Google Calendar connection' })
      return
    }

    // Redirect back to dashboard with success
    const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
    const returnTo = (req.query['return_to'] as string) || '/settings'
    res.redirect(`${webUrl}${returnTo}?google=connected`)
  } catch (err) {
    console.error('Google OAuth error:', err)
    res.status(500).json({ error: 'Google OAuth failed' })
  }
})

export default router
