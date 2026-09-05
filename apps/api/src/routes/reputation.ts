import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { google } from 'googleapis'
import crypto from 'crypto'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { syncReviews, refreshTokenIfNeeded, fetchGbpInsights } from '../lib/gbp-sync.js'
import redis from '../lib/redis.js'
import { searchYelpBusinesses } from '../lib/yelp-client.js'
import { syncYelpReviews } from '../lib/yelp-sync.js'
import {
  isFacebookConfigured,
  getFacebookAuthUrl,
  exchangeFacebookCode,
  getFacebookPages,
  saveFacebookConnection,
} from '../lib/facebook-oauth.js'
import { syncFacebookReviews } from '../lib/facebook-sync.js'

const router = Router()

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/reputation/callback`
  )
}

// GET /api/reputation/ — generate GBP OAuth URL with CSRF nonce
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  try {
    const nonce = crypto.randomBytes(32).toString('hex')
    await redis.set(`oauth_nonce:${nonce}`, authed.tenantId, 'EX', 600)
    const state = Buffer.from(JSON.stringify({ nonce, tenantId: authed.tenantId })).toString(
      'base64'
    )
    const oauth2Client = getOAuth2Client()
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/business.manage'],
      prompt: 'consent',
      state,
    })
    res.json({ url })
  } catch (err) {
    console.error('[reputation] connect error:', err)
    res.status(500).json({ error: 'Failed to generate OAuth URL' })
  }
})

// GET /api/reputation/callback — OAuth exchange (no requireAuth — uses state param for tenantId)
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: rawState } = req.query as { code?: string; state?: string }
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (!code || !rawState) {
    res.redirect(`${webUrl}/reputation?error=missing_params`)
    return
  }

  let tenantId: string
  try {
    const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString()) as {
      nonce?: string
      tenantId?: string
    }
    if (!parsed.nonce || !parsed.tenantId) throw new Error('Invalid state')
    const stored = await redis.get(`oauth_nonce:${parsed.nonce}`)
    if (!stored || stored !== parsed.tenantId) {
      res.redirect(`${webUrl}/reputation?error=invalid_state`)
      return
    }
    await redis.del(`oauth_nonce:${parsed.nonce}`)
    tenantId = parsed.tenantId
  } catch {
    res.redirect(`${webUrl}/reputation?error=invalid_state`)
    return
  }

  try {
    const oauth2Client = getOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)

    // Fetch GBP accounts
    const accountsRes = await fetch('https://mybusiness.googleapis.com/v4/accounts', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!accountsRes.ok) {
      console.error(`[reputation] GBP accounts fetch failed: ${accountsRes.status}`)
      res.redirect(`${webUrl}/reputation?error=oauth_failed`)
      return
    }
    const accountsBody = (await accountsRes.json()) as {
      accounts?: Array<{ name: string }>
    }
    const accountName = accountsBody.accounts?.[0]?.name ?? ''

    // Fetch first location
    const locationsRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${accountName}/locations`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    if (!locationsRes.ok) {
      console.error(`[reputation] GBP locations fetch failed: ${locationsRes.status}`)
      res.redirect(`${webUrl}/reputation?error=oauth_failed`)
      return
    }
    const locationsBody = (await locationsRes.json()) as {
      locations?: Array<{
        name: string
        locationName?: string
        title?: string
        metadata?: { placeId?: string }
      }>
    }
    const firstLocation = locationsBody.locations?.[0]
    const googleLocationName = firstLocation?.name ?? ''
    const locationName = firstLocation?.locationName ?? firstLocation?.title ?? 'My Business'
    const placeId = firstLocation?.metadata?.placeId ?? null

    const supabase = getServiceClient()
    const { error: upsertError } = await supabase.from('gbp_connections').upsert(
      {
        tenant_id: tenantId,
        google_account_id: accountName,
        google_location_name: googleLocationName,
        location_name: locationName,
        place_id: placeId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(tokens.expiry_date ?? Date.now() + 3_600_000).toISOString(),
      },
      { onConflict: 'tenant_id' }
    )

    if (upsertError) {
      console.error('[reputation] gbp_connections upsert error:', upsertError.message)
      res.redirect(`${webUrl}/reputation?error=oauth_failed`)
      return
    }

    console.info(`[reputation] GBP connected for tenant=${tenantId}, location=${locationName}`)
    res.redirect(`${webUrl}/reputation?connected=true`)
  } catch (err) {
    console.error('[reputation] callback error:', err)
    res.redirect(`${webUrl}/reputation?error=oauth_failed`)
  }
})

