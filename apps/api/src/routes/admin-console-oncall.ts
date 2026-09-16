import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth } from '../lib/auth.js'
import { requirePlatformOwner } from '../lib/platform-auth.js'
import { whoIsOnCallAt } from '../lib/oncall.js'

const router = Router()
router.use(requireAuth, requirePlatformOwner)

// ── GET /api/admin-console/oncall/now ────────────────────────────────────────
// Declared before the '/:id'-shaped routes so 'now' is never read as an id.
router.get('/now', async (_req: Request, res: Response): Promise<void> => {
  const userId = await whoIsOnCallAt(new Date())
  if (!userId) {
    // An empty rota is a real operational state, and the caller should be able
    // to say "nobody is on call" rather than render a blank name.
    res.json({ user_id: null, user: null })
    return
  }
  const supabase = getServiceClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle<{ id: string; full_name: string }>()
  res.json({ user_id: userId, user: user ?? null })
})

// ── GET /api/admin-console/oncall ────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const from = typeof req.query['from'] === 'string' ? req.query['from'] : null
  const to = typeof req.query['to'] === 'string' ? req.query['to'] : null

  let query = supabase.from('platform_oncall_shifts').select('*')
  // A shift overlaps the window when it ends after the window starts and
  // starts before the window ends.
  if (from) query = query.gte('ends_at', from)
  if (to) query = query.lte('starts_at', to)

  const { data, error } = await query.order('starts_at', { ascending: true })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ shifts: data ?? [] })
})

// ── POST /api/admin-console/oncall ───────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const userId = typeof body['user_id'] === 'string' ? body['user_id'] : ''
  const startsAt = typeof body['starts_at'] === 'string' ? body['starts_at'] : ''
  const endsAt = typeof body['ends_at'] === 'string' ? body['ends_at'] : ''

  if (!userId || !startsAt || !endsAt) {
    res.status(400).json({ error: 'user_id, starts_at and ends_at are required' })
    return
  }
  // NaN from an unparseable date fails this comparison, so a garbage date is
  // refused here rather than reaching the column's CHECK as a 500.
  if (!(Date.parse(endsAt) > Date.parse(startsAt))) {
    res.status(400).json({ error: 'ends_at must be after starts_at' })
    return
  }

  // users.id is a plain FK with no tenant in it. Putting a merchant's account
  // on the Nuatis rota would assign them incidents they can never see.
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('tenant_id', process.env['PLATFORM_TENANT_ID'] ?? '')
    .maybeSingle<{ id: string }>()

  if (!user) {
    res.status(400).json({ error: 'That user is not on the platform team' })
    return
  }

  const { data, error } = await supabase
    .from('platform_oncall_shifts')
    .insert({
      user_id: userId,
      starts_at: startsAt,
      ends_at: endsAt,
      is_override: body['is_override'] === true,
      note: typeof body['note'] === 'string' ? body['note'] : null,
    })
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create shift' })
    return
  }
  res.status(201).json({ shift: data })
})

// ── DELETE /api/admin-console/oncall/:id ─────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('platform_oncall_shifts')
    .delete()
    .eq('id', req.params['id'])
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
