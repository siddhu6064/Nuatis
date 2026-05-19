import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const VALID_MODES = ['round_robin', 'load_balanced']

interface LocationRef {
  id: string
  name: string
}

interface MemberRow {
  location_id: string
  position: number
  locations: LocationRef | LocationRef[] | null
}

function locName(locations: LocationRef | LocationRef[] | null | undefined): string {
  if (!locations) return ''
  if (Array.isArray(locations)) return locations[0]?.name ?? ''
  return locations.name
}

// GET /api/calendar-groups
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: groups, error } = await supabase
    .from('calendar_groups')
    .select(
      'id, name, description, assignment_mode, last_assigned_index, created_at, calendar_group_members(location_id, position, locations(id, name))'
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const result = (groups ?? []).map((g) => {
    const members = ((g.calendar_group_members as MemberRow[]) ?? []).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    )
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      assignment_mode: g.assignment_mode,
      last_assigned_index: g.last_assigned_index,
      created_at: g.created_at,
      member_count: members.length,
      members: members.map((m) => ({
        location_id: m.location_id,
        position: m.position,
        location_name: locName(m.locations),
      })),
    }
  })

  res.json({ groups: result })
})

// POST /api/calendar-groups
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const assignment_mode =
    typeof b['assignment_mode'] === 'string' ? b['assignment_mode'] : 'round_robin'
  if (!VALID_MODES.includes(assignment_mode)) {
    res.status(400).json({ error: 'assignment_mode must be round_robin or load_balanced' })
    return
  }

  const { data, error } = await supabase
    .from('calendar_groups')
    .insert({
      tenant_id: authed.tenantId,
      name,
      description: (b['description'] as string) || null,
      assignment_mode,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// PATCH /api/calendar-groups/:id
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (b['description'] !== undefined) updates['description'] = b['description'] || null
  if (typeof b['assignment_mode'] === 'string') {
    if (!VALID_MODES.includes(b['assignment_mode'])) {
      res.status(400).json({ error: 'assignment_mode must be round_robin or load_balanced' })
      return
    }
    updates['assignment_mode'] = b['assignment_mode']
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('calendar_groups')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

// DELETE /api/calendar-groups/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('calendar_groups')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

// POST /api/calendar-groups/:id/members
router.post('/:id/members', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const locationId = typeof b['locationId'] === 'string' ? b['locationId'] : ''
  if (!locationId) {
    res.status(400).json({ error: 'locationId is required' })
    return
  }

  const { data: group } = await supabase
    .from('calendar_groups')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!group) {
    res.status(404).json({ error: 'Group not found' })
    return
  }

  const { data: existing } = await supabase
    .from('calendar_group_members')
    .select('position')
    .eq('group_id', req.params['id'])
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = ((existing?.[0]?.position as number | undefined) ?? -1) + 1

  const { error } = await supabase.from('calendar_group_members').insert({
    group_id: req.params['id'],
    location_id: locationId,
    position: nextPosition,
  })

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Location is already in this group' })
    } else {
      res.status(500).json({ error: error.message })
    }
    return
  }

  res.status(201).json({ added: true })
})

// PUT /api/calendar-groups/:id/members/order — batch reorder
router.put(
  '/:id/members/order',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    if (!Array.isArray(b['order'])) {
      res.status(400).json({ error: 'order must be an array of locationIds' })
      return
    }

    const { data: group } = await supabase
      .from('calendar_groups')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const updates = (b['order'] as string[]).map((locationId, index) => ({
      group_id: req.params['id'],
      location_id: locationId,
      position: index,
    }))

    const { error } = await supabase
      .from('calendar_group_members')
      .upsert(updates, { onConflict: 'group_id,location_id' })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ updated: true })
  }
)

// DELETE /api/calendar-groups/:id/members/:locationId
router.delete(
  '/:id/members/:locationId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: group } = await supabase
      .from('calendar_groups')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const { error } = await supabase
      .from('calendar_group_members')
      .delete()
      .eq('group_id', req.params['id'])
      .eq('location_id', req.params['locationId'])

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ removed: true })
  }
)

// POST /api/calendar-groups/:id/assign — get next assignee
router.post('/:id/assign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: group, error: groupError } = await supabase
    .from('calendar_groups')
    .select('id, assignment_mode, last_assigned_index')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (groupError || !group) {
    res.status(404).json({ error: 'Group not found' })
    return
  }

  const { data: members, error: membersError } = await supabase
    .from('calendar_group_members')
    .select('location_id, position, locations(id, name)')
    .eq('group_id', req.params['id'])
    .order('position', { ascending: true })

  if (membersError || !members || members.length === 0) {
    res.status(400).json({ error: 'Group has no members' })
    return
  }

  let assignedIndex = 0

  if (group.assignment_mode === 'load_balanced') {
    const now = new Date()
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const locationIds = members.map((m) => m.location_id)

    const { data: appts } = await supabase
      .from('appointments')
      .select('location_id')
      .in('location_id', locationIds)
      .gte('start_time', now.toISOString())
      .lte('start_time', weekOut.toISOString())
      .eq('status', 'scheduled')

    const counts = new Map<string, number>()
    for (const m of members) counts.set(m.location_id, 0)
    for (const a of appts ?? []) {
      if (a.location_id) counts.set(a.location_id, (counts.get(a.location_id) ?? 0) + 1)
    }

    let minCount = Infinity
    members.forEach((m, i) => {
      const c = counts.get(m.location_id) ?? 0
      if (c < minCount) {
        minCount = c
        assignedIndex = i
      }
    })
  } else {
    assignedIndex = (((group.last_assigned_index as number | null) ?? 0) + 1) % members.length
  }

  await supabase
    .from('calendar_groups')
    .update({ last_assigned_index: assignedIndex })
    .eq('id', req.params['id'])

  const assigned = members[assignedIndex] as MemberRow | undefined
  res.json({
    locationId: assigned?.location_id,
    locationName: locName(assigned?.locations),
  })
})

export default router
