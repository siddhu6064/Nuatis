import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { parseCsv, suggestMapping } from '../lib/csv-parser.js'
import { processImportRows } from '../lib/import-processor.js'
import { getCsvImportQueue } from '../workers/csv-import-worker.js'

const router = Router()
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── POST /api/import/contacts/parse ──────────────────────────────────────────
// Accepts raw CSV text in req.body.csv (string) since we don't have multer
router.post('/contacts/parse', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const csvText = typeof req.body?.csv === 'string' ? req.body.csv : null

  if (!csvText) {
    res.status(400).json({ error: 'csv field is required (string)' })
    return
  }

  if (csvText.length > MAX_FILE_SIZE) {
    res.status(400).json({ error: 'CSV exceeds 5MB limit' })
    return
  }

  const { headers, rows } = parseCsv(csvText)

  if (headers.length === 0) {
    res.status(400).json({ error: 'No headers found in CSV' })
    return
  }

  const suggestedMappingResult = suggestMapping(headers)
  const previewRows = rows.slice(0, 5)

  res.json({
    headers,
    preview_rows: previewRows,
    total_rows: rows.length,
    suggested_mapping: suggestedMappingResult,
  })
})

// ── POST /api/import/contacts ────────────────────────────────────────────────
router.post('/contacts', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const b = req.body as Record<string, unknown>

  const rows = Array.isArray(b['rows']) ? (b['rows'] as Record<string, string>[]) : null
  const mapping =
    b['mapping'] && typeof b['mapping'] === 'object' && !Array.isArray(b['mapping'])
      ? (b['mapping'] as Record<string, string>)
      : null
  const options = (b['options'] as { skip_duplicates?: boolean; update_existing?: boolean }) ?? {}
  const skipDuplicates = options.skip_duplicates !== false
  const updateExisting = options.update_existing === true

  if (!rows || !mapping) {
    res.status(400).json({ error: 'rows and mapping are required' })
    return
  }

  if (rows.length > 5000) {
    res.status(400).json({ error: 'Maximum 5000 rows per import' })
    return
  }

  // Validate that at least one of name/phone/email is mapped
  const mappedFields = new Set(Object.values(mapping))
  if (!mappedFields.has('name') && !mappedFields.has('phone') && !mappedFields.has('email')) {
    res.status(400).json({ error: 'At least one of name, phone, or email must be mapped' })
    return
  }

  // Small import: process synchronously
  if (rows.length <= 100) {
    const result = await processImportRows(authed.tenantId, rows, mapping, {
      skip_duplicates: skipDuplicates,
      update_existing: updateExisting,
    })
    res.json(result)
    return
  }

  // Large import: create job and enqueue
  const supabase = getSupabase()
  const { data: job, error: jobErr } = await supabase
    .from('import_jobs')
    .insert({
      tenant_id: authed.tenantId,
      created_by_user_id: authed.userId,
      filename: `import-${Date.now()}.csv`,
      row_count: rows.length,
      status: 'pending',
      mapping,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    res.status(500).json({ error: jobErr?.message ?? 'Failed to create import job' })
    return
  }

  try {
    const queue = getCsvImportQueue()
    await queue.add('csv-import', {
      jobId: job.id,
      tenantId: authed.tenantId,
      userId: authed.userId,
      rows,
      mapping,
      options: { skip_duplicates: skipDuplicates, update_existing: updateExisting },
    })
  } catch (err) {
    console.error('[import] failed to enqueue job:', err)
    await supabase.from('import_jobs').update({ status: 'failed' }).eq('id', job.id)
    res.status(500).json({ error: 'Failed to enqueue import job' })
    return
  }

  res.json({ job_id: job.id, status: 'processing' })
})

// ── GET /api/import/contacts/jobs ────────────────────────────────────────────
router.get('/contacts/jobs', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('import_jobs')
    .select('*, creator:users!import_jobs_created_by_user_id_fkey(full_name)')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ jobs: data ?? [] })
})

// ── GET /api/import/contacts/jobs/:jobId ─────────────────────────────────────
router.get(
  '/contacts/jobs/:jobId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: job, error } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('id', req.params['jobId'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !job) {
      res.status(404).json({ error: 'Import job not found' })
      return
    }

    res.json(job)
  }
)

export default router
