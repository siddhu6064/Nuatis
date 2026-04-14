import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/locations
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('locations')
    .select(
      'id, name, address, city, state, zip, phone, telnyx_number, maya_enabled, is_primary, google_calendar_id, google_refresh_token, created_at'
    )
    .eq('tenant_id', authed.tenantId)
    .order('is_primary', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const locations = (data ?? []).map((l) => ({
    ...l,
    calendar_connected: !!l.google_refresh_token,
    google_refresh_token: undefined,
  }))

  res.json({ locations })
})

// POST /api/locations
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const { data, error } = await supabase
    .from('locations')
    .insert({
      tenant_id: authed.tenantId,
      name,
      address: (b['address'] as string) || null,
      city: (b['city'] as string) || null,
      state: (b['state'] as string) || null,
      zip: (b['zip'] as string) || null,
      phone: (b['phone'] as string) || null,
      telnyx_number: (b['telnyx_number'] as string) || null,
      maya_enabled: typeof b['maya_enabled'] === 'boolean' ? b['maya_enabled'] : true,
      is_primary: false,
    })
    .select('id, name, address, is_primary, maya_enabled, created_at')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// PUT /api/locations/:id
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (b['address'] !== undefined) updates['address'] = b['address'] || null
  if (b['city'] !== undefined) updates['city'] = b['city'] || null
  if (b['state'] !== undefined) updates['state'] = b['state'] || null
  if (b['zip'] !== undefined) updates['zip'] = b['zip'] || null
  if (b['phone'] !== undefined) updates['phone'] = b['phone'] || null
  if (typeof b['maya_enabled'] === 'boolean') updates['maya_enabled'] = b['maya_enabled']
  if (typeof b['escalation_phone'] === 'string') updates['escalation_phone'] = b['escalation_phone']

  const { data, error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

// PUT /api/locations/:id/set-primary
router.put('/:id/set-primary', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Unset all primary flags
  await supabase.from('locations').update({ is_primary: false }).eq('tenant_id', authed.tenantId)

  // Set new primary
  const { error } = await supabase
    .from('locations')
    .update({ is_primary: true })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ primary: true })
})

// DELETE /api/locations/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Check not primary
  const { data: loc } = await supabase
    .from('locations')
    .select('is_primary')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (loc?.is_primary) {
    res.status(400).json({ error: 'Cannot delete the primary location' })
    return
  }

  const { error } = await supabase
    .from('locations')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

export default router
