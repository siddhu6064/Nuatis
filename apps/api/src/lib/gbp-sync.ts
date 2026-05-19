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

    const { data: existing } = await supabase
      .from('reviews')
      .select('id, ai_suggested_reply')
      .eq('tenant_id', tenantId)
      .eq('google_review_id', raw.reviewId)
      .maybeSingle()

    await supabase
      .from('reviews')
      .upsert(upsertPayload, { onConflict: 'tenant_id,google_review_id' })

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