// DELETE /api/reputation/disconnect
router.delete('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  try {
    const { error: deleteError } = await supabase
      .from('gbp_connections')
      .delete()
      .eq('tenant_id', authed.tenantId)
    if (deleteError) {
      console.error(`[reputation] disconnect error: ${deleteError.message}`)
      res.status(500).json({ error: 'Failed to disconnect' })
      return
    }
    console.info(`[reputation] disconnected for tenant=${authed.tenantId}`)
    res.json({ disconnected: true })
  } catch (err) {
    console.error('[reputation] disconnect error:', err)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// GET /api/reputation/status
router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  try {
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('location_name, place_id')
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!conn) {
      res.json({ connected: false })
      return
    }

    res.json({
      connected: true,
      location_name: conn.location_name,
      place_id: conn.place_id ?? null,
    })
  } catch (err) {
    console.error('[reputation] status error:', err)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// POST /api/reputation/sync
router.post('/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  try {
    const synced = await syncReviews(authed.tenantId)
    console.info(`[reputation] synced ${synced} reviews for tenant=${authed.tenantId}`)
    res.json({ synced })
  } catch (err) {
    console.error('[reputation] sync error:', err)
    res.status(500).json({ error: 'Sync failed' })
  }
})

// GET /api/reputation/reviews
router.get('/reviews', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const status = (req.query['status'] as string | undefined) ?? undefined
  const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt((req.query['limit'] as string) ?? '20', 10)))
  const offset = (page - 1) * limit

  try {
    let query = supabase
      .from('reviews')
      .select('*', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && ['new', 'replied', 'ignored'].includes(status)) {
      query = query.eq('status', status)
    }

    const { data, count, error } = await query

    if (error) {
      console.error(`[reputation] reviews GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch reviews' })
      return
    }

    res.json({ reviews: data ?? [], total: count ?? 0, page, limit })
  } catch (err) {
    console.error('[reputation] reviews error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const MANUAL_REVIEW_SOURCES = ['yelp', 'facebook', 'manual', 'other']

// POST /api/reputation/reviews/manual — a review left somewhere other than
// Google (Yelp, Facebook, in person) entered by hand so it shows in the same
// feed/stats. Zero touches to the Google OAuth/sync machinery in gbp-sync.ts.
router.post('/reviews/manual', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const rating = typeof b['rating'] === 'number' ? b['rating'] : NaN
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'rating must be an integer between 1 and 5' })
    return
  }

  const source = typeof b['source'] === 'string' ? b['source'] : 'manual'
  if (!MANUAL_REVIEW_SOURCES.includes(source)) {
    res.status(400).json({ error: `source must be one of: ${MANUAL_REVIEW_SOURCES.join(', ')}` })
    return
  }

  const reviewerName =
    typeof b['reviewer_name'] === 'string' ? b['reviewer_name'].trim() || null : null
  const comment = typeof b['comment'] === 'string' ? b['comment'].trim() || null : null
  const publishedAt =
    typeof b['published_at'] === 'string' && !isNaN(Date.parse(b['published_at']))
      ? b['published_at']
      : new Date().toISOString()

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      tenant_id: authed.tenantId,
      google_review_id: `manual-${crypto.randomUUID()}`,
      source,
      reviewer_name: reviewerName,
      rating,
      comment,
      published_at: publishedAt,
      status: 'new',
    })
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to save review' })
    return
  }

  res.status(201).json(data)
})

// DELETE /api/reputation/reviews/:id — manual/non-Google entries only. A real
// synced Google review isn't deletable here since the next sync just brings
// it back; this is for removing a mis-entered manual one.
router.delete('/reviews/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { id } = req.params as { id: string }

  const { data, error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .neq('source', 'google')
    .select('id')
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Manual review not found' })
    return
  }

  res.json({ success: true })
})

// GET /api/reputation/stats
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  try {
    const { data: allReviews } = await supabase
      .from('reviews')
      .select('rating, published_at')
      .eq('tenant_id', authed.tenantId)

    const reviews = allReviews ?? []
    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const total = reviews.length
    const avgRating = total
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
      : 0

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>
    for (const r of reviews) {
      breakdown[r.rating] = (breakdown[r.rating] ?? 0) + 1
    }

    const thisMonth = reviews.filter(
      (r) => r.published_at && new Date(r.published_at) >= thisMonthStart
    ).length

    const lastMonth = reviews.filter(
      (r) =>
        r.published_at &&
        new Date(r.published_at) >= lastMonthStart &&
        new Date(r.published_at) < thisMonthStart
    ).length

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const monthGroups = new Map<string, { sum: number; count: number; date: Date }>()

    for (const r of reviews) {
      if (!r.published_at) continue
      const d = new Date(r.published_at)
      if (d < sixMonthsAgo) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const existing = monthGroups.get(key)
      if (existing) {
        existing.sum += r.rating
        existing.count++
      } else {
        monthGroups.set(key, { sum: r.rating, count: 1, date: d })
      }
    }

    const trendData = [...monthGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, g]) => ({
        month: g.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        avgRating: Math.round((g.sum / g.count) * 10) / 10,
        count: g.count,
      }))

    res.json({
      averageRating: avgRating,
      totalReviews: total,
      ratingBreakdown: breakdown,
      reviewsThisMonth: thisMonth,
      reviewsLastMonth: lastMonth,
      trendData,
    })
  } catch (err) {
    console.error('[reputation] stats error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/reputation/reviews/:id/reply
router.post(
  '/reviews/:id/reply',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { id } = req.params as { id: string }
    const body = req.body as { reply_text?: string }
    const replyText = body.reply_text?.trim() ?? ''

    if (!replyText) {
      res.status(400).json({ error: 'reply_text is required' })
      return
    }

    try {
      const { error } = await supabase
        .from('reviews')
        .update({
          reply_text: replyText,
          status: 'replied',
          reply_sent_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', authed.tenantId)

      if (error) {
        console.error(`[reputation] reply update error: ${error.message}`)
        res.status(500).json({ error: 'Failed to save reply' })
        return
      }

      // Attempt to post reply to GBP (best-effort)
      const { data: conn } = await supabase
        .from('gbp_connections')
        .select('*')
        .eq('tenant_id', authed.tenantId)
        .maybeSingle()

      if (conn) {
        try {
          const accessToken = await refreshTokenIfNeeded(conn)
          const { data: review } = await supabase
            .from('reviews')
            .select('google_review_id')
            .eq('id', id)
            .eq('tenant_id', authed.tenantId)
            .maybeSingle()

          if (review) {
            await fetch(
              `https://mybusiness.googleapis.com/v4/${conn.google_location_name}/reviews/${review.google_review_id}/reply`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ comment: replyText }),
              }
            )
          }
        } catch (err) {
          console.warn('[reputation] GBP reply post failed:', err)
        }
      }

      console.info(`[reputation] reply saved for review=${id}, tenant=${authed.tenantId}`)
      res.json({ success: true })
    } catch (err) {
      console.error('[reputation] reply error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// PUT /api/reputation/reviews/:id/ignore
router.put(
  '/reviews/:id/ignore',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { id } = req.params as { id: string }

    try {
      const { error } = await supabase
        .from('reviews')
        .update({ status: 'ignored' })
        .eq('id', id)
        .eq('tenant_id', authed.tenantId)

      if (error) {
        console.error(`[reputation] ignore update error: ${error.message}`)
        res.status(500).json({ error: 'Failed to ignore review' })
        return
      }

      console.info(`[reputation] review ignored: review=${id}, tenant=${authed.tenantId}`)
      res.json({ success: true })
    } catch (err) {
      console.error('[reputation] ignore error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ── GET /api/reputation/insights ─────────────────────────────────────────────
router.get('/insights', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const insights = await fetchGbpInsights(authed.tenantId)
  if (!insights) {
    res.json({ connected: false })
    return
  }
  res.json(insights)
})

// ── Yelp: read-only import, app-level key (no OAuth) ─────────────────────────

// GET /api/reputation/yelp/search?term=&location=
router.get('/yelp/search', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const term = typeof req.query['term'] === 'string' ? req.query['term'] : ''
  const location = typeof req.query['location'] === 'string' ? req.query['location'] : ''
  if (!term.trim() || !location.trim()) {
    res.status(400).json({ error: 'term and location are required' })
    return
  }
  try {
    const businesses = await searchYelpBusinesses(term.trim(), location.trim())
    res.json({ businesses })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Yelp search failed'
    if (message.includes('YELP_API_KEY')) {
      res.status(503).json({ error: 'Yelp is not configured' })
      return
    }
    console.error('[reputation] yelp search error:', err)
    res.status(500).json({ error: 'Yelp search failed' })
  }
})

// GET /api/reputation/yelp/status
router.get('/yelp/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('yelp_connections')
    .select('yelp_business_id, business_name, connected_at')
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  res.json({
    configured: Boolean(process.env['YELP_API_KEY']),
    connected: Boolean(data),
    businessName: data?.business_name ?? null,
  })
})

// POST /api/reputation/yelp/connect — body { businessId, businessName }
router.post('/yelp/connect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { businessId, businessName } = req.body as {
    businessId?: string
    businessName?: string
  }
  if (!businessId?.trim()) {
    res.status(400).json({ error: 'businessId is required' })
    return
  }
  const supabase = getServiceClient()
  const { error } = await supabase.from('yelp_connections').upsert(
    {
      tenant_id: authed.tenantId,
      yelp_business_id: businessId.trim(),
      business_name: businessName?.trim() || null,
    },
    { onConflict: 'tenant_id' }
  )
  if (error) {
    console.error('[reputation] yelp connect error:', error.message)
    res.status(500).json({ error: 'Failed to connect Yelp' })
    return
  }
  res.json({ connected: true })
})

