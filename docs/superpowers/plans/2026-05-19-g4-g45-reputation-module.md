# G4+G45 Reputation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Reputation Module with Google Business Profile (GBP) OAuth integration, review sync, AI-generated reply suggestions via Gemini, and a rich dashboard UI — all wired into the existing Nuatis monorepo patterns.

**Architecture:** A new `gbp_connections` table stores OAuth tokens + location metadata; a `reviews` table stores synced review data. An Express router at `/api/reputation` handles OAuth connect/callback, sync, CRUD on reviews, and stats. A pure-function library `gbp-sync.ts` handles token refresh, GBP API calls, and Gemini AI reply generation. The Next.js frontend adds a server component at `/reputation` that pre-fetches stats + initial reviews, rendered by a rich `ReputationClient.tsx` with recharts charts, tab-based review feed, and inline AI reply tooling.

**Tech Stack:** PostgreSQL/Supabase, Express + TypeScript, `googleapis` (already ^171.4.0), `@google/genai` (already ^1.48.0), Next.js 14 App Router, `recharts` (already ^3.8.1), Tailwind CSS, Jest (ESM)

---

## File Map

| Action | Path                                                           | Responsibility                                                    |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create | `supabase/migrations/0084_reputation.sql`                      | Tables: gbp_connections, reviews                                  |
| Modify | `packages/shared/src/types/index.ts`                           | Add GbpConnection, Review, ReputationStats                        |
| Create | `apps/api/src/lib/gbp-sync.test.ts`                            | 3 unit tests for pure functions (TDD: write first)                |
| Create | `apps/api/src/lib/gbp-sync.ts`                                 | starRatingToInt, buildAiReplyPrompt, syncReviews, generateAiReply |
| Create | `apps/api/src/routes/reputation.ts`                            | All reputation routes                                             |
| Modify | `apps/api/src/index.ts`                                        | Register /api/reputation after mayaKbRouter                       |
| Modify | `apps/api/.env.example`                                        | Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET                        |
| Modify | `apps/web/src/app/(dashboard)/Sidebar.tsx`                     | Add Reputation nav item to automation group                       |
| Create | `apps/web/src/app/(dashboard)/reputation/page.tsx`             | Server component                                                  |
| Create | `apps/web/src/app/(dashboard)/reputation/ReputationClient.tsx` | Full client UI                                                    |

---

## Task 1: Migration 0084_reputation.sql

**Files:**

- Create: `supabase/migrations/0084_reputation.sql`

- [ ] **Step 1.1: Create migration file**

Create `supabase/migrations/0084_reputation.sql` with the following content:

```sql
-- Migration 0084: Reputation Module (GBP + Reviews)

CREATE TABLE gbp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  google_account_id TEXT NOT NULL,
  google_location_name TEXT NOT NULL,  -- full resource path e.g. "accounts/123/locations/456"
  location_name TEXT NOT NULL,
  place_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  google_review_id TEXT NOT NULL,
  reviewer_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  published_at TIMESTAMPTZ,
  reply_text TEXT,
  reply_sent_at TIMESTAMPTZ,
  ai_suggested_reply TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','ignored')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, google_review_id)
);

CREATE INDEX ON reviews(tenant_id, published_at DESC);
CREATE INDEX ON reviews(tenant_id, status);
```

- [ ] **Step 1.2: Apply migration**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx supabase db push
```

Expected output: migration applied with `0084_reputation.sql` in the list.

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/0084_reputation.sql
git commit -m "feat(reputation): migration 0084 — gbp_connections + reviews tables"
```

---

## Task 2: Shared TypeScript Types

**Files:**

- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 2.1: Append reputation types to shared index**

Open `packages/shared/src/types/index.ts`. Append the following block at the very end of the file (after the last existing export):

```typescript
// ── Reputation / Google Business Profile ─────────────────────

export interface GbpConnection {
  id: string
  tenantId: string
  locationId: string | null
  googleAccountId: string
  googleLocationName: string
  locationName: string
  placeId: string | null
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  connectedAt: string
}

export type ReviewStatus = 'new' | 'replied' | 'ignored'

export interface Review {
  id: string
  tenantId: string
  googleReviewId: string
  reviewerName: string | null
  rating: number
  comment: string | null
  publishedAt: string | null
  replyText: string | null
  replySentAt: string | null
  aiSuggestedReply: string | null
  status: ReviewStatus
  createdAt: string
}

export interface ReputationStats {
  averageRating: number
  totalReviews: number
  ratingBreakdown: Record<1 | 2 | 3 | 4 | 5, number>
  reviewsThisMonth: number
  reviewsLastMonth: number
  trendData: Array<{ month: string; avgRating: number; count: number }>
}
```

