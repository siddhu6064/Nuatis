import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { generateTriggerSlug } from '../lib/slugify.js'

const router = Router()
const publicRouter = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3001'

// ── GET /api/trigger-links ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('trigger_links')
    .select('id, name, slug, action, click_count, created_at')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ trigger_links: data ?? [] })
})

// ── POST /api/trigger-links ───────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const action = typeof b['action'] === 'string' ? b['action'] : ''
  const validActions = [
    'confirm_appointment',
    'cancel_appointment',
    'mark_contacted',
    'mark_won',
    'mark_lost',
    'custom_webhook',
  ]
  if (!validActions.includes(action)) {
    res.status(400).json({ error: 'invalid action' })
    return
  }

  const actionConfig =
    b['action_config'] &&
    typeof b['action_config'] === 'object' &&
    !Array.isArray(b['action_config'])
      ? (b['action_config'] as Record<string, unknown>)
      : {}

  let slug: string
  try {
    slug = await generateTriggerSlug()
  } catch {
    res.status(500).json({ error: 'Could not generate unique slug' })
    return
  }

  const { data, error } = await supabase
    .from('trigger_links')
    .insert({ tenant_id: authed.tenantId, name, slug, action, action_config: actionConfig })
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({
    trigger_link: data,
    short_url: `${API_BASE_URL}/t/${slug}`,
  })
})

// ── PUT /api/trigger-links/:id ────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params as { id: string }
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('trigger_links')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b['name'] === 'string' && b['name'].trim()) updates['name'] = b['name'].trim()
  if (typeof b['action'] === 'string') updates['action'] = b['action']
  if (
    b['action_config'] &&
    typeof b['action_config'] === 'object' &&
    !Array.isArray(b['action_config'])
  ) {
    updates['action_config'] = b['action_config']
  }

  const { data, error } = await supabase
    .from('trigger_links')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ trigger_link: data })
})

// ── DELETE /api/trigger-links/:id ─────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params as { id: string }

  const { data: existing } = await supabase
    .from('trigger_links')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const { error } = await supabase.from('trigger_links').delete().eq('id', id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(204).send()
})

// ── PUBLIC: GET /t/:slug ──────────────────────────────────────────────────────
publicRouter.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params as { slug: string }
  const supabase = getSupabase()

  const { data: link } = await supabase
    .from('trigger_links')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (!link) {
    res.status(404).send('<html><body><p>This link is no longer active.</p></body></html>')
    return
  }

  const contactId = typeof req.query['cid'] === 'string' ? req.query['cid'] : null
  const ip =
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    null
  const userAgent = req.headers['user-agent'] ?? null

  // Insert event
  await supabase.from('trigger_link_events').insert({
    trigger_link_id: link.id,
    tenant_id: link.tenant_id,
    contact_id: contactId,
    ip_address: ip,
    user_agent: userAgent,
  })

  // Increment click_count (RPC with direct-update fallback)
  try {
    await supabase.rpc('increment_trigger_link_click', { link_id: link.id })
  } catch {
    await supabase
      .from('trigger_links')
      .update({ click_count: (link.click_count as number) + 1 })
      .eq('id', link.id)
  }

  // Execute action
  const config = (link.action_config ?? {}) as Record<string, unknown>
  const action: string = link.action

  if (action === 'confirm_appointment') {
    const apptId = config['appointment_id'] as string | undefined
    if (apptId) {
      await supabase.from('appointments').update({ status: 'confirmed' }).eq('id', apptId)
    } else if (contactId) {
      await supabase
        .from('appointments')
        .update({ status: 'confirmed' })
        .eq('contact_id', contactId)
        .eq('tenant_id', link.tenant_id)
        .in('status', ['pending', 'scheduled'])
        .order('start_time', { ascending: true })
        .limit(1)
    }
  } else if (action === 'cancel_appointment') {
    const apptId = config['appointment_id'] as string | undefined
    if (apptId) {
      await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', apptId)
    }
  } else if (action === 'mark_contacted') {
    if (contactId) {
      await supabase
        .from('contacts')
        .update({ last_contacted_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('tenant_id', link.tenant_id)
    }
  } else if (action === 'mark_won') {
    if (contactId) {
      const { data: deals } = await supabase
        .from('deals')
        .select('id')
        .eq('contact_id', contactId)
        .eq('tenant_id', link.tenant_id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (deals?.[0]) {
        await supabase.from('deals').update({ status: 'won' }).eq('id', deals[0].id)
      }
    }
  } else if (action === 'mark_lost') {
    if (contactId) {
      const { data: deals } = await supabase
        .from('deals')
        .select('id')
        .eq('contact_id', contactId)
        .eq('tenant_id', link.tenant_id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (deals?.[0]) {
        await supabase.from('deals').update({ status: 'lost' }).eq('id', deals[0].id)
      }
    }
  } else if (action === 'custom_webhook') {
    const webhookUrl = config['webhook_url'] as string | undefined
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_link_id: link.id,
          contact_id: contactId,
          clicked_at: new Date().toISOString(),
          metadata: {},
        }),
      }).catch(() => {
        /* fire-and-forget */
      })
    }
  }

  const redirectUrl = config['redirect_url'] as string | undefined
  if (redirectUrl) {
    res.redirect(302, redirectUrl)
  } else {
    res.send("<html><body><p>Got it — you're all set.</p></body></html>")
  }
})

export default router
export { publicRouter as triggerLinkPublicRouter }
