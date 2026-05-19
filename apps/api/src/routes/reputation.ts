import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { syncReviews, refreshTokenIfNeeded } from '../lib/gbp-sync.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/reputation/callback`
  )
}

// GET /api/reputation/ — generate GBP OAuth URL
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  try {
    const oauth2Client = getOAuth2Client()
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/business.manage'],
      prompt: 'consent',
      state: authed.tenantId,
    })
    res.json({ url })
  } catch (err) {
    console.error('[reputation] connect error:', err)
    res.status(500).json({ error: 'Failed to generate OAuth URL' })
  }
})

// GET /api/reputation/callback — OAuth exchange (no requireAuth — uses state param for tenantId)
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: tenantId } = req.query as { code?: string; state?: string }
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (!code || !tenantId) {
    res.redirect(`${webUrl}/settings/reputation?error=missing_params`)
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
      res.redirect(`${webUrl}/settings/reputation?error=oauth_failed`)
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
      res.redirect(`${webUrl}/settings/reputation?error=oauth_failed`)
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

    const supabase = getSupabase()
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
      res.redirect(`${webUrl}/settings/reputation?error=oauth_failed`)
      return
    }

    console.info(`[reputation] GBP connected for tenant=${tenantId}, location=${locationName}`)
    res.redirect(`${webUrl}/settings/reputation?connected=true`)
  } catch (err) {
    console.error('[reputation] callback error:', err)
    res.redirect(`${webUrl}/settings/reputation?error=oauth_failed`)
  }
})

// DELETE /api/reputation/disconnect
router.delete('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
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
  const supabase = getSupabase()
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
  const supabase = getSupabase()

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

// GET /api/reputation/stats
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

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
    const supabase = getSupabase()
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
    const supabase = getSupabase()
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

export default router
