import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const VALID_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'checkbox',
  'date',
  'number',
] as const
type FieldType = (typeof VALID_FIELD_TYPES)[number]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function validateFields(fields: unknown[]): { valid: boolean; error?: string } {
  for (const field of fields) {
    const f = field as Record<string, unknown>
    if (!f['id'] || typeof f['id'] !== 'string') {
      return { valid: false, error: 'Each field must have an id' }
    }
    if (!f['label'] || typeof f['label'] !== 'string') {
      return { valid: false, error: 'Each field must have a label' }
    }
    if (!f['type'] || !VALID_FIELD_TYPES.includes(f['type'] as FieldType)) {
      return {
        valid: false,
        error: `Field type must be one of: ${VALID_FIELD_TYPES.join(', ')}`,
      }
    }
    if (f['type'] === 'select') {
      if (!Array.isArray(f['options']) || (f['options'] as unknown[]).length === 0) {
        return { valid: false, error: 'Select fields must have an options array' }
      }
    }
  }
  return { valid: true }
}

// ── GET / — list forms for tenant ────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: forms, error } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Get submission counts per form
  const { data: submissionCounts, error: countError } = await supabase
    .from('intake_submissions')
    .select('form_id')
    .eq('tenant_id', authed.tenantId)

  if (countError) {
    res.status(500).json({ error: countError.message })
    return
  }

  const countMap: Record<string, number> = {}
  for (const row of submissionCounts ?? []) {
    const fid = (row as { form_id: string }).form_id
    countMap[fid] = (countMap[fid] ?? 0) + 1
  }

  const result = (forms ?? []).map((form) => {
    const fields = Array.isArray(form['fields']) ? (form['fields'] as unknown[]) : []
    return {
      ...form,
      fieldCount: fields.length,
      submissionCount: countMap[form['id'] as string] ?? 0,
    }
  })

  res.json({ data: result })
})

// ── GET /:id — single form with submission count ──────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { data: form, error } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !form) {
    res.status(404).json({ error: 'Form not found' })
    return
  }

  const { count, error: countError } = await supabase
    .from('intake_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('form_id', id)
    .eq('tenant_id', authed.tenantId)

  if (countError) {
    res.status(500).json({ error: countError.message })
    return
  }

  const fields = Array.isArray(form['fields']) ? (form['fields'] as unknown[]) : []

  res.json({
    data: {
      ...form,
      fieldCount: fields.length,
      submissionCount: count ?? 0,
    },
  })
})

// ── POST / — create form ──────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { name, description, fields, linkedServiceIds } = req.body as {
    name?: unknown
    description?: unknown
    fields?: unknown
    linkedServiceIds?: unknown
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'name is required' })
    return
  }

  if (!Array.isArray(fields)) {
    res.status(400).json({ error: 'fields must be an array' })
    return
  }

  const validation = validateFields(fields)
  if (!validation.valid) {
    res.status(400).json({ error: validation.error })
    return
  }

  const supabase = getSupabase()

  const { data: form, error } = await supabase
    .from('intake_forms')
    .insert({
      tenant_id: authed.tenantId,
      name: name.trim(),
      description: typeof description === 'string' ? description : null,
      fields,
      linked_service_ids: Array.isArray(linkedServiceIds) ? linkedServiceIds : [],
      is_active: true,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({ data: form })
})

// ── PUT /:id — update form ────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  // Verify form belongs to this tenant
  const { data: existing } = await supabase
    .from('intake_forms')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Form not found' })
    return
  }

  const { name, description, fields, linkedServiceIds, isActive } = req.body as {
    name?: unknown
    description?: unknown
    fields?: unknown
    linkedServiceIds?: unknown
    isActive?: unknown
  }

  if (fields !== undefined) {
    if (!Array.isArray(fields)) {
      res.status(400).json({ error: 'fields must be an array' })
      return
    }
    const validation = validateFields(fields)
    if (!validation.valid) {
      res.status(400).json({ error: validation.error })
      return
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name must be a non-empty string' })
      return
    }
    updates['name'] = name.trim()
  }
  if (description !== undefined) updates['description'] = description
  if (fields !== undefined) updates['fields'] = fields
  if (linkedServiceIds !== undefined) updates['linked_service_ids'] = linkedServiceIds
  if (isActive !== undefined) updates['is_active'] = Boolean(isActive)

  const { data: form, error } = await supabase
    .from('intake_forms')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: form })
})

// ── DELETE /:id — delete form ─────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  // Verify form belongs to this tenant
  const { data: existing } = await supabase
    .from('intake_forms')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Form not found' })
    return
  }

  // Block delete if submissions exist
  const { count, error: countError } = await supabase
    .from('intake_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('form_id', id)
    .eq('tenant_id', authed.tenantId)

  if (countError) {
    res.status(500).json({ error: countError.message })
    return
  }

  if ((count ?? 0) > 0) {
    res.status(400).json({
      error: 'Cannot delete a form that has submissions — deactivate instead',
    })
    return
  }

  const { error } = await supabase
    .from('intake_forms')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(204).send()
})

// ── GET /:id/submissions — list submissions ───────────────────
router.get('/:id/submissions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  // Verify form belongs to this tenant
  const { data: form } = await supabase
    .from('intake_forms')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!form) {
    res.status(404).json({ error: 'Form not found' })
    return
  }

  const { data: submissions, error } = await supabase
    .from('intake_submissions')
    .select('*')
    .eq('form_id', id)
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Collect unique contact IDs
  const contactIds = [
    ...new Set(
      (submissions ?? [])
        .map((s) => (s as Record<string, unknown>)['contact_id'] as string | null)
        .filter(Boolean) as string[]
    ),
  ]

  // Fetch contact names in bulk
  const contactNameMap: Record<string, string> = {}
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name')
      .in('id', contactIds)
      .eq('tenant_id', authed.tenantId)

    for (const c of contacts ?? []) {
      const contact = c as { id: string; full_name?: string }
      contactNameMap[contact.id] = contact.full_name ?? 'Unknown'
    }
  }

  const result = (submissions ?? []).map((s) => {
    const sub = s as Record<string, unknown>
    const contactId = sub['contact_id'] as string | null
    return {
      ...sub,
      contactName: contactId ? (contactNameMap[contactId] ?? 'Unknown') : null,
    }
  })

  res.json({ data: result })
})

export default router
