import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

// Authenticated agent-side router for the LIVE webchat system
// (webchat_sessions/webchat_messages). Mounted at /api/webchat/sessions.
const router = Router()

// ── GET /:id ───────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getServiceClient()

  const { data: session, error } = await supabase
    .from('webchat_sessions')
    .select(
      'id, status, mode, visitor_name, visitor_email, handoff_requested_at, handoff_reason, started_at, ended_at'
    )
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const { data: messages, error: msgsError } = await supabase
    .from('webchat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true })

  if (msgsError) {
    res.status(500).json({ error: msgsError.message })
    return
  }

  void supabase
    .from('webchat_sessions')
    .update({ unread_count: 0 })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  res.json({ session, messages: messages ?? [] })
})

// ── GET /:id/messages (cursor poll) ─────────────────────────────────────────────
router.get('/:id/messages', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const { after } = req.query as { after?: string }
  const supabase = getServiceClient()

  const { data: session, error: sessionError } = await supabase
    .from('webchat_sessions')
    .select('id, mode')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  let query = supabase
    .from('webchat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true })

  if (after) {
    query = query.gt('created_at', after)
  }

  const { data: messages, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ messages: messages ?? [], mode: session.mode })
})

// ── POST /:id/reply ─────────────────────────────────────────────────────────────
router.post('/:id/reply', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const { body } = req.body as { body?: string }

  if (!body || !body.trim()) {
    res.status(400).json({ error: 'body is required' })
    return
  }

  const supabase = getServiceClient()

  const { data: session, error: sessionError } = await supabase
    .from('webchat_sessions')
    .select('id, mode, handoff_requested_at')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const trimmed = body.trim()

  const { data: message, error: insertError } = await supabase
    .from('webchat_messages')
    .insert({ session_id: id, role: 'agent', content: trimmed })
    .select('id, role, content, created_at')
    .single()

  if (insertError || !message) {
    res.status(500).json({ error: insertError?.message ?? 'Failed to send reply' })
    return
  }

  // Sending a reply is itself the takeover — no separate "take over" click required.
  const updates: Record<string, unknown> = {
    last_message_at: message.created_at,
    last_message_preview: trimmed.slice(0, 140),
    unread_count: 0,
  }
  if (session.mode !== 'human') {
    updates['mode'] = 'human'
    updates['handoff_requested_at'] = session.handoff_requested_at ?? new Date().toISOString()
  }

  await supabase.from('webchat_sessions').update(updates).eq('id', id)

  res.status(201).json({ message, mode: 'human' })
})

// ── PATCH /:id/mode ──────────────────────────────────────────────────────────────
router.patch('/:id/mode', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const { mode } = req.body as { mode?: string }

  if (mode !== 'ai' && mode !== 'human') {
    res.status(400).json({ error: "mode must be 'ai' or 'human'" })
    return
  }

  const supabase = getServiceClient()

  const { data: session, error: sessionError } = await supabase
    .from('webchat_sessions')
    .select('id, handoff_requested_at')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const updates: Record<string, unknown> =
    mode === 'human'
      ? { mode, handoff_requested_at: session.handoff_requested_at ?? new Date().toISOString() }
      : { mode, handoff_requested_at: null, handoff_reason: null }

  const { error: updateError } = await supabase
    .from('webchat_sessions')
    .update(updates)
    .eq('id', id)

  if (updateError) {
    res.status(500).json({ error: updateError.message })
    return
  }

  res.json({ ok: true, mode })
})

// ── POST /:id/close ──────────────────────────────────────────────────────────────
router.post('/:id/close', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getServiceClient()

  const { error } = await supabase
    .from('webchat_sessions')
    .update({ status: 'closed', ended_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

export default router
