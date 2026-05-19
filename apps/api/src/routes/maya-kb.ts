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

export default router