- [ ] **Step 2.2: Verify types compile**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc -p packages/shared/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat(reputation): add GbpConnection, Review, ReputationStats shared types"
```

---

## Task 3: gbp-sync.ts — TDD (tests first, then implementation)

**Files:**

- Create: `apps/api/src/lib/gbp-sync.test.ts`
- Create: `apps/api/src/lib/gbp-sync.ts`

### Step 3.1 — Write the failing test file first

- [ ] **Step 3.1: Create `apps/api/src/lib/gbp-sync.test.ts`**

```typescript
import { describe, it, expect } from '@jest/globals'
import { starRatingToInt, buildAiReplyPrompt } from './gbp-sync.js'

describe('starRatingToInt', () => {
  it('maps all GBP star rating strings to integers', () => {
    expect(starRatingToInt('ONE')).toBe(1)
    expect(starRatingToInt('TWO')).toBe(2)
    expect(starRatingToInt('THREE')).toBe(3)
    expect(starRatingToInt('FOUR')).toBe(4)
    expect(starRatingToInt('FIVE')).toBe(5)
  })

  it('returns 0 for unrecognized rating strings', () => {
    expect(starRatingToInt('STAR_RATING_UNSPECIFIED')).toBe(0)
    expect(starRatingToInt('')).toBe(0)
  })
})

describe('buildAiReplyPrompt', () => {
  it('includes tenant name, vertical, rating, and comment in prompt', () => {
    const prompt = buildAiReplyPrompt('Acme Spa', 'beauty', 5, 'Loved the massage!')
    expect(prompt).toContain('Acme Spa')
    expect(prompt).toContain('beauty')
    expect(prompt).toContain('5/5')
    expect(prompt).toContain('Loved the massage!')
  })

  it('includes do-not-mention-name constraint', () => {
    const prompt = buildAiReplyPrompt('Shop', 'retail', 3, 'It was ok')
    expect(prompt).toContain("Do not mention the reviewer's name")
    expect(prompt).toContain('Do not use generic phrases')
  })
})
```

- [ ] **Step 3.2: Run tests to confirm they FAIL (no implementation yet)**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
NODE_OPTIONS=--experimental-vm-modules npx jest --config apps/api/jest.config.ts apps/api/src/lib/gbp-sync.test.ts 2>&1 | tail -20
```

Expected output: `Cannot find module './gbp-sync.js'` or similar import error. Tests must fail before we add implementation.

### Step 3.3 — Implement gbp-sync.ts

- [ ] **Step 3.3: Create `apps/api/src/lib/gbp-sync.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

// ── Supabase factory ──────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Raw GBP API shape ─────────────────────────────────────────

interface GbpReviewRaw {
  reviewId: string
  reviewer?: { displayName?: string }
  starRating: string
  comment?: string
  createTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

// ── Pure helpers (unit-testable, no I/O) ─────────────────────

export function starRatingToInt(rating: string): number {
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  }
  return map[rating] ?? 0
}

export function buildAiReplyPrompt(
  tenantName: string,
  vertical: string,
  rating: number,
  comment: string
): string {
  return `You are helping a small business owner respond to a Google review professionally and warmly.\nBusiness: ${tenantName}, Vertical: ${vertical}\nReview (rating: ${rating}/5): ${comment}\nWrite a concise, genuine reply (2-4 sentences). Do not mention the reviewer's name. Do not use generic phrases like "Thank you for your feedback."`
}

// ── OAuth helper ──────────────────────────────────────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/reputation/callback`
  )
}

export async function refreshTokenIfNeeded(conn: {
  id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
}): Promise<string> {
  const now = new Date()
  const expiresAt = new Date(conn.token_expires_at)
  // Return existing token if it expires more than 5 minutes from now
  if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) return conn.access_token

  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token })
  const { credentials } = await oauth2Client.refreshAccessToken()

  const supabase = getSupabase()
  await supabase
    .from('gbp_connections')
    .update({
      access_token: credentials.access_token,
      token_expires_at: new Date(credentials.expiry_date!).toISOString(),
    })
    .eq('id', conn.id)

  return credentials.access_token!
}

// ── syncReviews ───────────────────────────────────────────────

