import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import {
  getFieldDefinitions,
  saveFieldDefinitions,
  CUSTOM_FIELD_TYPES,
  RESERVED_KEYS,
  MAX_CUSTOM_FIELDS,
  KEY_PATTERN,
  type CustomFieldDef,
  type CustomFieldType,
} from '../lib/custom-fields.js'

const router = Router()

function parseFieldInput(
  b: Record<string, unknown>
): { field: Omit<CustomFieldDef, 'key'>; error: null } | { field: null; error: string } {
  const label = typeof b['label'] === 'string' ? b['label'].trim() : ''
  if (!label) return { field: null, error: 'label is required' }

  const type = b['type']
  if (typeof type !== 'string' || !CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) {
    return { field: null, error: `type must be one of: ${CUSTOM_FIELD_TYPES.join(', ')}` }
  }

  const required = typeof b['required'] === 'boolean' ? b['required'] : false

  let options: string[] | undefined
  if (type === 'select') {
    if (!Array.isArray(b['options']) || b['options'].length === 0) {
      return { field: null, error: 'select fields require a non-empty options array' }
    }
    options = (b['options'] as unknown[]).filter((o): o is string => typeof o === 'string')
    if (options.length === 0) {
      return { field: null, error: 'select fields require a non-empty options array' }
    }
  }

  return { field: { label, type: type as CustomFieldType, required, options }, error: null }
}

// ── GET /api/settings/custom-fields ──────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { vertical, fields } = await getFieldDefinitions(supabase, authed.tenantId)
  res.json({ vertical, fields })
})

// ── POST /api/settings/custom-fields ─────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const key = typeof b['key'] === 'string' ? b['key'].trim() : ''
  if (!key || !KEY_PATTERN.test(key)) {
    res.status(400).json({
      error:
        'key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores',
    })
    return
  }
  if (RESERVED_KEYS.includes(key)) {
    res.status(400).json({ error: `"${key}" is a reserved key and cannot be used` })
    return
  }

  const parsed = parseFieldInput(b)
  if (parsed.field === null) {
    res.status(400).json({ error: parsed.error })
    return
  }

  const { vertical, fields } = await getFieldDefinitions(supabase, authed.tenantId)
  if (!vertical) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }
  if (fields.some((f) => f.key === key)) {
    res.status(409).json({ error: `A field with key "${key}" already exists` })
    return
  }
  if (fields.length >= MAX_CUSTOM_FIELDS) {
    res.status(400).json({ error: `Cannot exceed ${MAX_CUSTOM_FIELDS} custom fields` })
    return
  }

  const next = [...fields, { key, ...parsed.field }]
  await saveFieldDefinitions(supabase, authed.tenantId, vertical, next)

  res.status(201).json({ key, ...parsed.field })
})

// ── PUT /api/settings/custom-fields/reorder ──────────────────────────────────
// NOTE: must be registered before /:key so "reorder" isn't read as a key.
router.put('/reorder', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const keys = Array.isArray(b['keys'])
    ? ((b['keys'] as unknown[]).filter((k) => typeof k === 'string') as string[])
    : []
  if (keys.length === 0) {
    res.status(400).json({ error: 'keys array is required' })
    return
  }

  const { vertical, fields } = await getFieldDefinitions(supabase, authed.tenantId)
  if (!vertical) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }
  if (keys.length !== fields.length || !keys.every((k) => fields.some((f) => f.key === k))) {
    res.status(400).json({ error: 'keys must be a full permutation of the existing field keys' })
    return
  }

  const byKey = new Map(fields.map((f) => [f.key, f]))
  const next = keys.map((k) => byKey.get(k)!)
  await saveFieldDefinitions(supabase, authed.tenantId, vertical, next)

  res.json({ fields: next })
})

// ── PUT /api/settings/custom-fields/:key ─────────────────────────────────────
router.put('/:key', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { key } = req.params
  const b = req.body as Record<string, unknown>

  const { vertical, fields } = await getFieldDefinitions(supabase, authed.tenantId)
  if (!vertical) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }
  const existing = fields.find((f) => f.key === key)
  if (!existing) {
    res.status(404).json({ error: 'Field not found' })
    return
  }

  const parsed = parseFieldInput({ ...existing, ...b })
  if (parsed.field === null) {
    res.status(400).json({ error: parsed.error })
    return
  }

  const next = fields.map((f) => (f.key === key ? { key, ...parsed.field } : f))
  await saveFieldDefinitions(supabase, authed.tenantId, vertical, next)

  res.json({ key, ...parsed.field })
})

// ── DELETE /api/settings/custom-fields/:key ──────────────────────────────────
// Soft-hide only — removes the definition, leaves any existing
// contacts.vertical_data[key] value untouched (reversible: re-add the same
// key to see it again).
router.delete('/:key', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { key } = req.params

  const { vertical, fields } = await getFieldDefinitions(supabase, authed.tenantId)
  if (!vertical) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }
  if (!fields.some((f) => f.key === key)) {
    res.status(404).json({ error: 'Field not found' })
    return
  }

  const next = fields.filter((f) => f.key !== key)
  await saveFieldDefinitions(supabase, authed.tenantId, vertical, next)

  res.json({ success: true })
})

export default router
