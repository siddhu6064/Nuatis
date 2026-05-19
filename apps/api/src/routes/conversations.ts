import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendSms } from '../lib/sms.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/conversations ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const tenantId = authed.tenantId
  const supabase = getSupabase()

  const statusFilter = (req.query['status'] as string) ?? 'open'
  if (!['open', 'resolved', 'all'].includes(statusFilter)) {
    res.status(400).json({ error: 'status must be open, resolved, or all' })
    return
  }
  const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10) || 1)
  const limit = Math.min(
    100,
    Math.max(1, parseInt((req.query['limit'] as string) ?? '20', 10) || 20)
  )

  // Step 1: Fetch all sms_messages for this tenant
  const { data: allMessages, error: msgError } = await supabase
    .from('sms_messages')
    .select('id, contact_id, direction, body, created_at, ai_handled')
    .eq('tenant_id', tenantId)
    .not('contact_id', 'is', null)
    .order('created_at', { ascending: false })

  if (msgError) {
    res.status(500).json({ error: msgError.message })
    return
  }

  // Get unique contact IDs
  const contactIds = [...new Set((allMessages ?? []).map((m) => m.contact_id as string))]

  // Early return if no conversations
  if (contactIds.length === 0) {
    res.json({ conversations: [], total: 0, page })
    return
  }

  // Step 2: Fetch contact info
  const { data: contacts, error: contactsError } = await supabase
    .from('contacts')
    .select('id, full_name, phone')
    .in('id', contactIds)
    .eq('tenant_id', tenantId)

  if (contactsError) {
    res.status(500).json({ error: contactsError.message })
    return
  }

  // Step 3: Fetch conversation statuses
  const { data: statuses, error: statusError } = await supabase
    .from('conversation_status')
    .select('contact_id, resolved_at')
    .eq('tenant_id', tenantId)
    .in('contact_id', contactIds)

  if (statusError) {
    res.status(500).json({ error: statusError.message })
    return
  }

  // Build lookup maps
  const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]))
  const statusMap = new Map((statuses ?? []).map((s) => [s.contact_id, s]))

  // Group messages by contact_id
  const messagesByContact = new Map<string, typeof allMessages>()
  for (const msg of allMessages ?? []) {
    const cid = msg.contact_id as string
    if (!messagesByContact.has(cid)) {
      messagesByContact.set(cid, [])
    }
    messagesByContact.get(cid)!.push(msg)
  }

  // Build conversations array
  const allConversations = contactIds
    .map((contactId) => {
      const messages = messagesByContact.get(contactId) ?? []
      // Messages are ordered descending, so first is most recent
      const lastMessage = messages[0]

      // Compute unread count: inbound messages after the last outbound
      const outboundMessages = messages.filter((m) => m.direction === 'outbound')
      let unreadCount = 0
      if (outboundMessages.length === 0) {
        // No outbound: all inbound are unread
        unreadCount = messages.filter((m) => m.direction === 'inbound').length
      } else {
        // Find the max outbound created_at
        const lastOutboundAt = outboundMessages.reduce((max, m) =>
          m.created_at > max.created_at ? m : max
        ).created_at
        // Count inbound after last outbound
        unreadCount = messages.filter(
          (m) => m.direction === 'inbound' && m.created_at > lastOutboundAt
        ).length
      }

      const statusRow = statusMap.get(contactId)
      const conversationStatus = statusRow?.resolved_at ? 'resolved' : 'open'
      const contact = contactMap.get(contactId)

      return {
        id: contactId,
        contact_id: contactId,
        contact_name: contact?.full_name ?? null,
        contact_phone: contact?.phone ?? null,
        last_message: lastMessage?.body ?? null,
        last_message_at: lastMessage?.created_at ?? null,
        direction: lastMessage?.direction ?? null,
        ai_handled: lastMessage?.ai_handled ?? false,
        unread_count: unreadCount,
        status: conversationStatus,
      }
    })
    .filter((conv) => {
      if (statusFilter === 'all') return true
      return conv.status === statusFilter
    })
    .sort((a, b) => {
      // Sort by last message descending
      if (!a.last_message_at) return 1
      if (!b.last_message_at) return -1
      return b.last_message_at.localeCompare(a.last_message_at)
    })

  const total = allConversations.length
  const offset = (page - 1) * limit
  const paginated = allConversations.slice(offset, offset + limit)

  res.json({ conversations: paginated, total, page })
})

