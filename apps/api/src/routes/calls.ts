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
        'id, tenant_id, stream_id, call_control_id, caller_phone, caller_name, direction, status, started_at, ended_at, duration_seconds, first_response_ms, language_detected, outcome, booked_appointment, appointment_id, contact_id, escalated, escalation_reason, call_quality_mos, hangup_source, hangup_cause, created_at',
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

    res.json({ sessions: data ?? [], total, page, pages })
  } catch (err) {
    console.error('[calls] list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/calls/:id — get single voice session detail ─────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const sessionId = req.params['id']

  try {
    const { data, error } = await supabase
      .from('voice_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Voice session not found' })
      return
    }

    res.json(data)
  } catch (err) {
    console.error('[calls] detail error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
