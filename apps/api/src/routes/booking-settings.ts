import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const WEB_URL = process.env['WEB_URL'] || 'http://localhost:3000'

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$|^[a-z0-9]{3}$/

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/booking-settings ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const [tenantResult, servicesResult] = await Promise.all([
    supabase
      .from('tenants')
      .select(
        'vertical, booking_page_enabled, booking_page_slug, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
      )
      .eq('id', authed.tenantId)
      .single(),
    supabase
      .from('services')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  const currentVertical = tenantResult.data?.vertical as string | null | undefined

  if (tenantResult.error || !tenantResult.data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  if (servicesResult.error) {
    res.status(500).json({ error: 'Failed to fetch services' })
    return
  }

  const t = tenantResult.data
  const allServices = servicesResult.data ?? []
  const availableServices = currentVertical
    ? allServices.filter(
        (s) => s.vertical === currentVertical || s.vertical === null || s.vertical === undefined
      )
    : allServices

  res.json({
    enabled: t.booking_page_enabled ?? false,
    slug: t.booking_page_slug ?? null,
    serviceIds: t.booking_services ?? [],
    bufferMinutes: t.booking_buffer_minutes ?? 15,
    advanceDays: t.booking_advance_days ?? 30,
    confirmationMessage:
      t.booking_confirmation_message ??
      'Your appointment has been booked! We look forward to seeing you.',
    googleReviewUrl: t.booking_google_review_url ?? null,
    accentColor: t.booking_accent_color ?? '#2563eb',
    availableServices,
  })
})

// ── PUT /api/booking-settings ─────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  // enabled
  if (typeof b['enabled'] === 'boolean') {
    updates['booking_page_enabled'] = b['enabled']
  }

  // slug — validate format + uniqueness
  if (b['slug'] !== undefined) {
    const slug = b['slug']
    if (typeof slug !== 'string' || slug.length < 3 || slug.length > 50 || !SLUG_REGEX.test(slug)) {
      res.status(400).json({
        error: 'slug must be 3-50 lowercase alphanumeric characters and hyphens',
      })
      return
    }

    // Check uniqueness — exclude current tenant
    const { data: existing } = await supabase
      .from('tenants')
      .select('id')
      .eq('booking_page_slug', slug)
      .neq('id', authed.tenantId)
      .maybeSingle()

    if (existing) {
      res.status(409).json({ error: 'This booking slug is already taken' })
      return
    }

    updates['booking_page_slug'] = slug
  }

  // serviceIds
  if (Array.isArray(b['serviceIds'])) {
    updates['booking_services'] = b['serviceIds']
  }

  // bufferMinutes — clamp to 5-60
  if (typeof b['bufferMinutes'] === 'number') {
    updates['booking_buffer_minutes'] = Math.min(60, Math.max(5, Math.round(b['bufferMinutes'])))
  }

  // advanceDays — clamp to 1-90
  if (typeof b['advanceDays'] === 'number') {
    updates['booking_advance_days'] = Math.min(90, Math.max(1, Math.round(b['advanceDays'])))
  }

  // confirmationMessage
  if (typeof b['confirmationMessage'] === 'string') {
    updates['booking_confirmation_message'] = b['confirmationMessage'].trim() || null
  }

  // googleReviewUrl
  if (b['googleReviewUrl'] !== undefined) {
    updates['booking_google_review_url'] =
      typeof b['googleReviewUrl'] === 'string' && b['googleReviewUrl'].trim()
        ? b['googleReviewUrl'].trim()
        : null
  }

  // accentColor
  if (typeof b['accentColor'] === 'string') {
    updates['booking_accent_color'] = b['accentColor'].trim() || null
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }

  const { error } = await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[booking-settings] updated for tenant=${authed.tenantId}`)

  // Return updated settings
  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'booking_page_enabled, booking_page_slug, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
    )
    .eq('id', authed.tenantId)
    .single()

  if (!tenant) {
    res.status(500).json({ error: 'Failed to fetch updated settings' })
    return
  }

  res.json({
    enabled: tenant.booking_page_enabled ?? false,
    slug: tenant.booking_page_slug ?? null,
    serviceIds: tenant.booking_services ?? [],
    bufferMinutes: tenant.booking_buffer_minutes ?? 15,
    advanceDays: tenant.booking_advance_days ?? 30,
    confirmationMessage:
      tenant.booking_confirmation_message ??
      'Your appointment has been booked! We look forward to seeing you.',
    googleReviewUrl: tenant.booking_google_review_url ?? null,
    accentColor: tenant.booking_accent_color ?? '#2563eb',
  })
})

// ── GET /api/booking-settings/preview-url ────────────────────────────────────
router.get('/preview-url', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('booking_page_slug')
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const slug = tenant.booking_page_slug as string | null
  if (!slug) {
    res.status(400).json({ error: 'Booking slug not configured' })
    return
  }

  res.json({ url: `${WEB_URL}/book/${slug}` })
})

export default router