// DELETE /api/reputation/yelp/disconnect
router.delete(
  '/yelp/disconnect',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    await supabase.from('yelp_connections').delete().eq('tenant_id', authed.tenantId)
    res.json({ disconnected: true })
  }
)

// POST /api/reputation/yelp/sync
router.post('/yelp/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  try {
    const result = await syncYelpReviews(authed.tenantId)
    res.json(result)
  } catch (err) {
    console.error('[reputation] yelp sync error:', err)
    res.status(500).json({ error: 'Yelp sync failed' })
  }
})

// ── Facebook: OAuth scaffold, built ready to activate ─────────────────────────
// Every route here 503s cleanly when META_APP_ID/META_APP_SECRET aren't set —
// which they never are in this environment — rather than half-working.

// GET /api/reputation/facebook/status
router.get('/facebook/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('facebook_connections')
    .select('page_name')
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  res.json({
    configured: isFacebookConfigured(),
    connected: Boolean(data),
    pageName: data?.page_name ?? null,
  })
})

// GET /api/reputation/facebook/auth-url
router.get(
  '/facebook/auth-url',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    if (!isFacebookConfigured()) {
      res.status(503).json({ error: 'Facebook is not configured' })
      return
    }
    const nonce = crypto.randomBytes(32).toString('hex')
    await redis.set(`oauth_nonce:fb:${nonce}`, authed.tenantId, 'EX', 600)
    const state = Buffer.from(JSON.stringify({ nonce, tenantId: authed.tenantId })).toString(
      'base64'
    )
    res.json({ url: getFacebookAuthUrl(state) })
  }
)

