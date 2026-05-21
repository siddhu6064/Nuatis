import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const E164_RE = /^\+[1-9]\d{0,13}$/

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/telnyx-numbers — list all numbers for tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data } = await supabase
    .from('telnyx_numbers')
    .select(
      'id, phone_number, label, department, is_primary, maya_enabled, forwarding_number, status, created_at'
    )
    .eq('tenant_id', authed.tenantId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  res.json({ numbers: data ?? [] })
})

// POST /api/telnyx-numbers — add a number
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { phone_number, label, department, maya_enabled, forwarding_number } = req.body as {
    phone_number?: string
    label?: string
    department?: string
    maya_enabled?: boolean
    forwarding_number?: string
  }

  // Validate
  if (!phone_number?.trim() || !E164_RE.test(phone_number.trim())) {
    res.status(400).json({ error: 'phone_number must be in E.164 format (e.g. +15125551234)' })
    return
  }
  if (!label?.trim()) {
    res.status(400).json({ error: 'label is required' })
    return
  }
  if (label.trim().length > 50) {
    res.status(400).json({ error: 'label must be 50 characters or fewer' })
    return
  }
  const validDepartments = ['general', 'scheduling', 'billing', 'sales', 'support', 'maya']
  const dept = department ?? 'general'
  if (!validDepartments.includes(dept)) {
    res.status(400).json({ error: `department must be one of: ${validDepartments.join(', ')}` })
    return
  }

  const supabase = getSupabase()

  // Check if this tenant already has numbers (to auto-set primary)
  const { count } = await supabase
    .from('telnyx_numbers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
  const isPrimary = (count ?? 0) === 0

  const { data, error } = await supabase
    .from('telnyx_numbers')
    .insert({
      tenant_id: authed.tenantId,
      phone_number: phone_number.trim(),
      label: label.trim(),
      department: dept,
      maya_enabled: maya_enabled !== false,
      forwarding_number: forwarding_number?.trim() || null,
      is_primary: isPrimary,
    })
    .select(
      'id, phone_number, label, department, is_primary, maya_enabled, forwarding_number, status, created_at'
    )
    .single()

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'This phone number is already registered' })
      return
    }
    res.status(500).json({ error: 'Failed to add number' })
    return
  }

  res.status(201).json(data)
})

// PUT /api/telnyx-numbers/:id — update label/department/maya_enabled/forwarding/status
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify ownership
  const { data: existing } = await supabase
    .from('telnyx_numbers')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!existing) {
    res.status(404).json({ error: 'Number not found' })
    return
  }

  const { label, department, maya_enabled, forwarding_number, status } = req.body as {
    label?: string
    department?: string
    maya_enabled?: boolean
    forwarding_number?: string | null
    status?: string
  }

  const validDepartments = ['general', 'scheduling', 'billing', 'sales', 'support', 'maya']
  const validStatuses = ['active', 'inactive']

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (label !== undefined) {
    if (!label.trim()) {
      res.status(400).json({ error: 'label cannot be empty' })
      return
    }
    if (label.trim().length > 50) {
      res.status(400).json({ error: 'label max 50 chars' })
      return
    }
    updates['label'] = label.trim()
  }
  if (department !== undefined) {
    if (!validDepartments.includes(department)) {
      res.status(400).json({ error: `department must be one of: ${validDepartments.join(', ')}` })
      return
    }
    updates['department'] = department
  }
  if (maya_enabled !== undefined) updates['maya_enabled'] = maya_enabled
  if (forwarding_number !== undefined)
    updates['forwarding_number'] = forwarding_number?.trim() || null
  if (status !== undefined) {
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'status must be active or inactive' })
      return
    }
    updates['status'] = status
  }

  const { data, error } = await supabase
    .from('telnyx_numbers')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select(
      'id, phone_number, label, department, is_primary, maya_enabled, forwarding_number, status, created_at'
    )
    .single()

  if (error) {
    res.status(500).json({ error: 'Failed to update number' })
    return
  }

  res.json(data)
})

// POST /api/telnyx-numbers/:id/set-primary
router.post('/:id/set-primary', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify ownership + get phone_number
  const { data: target } = await supabase
    .from('telnyx_numbers')
    .select('id, phone_number')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!target) {
    res.status(404).json({ error: 'Number not found' })
    return
  }

  const targetRow = target as { id: string; phone_number: string }

  // Set new primary FIRST (prevents zero-primary window if clear succeeds but set fails)
  const { error: setError } = await supabase
    .from('telnyx_numbers')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (setError) {
    res.status(500).json({ error: 'Failed to set primary number' })
    return
  }

  // Now clear old primary (safe — new primary is already set)
  await supabase
    .from('telnyx_numbers')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', authed.tenantId)
    .eq('is_primary', true)
    .neq('id', req.params['id'])

  // Keep locations.telnyx_number in sync
  await supabase
    .from('locations')
    .update({ telnyx_number: targetRow.phone_number })
    .eq('tenant_id', authed.tenantId)
    .eq('is_primary', true)

  res.json({ ok: true, primary_number: targetRow.phone_number })
})

// DELETE /api/telnyx-numbers/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify ownership + check if primary
  const { data: existing } = await supabase
    .from('telnyx_numbers')
    .select('id, is_primary')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!existing) {
    res.status(404).json({ error: 'Number not found' })
    return
  }

  const row = existing as { id: string; is_primary: boolean }
  if (row.is_primary) {
    res.status(400).json({ error: 'Cannot delete primary number — set another as primary first' })
    return
  }

  await supabase
    .from('telnyx_numbers')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  res.json({ ok: true })
})

export default router