export async function syncReviews(tenantId: string): Promise<number> {
  const supabase = getSupabase()

  const { data: conn } = await supabase
    .from('gbp_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!conn) return 0

  const accessToken = await refreshTokenIfNeeded(conn)

  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${conn.google_location_name}/reviews`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) throw new Error(`GBP reviews fetch failed: ${res.status}`)

  const body = (await res.json()) as { reviews?: GbpReviewRaw[] }
  const rawReviews = body.reviews ?? []

  let synced = 0

  for (const raw of rawReviews) {
    const rating = starRatingToInt(raw.starRating)
    if (rating === 0) continue

    const upsertPayload = {
      tenant_id: tenantId,
      google_review_id: raw.reviewId,
      reviewer_name: raw.reviewer?.displayName ?? null,
      rating,
      comment: raw.comment ?? null,
      published_at: raw.createTime ?? null,
      reply_text: raw.reviewReply?.comment ?? null,
      reply_sent_at: raw.reviewReply?.updateTime ?? null,
      status: raw.reviewReply?.comment ? 'replied' : 'new',
    }

    // Check if this review already exists (to decide whether to generate AI reply)
    const { data: existing } = await supabase
      .from('reviews')
      .select('id, ai_suggested_reply')
      .eq('tenant_id', tenantId)
      .eq('google_review_id', raw.reviewId)
      .maybeSingle()

    await supabase
      .from('reviews')
      .upsert(upsertPayload, { onConflict: 'tenant_id,google_review_id' })

    // Generate AI reply only for newly-synced reviews without an existing reply
    if (!existing && !raw.reviewReply && raw.comment) {
      const { data: inserted } = await supabase
        .from('reviews')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('google_review_id', raw.reviewId)
        .maybeSingle()

      if (inserted) {
        generateAiReply(tenantId, inserted.id, rating, raw.comment).catch((err: unknown) =>
          console.error('[gbp-sync] generateAiReply error:', err)
        )
      }
    }

    synced++
  }

  return synced
}

// ── generateAiReply ───────────────────────────────────────────

export async function generateAiReply(
  tenantId: string,
  reviewId: string,
  rating: number,
  comment: string
): Promise<void> {
  const supabase = getSupabase()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, vertical')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) return

  const { GoogleGenAI } = await import('@google/genai')
  const genai = new GoogleGenAI({ apiKey })

  const prompt = buildAiReplyPrompt(tenant.name, tenant.vertical, rating, comment)

  const result = await genai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  })

  const reply = result.text ?? ''

  if (reply) {
    await supabase.from('reviews').update({ ai_suggested_reply: reply }).eq('id', reviewId)
  }
}
```

- [ ] **Step 3.4: Run tests to confirm they PASS**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
NODE_OPTIONS=--experimental-vm-modules npx jest --config apps/api/jest.config.ts apps/api/src/lib/gbp-sync.test.ts 2>&1 | tail -20
```

Expected output:

```
PASS apps/api/src/lib/gbp-sync.test.ts
  starRatingToInt
    ✓ maps all GBP star rating strings to integers
    ✓ returns 0 for unrecognized rating strings
  buildAiReplyPrompt
    ✓ includes tenant name, vertical, rating, and comment in prompt
    ✓ includes do-not-mention-name constraint

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/lib/gbp-sync.test.ts apps/api/src/lib/gbp-sync.ts
git commit -m "feat(reputation): gbp-sync lib — pure functions + OAuth + syncReviews + generateAiReply (TDD)"
```

---

## Task 4: reputation.ts routes + index.ts registration + .env.example update

**Files:**

- Create: `apps/api/src/routes/reputation.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/.env.example`

### Step 4.1 — Create reputation router

- [ ] **Step 4.1: Create `apps/api/src/routes/reputation.ts`**

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { syncReviews, refreshTokenIfNeeded } from '../lib/gbp-sync.js'

const router = Router()

// ── Supabase factory ──────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── OAuth2 client factory ─────────────────────────────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/reputation/callback`
  )
}

// ── GET /api/reputation/ — generate GBP OAuth URL ────────────

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

