import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendEmail } from '../lib/email-client.js'
import { generateInvoiceNumber } from '../lib/invoice-number.js'
import PDFDocument from 'pdfkit'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface LineItemInput {
  description: string
  quantity: number
  unit_price: number
}

export function calcInvoiceTotals(items: LineItemInput[], taxRate: number) {
  const subtotal = Number(items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0).toFixed(2))
  const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2))
  const total = Number((subtotal + taxAmount).toFixed(2))
  return { subtotal, taxAmount, total }
}

// ── GET /api/invoices ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const status = req.query['status'] ? String(req.query['status']) : null
  const contactId = req.query['contact_id'] ? String(req.query['contact_id']) : null
  const offset = (page - 1) * limit

  let query = supabase
    .from('invoices')
    .select('*, contacts(full_name)', { count: 'exact' })
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const total = count ?? 0
  res.json({ invoices: data ?? [], total, page, pages: Math.ceil(total / limit) })
})

// ── GET /api/invoices/:id/pdf ─────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // 1. Fetch invoice with contact
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  // Fetch line items
  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })

  // 2. Fetch tenant name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()

  const businessName = tenant?.name ?? 'Your Business'
  const contact = invoice.contacts as { full_name?: string; email?: string; phone?: string } | null

  const TEAL = '#0d9488'
  const DARK = '#111827'
  const GRAY = '#6b7280'
  const LIGHT_GRAY = '#f3f4f6'

  function fmt(n: number): string {
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  function fmtDate(d: string | null | undefined): string {
    if (!d) return 'Not set'
    return new Date(d).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // 3. Generate PDF and stream as response
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="INV-${invoice.invoice_number as string}.pdf"`
  )

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
  doc.pipe(res)

  const pageWidth = doc.page.width - 100 // account for left + right margins

  // ── Header section ────────────────────────────────────────────────────────
  // Business name (top-left, large, bold)
  doc
    .fontSize(22)
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text(businessName, 50, 50, { width: pageWidth / 2 })

  // "INVOICE" label (top-right, teal)
  doc.fontSize(22).fillColor(TEAL).text('INVOICE', 50, 50, { width: pageWidth, align: 'right' })

  // Invoice number below "INVOICE" (mono style using Courier)
  doc
    .fontSize(10)
    .fillColor(GRAY)
    .font('Courier')
    .text(String(invoice.invoice_number), 50, 78, { width: pageWidth, align: 'right' })
  doc.font('Helvetica')

  // ── Metadata block (two columns) ──────────────────────────────────────────
  let y = 120

  // Left column: Bill To
  doc.fontSize(9).fillColor(TEAL).font('Helvetica-Bold').text('BILL TO', 50, y)
  doc.font('Helvetica')
  y += 14
  if (contact?.full_name) {
    doc.fontSize(10).fillColor(DARK).text(contact.full_name, 50, y)
    y += 14
  }
  if (contact?.email) {
    doc.fontSize(9).fillColor(GRAY).text(contact.email, 50, y)
    y += 13
  }
  if (contact?.phone) {
    doc.fontSize(9).fillColor(GRAY).text(contact.phone, 50, y)
    y += 13
  }

  // Right column: dates + status (reset y to start of metadata block)
  const rightColX = 380
  let ry = 120

  doc.fontSize(9).fillColor(GRAY).text('Issue Date', rightColX, ry, { width: 170 })
  ry += 13
  doc
    .fillColor(DARK)
    .text(fmtDate(invoice.issue_date as string | null), rightColX, ry, { width: 170 })
  ry += 18

  doc.fillColor(GRAY).text('Due Date', rightColX, ry, { width: 170 })
  ry += 13
  doc
    .fillColor(DARK)
    .text(fmtDate(invoice.due_date as string | null | undefined), rightColX, ry, { width: 170 })
  ry += 18

  doc.fillColor(GRAY).text('Status', rightColX, ry, { width: 170 })
  ry += 13
  doc
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text(String(invoice.status ?? '').toUpperCase(), rightColX, ry, { width: 170 })
  doc.font('Helvetica')

  // Move y below both columns
  y = Math.max(y, ry) + 24

  // Dividing line
  doc
    .moveTo(50, y)
    .lineTo(50 + pageWidth, y)
    .strokeColor(LIGHT_GRAY)
    .lineWidth(1)
    .stroke()
  y += 14

  // ── Line items table ──────────────────────────────────────────────────────
  const colDesc = 50
  const colQty = 350
  const colPrice = 420
  const colAmount = 490

  // Table header row
  doc.rect(50, y, pageWidth, 22).fill(LIGHT_GRAY)
  doc.fontSize(8).fillColor(GRAY)
  doc.text('Description', colDesc + 4, y + 6, { width: 290 })
  doc.text('Qty', colQty, y + 6, { width: 60, align: 'right' })
  doc.text('Unit Price', colPrice, y + 6, { width: 60, align: 'right' })
  doc.text('Amount', colAmount, y + 6, { width: 60, align: 'right' })
  y += 22

  // Data rows
  const items = lineItems ?? []
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!
    // Alternating row background
    if (idx % 2 === 1) {
      doc.rect(50, y, pageWidth, 20).fill('#f9fafb')
    }
    doc
      .fontSize(9)
      .fillColor(DARK)
      .text(item.description, colDesc + 4, y + 5, { width: 290 })
    doc.text(String(item.quantity), colQty, y + 5, { width: 60, align: 'right' })
    doc.text(fmt(Number(item.unit_price)), colPrice, y + 5, { width: 60, align: 'right' })
    doc.text(fmt(Number(item.quantity) * Number(item.unit_price)), colAmount, y + 5, {
      width: 60,
      align: 'right',
    })
    y += 20
  }

  // ── Totals block ──────────────────────────────────────────────────────────
  y += 10
  doc.moveTo(370, y).lineTo(550, y).strokeColor(LIGHT_GRAY).lineWidth(1).stroke()
  y += 8

  const subtotal = Number(invoice.subtotal ?? 0)
  const taxRate = Number(invoice.tax_rate ?? 0)
  const taxAmount = Number(invoice.tax_amount ?? 0)
  const total = Number(invoice.total ?? 0)
  const amountPaid = Number(invoice.amount_paid ?? 0)
  const balanceDue = Number((total - amountPaid).toFixed(2))

  doc.fontSize(9).fillColor(GRAY).text('Subtotal', 370, y, { width: 120 })
  doc.fillColor(DARK).text(fmt(subtotal), 490, y, { width: 60, align: 'right' })

  if (taxRate > 0) {
    y += 16
    doc.fillColor(GRAY).text(`Tax (${taxRate}%)`, 370, y, { width: 120 })
    doc.fillColor(DARK).text(fmt(taxAmount), 490, y, { width: 60, align: 'right' })
  }

  y += 20
  doc.moveTo(370, y).lineTo(550, y).strokeColor(TEAL).lineWidth(1.5).stroke()
  y += 8
  doc.fontSize(11).fillColor(TEAL).font('Helvetica-Bold').text('Total', 370, y, { width: 120 })
  doc.text(fmt(total), 490, y, { width: 60, align: 'right' })
  doc.font('Helvetica')

  y += 20
  doc.moveTo(370, y).lineTo(550, y).strokeColor(LIGHT_GRAY).lineWidth(0.5).stroke()
  y += 8
  doc.fontSize(9).fillColor(GRAY).text('Amount Paid', 370, y, { width: 120 })
  doc.fillColor(DARK).text(fmt(amountPaid), 490, y, { width: 60, align: 'right' })

  y += 16
  doc
    .fontSize(10)
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text('Balance Due', 370, y, { width: 120 })
  doc.text(fmt(balanceDue), 490, y, { width: 60, align: 'right' })
  doc.font('Helvetica')

  // ── Overdue watermark ─────────────────────────────────────────────────────
  if (invoice.status === 'overdue') {
    doc.save()
    doc
      .opacity(0.08)
      .fontSize(96)
      .fillColor('#dc2626')
      .font('Helvetica-Bold')
      .rotate(45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .text('OVERDUE', 0, doc.page.height / 2 - 48, { width: doc.page.width, align: 'center' })
    doc.restore()
  }

  // ── Notes section ─────────────────────────────────────────────────────────
  if (invoice.notes) {
    y += 36
    doc
      .moveTo(50, y)
      .lineTo(50 + pageWidth, y)
      .strokeColor(LIGHT_GRAY)
      .lineWidth(1)
      .stroke()
    y += 12
    doc.fontSize(10).fillColor(TEAL).font('Helvetica-Bold').text('Notes:', 50, y)
    doc.font('Helvetica')
    y += 16
    doc.fontSize(9).fillColor(GRAY).text(String(invoice.notes), 50, y, { width: pageWidth })
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 60
  doc.fontSize(8).fillColor(GRAY)
  doc.text(businessName, 50, footerY, { width: pageWidth, align: 'center' })
  doc.text('Page 1', 50, footerY + 12, { width: pageWidth, align: 'center' })

  doc.end()
})

// ── GET /api/invoices/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })

  res.json({ ...invoice, line_items: items ?? [] })
})

// ── POST /api/invoices ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const lineItems = Array.isArray(b['line_items']) ? (b['line_items'] as LineItemInput[]) : []
  if (lineItems.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' })
    return
  }

  const taxRate = typeof b['tax_rate'] === 'number' ? b['tax_rate'] : 0
  const { subtotal, taxAmount, total } = calcInvoiceTotals(lineItems, taxRate)

  let invoiceNumber: string
  try {
    invoiceNumber = await generateInvoiceNumber(authed.tenantId)
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to generate invoice number' })
    return
  }

  const { data: invoice, error: invoiceErr } = await supabase
    .from('invoices')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: (b['contact_id'] as string) || null,
      deal_id: (b['deal_id'] as string) || null,
      invoice_number: invoiceNumber,
      share_token: randomUUID(),
      status: 'draft',
      issue_date: (b['issue_date'] as string) || new Date().toISOString().split('T')[0],
      due_date: (b['due_date'] as string) || null,
      notes: (b['notes'] as string) || null,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      amount_paid: 0,
    })
    .select('*')
    .single()

  if (invoiceErr || !invoice) {
    res.status(500).json({ error: invoiceErr?.message ?? 'Failed to create invoice' })
    return
  }

  const itemRows = lineItems.map((item, i) => ({
    invoice_id: invoice.id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total: Number((item.quantity * item.unit_price).toFixed(2)),
    sort_order: i,
  }))

  const { data: items } = await supabase.from('invoice_line_items').insert(itemRows).select('*')

  res.status(201).json({ ...invoice, line_items: items ?? [] })
})

// ── PUT /api/invoices/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: existing } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }
  if (existing.status !== 'draft') {
    res.status(400).json({ error: 'Only draft invoices can be edited' })
    return
  }

  const b = req.body as Record<string, unknown>
  const lineItems = Array.isArray(b['line_items']) ? (b['line_items'] as LineItemInput[]) : []
  if (lineItems.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' })
    return
  }

  const taxRate = typeof b['tax_rate'] === 'number' ? b['tax_rate'] : 0
  const { subtotal, taxAmount, total } = calcInvoiceTotals(lineItems, taxRate)

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    contact_id: (b['contact_id'] as string) || null,
    deal_id: (b['deal_id'] as string) || null,
    issue_date: b['issue_date'] || null,
    due_date: b['due_date'] || null,
    notes: (b['notes'] as string) || null,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Replace line items only after invoice update succeeds
  await supabase.from('invoice_line_items').delete().eq('invoice_id', req.params['id'])
  const itemRows = lineItems.map((item, i) => ({
    invoice_id: req.params['id'],
    tenant_id: authed.tenantId,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    sort_order: i,
  }))
  await supabase.from('invoice_line_items').insert(itemRows)

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', req.params['id'])
    .order('sort_order', { ascending: true })

  res.json({ ...data, line_items: items ?? [] })
})

// ── POST /api/invoices/:id/send ────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*, contacts(full_name, email)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  if (!['draft', 'due'].includes(invoice.status as string)) {
    res.status(400).json({ error: 'Only draft or due invoices can be sent' })
    return
  }

  const sentAt = new Date().toISOString()

  const { error: sendUpdateErr } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: sentAt })
    .eq('id', invoice.id)

  if (sendUpdateErr) {
    res.status(500).json({ error: `Failed to update invoice: ${sendUpdateErr.message}` })
    return
  }

  // Get business name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()
  const businessName = tenant?.name ?? ''

  const contact = invoice.contacts as { full_name?: string; email?: string } | null

  // Send email if contact has email
  if (contact?.email) {
    const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
    const publicUrl = `${webUrl}/invoices/public/${invoice.share_token}`
    const dueDate = invoice.due_date
      ? new Date(invoice.due_date as string).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : null

    void sendEmail({
      to: contact.email,
      subject: `Invoice ${invoice.invoice_number} from ${businessName}`,
      html: invoiceEmailHtml({
        contactName: contact.full_name ?? 'Customer',
        businessName,
        invoiceNumber: invoice.invoice_number as string,
        invoiceTotal: `$${Number(invoice.total).toFixed(2)}`,
        invoiceUrl: publicUrl,
        dueDate: dueDate ?? '',
      }),
      tenantId: authed.tenantId,
    }).catch((err) => console.error('[invoices] send email error:', err))
  }

  res.json({ sent_at: sentAt })
})

// ── POST /api/invoices/:id/record-payment ────────────────────────────────────
router.post(
  '/:id/record-payment',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    const amount =
      typeof b['amount'] === 'number' ? b['amount'] : parseFloat(String(b['amount'] ?? ''))
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' })
      return
    }

    const method = typeof b['method'] === 'string' ? b['method'] : ''
    if (!method) {
      res.status(400).json({ error: 'method is required' })
      return
    }

    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, amount_paid, total, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' })
      return
    }

    const allowedStatuses = ['sent', 'due', 'overdue']
    if (!allowedStatuses.includes(invoice.status as string)) {
      res
        .status(400)
        .json({ error: 'Payments can only be recorded for sent, due, or overdue invoices' })
      return
    }

    const newAmountPaid = Number((Number(invoice.amount_paid ?? 0) + amount).toFixed(2))
    const total = Number(invoice.total)

    const updateFields: Record<string, unknown> = {
      amount_paid: newAmountPaid,
      updated_at: new Date().toISOString(),
    }

    if (newAmountPaid >= total) {
      updateFields['status'] = 'received'
      updateFields['paid_at'] = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('invoices')
      .update(updateFields)
      .eq('id', invoice.id)
      .select('*')
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json(data)
  }
)

// ── POST /api/invoices/:id/void ───────────────────────────────────────────────
router.post('/:id/void', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  if (invoice.status === 'received') {
    res.status(400).json({ error: 'Cannot void a received (paid) invoice' })
    return
  }

  const voidedAt = new Date().toISOString()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', voided_at: voidedAt })
    .eq('id', invoice.id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ voided_at: voidedAt })
})

// ── processRecordPayment — exported for testing ───────────────────────────────
export async function processRecordPayment(
  invoiceId: string,
  tenantId: string,
  amount: number,
  method: string
): Promise<{ status: number; data?: unknown; error?: string }> {
  const supabase = getSupabase()

  if (isNaN(amount) || amount <= 0) {
    return { status: 400, error: 'amount must be a positive number' }
  }
  if (!method) {
    return { status: 400, error: 'method is required' }
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, amount_paid, total, status')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (!invoice) {
    return { status: 404, error: 'Invoice not found' }
  }

  const allowedStatuses = ['sent', 'due', 'overdue']
  if (!allowedStatuses.includes(invoice['status'] as string)) {
    return {
      status: 400,
      error: 'Payments can only be recorded for sent, due, or overdue invoices',
    }
  }

  const newAmountPaid = Number((Number(invoice['amount_paid'] ?? 0) + amount).toFixed(2))
  const total = Number(invoice['total'])

  const updateFields: Record<string, unknown> = {
    amount_paid: newAmountPaid,
    updated_at: new Date().toISOString(),
  }

  if (newAmountPaid >= total) {
    updateFields['status'] = 'received'
    updateFields['paid_at'] = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updateFields)
    .eq('id', invoiceId)
    .select('*')
    .single()

  if (error) {
    return { status: 500, error: error.message }
  }

  return { status: 200, data }
}

// ── processVoidInvoice — exported for testing ─────────────────────────────────
export async function processVoidInvoice(
  invoiceId: string,
  tenantId: string
): Promise<{ status: number; data?: unknown; error?: string }> {
  const supabase = getSupabase()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (!invoice) {
    return { status: 404, error: 'Invoice not found' }
  }

  if (invoice['status'] === 'received') {
    return { status: 400, error: 'Cannot void a received (paid) invoice' }
  }

  const voidedAt = new Date().toISOString()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', voided_at: voidedAt })
    .eq('id', invoiceId)

  if (error) {
    return { status: 500, error: error.message }
  }

  return { status: 200, data: { voided_at: voidedAt } }
}

// ── PUBLIC: GET /api/invoices/public/:token ──────────────────────────────────
// NOTE: This route is mounted separately as invoicesPublicRouter in index.ts.
// Keyed on the unguessable share_token (NOT the raw PK) so a leaked URL is not a
// forever-valid credential. The raw id no longer resolves on this public route.
export const publicRouter = Router()

publicRouter.get('/:token', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, status, issue_date, due_date, subtotal, tax_rate, tax_amount, total, amount_paid, notes, contact_id, tenant_id'
    )
    .eq('share_token', req.params['token'])
    .single()

  if (error || !invoice) {
    res.status(404).json({ error: 'Invoice not found' })
    return
  }

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('id, description, quantity, unit_price, total, sort_order')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', invoice.tenant_id)
    .single()

  let contactName: string | null = null
  if (invoice.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('full_name')
      .eq('id', invoice.contact_id)
      .single()
    contactName = contact?.full_name ?? null
  }

  const balanceDue = Number((Number(invoice.total) - Number(invoice.amount_paid ?? 0)).toFixed(2))

  res.json({
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    subtotal: invoice.subtotal,
    tax_rate: invoice.tax_rate,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    amount_paid: invoice.amount_paid,
    balance_due: balanceDue,
    notes: invoice.notes,
    business_name: tenant?.name ?? '',
    contact_name: contactName,
    line_items: items ?? [],
  })
})

// ── Invoice email HTML helper ─────────────────────────────────────────────────
function invoiceEmailHtml(vars: {
  contactName: string
  businessName: string
  invoiceNumber: string
  invoiceTotal: string
  invoiceUrl: string
  dueDate: string
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.c{max-width:560px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.total{font-size:28px;font-weight:700;color:#0d9488;margin:16px 0}
.btn{display:inline-block;padding:14px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}</style>
</head><body><div class="c"><div class="card">
<h1>Invoice ${vars.invoiceNumber}</h1>
<p>Hi ${vars.contactName},</p>
<p>You have received an invoice from <strong>${vars.businessName}</strong>.</p>
<div class="total">${vars.invoiceTotal}</div>
${vars.dueDate ? `<p style="font-size:13px;color:#999">Due by ${vars.dueDate}</p>` : ''}
<p style="margin-top:24px"><a class="btn" href="${vars.invoiceUrl}">View Invoice</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}

export default router
