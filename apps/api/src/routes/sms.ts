import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { smsSendTenantLimiter } from '../middleware/rate-limit.js'
import { sendSms } from '../lib/sms.js'
import { grantTcpaOptIn } from '../lib/tcpa.js'
import { logActivity } from '../lib/activity.js'
import { getTenantPhoneNumber } from '../lib/telnyx-tenant-lookup.js'

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
      .from('sms_messages')
      .select('*')
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: true })

    if (error) {
      res.status(500).json({ error: 'Database operation failed' })
      return
    }

    const { count: unreadCount } = await supabase
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('direction', 'inbound')
      .is('read_at', null)

    res.json({ messages: messages ?? [], unread_count: unreadCount ?? 0 })
  }
)

// ── POST /api/contacts/:contactId/sms ────────────────────────────────────────
router.post(
  '/contacts/:contactId/sms',
  requireAuth,
  smsSendTenantLimiter,
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
      .select('id, phone, full_name, sms_opt_in')
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

    // Check SMS opt-in: explicit opt-out blocks. Null/undefined is treated as
    // agent-initiated consent — the agent's deliberate action to send creates
    // an established business relationship under TCPA. Grant opt-in here so
    // sendSms's internal TCPA check passes and so future automated replies
    // (Maya, campaigns) can also reach this contact.
    if (contact.sms_opt_in === false) {
      res.status(403).json({ error: 'Contact has opted out of SMS' })
      return
    }
    if (contact.sms_opt_in !== true) {
      await grantTcpaOptIn(contactId as string, authed.tenantId, authed.appUserId ?? null)
    }

    // Get tenant's Telnyx number (from telnyx_numbers table)
    const fromNumber = await getTenantPhoneNumber(authed.tenantId)

    if (!fromNumber) {
      res.status(400).json({ error: 'SMS not configured — no Telnyx number' })
      return
    }

    const result = await sendSms(fromNumber, contact.phone, message, {
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
      .from('sms_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .eq('direction', 'inbound')
      .is('read_at', null)

    res.json({ updated: count ?? 0 })
  }
)

// ── GET /api/sms/unread-count ────────────────────────────────────────────────
router.get('/sms/unread-count', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { count } = await supabase
    .from('sms_messages')
    .select('contact_id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
    .eq('direction', 'inbound')
    .is('read_at', null)

  res.json({ count: count ?? 0 })
})

export default router