// ── GET /api/reputation/callback — OAuth exchange ────────────

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
    const accountsBody = (await accountsRes.json()) as {
      accounts?: Array<{ name: string }>
    }
    const accountName = accountsBody.accounts?.[0]?.name ?? ''

    // Fetch first location
    const locationsRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${accountName}/locations`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
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
    await supabase.from('gbp_connections').upsert(
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

    console.info(`[reputation] GBP connected for tenant=${tenantId}, location=${locationName}`)
    res.redirect(`${webUrl}/settings/reputation?connected=true`)
  } catch (err) {
    console.error('[reputation] callback error:', err)
    res.redirect(`${webUrl}/settings/reputation?error=oauth_failed`)
  }
})

// ── DELETE /api/reputation/disconnect ────────────────────────

router.delete('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    await supabase.from('gbp_connections').delete().eq('tenant_id', authed.tenantId)
    console.info(`[reputation] disconnected for tenant=${authed.tenantId}`)
    res.json({ disconnected: true })
  } catch (err) {
    console.error('[reputation] disconnect error:', err)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// ── GET /api/reputation/status ────────────────────────────────

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

// ── POST /api/reputation/sync ─────────────────────────────────

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

// ── GET /api/reputation/reviews ───────────────────────────────

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

// ── GET /api/reputation/stats ─────────────────────────────────

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

    // Trend: last 6 months
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

// ── POST /api/reputation/reviews/:id/reply ────────────────────

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

      // Attempt to post reply to GBP
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

// ── PUT /api/reputation/reviews/:id/ignore ────────────────────

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
```

### Step 4.2 — Register router in index.ts

- [ ] **Step 4.2: Modify `apps/api/src/index.ts`**

Add the import after the `mayaKbRouter` import (line 72 area):

Find this line:

```typescript
import mayaKbRouter from './routes/maya-kb.js'
```

Add immediately after:

```typescript
import reputationRouter from './routes/reputation.js'
```

Then find the registration line:

```typescript
app.use('/api/maya-kb', mayaKbRouter)
```

Add immediately after:

```typescript
app.use('/api/reputation', reputationRouter)
```

### Step 4.3 — Update .env.example

- [ ] **Step 4.3: Modify `apps/api/.env.example`**

Append the following two lines at the end of the file:

```
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
```

Note: `API_BASE_URL` and `WEB_URL` are typically already present in `.env.example`. If not, also add:

```
API_BASE_URL=http://localhost:3001
WEB_URL=http://localhost:3000
```

- [ ] **Step 4.4: TypeScript check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors related to reputation.ts or gbp-sync.ts.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/routes/reputation.ts apps/api/src/index.ts apps/api/.env.example
git commit -m "feat(reputation): Express router — connect/callback/status/sync/reviews/stats/reply/ignore"
```

---

## Task 5: Sidebar nav item + reputation/page.tsx server component

**Files:**

- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`
- Create: `apps/web/src/app/(dashboard)/reputation/page.tsx`

### Step 5.1 — Sidebar

- [ ] **Step 5.1: Modify `apps/web/src/app/(dashboard)/Sidebar.tsx`**

Find the `automation` group's items array (currently ends with):

```typescript
      { href: '/settings/automation', label: 'Review Auto', icon: '⭐', suiteOnly: true },
```

Add a new item immediately after it:

```typescript
      { href: '/reputation', label: 'Reputation', icon: '★', suiteOnly: true },
```

The full automation group items array becomes:

```typescript
    items: [
      {
        href: '/automation',
        label: 'Automation',
        icon: '⚡',
        suiteOnly: true,
        requireModule: 'automation',
      },
      {
        href: '/settings/follow-ups',
        label: 'Follow-ups',
        icon: '↻',
        suiteOnly: true,
        requireModule: 'automation',
      },
      {
        href: '/settings/email-templates',
        label: 'Email Templates',
        icon: '📧',
        suiteOnly: true,
      },
      { href: '/settings/automation', label: 'Review Auto', icon: '⭐', suiteOnly: true },
      { href: '/reputation', label: 'Reputation', icon: '★', suiteOnly: true },
    ],
```

### Step 5.2 — Server component

- [ ] **Step 5.2: Create directory and server component**

First create the directory:

```bash
mkdir -p /Users/sidyennamaneni/Documents/Nuatis/nuatis/apps/web/src/app/\(dashboard\)/reputation
```

Create `apps/web/src/app/(dashboard)/reputation/page.tsx`:

