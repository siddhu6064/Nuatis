import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendSms } from '../lib/sms.js'
import { grantTcpaOptIn } from '../lib/tcpa.js'
import { smsSendLimiter } from '../middleware/rate-limit.js'
import { broadcastToTenant } from '../lib/conversations-ws.js'

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

  // Step 1: Fetch recent sms_messages for this tenant (capped to avoid full-table scan)
  const { data: allMessages, error: msgError } = await supabase
    .from('sms_messages')
    .select('id, contact_id, direction, body, created_at, ai_handled, read_at')
    .eq('tenant_id', tenantId)
    .not('contact_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)

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
    .select('contact_id, resolved_at, assigned_to, assigned_at')
    .eq('tenant_id', tenantId)
    .in('contact_id', contactIds)

  if (statusError) {
    res.status(500).json({ error: statusError.message })
    return
  }

  // Step 4: Fetch assignee names for any assigned conversations
  const assigneeIds = [
    ...new Set(
      (statuses ?? [])
        .map((s) => s.assigned_to as string | null)
        .filter((id): id is string => id !== null)
    ),
  ]

  let assigneeMap = new Map<string, string>()
  if (assigneeIds.length > 0) {
    const { data: assignees } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', assigneeIds)
    assigneeMap = new Map((assignees ?? []).map((u) => [u.id as string, u.full_name as string]))
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

      // Compute unread count: inbound messages without a read_at timestamp
      const unreadCount = messages.filter(
        (m) => m.direction === 'inbound' && m.read_at == null
      ).length

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
        assigned_to: statusRow?.assigned_to ?? null,
        assigned_to_name: statusRow?.assigned_to
          ? (assigneeMap.get(statusRow.assigned_to as string) ?? null)
          : null,
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

// ── GET /api/conversations/assignees ─────────────────────────────────────────
// MUST be before /:contactId routes to avoid Express treating 'assignees' as a contactId
router.get('/assignees', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const tenantId = authed.tenantId
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json((data ?? []).map((u) => ({ id: u.id, name: u.full_name, email: u.email })))
})

// ── GET /api/conversations/analytics ─────────────────────────────────────────
// MUST be before /:contactId routes
router.get('/analytics', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const tenantId = authed.tenantId
  const supabase = getSupabase()

  const periodDays = 30
  const since30 = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()
  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: messages, error: msgErr } = await supabase
    .from('sms_messages')
    .select('id, contact_id, direction, created_at, ai_handled')
    .eq('tenant_id', tenantId)
    .gte('created_at', since30)
    .not('contact_id', 'is', null)
    .order('contact_id', { ascending: true })
    .order('created_at', { ascending: true })

  if (msgErr) {
    res.status(500).json({ error: msgErr.message })
    return
  }

  const msgs = messages ?? []
  const contactIds = [...new Set(msgs.map((m) => m.contact_id as string))]

  // Fetch statuses for open/resolved counts
  const { data: statuses } =
    contactIds.length > 0
      ? await supabase
          .from('conversation_status')
          .select('contact_id, resolved_at')
          .eq('tenant_id', tenantId)
          .in('contact_id', contactIds)
      : { data: [] }

  const statusMap = new Map((statuses ?? []).map((s) => [s.contact_id as string, s]))
  const totalConversations = contactIds.length
  const resolvedConversations = contactIds.filter((cid) => statusMap.get(cid)?.resolved_at).length
  const openConversations = totalConversations - resolvedConversations

  // AI handled stats (over 30-day inbound messages)
  const inboundMsgs = msgs.filter((m) => m.direction === 'inbound')
  const aiHandledCount = inboundMsgs.filter((m) => m.ai_handled).length
  const aiHandledPct =
    inboundMsgs.length > 0 ? Math.round((aiHandledCount / inboundMsgs.length) * 100) : 0

  // Avg response time: inbound → next outbound pairs per conversation
  const msgsByContact = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const cid = m.contact_id as string
    if (!msgsByContact.has(cid)) msgsByContact.set(cid, [])
    msgsByContact.get(cid)!.push(m)
  }

  const responseTimes: number[] = []
  for (const [, convMsgs] of msgsByContact) {
    for (let i = 0; i < convMsgs.length - 1; i++) {
      const curr = convMsgs[i]!
      const next = convMsgs[i + 1]!
      if (curr.direction === 'inbound' && next.direction === 'outbound') {
        const diffMin =
          (new Date(next.created_at as string).getTime() -
            new Date(curr.created_at as string).getTime()) /
          60000
        if (diffMin >= 0 && diffMin < 1440) responseTimes.push(diffMin)
      }
    }
  }

  const avgResponseTimeMinutes =
    responseTimes.length > 0
      ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
      : null

  // Busiest hour (inbound, last 30 days)
  const hourCounts = new Array<number>(24).fill(0)
  for (const m of inboundMsgs) {
    const hour = new Date(m.created_at as string).getHours()
    hourCounts[hour]!++
  }
  const maxCount = Math.max(...hourCounts)
  const busiestHour = maxCount > 0 ? hourCounts.indexOf(maxCount) : null

  // Volume by day — last 14 days (all days guaranteed present)
  const volumeMap = new Map<string, { inbound: number; outbound: number }>()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    volumeMap.set(d.toISOString().slice(0, 10), { inbound: 0, outbound: 0 })
  }
  for (const m of msgs.filter((m) => (m.created_at as string) >= since14)) {
    const key = (m.created_at as string).slice(0, 10)
    const entry = volumeMap.get(key)
    if (entry) {
      if (m.direction === 'inbound') entry.inbound++
      else entry.outbound++
    }
  }
  const volumeByDay = [...volumeMap.entries()].map(([date, v]) => ({ date, ...v }))

  res.json({
    period_days: periodDays,
    total_conversations: totalConversations,
    open_conversations: openConversations,
    resolved_conversations: resolvedConversations,
    avg_response_time_minutes: avgResponseTimeMinutes,
    ai_handled_count: aiHandledCount,
    ai_handled_pct: aiHandledPct,
    busiest_hour: busiestHour,
    volume_by_day: volumeByDay,
  })
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

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (contactErr) {
      res.status(500).json({ error: contactErr.message })
      return
    }
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    const now = new Date().toISOString()

    const { error } = await supabase.from('conversation_status').upsert(
      {
        tenant_id: tenantId,
        contact_id: contactId,
        resolved_at: now,
        resolved_by: authed.appUserId ?? null,
        updated_at: now,
      },
      { onConflict: 'tenant_id,contact_id' }
    )

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    broadcastToTenant(tenantId as string, {
      type: 'conversation_resolved',
      conversation_id: contactId!,
    })

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

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (contactErr) {
      res.status(500).json({ error: contactErr.message })
      return
    }
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

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

    broadcastToTenant(tenantId as string, {
      type: 'conversation_reopened',
      conversation_id: contactId!,
    })

    res.json({ reopened: true })
  }
)