// GET /api/reputation/facebook/callback
router.get('/facebook/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: rawState } = req.query as { code?: string; state?: string }
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (!code || !rawState) {
    res.redirect(`${webUrl}/reputation?error=missing_params`)
    return
  }

  let tenantId: string
  try {
    const parsed = JSON.parse(Buffer.from(rawState, 'base64').toString()) as {
      nonce?: string
      tenantId?: string
    }
    if (!parsed.nonce || !parsed.tenantId) throw new Error('Invalid state')
    const stored = await redis.get(`oauth_nonce:fb:${parsed.nonce}`)
    if (!stored || stored !== parsed.tenantId) {
      res.redirect(`${webUrl}/reputation?error=invalid_state`)
      return
    }
    await redis.del(`oauth_nonce:fb:${parsed.nonce}`)
    tenantId = parsed.tenantId
  } catch {
    res.redirect(`${webUrl}/reputation?error=invalid_state`)
    return
  }

  try {
    const tokenRes = await exchangeFacebookCode(code)
    const pages = await getFacebookPages(tokenRes.access_token)
    const page = pages[0]
    if (!page) {
      res.redirect(`${webUrl}/reputation?error=no_pages`)
      return
    }
    await saveFacebookConnection(tenantId, page, tokenRes.expires_in)
    res.redirect(`${webUrl}/reputation?connected=facebook`)
  } catch (err) {
    console.error('[reputation] facebook callback error:', err)
    res.redirect(`${webUrl}/reputation?error=oauth_failed`)
  }
})

// DELETE /api/reputation/facebook/disconnect
router.delete(
  '/facebook/disconnect',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    await supabase.from('facebook_connections').delete().eq('tenant_id', authed.tenantId)
    res.json({ disconnected: true })
  }
)

// POST /api/reputation/facebook/sync
router.post('/facebook/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  if (!isFacebookConfigured()) {
    res.status(503).json({ error: 'Facebook is not configured' })
    return
  }
  try {
    const result = await syncFacebookReviews(authed.tenantId)
    res.json(result)
  } catch (err) {
    console.error('[reputation] facebook sync error:', err)
    res.status(500).json({ error: 'Facebook sync failed' })
  }
})

export default router