```typescript
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import ReputationClient from './ReputationClient'
import type { Review, ReputationStats } from '@nuatis/shared'

// ── DB row → Review camelCase mapper ─────────────────────────

function mapReview(row: Record<string, unknown>): Review {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    googleReviewId: row['google_review_id'] as string,
    reviewerName: (row['reviewer_name'] as string | null) ?? null,
    rating: row['rating'] as number,
    comment: (row['comment'] as string | null) ?? null,
    publishedAt: (row['published_at'] as string | null) ?? null,
    replyText: (row['reply_text'] as string | null) ?? null,
    replySentAt: (row['reply_sent_at'] as string | null) ?? null,
    aiSuggestedReply: (row['ai_suggested_reply'] as string | null) ?? null,
    status: row['status'] as Review['status'],
    createdAt: row['created_at'] as string,
  }
}

// ── Stats computation (mirrors API route) ────────────────────

function computeStats(
  allReviews: Array<{ rating: number; published_at: string | null }>,
): ReputationStats {
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const total = allReviews.length
  const avgRating =
    total
      ? Math.round((allReviews.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
      : 0

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>
  for (const r of allReviews) {
    breakdown[r.rating] = (breakdown[r.rating] ?? 0) + 1
  }

  const reviewsThisMonth = allReviews.filter(
    (r) => r.published_at && new Date(r.published_at) >= thisMonthStart,
  ).length

  const reviewsLastMonth = allReviews.filter(
    (r) =>
      r.published_at &&
      new Date(r.published_at) >= lastMonthStart &&
      new Date(r.published_at) < thisMonthStart,
  ).length

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const monthGroups = new Map<string, { sum: number; count: number; date: Date }>()

  for (const r of allReviews) {
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

  return {
    averageRating: avgRating,
    totalReviews: total,
    ratingBreakdown: breakdown as Record<1 | 2 | 3 | 4 | 5, number>,
    reviewsThisMonth,
    reviewsLastMonth,
    trendData,
  }
}

// ── Page ──────────────────────────────────────────────────────

export default async function ReputationPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  let connected = false
  let locationName: string | null = null
  let stats: ReputationStats | null = null
  let initialReviews: Review[] = []

  if (tenantId) {
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('location_name, place_id')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    connected = !!conn
    locationName = conn?.location_name ?? null

    if (connected) {
      // Fetch all reviews for stats computation
      const { data: allReviewRows } = await supabase
        .from('reviews')
        .select('rating, published_at')
        .eq('tenant_id', tenantId)

      if (allReviewRows && allReviewRows.length > 0) {
        stats = computeStats(allReviewRows)
      }

      // Fetch initial 'new' reviews for the review feed
      const { data: newReviewRows } = await supabase
        .from('reviews')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'new')
        .order('published_at', { ascending: false })
        .limit(20)

      initialReviews = (newReviewRows ?? []).map((row) =>
        mapReview(row as Record<string, unknown>),
      )
    }
  }

  return (
    <ReputationClient
      connected={connected}
      locationName={locationName}
      stats={stats}
      initialReviews={initialReviews}
    />
  )
}
```

- [ ] **Step 5.3: Verify web TypeScript check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc -p apps/web/tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: no new errors.

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/Sidebar.tsx apps/web/src/app/\(dashboard\)/reputation/page.tsx
git commit -m "feat(reputation): Sidebar nav item + reputation server component"
```

---

## Task 6: ReputationClient.tsx — full client component

**Files:**

- Create: `apps/web/src/app/(dashboard)/reputation/ReputationClient.tsx`

- [ ] **Step 6.1: Create `apps/web/src/app/(dashboard)/reputation/ReputationClient.tsx`**

```tsx
'use client'

import { useState } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Review, ReputationStats } from '@nuatis/shared'

// ── Types ─────────────────────────────────────────────────────

interface Props {
  connected: boolean
  locationName: string | null
  stats: ReputationStats | null
  initialReviews: Review[]
}

type Tab = 'new' | 'replied' | 'all'

// ── ConnectBanner ─────────────────────────────────────────────

function ConnectBanner() {
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    try {
      const res = await fetch('/api/reputation', { credentials: 'include' })
      const data = (await res.json()) as { url?: string }
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error('[reputation] connect error:', err)
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-8 flex flex-col items-center gap-4 mt-6">
      <div className="text-3xl">⭐</div>
      <h2 className="text-lg font-semibold text-ink">Connect Google Business Profile</h2>
      <p className="text-sm text-ink3 text-center max-w-md">
        See your reviews, track your rating, and reply with AI — all from Nuatis.
      </p>
      <button
        onClick={() => void handleConnect()}
        disabled={loading}
        className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Redirecting...' : 'Connect Google Business Profile'}
      </button>
    </div>
  )
}

