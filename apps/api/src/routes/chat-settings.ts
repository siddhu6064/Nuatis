import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const VALID_POSITIONS = ['bottom-right', 'bottom-left'] as const

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/chat/widget-settings ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('chat_widget_enabled, chat_widget_color, chat_widget_greeting, chat_widget_position')
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({
    enabled: tenant.chat_widget_enabled ?? false,
    color: tenant.chat_widget_color ?? null,
    greeting: tenant.chat_widget_greeting ?? null,
    position: tenant.chat_widget_position ?? 'bottom-right',
  })
})

// ── PUT /api/chat/widget-settings ─────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  if ('enabled' in b) {
    updates['chat_widget_enabled'] = Boolean(b['enabled'])
  }

  if ('color' in b) {
    updates['chat_widget_color'] = typeof b['color'] === 'string' ? b['color'].trim() || null : null
  }

  if ('greeting' in b) {
    updates['chat_widget_greeting'] =
      typeof b['greeting'] === 'string' ? b['greeting'].trim() || null : null
  }

  if ('position' in b) {
    if (!VALID_POSITIONS.includes(b['position'] as (typeof VALID_POSITIONS)[number])) {
      res.status(400).json({ error: "position must be 'bottom-right' or 'bottom-left'" })
      return
    }
    updates['chat_widget_position'] = b['position']
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }

  const { error } = await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[chat-settings] widget settings updated for tenant=${authed.tenantId}`)
  res.json({ success: true })
})

export default router
