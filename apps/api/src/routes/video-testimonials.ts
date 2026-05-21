import { randomBytes } from 'crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import multer from 'multer'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── PUBLIC ROUTES ──────────────────────────────────────────────────────────

// GET /api/video-testimonials/collect/:slug
router.get('/collect/:slug', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
  const { data: collector } = await supabase
    .from('video_collectors')
    .select('id, name, prompt, max_duration_seconds, status, tenant_id, tenants(name)')
    .eq('slug', req.params['slug'])
    .maybeSingle()

  if (!collector || collector.status !== 'active') {
    res.json({ valid: false })
    return
  }

  const tenant = collector.tenants as unknown as { name: string | null } | null
  res.json({
    valid: true,
    collector: {
      id: collector.id,
      name: collector.name,
      prompt: collector.prompt,
      max_duration_seconds: collector.max_duration_seconds,
      tenant_name: tenant?.name ?? null,
    },
  })
})

// POST /api/video-testimonials/collect/:slug
router.post(
  '/collect/:slug',
  upload.single('video'),
  async (req: Request, res: Response): Promise<void> => {
    const supabase = getSupabase()

    // 1. Find collector
    const { data: collector } = await supabase
      .from('video_collectors')
      .select('id, tenant_id, status')
      .eq('slug', req.params['slug'])
      .maybeSingle()

    if (!collector || collector.status !== 'active') {
      res.status(404).json({ error: 'Collector not found or inactive' })
      return
    }

    // 2. Validate file
    if (!req.file) {
      res.status(400).json({ error: 'Video file is required' })
      return
    }
    if (!req.file.mimetype.startsWith('video/')) {
      res.status(400).json({ error: 'File must be a video' })
      return
    }

    // 3. Generate storage path
    const ext = req.file.mimetype.includes('mp4') ? 'mp4' : 'webm'
    const fileId = randomBytes(16).toString('hex')
    const storagePath = `${collector.tenant_id}/${collector.id}/${fileId}.${ext}`

    // 4. Ensure bucket exists + upload
    await supabase.storage
      .createBucket('video-testimonials', { public: false })
      .catch(() => null)

    const { error: uploadErr } = await supabase.storage
      .from('video-testimonials')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      })

    if (uploadErr) {
      console.error('[video-testimonials] upload error:', uploadErr)
      res.status(500).json({ error: 'Failed to upload video' })
      return
    }

    // 5. Insert testimonial row
    const name = (req.body as Record<string, string>)['name'] ?? null
    const email = (req.body as Record<string, string>)['email'] ?? null

    const { data: testimonial } = await supabase
      .from('video_testimonials')
      .insert({
        tenant_id: collector.tenant_id,
        collector_id: collector.id,
        submitter_name: name,
        submitter_email: email,
        storage_path: storagePath,
        status: 'pending',
      })
      .select('id')
      .single()

    // 6. Increment submission_count (simple read-then-write)
    const { data: cur } = await supabase
      .from('video_collectors')
      .select('submission_count')
      .eq('id', collector.id)
      .single()
    try {
      await supabase
        .from('video_collectors')
        .update({
          submission_count:
            ((cur as { submission_count: number } | null)?.submission_count ?? 0) + 1,
        })
        .eq('id', collector.id)
    } catch {
      // increment failure is non-fatal
    }

    // 7. Fire async transcript generation
    if (testimonial) {
      import('../lib/video-testimonial-processor.js')
        .then(({ generateTranscriptAndSentiment }) =>
          generateTranscriptAndSentiment(testimonial.id)
        )
        .catch(() => null)
    }

    res.json({ success: true, message: 'Thank you for your video!' })
  }
)

// ── TENANT-AUTHENTICATED ROUTES ────────────────────────────────────────────

// GET /api/video-testimonials/collectors
router.get('/collectors', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { data } = await supabase
    .from('video_collectors')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
  res.json({ collectors: data ?? [] })
})

// POST /api/video-testimonials/collectors
router.post('/collectors', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { name, prompt, max_duration_seconds } = req.body as {
    name?: string
    prompt?: string
    max_duration_seconds?: number
  }
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const supabase = getSupabase()
  const slug = randomBytes(8).toString('hex')

  const { data, error } = await supabase
    .from('video_collectors')
    .insert({
      tenant_id: authed.tenantId,
      name: name.trim(),
      slug,
      prompt: prompt ?? 'Tell us about your experience!',
      max_duration_seconds: max_duration_seconds ?? 30,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: 'Failed to create collector' })
    return
  }
  res.status(201).json({ collector: data })
})

// PUT /api/video-testimonials/collectors/:id
router.put(
  '/collectors/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const { name, prompt, max_duration_seconds, status } = req.body as Record<string, unknown>
    const supabase = getSupabase()
    const updates: Record<string, unknown> = {}
    if (typeof name === 'string') updates['name'] = name.trim()
    if (typeof prompt === 'string') updates['prompt'] = prompt
    if (typeof max_duration_seconds === 'number')
      updates['max_duration_seconds'] = max_duration_seconds
    if (typeof status === 'string' && ['active', 'paused'].includes(status))
      updates['status'] = status

    const { data, error } = await supabase
      .from('video_collectors')
      .update(updates)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Collector not found' })
      return
    }
    res.json({ collector: data })
  }
)

// DELETE /api/video-testimonials/collectors/:id (archive)
router.delete(
  '/collectors/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    await supabase
      .from('video_collectors')
      .update({ status: 'archived' })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
    res.json({ ok: true })
  }
)

// GET /api/video-testimonials/ (list testimonials)
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { collector_id, status } = req.query
  const supabase = getSupabase()

  let query = supabase
    .from('video_testimonials')
    .select(
      'id, submitter_name, submitter_email, status, sentiment, duration_seconds, submitted_at, collector_id, storage_path'
    )
    .eq('tenant_id', authed.tenantId)
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (collector_id && typeof collector_id === 'string')
    query = query.eq('collector_id', collector_id)
  if (status && typeof status === 'string') query = query.eq('status', status)

  const { data } = await query
  res.json({ testimonials: data ?? [] })
})

// GET /api/video-testimonials/:id (single + signed URL)
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: testimonial } = await supabase
    .from('video_testimonials')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!testimonial) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  // Generate signed URL (5 min)
  const { data: signed } = await supabase.storage
    .from('video-testimonials')
    .createSignedUrl((testimonial as { storage_path: string }).storage_path, 300)

  res.json({
    testimonial: {
      ...testimonial,
      signed_url: signed?.signedUrl ?? null,
    },
  })
})

// Helper: update testimonial status
async function updateStatus(req: Request, res: Response, status: string): Promise<void> {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('video_testimonials')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('id, status')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({ ok: true, status })
}

router.post('/:id/approve', requireAuth, (req, res) => updateStatus(req, res, 'approved'))
router.post('/:id/reject', requireAuth, (req, res) => updateStatus(req, res, 'rejected'))
router.post('/:id/feature', requireAuth, (req, res) => updateStatus(req, res, 'featured'))

// DELETE /api/video-testimonials/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: testimonial } = await supabase
    .from('video_testimonials')
    .select('storage_path')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!testimonial) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  // Delete from storage
  await supabase.storage
    .from('video-testimonials')
    .remove([(testimonial as { storage_path: string }).storage_path])
    .catch(() => null)

  // Delete from DB
  await supabase
    .from('video_testimonials')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  res.json({ ok: true })
})

export default router