// ── StatsHeader ───────────────────────────────────────────────

function StatsHeader({ stats }: { stats: ReputationStats }) {
  const trend =
    stats.reviewsLastMonth > 0
      ? Math.round(
          ((stats.reviewsThisMonth - stats.reviewsLastMonth) / stats.reviewsLastMonth) * 100
        )
      : null

  const statCards = [
    {
      label: 'Average Rating',
      value: stats.averageRating.toFixed(1),
      sub: `out of 5`,
    },
    {
      label: 'Total Reviews',
      value: stats.totalReviews.toString(),
      sub: 'all time',
    },
    {
      label: 'This Month',
      value: stats.reviewsThisMonth.toString(),
      sub: trend !== null ? `${trend >= 0 ? '+' : ''}${trend}% vs last month` : 'vs last month',
    },
    {
      label: 'Last Month',
      value: stats.reviewsLastMonth.toString(),
      sub: 'reviews',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-border-brand p-5 flex flex-col gap-1"
          >
            <p className="text-xs font-medium text-ink4 uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-bold text-ink">{card.value}</p>
            <p className="text-xs text-ink3">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Rating breakdown */}
      <div className="bg-white rounded-xl border border-border-brand p-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Rating Breakdown</h3>
        <div className="space-y-2">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = stats.ratingBreakdown[star] ?? 0
            const pct = stats.totalReviews > 0 ? (count / stats.totalReviews) * 100 : 0
            return (
              <div key={star} className="flex items-center gap-3">
                <span className="text-xs text-ink3 w-4 text-right">{star}★</span>
                <div className="flex-1 bg-bg rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 bg-teal-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-ink3 w-8 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Trend chart */}
      {stats.trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-border-brand p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">6-Month Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={stats.trendData}
              margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" domain={[1, 5]} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value: number, name: string) => [
                  name === 'avgRating' ? value.toFixed(1) : value,
                  name === 'avgRating' ? 'Avg Rating' : 'Reviews',
                ]}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="left"
                dataKey="count"
                name="Reviews"
                fill="#99f6e4"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgRating"
                name="Avg Rating"
                stroke="#0d9488"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── ReviewCard ────────────────────────────────────────────────

function ReviewCard({
  review,
  onReply,
  onIgnore,
}: {
  review: Review
  onReply: (id: string, text: string) => Promise<void>
  onIgnore: (id: string) => Promise<void>
}) {
  const [replyText, setReplyText] = useState(review.replyText ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [ignoring, setIgnoring] = useState(false)

  async function handleSend() {
    if (!replyText.trim()) return
    setSubmitting(true)
    await onReply(review.id, replyText)
    setSubmitting(false)
  }

  async function handleIgnore() {
    setIgnoring(true)
    await onIgnore(review.id)
    setIgnoring(false)
  }

  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{review.reviewerName ?? 'Anonymous'}</p>
          <p className="text-xs text-amber-500 tracking-wider">{stars}</p>
          {review.publishedAt && (
            <p className="text-xs text-ink4 mt-0.5">
              {new Date(review.publishedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
            review.status === 'new'
              ? 'bg-teal-50 text-teal-700'
              : review.status === 'replied'
                ? 'bg-green-50 text-green-700'
                : 'bg-gray-100 text-ink4'
          }`}
        >
          {review.status}
        </span>
      </div>

      {/* Review comment */}
      {review.comment && <p className="text-sm text-ink3 leading-relaxed">{review.comment}</p>}

      {/* Existing reply */}
      {review.replyText && (
        <div className="bg-bg rounded-lg p-3 text-sm text-ink3 border-l-2 border-teal-400">
          <p className="text-xs font-medium text-teal-700 mb-1">Your reply</p>
          {review.replyText}
        </div>
      )}

      {/* AI suggested reply (only on 'new' tab logic — shown when status === 'new') */}
      {review.status === 'new' && (
        <div className="space-y-2">
          {review.aiSuggestedReply ? (
            <div className="bg-teal-50 rounded-lg p-3 text-sm text-ink3">
              <p className="text-xs font-medium text-teal-700 mb-1">AI suggested reply</p>
              <p className="leading-relaxed">{review.aiSuggestedReply}</p>
              <button
                onClick={() => setReplyText(review.aiSuggestedReply!)}
                className="mt-2 text-xs font-medium text-teal-700 hover:text-teal-800 underline underline-offset-2"
              >
                Use this reply
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink4">
              <svg
                className="w-3.5 h-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.9-3M20 15a9 9 0 01-15.9 3"
                />
              </svg>
              Generating AI reply suggestion...
            </div>
          )}

          {/* Reply textarea */}
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply..."
            rows={3}
            className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400 text-ink placeholder:text-ink4"
          />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSend()}
              disabled={submitting || !replyText.trim()}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Sending...' : 'Send Reply'}
            </button>
            <button
              onClick={() => void handleIgnore()}
              disabled={ignoring}
              className="px-3 py-1.5 border border-border-brand text-ink3 rounded-lg text-xs font-medium hover:bg-bg transition-colors disabled:opacity-50"
              title="Ignore this review"
            >
              {ignoring ? '...' : '✕ Ignore'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ReviewFeed ────────────────────────────────────────────────

function ReviewFeed({ tenantId: _tenantId }: { tenantId?: string }) {
  const [tab, setTab] = useState<Tab>('new')
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  async function fetchReviews(status: Tab, p: number) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' })
      if (status !== 'all') params.set('status', status)
      const res = await fetch(`/api/reputation/reviews?${params.toString()}`, {
        credentials: 'include',
      })
      const data = (await res.json()) as {
        reviews?: Review[]
        total?: number
      }
      setReviews(data.reviews ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('[reputation] reviews fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch on tab or page change
  useState(() => {
    void fetchReviews(tab, page)
  })

  function handleTabChange(newTab: Tab) {
    setTab(newTab)
    setPage(1)
    void fetchReviews(newTab, 1)
  }

  async function handleReply(id: string, replyText: string) {
    try {
      await fetch(`/api/reputation/reviews/${id}/reply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply_text: replyText }),
      })
      // Refresh feed
      void fetchReviews(tab, page)
    } catch (err) {
      console.error('[reputation] reply error:', err)
    }
  }

  async function handleIgnore(id: string) {
    try {
      await fetch(`/api/reputation/reviews/${id}/ignore`, {
        method: 'PUT',
        credentials: 'include',
      })
      void fetchReviews(tab, page)
    } catch (err) {
      console.error('[reputation] ignore error:', err)
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'new', label: 'New' },
    { id: 'replied', label: 'Replied' },
    { id: 'all', label: 'All' },
  ]

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-bg rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-ink3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Review list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          Loading reviews...
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          No {tab === 'all' ? '' : tab} reviews found.
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              onReply={handleReply}
              onIgnore={handleIgnore}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between text-xs text-ink4 pt-2">
          <span>
            {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const prev = Math.max(1, page - 1)
                setPage(prev)
                void fetchReviews(tab, prev)
              }}
              disabled={page === 1}
              className="px-3 py-1 border border-border-brand rounded-lg disabled:opacity-40 hover:bg-bg transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => {
                const next = page + 1
                setPage(next)
                void fetchReviews(tab, next)
              }}
              disabled={page * 20 >= total}
              className="px-3 py-1 border border-border-brand rounded-lg disabled:opacity-40 hover:bg-bg transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main client component ─────────────────────────────────────

