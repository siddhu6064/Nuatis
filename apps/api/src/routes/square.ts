import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import redis from '../lib/redis.js'

const router = Router()

// ── Environment helpers ───────────────────────────────────────────────────────

const SQUARE_ENVIRONMENT = process.env['SQUARE_ENVIRONMENT'] ?? 'sandbox'
const SQUARE_APP_ID = process.env['SQUARE_APP_ID'] ?? ''
const SQUARE_APP_SECRET = process.env['SQUARE_APP_SECRET'] ?? ''

function squareBaseUrl(): string {
  return SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /connect — return Square OAuth URL ────────────────────────────────────
router.get('/connect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  const apiUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
  const redirectUri = `${apiUrl}/api/square/callback`

  // Single-use nonce bound to the authenticated tenant; callback resolves the
  // tenant from Redis rather than trusting `state`.
  const nonce = randomBytes(32).toString('hex')
  await redis.set(`oauth:square:${nonce}`, authed.tenantId, 'EX', 600)

  const params = new URLSearchParams({
    client_id: SQUARE_APP_ID,
    scope: 'PAYMENTS_WRITE+ORDERS_READ+MERCHANT_PROFILE_READ',
    state: nonce,
    redirect_uri: redirectUri,
  })

  const url = `${squareBaseUrl()}/oauth2/authorize?${params.toString()}`

  res.json({ url })
})

// ── GET /callback — Square OAuth callback (PUBLIC) ────────────────────────────
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oauthError } = req.query as Record<string, string>
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (oauthError) {
    res.redirect(`${webUrl}/settings/payments?square=error`)
    return
  }

  if (!code || !state) {
    res.redirect(`${webUrl}/settings/payments?square=error`)
    return
  }

  // Resolve the tenant from the single-use nonce — never trust `state` directly.
  const nonceKey = `oauth:square:${state}`
  const tenantId = await redis.get(nonceKey)
  if (!tenantId) {
    res.redirect(`${webUrl}/settings/payments?square=error`)
    return
  }
  await redis.del(nonceKey)

  try {
    const apiUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
    const redirectUri = `${apiUrl}/api/square/callback`

    // Exchange code for tokens
    const tokenRes = await fetch(`${squareBaseUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2024-01-18' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Square token exchange failed: ${tokenRes.status} ${text}`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_at: string
      merchant_id: string
    }

    const { access_token, refresh_token, expires_at, merchant_id } = tokens

    // Fetch merchant info
    const merchantRes = await fetch(`${squareBaseUrl()}/v2/merchants/${merchant_id}`, {
      headers: { Authorization: `Bearer ${access_token}`, 'Square-Version': '2024-01-18' },
    })

    if (!merchantRes.ok) {
      throw new Error(`Failed to fetch merchant info: ${merchantRes.status}`)
    }

    // Fetch first location
    const locationsRes = await fetch(`${squareBaseUrl()}/v2/locations`, {
      headers: { Authorization: `Bearer ${access_token}`, 'Square-Version': '2024-01-18' },
    })

    let locationId: string | null = null

    if (locationsRes.ok) {
      const locData = (await locationsRes.json()) as { locations?: Array<{ id: string }> }
      locationId = locData.locations?.[0]?.id ?? null
    }

    // Upsert square_connections
    const supabase = getSupabase()

    const { error: upsertError } = await supabase.from('square_connections').upsert(
      {
        tenant_id: tenantId,
        square_merchant_id: merchant_id,
        square_location_id: locationId,
        access_token,
        refresh_token,
        token_expires_at: expires_at,
      },
      { onConflict: 'tenant_id' }
    )

    if (upsertError) throw new Error(`DB upsert failed: ${upsertError.message}`)

    res.redirect(`${webUrl}/settings/payments?square=connected`)
  } catch (err) {
    console.error('[square] callback error:', err)
    res.redirect(`${webUrl}/settings/payments?square=error`)
  }
})

// ── DELETE /disconnect — remove Square connection ────────────────────────────
router.delete('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('square_connections')
    .delete()
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

// ── Exported helper: getSquareConnectionStatus ───────────────────────────────

export async function getSquareConnectionStatus(tenantId: string): Promise<{
  connected: boolean
  merchant_id?: string
  location_id?: string | null
}> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('square_connections')
    .select('square_merchant_id, square_location_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return { connected: false }
  }

  return {
    connected: true,
    merchant_id: data['square_merchant_id'] as string,
    location_id: (data['square_location_id'] as string | null) ?? null,
  }
}

// ── GET /status — check Square connection status ─────────────────────────────
router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  try {
    const result = await getSquareConnectionStatus(authed.tenantId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