// ── POST /api/conversations/:contactId/send ───────────────────────────────────
router.post(
  '/:contactId/send',
  smsSendLimiter,
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
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
      await grantTcpaOptIn(contactId as string, tenantId as string)
    }

    // Get our phone number (from telnyx_numbers table)
    const { data: telnyxNum, error: locationError } = await supabase
      .from('telnyx_numbers')
      .select('phone_number')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (locationError) {
      res.status(500).json({ error: locationError.message })
      return
    }
    if (!telnyxNum?.phone_number) {
      res.status(400).json({ error: 'SMS not configured — no Telnyx number' })
      return
    }

    const result = await sendSms(telnyxNum.phone_number, contact.phone, body, {
      tenantId,
      contactId,
    })

    if (!result.success) {
      console.warn(
        `[conversations] manual SMS send failed: tenant=${tenantId} contact=${contactId} to=${contact.phone} from=${telnyxNum.phone_number}`
      )
      res.status(500).json({ error: 'Failed to send SMS' })
      return
    }

    broadcastToTenant(tenantId as string, {
      type: 'new_message',
      conversation_id: contactId as string,
      message: {
        id: result.messageId ?? crypto.randomUUID(),
        direction: 'outbound',
        body,
        from_number: telnyxNum.phone_number,
        to_number: contact.phone!,
        status: 'sent',
        ai_handled: false,
        created_at: new Date().toISOString(),
      },
    })

    res.json({
      message_sid: result.messageId ?? null,
      created_at: new Date().toISOString(),
    })
  }
)

// ── POST /api/conversations/:contactId/assign ─────────────────────────────────
router.post(
  '/:contactId/assign',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const tenantId = authed.tenantId
    const supabase = getSupabase()
    const { contactId } = req.params

    // Validate body
    const rawUserId = req.body?.user_id
    if (rawUserId !== null && rawUserId !== undefined && typeof rawUserId !== 'string') {
      res.status(400).json({ error: 'user_id must be a string or null' })
      return
    }
    const userId: string | null = rawUserId ?? null

    // Verify contact belongs to tenant
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (contactErr) {
      res.status(500).json({ error: contactErr.message })
      return
    }
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    // If assigning (non-null), verify user exists in same tenant
    if (userId !== null) {
      const { data: user, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (userErr) {
        res.status(500).json({ error: userErr.message })
        return
      }
      if (!user) {
        res.status(400).json({ error: 'User not found in this tenant' })
        return
      }
    }

    const now = new Date().toISOString()

    const { error } = await supabase.from('conversation_status').upsert(
      {
        tenant_id: tenantId,
        contact_id: contactId,
        assigned_to: userId,
        assigned_at: userId !== null ? now : null,
        updated_at: now,
      },
      { onConflict: 'tenant_id,contact_id' }
    )

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    broadcastToTenant(tenantId as string, {
      type: 'conversation_assigned',
      conversation_id: contactId!,
      assigned_to: userId,
    })

    res.json({
      assigned_to: userId,
      assigned_at: userId !== null ? now : null,
    })
  }
)

// ── POST /api/conversations/:contactId/messages/read ─────────────────────────
router.post(
  '/:contactId/messages/read',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const tenantId = authed.tenantId
    const supabase = getSupabase()
    const { contactId } = req.params

    // Update inbound unread messages, returning updated rows to count them
    const { data, error } = await supabase
      .from('sms_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('direction', 'inbound')
      .is('read_at', null)
      .select('id')

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ marked_read: data?.length ?? 0 })
  }
)

export default router
