import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { resolveTemplate } from '../lib/email-templates.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/email-templates ────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const vertical = req.query['vertical'] as string | undefined

  let query = supabase
    .from('email_templates')
    .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (vertical) {
    query = query.eq('vertical', vertical)
  }

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

// ── GET /api/email-templates/:id ────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  res.json(data)
})

// ── GET /api/email-templates/:id/preview ────────────────────────────────────
router.get('/:id/preview', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const contactId = req.query['contactId'] as string | undefined

  if (!contactId) {
    res.status(400).json({ error: 'contactId query param is required' })
    return
  }

  const tenantId = authed.tenantId

  const [templateRes, contactRes, tenantRes] = await Promise.all([
    supabase
      .from('email_templates')
      .select('subject, body')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('contacts')
      .select('first_name, last_name, email, phone')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .single(),
    supabase.from('tenants').select('business_name, name, phone').eq('id', tenantId).single(),
  ])

  if (templateRes.error || !templateRes.data) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  if (contactRes.error || !contactRes.data) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  if (tenantRes.error || !tenantRes.data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const resolved = resolveTemplate(templateRes.data, contactRes.data, tenantRes.data)
  res.json(resolved)
})

// ── POST /api/email-templates ────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const { name, subject, body, vertical } = b as {
    name?: string
    subject?: string
    body?: string
    vertical?: string
  }

  if (!name || !subject || !body) {
    res.status(400).json({ error: 'name, subject, and body are required' })
    return
  }

  const insert: Record<string, unknown> = {
    tenant_id: authed.tenantId,
    name,
    subject,
    body,
  }
  if (vertical) insert['vertical'] = vertical

  const { data, error } = await supabase
    .from('email_templates')
    .insert(insert)
    .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create template' })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/email-templates/:id ─────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { name, subject, body, vertical } = b as {
    name?: string
    subject?: string
    body?: string
    vertical?: string
  }

  if (!name || !subject || !body) {
    res.status(400).json({ error: 'name, subject, and body are required' })
    return
  }

  // Verify template belongs to tenant
  const { data: existing, error: fetchError } = await supabase
    .from('email_templates')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (fetchError || !existing) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  const update: Record<string, unknown> = { name, subject, body }
  if (vertical !== undefined) update['vertical'] = vertical

  const { data, error } = await supabase
    .from('email_templates')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update template' })
    return
  }

  res.json(data)
})

// ── DELETE /api/email-templates/:id ──────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: existing, error: fetchError } = await supabase
    .from('email_templates')
    .select('id, is_default')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (fetchError || !existing) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  if (existing.is_default) {
    res.status(400).json({ error: 'Cannot delete default template' })
    return
  }

  const { error } = await supabase
    .from('email_templates')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(204).send()
})

export default router
