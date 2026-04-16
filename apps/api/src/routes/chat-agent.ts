import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/chat/sessions ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { status } = req.query

  let query = supabase
    .from('chat_sessions')
    .select(
      `id, tenant_id, contact_id, visitor_name, visitor_email, status,
       started_at, last_message_at, unread_count,
       chat_messages ( body, created_at )`
    )
    .eq('tenant_id', authed.tenantId)
    .order('last_message_at', { ascending: false })

  if (status === 'active' || status === 'closed' || status === 'archived') {
    query = query.eq('status', status)
  }

  const { data: sessions, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Attach last message preview from the joined messages
  const result = (sessions ?? []).map((session: Record<string, unknown>) => {
    const messages = session['chat_messages'] as Array<{ body: string; created_at: string }> | null
    const sorted = (messages ?? []).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    const { chat_messages: _dropped, ...rest } = session as Record<string, unknown> & {
      chat_messages: unknown
    }
    void _dropped
    return {
      ...rest,
      last_message_preview: sorted[0]?.body ?? null,
    }
  })

  res.json({ sessions: result })
})

// ── GET /api/chat/sessions/:id ────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', id)
    .order('created_at', { ascending: true })

  if (messagesError) {
    res.status(500).json({ error: messagesError.message })
    return
  }

  let contact = null
  if (session.contact_id) {
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, email, phone')
      .eq('id', session.contact_id)
      .eq('tenant_id', authed.tenantId)
      .single()
    contact = data ?? null
  }

  res.json({ session, messages: messages ?? [], contact })
})

// ── POST /api/chat/sessions/:id/reply ────────────────────────────────────────
router.post('/:id/reply', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) {
    res.status(400).json({ error: 'body is required' })
    return
  }

  // Verify session belongs to tenant
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, contact_id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const { data: message, error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      session_id: id,
      tenant_id: authed.tenantId,
      sender_type: 'agent',
      sender_id: authed.userId,
      body,
    })
    .select('id')
    .single()

  if (insertError || !message) {
    res.status(500).json({ error: insertError?.message ?? 'Failed to insert message' })
    return
  }

  await supabase
    .from('chat_sessions')
    .update({ last_message_at: new Date().toISOString(), unread_count: 0 })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (session.contact_id) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: session.contact_id,
      type: 'system',
      body: `Agent chat reply: ${body.slice(0, 100)}`,
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ messageId: message.id })
})

// ── POST /api/chat/sessions/:id/close ────────────────────────────────────────
router.post('/:id/close', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'closed', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

// ── POST /api/chat/sessions/:id/archive ──────────────────────────────────────
router.post('/:id/archive', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

export default router