// ── GET /api/conversations/:contactId/messages ────────────────────────────────
router.get(
  '/:contactId/messages',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const tenantId = authed.tenantId
    const supabase = getSupabase()
    const { contactId } = req.params

    // Verify contact belongs to tenant
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, sms_opt_in')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (contactError) {
      res.status(500).json({ error: contactError.message })
      return
    }
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    // Fetch all messages for this contact + tenant, ordered ascending
    const { data: messages, error: msgError } = await supabase
      .from('sms_messages')
      .select(
        'id, contact_id, direction, body, from_number, to_number, message_sid, status, ai_handled, ai_response, created_at'
      )
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })

    if (msgError) {
      res.status(500).json({ error: msgError.message })
      return
    }

    res.json({
      messages: messages ?? [],
      contact: {
        id: contact.id,
        name: contact.full_name,
        phone: contact.phone,
        email: contact.email,
        sms_opt_in: contact.sms_opt_in,
      },
    })
  }
)

// ── POST /api/conversations/:contactId/resolve ────────────────────────────────
router.post(
  '/:contactId/resolve',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const tenantId = authed.tenantId
    const supabase = getSupabase()
    const { contactId } = req.params

    const now = new Date().toISOString()

    const { error } = await supabase.from('conversation_status').upsert(
      {
        tenant_id: tenantId,
        contact_id: contactId,
        resolved_at: now,
        resolved_by: authed.userId ?? null,
        updated_at: now,
      },
      { onConflict: 'tenant_id,contact_id' }
    )

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ resolved: true, resolved_at: now })
  }
)

// ── POST /api/conversations/:contactId/reopen ─────────────────────────────────
router.post(
  '/:contactId/reopen',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const tenantId = authed.tenantId
    const supabase = getSupabase()
    const { contactId } = req.params

    const now = new Date().toISOString()

    const { error } = await supabase.from('conversation_status').upsert(
      {
        tenant_id: tenantId,
        contact_id: contactId,
        resolved_at: null,
        resolved_by: null,
        updated_at: now,
      },
      { onConflict: 'tenant_id,contact_id' }
    )

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ reopened: true })
  }
)

// ── POST /api/conversations/:contactId/send ───────────────────────────────────
router.post('/:contactId/send', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const tenantId = authed.tenantId
  const supabase = getSupabase()
  const { contactId } = req.params

  // Validate body
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) {
    res.status(400).json({ error: 'body is required' })
    return
  }
  if (body.length > 1600) {
    res.status(400).json({ error: 'body must be 1600 characters or less' })
    return
  }

  // Fetch contact (must belong to tenant)
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id, phone, full_name, sms_opt_in')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (contactError) {
    res.status(500).json({ error: contactError.message })
    return
  }
  if (!contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  // Check SMS opt-in
  if (contact.sms_opt_in === false) {
    res.status(403).json({ error: 'Contact has opted out of SMS' })
    return
  }

  // Get our phone number
  const { data: location, error: locationError } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  if (locationError) {
    res.status(500).json({ error: locationError.message })
    return
  }
  if (!location?.telnyx_number) {
    res.status(400).json({ error: 'SMS not configured — no Telnyx number' })
    return
  }

  const result = await sendSms(location.telnyx_number, contact.phone, body, {
    tenantId,
    contactId,
  })

  if (!result.success) {
    res.status(500).json({ error: 'Failed to send SMS' })
    return
  }

  res.json({
    message_sid: result.messageId ?? null,
    created_at: new Date().toISOString(),
  })
})

export default router
