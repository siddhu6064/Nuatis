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

// ── GET /api/calls — list voice sessions for the tenant ──────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const outcome = req.query['outcome'] ? String(req.query['outcome']) : null
  const fromDate = req.query['from_date'] ? String(req.query['from_date']) : null
  const toDate = req.query['to_date'] ? String(req.query['to_date']) : null

  const offset = (page - 1) * limit

  try {
    let query = supabase
      .from('voice_sessions')
      .select(
        'id, tenant_id, stream_id, call_control_id, caller_phone, caller_name, direction, status, started_at, ended_at, duration_seconds, first_response_ms, language_detected, outcome, booked_appointment, appointment_id, contact_id, escalated, escalation_reason, call_quality_mos, hangup_source, hangup_cause, created_at, contacts(full_name)',
        { count: 'exact' }
      )
      .eq('tenant_id', authed.tenantId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (outcome) {
      query = query.eq('outcome', outcome)
    }
    if (fromDate) {
      query = query.gte('started_at', fromDate)
    }
    if (toDate) {
      query = query.lte('started_at', toDate)
    }

    const { data, error, count } = await query

    if (error) {
      console.error(`[calls] list error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch call sessions' })
      return
    }

    const total = count ?? 0
    const pages = Math.ceil(total / limit)

    const sessions = (data ?? []).map((s) => {
      const { contacts, ...rest } = s as typeof s & { contacts?: { full_name?: string } | null }
      return { ...rest, caller_name: contacts?.full_name ?? rest.caller_name ?? null }
    })
    res.json({ sessions, total, page, pages })
  } catch (err) {
    console.error('[calls] list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/calls/metrics ───────────────────────────────────────────────────
router.get('/metrics', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const now = new Date()
  const defaultStart = new Date(now.getTime() - 30 * 86400000).toISOString()
  const startDate =
    typeof req.query['startDate'] === 'string' ? req.query['startDate'] : defaultStart
  const endDate =
    typeof req.query['endDate'] === 'string' ? req.query['endDate'] : now.toISOString()
  const directionFilter =
    typeof req.query['direction'] === 'string' ? req.query['direction'] : 'all'

  let query = supabase
    .from('voice_sessions')
    .select('id, direction, duration_seconds, outcome, escalated, contact_id, started_at')
    .eq('tenant_id', authed.tenantId)
    .gte('started_at', startDate)
    .lte('started_at', endDate)

  if (directionFilter === 'inbound' || directionFilter === 'outbound') {
    query = query.eq('direction', directionFilter)
  }

  const { data: sessions } = await query
  const s = sessions ?? []

  const total = s.length
  const inboundCount = s.filter((x) => (x.direction ?? 'inbound') === 'inbound').length
  const outboundCount = s.filter((x) => x.direction === 'outbound').length
  const answered = s.filter((x) => (x.duration_seconds ?? 0) > 0)
  const answeredPct = total > 0 ? Math.round((answered.length / total) * 100) : 0
  const bookedCount = s.filter((x) => x.outcome === 'booking_made').length
  const bookingRate = total > 0 ? Math.round((bookedCount / total) * 100) : 0
  const escalatedCount = s.filter((x) => x.escalated === true).length
  const escalationRate = total > 0 ? Math.round((escalatedCount / total) * 100) : 0
  const avgDurationSeconds =
    answered.length > 0
      ? Math.round(
          answered.reduce((sum, x) => sum + (x.duration_seconds ?? 0), 0) / answered.length
        )
      : 0

  // callsByDay — fill every date in range
  const dayMap = new Map<string, number>()
  for (const sess of s) {
    const day = (sess.started_at as string).slice(0, 10)
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1)
  }
  const callsByDay: { date: string; count: number }[] = []
  const cur = new Date(startDate)
  cur.setHours(0, 0, 0, 0)
  const endD = new Date(endDate)
  while (cur <= endD) {
    const d = cur.toISOString().slice(0, 10)
    callsByDay.push({ date: d, count: dayMap.get(d) ?? 0 })
    cur.setDate(cur.getDate() + 1)
  }

  // topSources — join contact.source + won deals
  const contactIds = [
    ...new Set(
      s.map((x) => x.contact_id as string | null).filter((id): id is string => id !== null)
    ),
  ]

  let topSources: {
    source: string
    totalCalls: number
    wonDeals: number
    avgDuration: number
  }[] = []

  if (contactIds.length > 0) {
    const [{ data: contacts }, { data: wonDeals }] = await Promise.all([
      supabase.from('contacts').select('id, source').in('id', contactIds),
      supabase
        .from('deals')
        .select('contact_id')
        .eq('tenant_id', authed.tenantId)
        .in('contact_id', contactIds)
        .eq('is_closed_won', true)
        .eq('is_archived', false),
    ])

    const contactSourceMap = new Map<string, string>()
    for (const c of contacts ?? []) {
      contactSourceMap.set(c.id as string, (c.source as string | null) ?? 'unknown')
    }
    const wonContactIds = new Set((wonDeals ?? []).map((d) => d.contact_id as string))

    type SourceAgg = { totalCalls: number; wonDeals: number; totalDuration: number }
    const sourceMap = new Map<string, SourceAgg>()

    for (const sess of s) {
      const cid = sess.contact_id as string | null
      if (!cid) continue
      const src = contactSourceMap.get(cid) ?? 'unknown'
      const agg = sourceMap.get(src) ?? { totalCalls: 0, wonDeals: 0, totalDuration: 0 }
      agg.totalCalls++
      agg.totalDuration += (sess.duration_seconds as number | null) ?? 0
      sourceMap.set(src, agg)
    }
    for (const cid of wonContactIds) {
      const src = contactSourceMap.get(cid)
      if (src) {
        const agg = sourceMap.get(src)
        if (agg) agg.wonDeals++
      }
    }

    topSources = [...sourceMap.entries()]
      .map(([source, agg]) => ({
        source,
        totalCalls: agg.totalCalls,
        wonDeals: agg.wonDeals,
        avgDuration: agg.totalCalls > 0 ? Math.round(agg.totalDuration / agg.totalCalls) : 0,
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, 6)
  }

  res.json({
    totalCalls: total,
    answeredPct,
    bookingRate,
    escalationRate,
    avgDurationSeconds,
    sentimentPct: null,
    callsByDay,
    topSources,
    inboundCount,
    outboundCount,
  })
})

// ── GET /api/calls/:id — get single voice session detail ─────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const sessionId = req.params['id']

  try {
    const { data, error } = await supabase
      .from('voice_sessions')
      .select('*, contacts(full_name)')
      .eq('id', sessionId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Voice session not found' })
      return
    }

    const { contacts, ...rest } = data as typeof data & { contacts?: { full_name?: string } | null }
    res.json({ ...rest, caller_name: contacts?.full_name ?? rest.caller_name ?? null })
  } catch (err) {
    console.error('[calls] detail error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/calls/initiate — stub click-to-call ────────────────────────────
router.post('/initiate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { contactPhone } = req.body as { contactPhone?: string }
  if (!contactPhone) {
    res.status(400).json({ error: 'contactPhone required' })
    return
  }
  res.json({
    success: true,
    message: 'Call initiated',
    phone: contactPhone,
    tenantId: authed.tenantId,
  })
})

export default router
