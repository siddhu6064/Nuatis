import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { aiGenerationLimiter } from '../middleware/rate-limit.js'

// ── Supabase factory ──────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Public webchat router ─────────────────────────────────────────────────────
const router = Router()

// ── POST /session/init ────────────────────────────────────────────────────────
router.post('/session/init', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenant_id, location_id, visitor_name, visitor_email } = req.body as {
      tenant_id?: string
      location_id?: string
      visitor_name?: string
      visitor_email?: string
    }

    if (!tenant_id) {
      res.status(400).json({ error: 'tenant_id is required' })
      return
    }

    const supabase = getSupabase()

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(
        'id, business_name, webchat_enabled, webchat_greeting, webchat_color, webchat_position'
      )
      .eq('id', tenant_id)
      .maybeSingle()

    if (tenantError || !tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    if (!tenant.webchat_enabled) {
      res.status(403).json({ error: 'Webchat not enabled' })
      return
    }

    const session_token = randomUUID()

    const { data: session, error: sessionError } = await supabase
      .from('webchat_sessions')
      .insert({
        tenant_id,
        location_id: location_id ?? null,
        session_token,
        status: 'active',
        visitor_name: visitor_name ?? null,
        visitor_email: visitor_email ?? null,
      })
      .select('id')
      .single()

    if (sessionError || !session) {
      console.error('[webchat/session/init] error', sessionError)
      res.status(500).json({ error: 'Failed to create session' })
      return
    }

    res.status(201).json({
      session_token,
      greeting: tenant.webchat_greeting,
      color: tenant.webchat_color,
      position: tenant.webchat_position,
      business_name: tenant.business_name,
    })
  } catch (err) {
    console.error('[webchat/session/init] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /session/:token/message ──────────────────────────────────────────────
router.post(
  '/session/:token/message',
  aiGenerationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params
      const { content, role: bodyRole } = req.body as {
        content?: string
        role?: 'user' | 'agent'
      }

      if (!content) {
        res.status(400).json({ error: 'content is required' })
        return
      }

      const role = bodyRole ?? 'user'
      const supabase = getSupabase()

      // Lookup session
      const { data: session, error: sessionError } = await supabase
        .from('webchat_sessions')
        .select('id, tenant_id, status')
        .eq('session_token', token)
        .maybeSingle()

      if (sessionError || !session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      if (session.status !== 'active') {
        res.status(400).json({ error: 'Session closed' })
        return
      }

      // Insert user/agent message
      const { data: message, error: msgError } = await supabase
        .from('webchat_messages')
        .insert({
          session_id: session.id,
          role,
          content,
        })
        .select('id, role, content, created_at')
        .single()

      if (msgError || !message) {
        console.error('[webchat/session/message] insert error', msgError)
        res.status(500).json({ error: 'Failed to save message' })
        return
      }

      // If agent message — no AI reply needed
      if (role !== 'user') {
        res.status(201).json({ message })
        return
      }

      // Generate AI reply
      const { data: historyRows } = await supabase
        .from('webchat_messages')
        .select('role, content')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false })
        .limit(10)

      const history = (historyRows ?? []).reverse()

      // Fetch business name for prompt
      const { data: tenant } = await supabase
        .from('tenants')
        .select('business_name')
        .eq('id', session.tenant_id)
        .maybeSingle()

      const businessName = tenant?.business_name ?? 'this business'

      const historyText = history
        .map((m: { role: string; content: string }) =>
          m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`
        )
        .join('\n')

      const fullPrompt = `You are a friendly AI assistant for ${businessName}. Answer visitor questions helpfully and concisely. Keep replies under 3 sentences.

${historyText}

User: ${content}
Assistant:`

      let aiReply = ''
      try {
        const { GoogleGenAI } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] ?? '' })
        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        })
        aiReply = result.text ?? ''
      } catch (aiErr) {
        console.error('[webchat/session/message] Gemini error', aiErr)
        aiReply = "I'm sorry, I'm having trouble responding right now. Please try again shortly."
      }

      // Insert AI reply
      const { data: reply, error: replyError } = await supabase
        .from('webchat_messages')
        .insert({
          session_id: session.id,
          role: 'assistant',
          content: aiReply,
        })
        .select('id, role, content, created_at')
        .single()

      if (replyError || !reply) {
        console.error('[webchat/session/message] reply insert error', replyError)
        res.status(500).json({ error: 'Failed to save AI reply' })
        return
      }

      res.status(201).json({ message, reply })
    } catch (err) {
      console.error('[webchat/session/message] error', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ── GET /session/:token ───────────────────────────────────────────────────────
router.get('/session/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params
    const supabase = getSupabase()

    const { data: session, error: sessionError } = await supabase
      .from('webchat_sessions')
      .select('id, status, visitor_name, visitor_email, started_at')
      .eq('session_token', token)
      .maybeSingle()

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { data: messages, error: msgsError } = await supabase
      .from('webchat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })

    if (msgsError) {
      console.error('[webchat/session/get] messages error', msgsError)
      res.status(500).json({ error: 'Failed to fetch messages' })
      return
    }

    res.json({ session, messages: messages ?? [] })
  } catch (err) {
    console.error('[webchat/session/get] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /session/:token/close ────────────────────────────────────────────────
router.post('/session/:token/close', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params
    const supabase = getSupabase()

    const { data: session, error: sessionError } = await supabase
      .from('webchat_sessions')
      .select('id')
      .eq('session_token', token)
      .maybeSingle()

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { error: updateError } = await supabase
      .from('webchat_sessions')
      .update({ status: 'closed', ended_at: new Date().toISOString() })
      .eq('id', session.id)

    if (updateError) {
      console.error('[webchat/session/close] error', updateError)
      res.status(500).json({ error: 'Failed to close session' })
      return
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[webchat/session/close] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /sessions (AUTHENTICATED — agent inbox) ───────────────────────────────
router.get('/sessions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authedReq = req as AuthenticatedRequest
    const tenantId = authedReq.tenantId
    const supabase = getSupabase()

    const { data: sessions, error } = await supabase
      .from('webchat_sessions')
      .select(
        'id, session_token, status, visitor_name, visitor_email, location_id, started_at, ended_at, created_at'
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[webchat/sessions] error', error)
      res.status(500).json({ error: 'Failed to fetch sessions' })
      return
    }

    res.json({ sessions: sessions ?? [] })
  } catch (err) {
    console.error('[webchat/sessions] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router

// ── Webchat settings router (AUTHENTICATED) ───────────────────────────────────
export const webchatSettingsRouter = Router()

webchatSettingsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authedReq = req as AuthenticatedRequest
    const tenantId = authedReq.tenantId
    const supabase = getSupabase()

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('webchat_enabled, webchat_greeting, webchat_color, webchat_position')
      .eq('id', tenantId)
      .maybeSingle()

    if (error || !tenant) {
      console.error('[webchat/settings/get] error', error)
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    res.json({
      webchat_enabled: tenant.webchat_enabled,
      webchat_greeting: tenant.webchat_greeting,
      webchat_color: tenant.webchat_color,
      webchat_position: tenant.webchat_position,
    })
  } catch (err) {
    console.error('[webchat/settings/get] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

webchatSettingsRouter.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authedReq = req as AuthenticatedRequest
    const tenantId = authedReq.tenantId

    const { webchat_enabled, webchat_greeting, webchat_color, webchat_position } = req.body as {
      webchat_enabled?: boolean
      webchat_greeting?: string
      webchat_color?: string
      webchat_position?: string
    }

    // Validate inputs
    const updates: Record<string, unknown> = {}

    if (webchat_enabled !== undefined) {
      if (typeof webchat_enabled !== 'boolean') {
        res.status(400).json({ error: 'webchat_enabled must be a boolean' })
        return
      }
      updates['webchat_enabled'] = webchat_enabled
    }

    if (webchat_greeting !== undefined) {
      if (typeof webchat_greeting !== 'string' || webchat_greeting.length > 500) {
        res.status(400).json({ error: 'webchat_greeting must be a string under 500 characters' })
        return
      }
      updates['webchat_greeting'] = webchat_greeting
    }

    if (webchat_color !== undefined) {
      if (typeof webchat_color !== 'string' || !/^#[0-9a-fA-F]{3,6}$/.test(webchat_color)) {
        res.status(400).json({ error: 'webchat_color must be a valid hex color (e.g. #2563eb)' })
        return
      }
      updates['webchat_color'] = webchat_color
    }

    if (webchat_position !== undefined) {
      const validPositions = ['bottom-right', 'bottom-left']
      if (!validPositions.includes(webchat_position)) {
        res
          .status(400)
          .json({ error: `webchat_position must be one of: ${validPositions.join(', ')}` })
        return
      }
      updates['webchat_position'] = webchat_position
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' })
      return
    }

    const supabase = getSupabase()

    const { error } = await supabase.from('tenants').update(updates).eq('id', tenantId)

    if (error) {
      console.error('[webchat/settings/put] error', error)
      res.status(500).json({ error: 'Failed to update settings' })
      return
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[webchat/settings/put] error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
