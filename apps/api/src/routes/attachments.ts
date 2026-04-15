/**
 * Contact file attachments API.
 * Storage bucket 'contact-attachments' must be created in Supabase Dashboard → Storage → New bucket (private).
 * Files are uploaded as base64 JSON payloads to avoid needing multer.
 */
import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

const router = Router()
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const BUCKET = 'contact-attachments'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

// ── POST /api/contacts/:contactId/attachments ────────────────────────────────
router.post(
  '/:contactId/attachments',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

    // Verify contact belongs to tenant
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    const b = req.body as Record<string, unknown>
    const fileData = typeof b['file_data'] === 'string' ? b['file_data'] : null // base64
    const fileName = typeof b['filename'] === 'string' ? b['filename'] : null
    const fileType = typeof b['file_type'] === 'string' ? b['file_type'] : null

    if (!fileData || !fileName || !fileType) {
      res.status(400).json({ error: 'file_data (base64), filename, and file_type are required' })
      return
    }

    if (!ALLOWED_TYPES.has(fileType)) {
      res.status(400).json({
        error: `File type '${fileType}' not allowed. Accepted: jpg, png, gif, webp, pdf, doc, docx`,
      })
      return
    }

    const buffer = Buffer.from(fileData, 'base64')
    if (buffer.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: 'File exceeds 10MB limit' })
      return
    }

    const sanitized = sanitizeFilename(fileName)
    const storagePath = `${authed.tenantId}/contacts/${contactId}/${randomUUID()}-${sanitized}`

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: fileType })

    if (uploadErr) {
      res.status(500).json({ error: `Upload failed: ${uploadErr.message}` })
      return
    }

    const { data: attachment, error: insertErr } = await supabase
      .from('contact_attachments')
      .insert({
        tenant_id: authed.tenantId,
        contact_id: contactId,
        filename: sanitized,
        original_filename: fileName,
        file_type: fileType,
        file_size: buffer.length,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        uploaded_by_user_id: authed.userId,
      })
      .select()
      .single()

    if (insertErr) {
      // Clean up uploaded file
      await supabase.storage.from(BUCKET).remove([storagePath])
      res.status(500).json({ error: insertErr.message })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      contactId,
      type: 'system',
      body: `File attached: "${fileName}"`,
      actorType: 'user',
      actorId: authed.userId,
    })

    res.status(201).json(attachment)
  }
)

// ── GET /api/contacts/:contactId/attachments ─────────────────────────────────
router.get(
  '/:contactId/attachments',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId } = req.params

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    const { data: attachments, error } = await supabase
      .from('contact_attachments')
      .select('*')
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // Generate signed URLs
    const withUrls = await Promise.all(
      (attachments ?? []).map(async (a) => {
        const { data: urlData } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(a.storage_path, 3600)
        return { ...a, signed_url: urlData?.signedUrl ?? null }
      })
    )

    res.json({ attachments: withUrls })
  }
)

// ── DELETE /api/contacts/:contactId/attachments/:attachmentId ────────────────
router.delete(
  '/:contactId/attachments/:attachmentId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { contactId, attachmentId } = req.params

    const { data: attachment } = await supabase
      .from('contact_attachments')
      .select('id, storage_path')
      .eq('id', attachmentId)
      .eq('contact_id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' })
      return
    }

    await supabase.storage.from(BUCKET).remove([attachment.storage_path])
    await supabase.from('contact_attachments').delete().eq('id', attachmentId)

    res.json({ deleted: true })
  }
)

export default router
