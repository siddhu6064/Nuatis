import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import type { BusinessProfile } from '@nuatis/shared'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function resolveLocationId(tenantId: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data: primary } = await supabase
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle<{ id: string }>()

  if (primary?.id) return primary.id

  const { data: fallback } = await supabase
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  return fallback?.id ?? null
}

// ── GET /api/business-profile ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const locationId = await resolveLocationId(authed.tenantId)
    if (!locationId) {
      res.json({ business_profile: {} })
      return
    }

    const { data, error } = await supabase
      .from('locations')
      .select('business_profile')
      .eq('id', locationId)
      .single<{ business_profile: BusinessProfile | null }>()

    if (error) {
      console.error(`[business-profile] GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch business profile' })
      return
    }

    res.json({ business_profile: data?.business_profile ?? {} })
  } catch (err) {
    console.error('[business-profile] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PUT /api/business-profile ─────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as { business_profile?: unknown }

  if (!body.business_profile || typeof body.business_profile !== 'object') {
    res.status(400).json({ error: 'business_profile must be an object' })
    return
  }

  const profile = body.business_profile as BusinessProfile

  // Validate services array
  if (profile.services !== undefined) {
    if (!Array.isArray(profile.services)) {
      res.status(400).json({ error: 'services must be an array' })
      return
    }
    for (const s of profile.services) {
      if (typeof s.name !== 'string' || !s.name.trim()) {
        res.status(400).json({ error: 'Each service must have a non-empty name' })
        return
      }
    }
  }

  // Validate staff array
  if (profile.staff !== undefined) {
    if (!Array.isArray(profile.staff)) {
      res.status(400).json({ error: 'staff must be an array' })
      return
    }
  }

  // Validate faqs array (max 10)
  if (profile.faqs !== undefined) {
    if (!Array.isArray(profile.faqs)) {
      res.status(400).json({ error: 'faqs must be an array' })
      return
    }
    if (profile.faqs.length > 10) {
      res.status(400).json({ error: 'Maximum 10 FAQs allowed' })
      return
    }
  }

  // Truncate notes to 2000 chars
  if (typeof profile.notes === 'string') {
    profile.notes = profile.notes.slice(0, 2000)
  }

  try {
    const locationId = await resolveLocationId(authed.tenantId)
    if (!locationId) {
      res.status(404).json({ error: 'No location found for this tenant' })
      return
    }

    const { error } = await supabase
      .from('locations')
      .update({ business_profile: profile })
      .eq('id', locationId)

    if (error) {
      console.error(`[business-profile] PUT error: ${error.message}`)
      res.status(500).json({ error: 'Failed to update business profile' })
      return
    }

    console.info(`[business-profile] updated for tenant=${authed.tenantId}`)
    res.json({ business_profile: profile })
  } catch (err) {
    console.error('[business-profile] PUT error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/business-profile/catalog-services ───────────────────────────────
router.get('/catalog-services', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, unit_price, duration_minutes')
      .eq('tenant_id', authed.tenantId)
      .order('name', { ascending: true })

    if (error) {
      console.error(`[business-profile] catalog-services error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch catalog services' })
      return
    }

    res.json({ services: data ?? [] })
  } catch (err) {
    console.error('[business-profile] catalog-services error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
