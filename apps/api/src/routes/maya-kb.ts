import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { extractPdfText } from '../voice/maya-kb-extractor.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  },
})

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function ensureBucket(): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.storage.createBucket('maya-kb', { public: false })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    console.warn('[maya-kb] bucket create warning:', error.message)
  }
}

// ── GET /api/maya-kb — list files for tenant ─────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('maya_kb_files')
      .select('id, file_name, file_size, status, created_at')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: 'Failed to fetch files' })
      return
    }

    res.json({ files: data ?? [] })
  } catch (err) {
    console.error('[maya-kb] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/maya-kb/upload ──────────────────────────────────────────────────
router.post(
  '/upload',
  requireAuth,
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File too large (max 10MB)' })
        return
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const file = req.file

    if (!file) {
      res.status(400).json({ error: 'No file provided' })
      return
    }

    const supabase = getSupabase()

    try {
      await ensureBucket()

      const id = crypto.randomUUID()
      const storagePath = `${authed.tenantId}/${id}.pdf`

      const { error: uploadError } = await supabase.storage
        .from('maya-kb')
        .upload(storagePath, file.buffer, { contentType: 'application/pdf' })

      if (uploadError) {
        console.error('[maya-kb] storage upload error:', uploadError.message)
        res.status(500).json({ error: 'Storage upload failed' })
        return
      }

      const { error: dbError } = await supabase.from('maya_kb_files').insert({
        id,
        tenant_id: authed.tenantId,
        file_name: file.originalname,
        file_size: file.size,
        storage_path: storagePath,
        status: 'pending',
      })

      if (dbError) {
        // Clean up orphaned storage object
        await supabase.storage.from('maya-kb').remove([storagePath])
        console.error('[maya-kb] DB insert error:', dbError.message)
        res.status(500).json({ error: 'Failed to save file record' })
        return
      }

      // Fire-and-forget extraction — never await
      extractPdfText({ id, storage_path: storagePath }).catch((err: unknown) =>
        console.error('[maya-kb] extraction error:', err)
      )

      console.info(
        `[maya-kb] uploaded file=${file.originalname} id=${id} tenant=${authed.tenantId}`
      )
      res.json({ id, file_name: file.originalname, status: 'pending' })
    } catch (err) {
      console.error('[maya-kb] upload error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ── DELETE /api/maya-kb/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getSupabase()

  try {
    const { data: file } = await supabase
      .from('maya_kb_files')
      .select('storage_path')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ storage_path: string }>()

    if (!file) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    await supabase.storage.from('maya-kb').remove([file.storage_path])

    await supabase.from('maya_kb_files').delete().eq('id', id).eq('tenant_id', authed.tenantId)

    console.info(`[maya-kb] deleted file id=${id} tenant=${authed.tenantId}`)
    res.json({ success: true })
  } catch (err) {
    console.error('[maya-kb] DELETE error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/maya-kb/urls — add a URL to crawl ──────────────────────────────
router.post('/urls', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { url } = req.body as { url?: string }

  if (!url?.trim()) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  // Validate URL format
  let normalized = url.trim()
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    res.status(400).json({ error: 'URL must start with http:// or https://' })
    return
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    res.status(400).json({ error: 'Invalid URL format' })
    return
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.status(400).json({ error: 'URL must use http or https' })
    return
  }

  // Strip trailing slash
  normalized = normalized.replace(/\/$/, '')

  const supabase = getSupabase()

  // Max 3 URLs per tenant
  const { count } = await supabase
    .from('maya_kb_urls')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
  if ((count ?? 0) >= 3) {
    res.status(400).json({ error: 'Maximum 3 URLs allowed per tenant' })
    return
  }

  // Insert (catch duplicate)
  const { data, error } = await supabase
    .from('maya_kb_urls')
    .insert({ tenant_id: authed.tenantId, url: normalized })
    .select('id, url, status, pages_crawled, last_crawled_at, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'URL already added for this account' })
      return
    }
    res.status(500).json({ error: 'Failed to add URL' })
    return
  }

  // Fire crawl async
  import('../lib/url-crawler.js')
    .then(({ crawlUrl }) =>
      crawlUrl({ tenantId: authed.tenantId, urlRecordId: data.id, rootUrl: normalized })
    )
    .catch((err) => console.error('[maya-kb] crawl error:', err))

  res.status(201).json(data)
})

// ── GET /api/maya-kb/urls — list URLs for tenant ─────────────────────────────
router.get('/urls', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data } = await supabase
    .from('maya_kb_urls')
    .select('id, url, status, pages_crawled, error_message, last_crawled_at, created_at')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  res.json({ urls: data ?? [] })
})

// ── DELETE /api/maya-kb/urls/:id — remove a URL ───────────────────────────────
router.delete('/urls/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('maya_kb_urls')
    .delete()
    .eq('id', req.params.id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({ ok: true })
})

// ── POST /api/maya-kb/urls/:id/refresh — re-crawl a URL ──────────────────────
router.post(
  '/urls/:id/refresh',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Fetch the record first
    const { data: record } = await supabase
      .from('maya_kb_urls')
      .select('id, url')
      .eq('id', req.params.id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!record) {
      res.status(404).json({ error: 'URL not found' })
      return
    }

    // Reset to pending
    await supabase
      .from('maya_kb_urls')
      .update({
        status: 'pending',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)

    // Fire crawl async
    const urlStr = (record as { url: string }).url
    const recordId = req.params.id as string
    import('../lib/url-crawler.js')
      .then(({ crawlUrl }) =>
        crawlUrl({
          tenantId: authed.tenantId,
          urlRecordId: recordId,
          rootUrl: urlStr,
        })
      )
      .catch((err) => console.error('[maya-kb] crawl error:', err))

    res.json({ status: 'pending' })
  }
)

export default router
