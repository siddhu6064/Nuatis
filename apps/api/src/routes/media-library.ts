import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { randomUUID } from 'node:crypto'

const router = Router()
const BUCKET = 'media-library'
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// POST /api/media/upload — raw binary, image/* only, max 10MB
// Registered before GET / to avoid path conflict
router.post('/upload', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.startsWith('image/')) {
    res.status(400).json({ error: 'Only image/* MIME types accepted' })
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', async () => {
    const body = Buffer.concat(chunks)
    if (body.length > MAX_SIZE_BYTES) {
      res.status(400).json({ error: 'File too large (max 10MB)' })
      return
    }

    const supabase = getSupabase()
    const ext = contentType.split('/')[1] ?? 'png'
    const fileName =
      (req.headers['x-file-name'] as string | undefined) ?? `upload-${Date.now()}.${ext}`
    const storagePath = `${authed.tenantId}/${randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, body, { contentType, upsert: false })

    if (uploadErr) {
      res.status(500).json({ error: uploadErr.message })
      return
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl ?? null

    const { data: fileRow, error: insertErr } = await supabase
      .from('media_files')
      .insert({
        tenant_id: authed.tenantId,
        file_name: fileName,
        file_size: body.length,
        mime_type: contentType,
        storage_path: storagePath,
        public_url: publicUrl,
        tags: [],
      })
      .select()
      .single()

    if (insertErr) {
      res.status(500).json({ error: insertErr.message })
      return
    }

    res.status(201).json(fileRow)
  })
})

// GET /api/media — list files for tenant with optional mime_type filter and pagination
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { mime_type, page = '1', limit = '50' } = req.query as Record<string, string>
  const supabase = getSupabase()
  const pageNum = Math.max(1, parseInt(page, 10))
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)))
  const from = (pageNum - 1) * limitNum
  const to = from + limitNum - 1

  let query = supabase
    .from('media_files')
    .select('*', { count: 'exact' })
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (mime_type) query = query.ilike('mime_type', `${mime_type}%`)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ files: data ?? [], total: count ?? 0, page: pageNum, limit: limitNum })
})

// DELETE /api/media/:id — remove from storage and DB
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { data: file, error: fetchErr } = await supabase
    .from('media_files')
    .select('id, storage_path')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!file) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  await supabase.storage.from(BUCKET).remove([file.storage_path as string])

  const { error: deleteErr } = await supabase
    .from('media_files')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (deleteErr) {
    res.status(500).json({ error: deleteErr.message })
    return
  }
  res.json({ ok: true })
})

export default router
