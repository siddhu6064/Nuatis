import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { getAuthUrl, exchangeCodeForTokens } from '../services/google.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/auth/google — redirect business owner to Google consent screen
router.get('/', requireAuth, (req: Request, res: Response): void => {
  const authed = req as AuthenticatedRequest
  const url = getAuthUrl(authed.tenantId)
  res.redirect(url)
})

// GET /api/auth/google/callback — Google redirects here after consent
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: tenantId } = req.query as { code: string; state: string }

  if (!code || !tenantId) {
    res.status(400).json({ error: 'Missing code or state' })
    return
  }

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
