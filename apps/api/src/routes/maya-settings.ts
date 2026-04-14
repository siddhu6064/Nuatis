import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS } from '@nuatis/shared'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/

interface LocationSettings {
  maya_enabled: boolean
  escalation_phone: string | null
  maya_greeting: string | null
  maya_personality: string
  preferred_languages: string[]
  appointment_duration_default: number
  telnyx_number: string | null
}

// ── GET /api/maya-settings ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data: location, error } = await supabase
      .from('locations')
      .select(
        'maya_enabled, escalation_phone, maya_greeting, maya_personality, preferred_languages, appointment_duration_default, telnyx_number'
      )
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .maybeSingle<LocationSettings>()

    if (error) {
      console.error(`[maya-settings] GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch Maya settings' })
      return
    }

    const vertical = authed.vertical || 'sales_crm'
    const verticalConfig = VERTICALS[vertical]
    const businessHours = verticalConfig?.business_hours ?? {
      mon_fri: '9am-5pm',
      sat: 'closed',
      sun: 'closed',
    }

    res.json({
      maya_enabled: location?.maya_enabled ?? true,
      escalation_phone: location?.escalation_phone ?? null,
      maya_greeting: location?.maya_greeting ?? null,
      maya_personality: location?.maya_personality ?? 'professional',
      preferred_languages: location?.preferred_languages ?? ['en'],
      appointment_duration_default: location?.appointment_duration_default ?? 60,
      telnyx_number: location?.telnyx_number ?? null,
      vertical,
      business_hours: businessHours,
    })
  } catch (err) {
    console.error('[maya-settings] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PUT /api/maya-settings ────────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as Record<string, unknown>

  // Build update object from allowed fields
  const updates: Record<string, unknown> = {}

  if (typeof body['maya_enabled'] === 'boolean') {
    updates['maya_enabled'] = body['maya_enabled']
  }

  if (body['escalation_phone'] !== undefined) {
    const phone = body['escalation_phone']
    if (phone === null || phone === '') {
      updates['escalation_phone'] = null
    } else if (typeof phone === 'string' && E164_REGEX.test(phone)) {
      updates['escalation_phone'] = phone
    } else {
      res
        .status(400)
        .json({ error: 'escalation_phone must be in E.164 format (e.g. +15125551234)' })
      return
    }
  }

  if (body['maya_greeting'] !== undefined) {
    const greeting = body['maya_greeting']
    updates['maya_greeting'] =
      typeof greeting === 'string' && greeting.trim() ? greeting.trim() : null
  }

  if (typeof body['maya_personality'] === 'string') {
    const valid = ['professional', 'friendly', 'casual']
    if (valid.includes(body['maya_personality'])) {
      updates['maya_personality'] = body['maya_personality']
    } else {
      res.status(400).json({ error: `maya_personality must be one of: ${valid.join(', ')}` })
      return
    }
  }

  if (Array.isArray(body['preferred_languages'])) {
    const validLangs = ['en', 'es', 'hi', 'te']
    const langs = (body['preferred_languages'] as string[]).filter((l) => validLangs.includes(l))
    if (langs.length === 0) {
      res.status(400).json({ error: 'At least one language must be selected' })
      return
    }
    updates['preferred_languages'] = langs
  }

  if (typeof body['appointment_duration_default'] === 'number') {
    const dur = body['appointment_duration_default']
    if ([15, 30, 45, 60, 90].includes(dur)) {
      updates['appointment_duration_default'] = dur
    } else {
      res.status(400).json({ error: 'appointment_duration_default must be 15, 30, 45, 60, or 90' })
      return
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  try {
    const { error } = await supabase
      .from('locations')
      .update(updates)
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)

    if (error) {
      console.error(`[maya-settings] PUT error: ${error.message}`)
      res.status(500).json({ error: 'Failed to update Maya settings' })
      return
    }

    console.info(
      `[maya-settings] updated for tenant=${authed.tenantId}: ${JSON.stringify(updates)}`
    )

    // Return updated settings
    const { data: location } = await supabase
      .from('locations')
      .select(
        'maya_enabled, escalation_phone, maya_greeting, maya_personality, preferred_languages, appointment_duration_default, telnyx_number'
      )
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .maybeSingle<LocationSettings>()

    const vertical = authed.vertical || 'sales_crm'
    const verticalConfig = VERTICALS[vertical]
    const businessHours = verticalConfig?.business_hours ?? {
      mon_fri: '9am-5pm',
      sat: 'closed',
      sun: 'closed',
    }

    res.json({
      maya_enabled: location?.maya_enabled ?? true,
      escalation_phone: location?.escalation_phone ?? null,
      maya_greeting: location?.maya_greeting ?? null,
      maya_personality: location?.maya_personality ?? 'professional',
      preferred_languages: location?.preferred_languages ?? ['en'],
      appointment_duration_default: location?.appointment_duration_default ?? 60,
      telnyx_number: location?.telnyx_number ?? null,
      vertical,
      business_hours: businessHours,
    })
  } catch (err) {
    console.error('[maya-settings] PUT error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
