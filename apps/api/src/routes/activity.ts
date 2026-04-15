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

// ── GET /api/contacts/:contactId/activity ────────────────────────────────────
router.get(
  '/contacts/:contactId/activity',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : null

    // Verify contact belongs to tenant
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    let query = supabase
      .from('activity_log')
      .select('id, tenant_id, contact_id, type, body, metadata, actor_type, actor_id, created_at')
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // fetch one extra to determine hasMore

    if (before) {
      query = query.lt('created_at', before)
    }

    const { data: items, error } = await query

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const rows = items ?? []
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    // Resolve actor names for user actors
    const userIds = [
      ...new Set(
        page.filter((i) => i.actor_type === 'user' && i.actor_id).map((i) => i.actor_id as string)
      ),
    ]
    let userMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', userIds)
      if (users) {
        userMap = Object.fromEntries(users.map((u) => [u.id, u.full_name]))
      }
    }

    const enriched = page.map((item) => ({
      ...item,
      actor_name:
        item.actor_type === 'user' && item.actor_id
          ? (userMap[item.actor_id] ?? null)
          : item.actor_type === 'ai'
            ? 'Maya AI'
            : item.actor_type === 'contact'
              ? 'Client'
              : null,
    }))

    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.created_at : null

    res.json({ items: enriched, hasMore, nextCursor })
  }
)

// ── POST /api/contacts/:contactId/notes ──────────────────────────────────────
router.post(
  '/contacts/:contactId/notes',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

    // Verify contact belongs to tenant
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
    if (!body || body.length === 0) {
      res.status(400).json({ error: 'body is required' })
      return
    }
    if (body.length > 5000) {
      res.status(400).json({ error: 'body must be at most 5000 characters' })
      return
    }

    const pinned = req.body?.pinned === true

    const { data: note, error } = await supabase
      .from('activity_log')
      .insert({
        tenant_id: authed.tenantId,
        contact_id: contactId,
        type: 'note',
        body,
        metadata: { pinned },
        actor_type: 'user',
        actor_id: authed.userId,
      })
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.status(201).json(note)
  }
)

// ── PATCH /api/contacts/:contactId/notes/:activityId ─────────────────────────
router.patch(
  '/contacts/:contactId/notes/:activityId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId, activityId } = req.params

    // Verify note exists and belongs to tenant
    const { data: existing } = await supabase
      .from('activity_log')
      .select('id, actor_id, metadata')
      .eq('id', activityId)
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('type', 'note')
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Note not found' })
      return
    }

    // Verify ownership: must be the author or an owner
    if (existing.actor_id !== authed.userId && authed.role !== 'owner') {
      res.status(403).json({ error: 'Not authorized to edit this note' })
      return
    }

    const updates: Record<string, unknown> = {}

    if (typeof req.body?.body === 'string') {
      const body = req.body.body.trim()
      if (body.length === 0) {
        res.status(400).json({ error: 'body cannot be empty' })
        return
      }
      if (body.length > 5000) {
        res.status(400).json({ error: 'body must be at most 5000 characters' })
        return
      }
      updates['body'] = body
    }

    if (typeof req.body?.pinned === 'boolean') {
      const meta = (existing.metadata as Record<string, unknown>) ?? {}
      updates['metadata'] = { ...meta, pinned: req.body.pinned }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    const { data: updated, error } = await supabase
      .from('activity_log')
      .update(updates)
      .eq('id', activityId)
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json(updated)
  }
)

// ── DELETE /api/contacts/:contactId/notes/:activityId ────────────────────────
router.delete(
  '/contacts/:contactId/notes/:activityId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId, activityId } = req.params

    // Verify note exists and belongs to tenant
    const { data: existing } = await supabase
      .from('activity_log')
      .select('id, actor_id')
      .eq('id', activityId)
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('type', 'note')
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Note not found' })
      return
    }

    if (existing.actor_id !== authed.userId && authed.role !== 'owner') {
      res.status(403).json({ error: 'Not authorized to delete this note' })
      return
    }

    const { error } = await supabase.from('activity_log').delete().eq('id', activityId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ deleted: true })
  }
)

export default router
