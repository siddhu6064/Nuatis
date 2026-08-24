/**
 * Expenses API.
 * Storage bucket 'expense-receipts' must be created in Supabase Dashboard → Storage → New bucket (private).
 * Receipts are uploaded as base64 JSON payloads to avoid needing multer.
 */
import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'
import { logActivity } from '../lib/activity.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'
import { generateExpenseNumber } from '../lib/expense-number.js'

const router = Router()
router.use(requireAuth, requirePlan('expenses'))

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const BUCKET = 'expense-receipts'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

interface ReceiptInput {
  fileData: string
  fileName: string
  fileType: string
}

function parseReceiptInput(b: Record<string, unknown>): ReceiptInput | null {
  const fileData = typeof b['receipt_data'] === 'string' ? b['receipt_data'] : null
  const fileName = typeof b['receipt_filename'] === 'string' ? b['receipt_filename'] : null
  const fileType = typeof b['receipt_file_type'] === 'string' ? b['receipt_file_type'] : null
  if (!fileData || !fileName || !fileType) return null
  return { fileData, fileName, fileType }
}

/** Uploads a receipt to storage and returns the 4 receipt_* columns to persist.
 *  Returns an error string instead of throwing so callers can 400 cleanly. */
async function uploadReceipt(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  expenseId: string,
  input: ReceiptInput
): Promise<{ columns: Record<string, unknown> } | { error: string }> {
  if (!ALLOWED_TYPES.has(input.fileType)) {
    return {
      error: `File type '${input.fileType}' not allowed. Accepted: jpg, png, gif, webp, pdf, doc, docx`,
    }
  }

  const buffer = Buffer.from(input.fileData, 'base64')
  if (buffer.length > MAX_FILE_SIZE) {
    return { error: 'File exceeds 10MB limit' }
  }

  const sanitized = sanitizeFilename(input.fileName)
  const storagePath = `${tenantId}/expenses/${expenseId}/${randomUUID()}-${sanitized}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: input.fileType })

  if (uploadErr) {
    return { error: `Upload failed: ${uploadErr.message}` }
  }

  return {
    columns: {
      receipt_storage_path: storagePath,
      receipt_filename: sanitized,
      receipt_file_type: input.fileType,
      receipt_file_size: buffer.length,
    },
  }
}

async function withSignedReceiptUrl<T extends { receipt_storage_path: string | null }>(
  supabase: ReturnType<typeof getServiceClient>,
  row: T
): Promise<T & { receipt_signed_url: string | null }> {
  if (!row.receipt_storage_path) return { ...row, receipt_signed_url: null }
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.receipt_storage_path, 3600)
  return { ...row, receipt_signed_url: data?.signedUrl ?? null }
}

// ── GET /api/expenses ────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const countOnly = req.query['count'] === 'true'
  const categoryId = typeof req.query['category_id'] === 'string' ? req.query['category_id'] : ''
  const from = typeof req.query['from'] === 'string' ? req.query['from'] : ''
  const to = typeof req.query['to'] === 'string' ? req.query['to'] : ''
  const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : ''

  if (countOnly) {
    let countQuery = supabase
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
    if (categoryId) countQuery = countQuery.eq('category_id', categoryId)
    const { count, error } = await countQuery
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ count: count ?? 0 })
    return
  }

  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from_ = (page - 1) * limit
  const to_ = from_ + limit - 1

  let query = supabase
    .from('expenses')
    .select('*, expense_categories(name)', { count: 'exact' })
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)

  if (categoryId) query = query.eq('category_id', categoryId)
  if (from) query = query.gte('expense_date', from)
  if (to) query = query.lte('expense_date', to)
  if (q) query = query.ilike('vendor', `%${q}%`)

  query = query.order('expense_date', { ascending: false }).range(from_, to_)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [], total: count ?? 0, page })
})

// ── POST /api/expenses ───────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const amount = typeof b['amount'] === 'number' ? b['amount'] : NaN
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a number > 0' })
    return
  }

  const expenseNumber = await generateExpenseNumber(authed.tenantId)

  const { data: expense, error: insertErr } = await supabase
    .from('expenses')
    .insert({
      tenant_id: authed.tenantId,
      category_id: (b['category_id'] as string) || null,
      expense_number: expenseNumber,
      amount,
      expense_date: (b['expense_date'] as string) || new Date().toISOString().slice(0, 10),
      vendor: typeof b['vendor'] === 'string' ? b['vendor'].trim() : null,
      notes: (b['notes'] as string) || null,
      created_by: authed.appUserId,
    })
    .select('*')
    .single()

  if (insertErr || !expense) {
    res.status(500).json({ error: insertErr?.message ?? 'Failed to create expense' })
    return
  }

  const receiptInput = parseReceiptInput(b)
  let finalExpense = expense
  if (receiptInput) {
    const result = await uploadReceipt(supabase, authed.tenantId, expense.id, receiptInput)
    if ('error' in result) {
      res.status(400).json({ error: result.error })
      return
    }
    const { data: updated } = await supabase
      .from('expenses')
      .update(result.columns)
      .eq('id', expense.id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()
    if (updated) finalExpense = updated
  }

  void logActivity({
    tenantId: authed.tenantId,
    type: 'expense',
    body: `Expense logged: ${expenseNumber} — $${amount.toFixed(2)}`,
    metadata: { expense_id: expense.id },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json(await withSignedReceiptUrl(supabase, finalExpense))
})

// ── GET /api/expenses/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: expense, error } = await supabase
    .from('expenses')
    .select('*, expense_categories(name)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .single()

  if (error || !expense) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(await withSignedReceiptUrl(supabase, expense))
})

// ── PUT /api/expenses/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['category_id'] === 'string') updates['category_id'] = b['category_id']
  if (b['category_id'] === null) updates['category_id'] = null
  if (typeof b['amount'] === 'number' && b['amount'] > 0) updates['amount'] = b['amount']
  if (typeof b['expense_date'] === 'string') updates['expense_date'] = b['expense_date']
  if (typeof b['vendor'] === 'string') updates['vendor'] = b['vendor'].trim()
  if (b['vendor'] === null) updates['vendor'] = null
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(await withSignedReceiptUrl(supabase, data))
})

// ── POST /api/expenses/:id/receipt — upload or replace ─────────────────────────
router.post('/:id/receipt', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const { data: expense, error: fetchErr } = await supabase
    .from('expenses')
    .select('id, receipt_storage_path')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .single()

  if (fetchErr || !expense) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const receiptInput = parseReceiptInput(b)
  if (!receiptInput) {
    res.status(400).json({
      error: 'receipt_data (base64), receipt_filename, and receipt_file_type are required',
    })
    return
  }

  const result = await uploadReceipt(supabase, authed.tenantId, expense.id, receiptInput)
  if ('error' in result) {
    res.status(400).json({ error: result.error })
    return
  }

  const previousPath = expense.receipt_storage_path as string | null

  const { data: updated, error: updateErr } = await supabase
    .from('expenses')
    .update(result.columns)
    .eq('id', expense.id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (updateErr || !updated) {
    await supabase.storage.from(BUCKET).remove([result.columns['receipt_storage_path'] as string])
    res.status(500).json({ error: updateErr?.message ?? 'Failed to save receipt' })
    return
  }

  if (previousPath) {
    await supabase.storage.from(BUCKET).remove([previousPath])
  }

  res.json(await withSignedReceiptUrl(supabase, updated))
})

// ── DELETE /api/expenses/:id/receipt ────────────────────────────────────────────
router.delete('/:id/receipt', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: expense, error: fetchErr } = await supabase
    .from('expenses')
    .select('id, receipt_storage_path')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .single()

  if (fetchErr || !expense) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (expense.receipt_storage_path) {
    await supabase.storage.from(BUCKET).remove([expense.receipt_storage_path as string])
  }

  const { data: updated, error: updateErr } = await supabase
    .from('expenses')
    .update({
      receipt_storage_path: null,
      receipt_filename: null,
      receipt_file_type: null,
      receipt_file_size: null,
    })
    .eq('id', expense.id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (updateErr || !updated) {
    res.status(500).json({ error: updateErr?.message ?? 'Failed to remove receipt' })
    return
  }

  res.json(updated)
})

// ── DELETE /api/expenses/:id (soft) ──────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({ success: true })
})

export default router
