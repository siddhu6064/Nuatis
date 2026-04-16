import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { logActivity } from '../lib/activity.js'
import { notifyOwner } from '../lib/notifications.js'
import { autoEnrichContact } from '../lib/contact-enrichment.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── POST /init — initialize chat session ─────────────────────────────────────
router.post('/init', async (req: Request, res: Response): Promise<void> => {
  const { tenantId } = req.body as { tenantId?: string }

  if (!tenantId) {
    res.status(400).json({ error: 'tenantId is required' })
    return
  }

  const supabase = getSupabase()

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, business_name, chat_widget_enabled, chat_widget_greeting, chat_widget_color')
    .eq('id', tenantId)
    .maybeSingle()

  if (tenantError || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  if (!tenant.chat_widget_enabled) {
    res.status(403).json({ error: 'Chat widget is not enabled for this business' })
    return
  }

  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .insert({ tenant_id: tenantId, status: 'active' })
    .select('id')
    .single()

  if (sessionError || !session) {
    res.status(500).json({ error: 'Failed to create chat session' })
    return
  }

  res.status(201).json({
    sessionId: session.id,
    greeting:
      (tenant.chat_widget_greeting as string | null) ?? 'Hi there! How can we help you today?',
    businessName: tenant.business_name,
    color: (tenant.chat_widget_color as string | null) ?? '#2563eb',
  })
})

// ── POST /message — visitor sends message ────────────────────────────────────
router.post('/message', async (req: Request, res: Response): Promise<void> => {
  const {
    sessionId,
    body: messageBody,
    visitorName,
    visitorEmail,
    visitorPhone,
  } = req.body as {
    sessionId?: string
    body?: string
    visitorName?: string
    visitorEmail?: string
    visitorPhone?: string
  }

  if (!sessionId || !messageBody) {
    res.status(400).json({ error: 'sessionId and body are required' })
    return
  }

  const supabase = getSupabase()

  // Validate session
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('id, tenant_id, status, contact_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionError || !session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  if (session.status !== 'active') {
    res.status(400).json({ error: 'Session is not active' })
    return
  }

  const tenantId: string = session.tenant_id as string

  // Insert message
  const { data: message, error: messageError } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      tenant_id: tenantId,
      sender_type: 'visitor',
      body: messageBody,
    })
    .select('id')
    .single()

  if (messageError || !message) {
    res.status(500).json({ error: 'Failed to save message' })
    return
  }

  // Update session metadata
  await supabase
    .from('chat_sessions')
    .update({
      last_message_at: new Date().toISOString(),
      // unread_count handled below via RPC
    })
    .eq('id', sessionId)

  // Increment unread_count separately
  try {
    await supabase.rpc('increment_chat_unread', { p_session_id: sessionId })
  } catch {
    // Fallback if RPC not available — best effort
    void supabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  // Handle visitor info / contact find-or-create
  let contactId: string | null = (session.contact_id as string | null) ?? null
  const name = visitorName?.trim() || null
  const email = visitorEmail?.trim().toLowerCase() || null
  const phone = visitorPhone?.trim() || null

  if (email || phone || name) {
    // Update session with visitor info
    const sessionUpdates: Record<string, unknown> = {}
    if (name) sessionUpdates['visitor_name'] = name
    if (email) sessionUpdates['visitor_email'] = email
    if (phone) sessionUpdates['visitor_phone'] = phone
    await supabase.from('chat_sessions').update(sessionUpdates).eq('id', sessionId)

    // Find or create contact (match email first, then phone)
    if (!contactId && (email || phone)) {
      let foundId: string | null = null

      if (email) {
        const { data: byEmail } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('email', email)
          .maybeSingle()
        if (byEmail) foundId = byEmail.id as string
      }

      if (!foundId && phone) {
        const { data: byPhone } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('phone', phone)
          .maybeSingle()
        if (byPhone) foundId = byPhone.id as string
      }

      if (foundId) {
        contactId = foundId
        await supabase.from('chat_sessions').update({ contact_id: contactId }).eq('id', sessionId)
      } else {
        // Create new contact
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            tenant_id: tenantId,
            full_name: name ?? email ?? phone ?? 'Chat Visitor',
            email: email ?? null,
            phone: phone ?? null,
            source: 'chat_widget',
          })
          .select('id')
          .single()

        if (newContact) {
          contactId = newContact.id as string
          await supabase.from('chat_sessions').update({ contact_id: contactId }).eq('id', sessionId)

          // Auto-enrich new contact
          try {
            const enrichResult = autoEnrichContact({
              phone: phone ?? undefined,
              email: email ?? undefined,
            })
            const enrichUpdates: Record<string, unknown> = {}
            if (enrichResult.updates.city) enrichUpdates['city'] = enrichResult.updates.city
            if (enrichResult.updates.state) enrichUpdates['state'] = enrichResult.updates.state
            if (enrichResult.updates.timezone)
              enrichUpdates['timezone'] = enrichResult.updates.timezone
            if (enrichResult.suggestedCompany) {
              enrichUpdates['custom_fields'] = {
                enrichment_suggested_company: enrichResult.suggestedCompany,
              }
            }
            if (Object.keys(enrichUpdates).length > 0) {
              await supabase.from('contacts').update(enrichUpdates).eq('id', contactId)
            }
          } catch (err) {
            console.error('[enrichment] Failed:', err)
          }
        }
      }
    }
  }

  // Notify owner
  const senderLabel = name ?? email ?? phone ?? 'Visitor'
  void notifyOwner(tenantId, 'new_sms', {
    pushTitle: 'New chat message',
    pushBody: `${senderLabel}: ${messageBody.slice(0, 50)}`,
  })

  // Log activity if contact linked
  if (contactId) {
    void logActivity({
      tenantId,
      contactId,
      type: 'system',
      body: `Chat message: ${messageBody.slice(0, 100)}`,
      metadata: { session_id: sessionId, message_id: message.id },
      actorType: 'system',
    })
  }

  res.status(201).json({ messageId: message.id, contactId })
})

// ── GET /messages/:sessionId — get messages ──────────────────────────────────
router.get('/messages/:sessionId', async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params
  const after = typeof req.query['after'] === 'string' ? req.query['after'] : null

  const supabase = getSupabase()

  // Verify session exists
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  let query = supabase
    .from('chat_messages')
    .select('id, session_id, sender_type, body, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (after) {
    query = query.gt('created_at', after)
  }

  const { data: messages, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ messages: messages ?? [] })
})

// ── POST /end — end session ───────────────────────────────────────────────────
router.post('/end', async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.body as { sessionId?: string }

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }

  const supabase = getSupabase()

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'closed', ended_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

export default router
