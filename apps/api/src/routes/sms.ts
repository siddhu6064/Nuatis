import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendSms } from '../lib/sms.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/contacts/:contactId/sms ─────────────────────────────────────────
router.get(
  '/contacts/:contactId/sms',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

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

    const { data: messages, error } = await supabase
      .from('inbound_sms')
      .select('*')
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: true })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const { count: unreadCount } = await supabase
      .from('inbound_sms')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('direction', 'inbound')
      .eq('status', 'received')

    res.json({ messages: messages ?? [], unread_count: unreadCount ?? 0 })
  }
)

// ── POST /api/contacts/:contactId/sms ────────────────────────────────────────
router.post(
  '/contacts/:contactId/sms',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    if (!message) {
      res.status(400).json({ error: 'message is required' })
      return
    }
    if (message.length > 320) {
      res.status(400).json({ error: 'message must be 320 chars or less' })
      return
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, phone, full_name')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    if (!contact.phone) {
      res.status(400).json({ error: 'Contact has no phone number' })
      return
    }

    // Get tenant's Telnyx number
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_number')
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .maybeSingle()

    if (!location?.telnyx_number) {
      res.status(400).json({ error: 'SMS not configured — no Telnyx number' })
      return
    }

    const result = await sendSms(location.telnyx_number, contact.phone, message, {
      tenantId: authed.tenantId,
      contactId,
    })

    if (!result.success) {
      res.status(500).json({ error: 'Failed to send SMS' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      contactId,
      type: 'sms',
      body: `SMS sent: "${message.slice(0, 60)}${message.length > 60 ? '...' : ''}"`,
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({ sent: true, message_id: result.messageId ?? null })
  }
)

// ── POST /api/contacts/:contactId/sms/read ───────────────────────────────────
router.post(
  '/contacts/:contactId/sms/read',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

    const { count } = await supabase
      .from('inbound_sms')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('direction', 'inbound')
      .eq('status', 'received')

    res.json({ updated: count ?? 0 })
  }
)

// ── GET /api/sms/unread-count ────────────────────────────────────────────────
router.get('/sms/unread-count', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { count } = await supabase
    .from('inbound_sms')
    .select('contact_id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
    .eq('direction', 'inbound')
    .eq('status', 'received')

  res.json({ count: count ?? 0 })
})

export default router
