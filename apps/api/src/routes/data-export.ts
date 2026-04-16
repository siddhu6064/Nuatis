import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { getExportQueue } from '../workers/export-worker.js'

const router = Router()

const VALID_TABLES = new Set([
  'contacts',
  'activity_log',
  'appointments',
  'deals',
  'quotes',
  'tasks',
])

const DEFAULT_TABLES = ['contacts', 'activity_log', 'appointments', 'deals', 'quotes', 'tasks']

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── POST /api/data-export — start export ─────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const b = req.body as Record<string, unknown>
  const requestedTables = Array.isArray(b['tables']) ? (b['tables'] as unknown[]) : DEFAULT_TABLES

  // Validate all requested tables
  const invalidTables = requestedTables.filter((t) => typeof t !== 'string' || !VALID_TABLES.has(t))
  if (invalidTables.length > 0) {
    res.status(400).json({
      error: `Invalid tables: ${invalidTables.join(', ')}. Valid tables: ${[...VALID_TABLES].join(', ')}`,
    })
    return
  }

  const tables = requestedTables as string[]

  // Rate limit: check for pending/processing export for this tenant
  const { data: existing, error: checkErr } = await supabase
    .from('export_jobs')
    .select('id, status')
    .eq('tenant_id', authed.tenantId)
    .in('status', ['pending', 'processing'])
    .limit(1)

  if (checkErr) {
    res.status(500).json({ error: checkErr.message })
    return
  }

  if (existing && existing.length > 0) {
    res.status(429).json({
      error: 'An export is already in progress. Please wait for it to complete.',
      exportJobId: existing[0]!.id,
    })
    return
  }

  // Insert export_jobs row
  const { data: job, error: insertErr } = await supabase
    .from('export_jobs')
    .insert({
      tenant_id: authed.tenantId,
      requested_by: authed.userId,
      status: 'pending',
      tables_included: tables,
    })
    .select('id')
    .single()

  if (insertErr || !job) {
    res.status(500).json({ error: insertErr?.message ?? 'Failed to create export job' })
    return
  }

  // Enqueue BullMQ job
  try {
    const queue = getExportQueue()
    await queue.add('data-export', {
      tenantId: authed.tenantId,
      exportJobId: job.id,
      requestedBy: authed.userId,
      tables,
    })
  } catch (err) {
    console.error('[data-export] failed to enqueue job:', err)
    await supabase.from('export_jobs').update({ status: 'failed' }).eq('id', job.id)
    res.status(500).json({ error: 'Failed to enqueue export job' })
    return
  }

  res.status(201).json({
    exportJobId: job.id,
    status: 'pending',
    message: 'Export started',
  })
})

// ── GET /api/data-export — list exports ──────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('export_jobs')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ exports: data ?? [] })
})

// ── GET /api/data-export/:id/download — redirect to signed URL ───────────────
router.get('/:id/download', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: job, error } = await supabase
    .from('export_jobs')
    .select('id, status, download_url, expires_at')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !job) {
    res.status(404).json({ error: 'Export job not found' })
    return
  }

  if (job.status !== 'completed') {
    res.status(404).json({ error: 'Export is not ready yet', status: job.status })
    return
  }

  // Check expiry
  if (job.expires_at && new Date(job.expires_at) < new Date()) {
    res.status(410).json({ error: 'Export link has expired' })
    return
  }

  if (!job.download_url) {
    res.status(404).json({ error: 'Download URL not available' })
    return
  }

  res.redirect(302, job.download_url)
})

export default router