export default function ReputationClient({
  connected,
  locationName,
  stats,
  initialReviews,
}: Props) {
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<number | null>(null)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/reputation/sync', {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json()) as { synced?: number }
      setLastSynced(data.synced ?? 0)
    } catch (err) {
      console.error('[reputation] sync error:', err)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="px-6 py-6 max-w-4xl">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Reputation</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {connected && locationName
              ? `Connected to ${locationName}`
              : 'Manage your Google reviews and public rating'}
          </p>
        </div>

        {connected && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 border border-border-brand rounded-lg text-sm text-ink3 hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <svg
              className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.9-3M20 15a9 9 0 01-15.9 3"
              />
            </svg>
            {syncing ? 'Syncing...' : 'Sync Reviews'}
          </button>
        )}
      </div>

      {/* Sync result toast */}
      {lastSynced !== null && (
        <div className="mb-4 px-4 py-2 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700">
          Synced {lastSynced} review{lastSynced !== 1 ? 's' : ''} from Google Business Profile.
        </div>
      )}

      {!connected ? (
        <ConnectBanner />
      ) : (
        <div className="space-y-8">
          {stats && <StatsHeader stats={stats} />}
          <ReviewFeed />
        </div>
      )}
    </div>
  )
}
```

Note on the `ReviewFeed` component initialization: the `useState(() => { void fetchReviews(tab, page) })` call on mount is intentional to trigger the initial load. Alternatively, a `useEffect` with `[]` dependency array could be used — both patterns work. If a linter flags the `useState` usage for side-effects, replace with:

```tsx
// Replace the useState initialization with:
const [_init] = useState(() => {
  void fetchReviews('new', 1)
  return null
})
```

Or use `useEffect`:

```tsx
useEffect(() => {
  void fetchReviews(tab, page)
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 6.2: Full TypeScript check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc -p apps/web/tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head -30
```

Expected: no new errors related to reputation files.

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/reputation/ReputationClient.tsx
git commit -m "feat(reputation): ReputationClient — stats, trend chart, tab review feed, AI reply tooling"
```

---

## Task 7: Full TypeScript check + test suite

- [ ] **Step 7.1: Run the full test suite**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
NODE_OPTIONS=--experimental-vm-modules npx jest --config apps/api/jest.config.ts 2>&1 | tail -30
```

Expected: all tests pass including the new `gbp-sync.test.ts`. Coverage thresholds (35% lines/functions, 25% branches) must be met.

- [ ] **Step 7.2: Run gbp-sync tests in isolation to confirm**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
NODE_OPTIONS=--experimental-vm-modules npx jest --config apps/api/jest.config.ts apps/api/src/lib/gbp-sync.test.ts --verbose 2>&1
```

Expected:

```
PASS apps/api/src/lib/gbp-sync.test.ts
  starRatingToInt
    ✓ maps all GBP star rating strings to integers (Xms)
    ✓ returns 0 for unrecognized rating strings (Xms)
  buildAiReplyPrompt
    ✓ includes tenant name, vertical, rating, and comment in prompt (Xms)
    ✓ includes do-not-mention-name constraint (Xms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

- [ ] **Step 7.3: Full TypeScript check across monorepo**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc -p packages/shared/tsconfig.json --noEmit && \
npx tsc -p apps/api/tsconfig.json --noEmit && \
npx tsc -p apps/web/tsconfig.json --noEmit
echo "All TypeScript checks passed"
```

Expected: `All TypeScript checks passed` with no preceding error lines.

- [ ] **Step 7.4: Final commit**

```bash
git add -A
git status
git commit -m "feat(reputation): G4+G45 Reputation Module complete — GBP OAuth, review sync, AI replies, dashboard UI"
```

---

## Environment Variables Required

Add these to `apps/api/.env` (local) and Vercel env (production):

| Variable               | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth 2.0 Client ID (from Google Cloud Console)                           |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret                                                   |
| `API_BASE_URL`         | Public API base URL (e.g. `https://api.nuatis.com`) — used as OAuth redirect URI |
| `WEB_URL`              | Public web URL (e.g. `https://app.nuatis.com`) — used for post-OAuth redirect    |
| `GEMINI_API_KEY`       | Google Gemini API key (likely already set)                                       |

**Google Cloud Console setup steps:**

1. Go to APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web Application)
3. Add authorized redirect URI: `{API_BASE_URL}/api/reputation/callback`
4. Enable "My Business Business Information API" in API Library
5. Enable "My Business Reviews API" in API Library

---

## Notes & Edge Cases

- **Single-location assumption:** The OAuth callback fetches `accounts[0]` and `locations[0]`. Multi-location support can be added later by prompting the user to pick a location.
- **Token refresh window:** Tokens are refreshed if they expire within 5 minutes — this prevents mid-request expiry.
- **AI reply generation is fire-and-forget:** `generateAiReply` is called without `await` during sync, so sync latency stays low. The UI shows a "Generating..." spinner until the field populates on next refresh.
- **GBP reply POST is best-effort:** If the GBP PUT call fails (e.g. API rate limit), the reply is still saved in Supabase and the user gets a success response. The error is logged as a warning only.
- **`ReviewFeed` initial data:** The server component pre-fetches `status=new` reviews and passes them as `initialReviews`, but `ReputationClient` manages its own fetch state. The `initialReviews` prop is passed but the component re-fetches on mount for consistency. To use SSR data directly, initialize `reviews` state with `initialReviews`.
- **CORS for callback:** The `/api/reputation/callback` route is a browser redirect (not an API fetch), so CORS does not apply. The `requireAuth` middleware is intentionally omitted from the callback route because the OAuth state parameter (`tenantId`) carries the identity.
