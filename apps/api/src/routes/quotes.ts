import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendEmail } from '../lib/email-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { sendPushNotification } from '../lib/push-client.js'
import { logAuditEvent } from '../middleware/audit-logger.js'
import { generateQuotePdf } from '../services/pdf-generator.js'
import { API_BASE_URL } from '../config/urls.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function nextQuoteNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string
): Promise<string> {
  const year = new Date().getFullYear()
  const { data } = await supabase
    .from('quotes')
    .select('quote_number')
    .eq('tenant_id', tenantId)
    .like('quote_number', `Q-${year}-%`)
    .order('quote_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seq = 1
  if (data?.quote_number) {
    const parts = (data.quote_number as string).split('-')
    const last = parseInt(parts[2] ?? '0', 10)
    if (!isNaN(last)) seq = last + 1
  }
  return `Q-${year}-${String(seq).padStart(4, '0')}`
}

interface LineItemInput {
  service_id?: string
  description: string
  quantity: number
  unit_price: number
}

function calcTotals(items: LineItemInput[], taxRate: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2))
  const total = Number((subtotal + taxAmount).toFixed(2))
  return { subtotal: Number(subtotal.toFixed(2)), taxAmount, total }
}

// ── GET /api/quotes ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const status = req.query['status'] ? String(req.query['status']) : null
  const contactId = req.query['contact_id'] ? String(req.query['contact_id']) : null
  const offset = (page - 1) * limit

  let query = supabase
    .from('quotes')
    .select(
      'id, quote_number, title, status, total, created_by, created_at, contact_id, contacts(full_name)',
      { count: 'exact' }
    )
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
  res.json({ quotes: data ?? [], total, page, pages: Math.ceil(total / limit) })
})

// ── GET /api/quotes/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  const { data: items } = await supabase
    .from('quote_line_items')
    .select('*')
    .eq('quote_id', quote.id)
    .order('sort_order', { ascending: true })

  res.json({ ...quote, line_items: items ?? [] })
})

// ── POST /api/quotes ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const title = typeof b['title'] === 'string' ? b['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const lineItems = Array.isArray(b['line_items']) ? (b['line_items'] as LineItemInput[]) : []
  if (lineItems.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' })
    return
  }

  const taxRate = typeof b['tax_rate'] === 'number' ? b['tax_rate'] : 0
  const validDays = typeof b['valid_days'] === 'number' ? b['valid_days'] : 30
  const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate)

  const quoteNumber = await nextQuoteNumber(supabase, authed.tenantId)
  const shareToken = randomUUID()

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: (b['contact_id'] as string) || null,
      quote_number: quoteNumber,
      title,
      status: 'draft',
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      notes: (b['notes'] as string) || null,
      valid_until: new Date(Date.now() + validDays * 86400000).toISOString(),
      share_token: shareToken,
      created_by: (b['created_by'] as string) || authed.userId || null,
    })
    .select('*')
    .single()

  if (quoteErr || !quote) {
    res.status(500).json({ error: quoteErr?.message ?? 'Failed to create quote' })
    return
  }

  const itemRows = lineItems.map((item, i) => ({
    quote_id: quote.id,
    service_id: item.service_id || null,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total: Number((item.quantity * item.unit_price).toFixed(2)),
    sort_order: i,
  }))

  const { data: items } = await supabase.from('quote_line_items').insert(itemRows).select('*')

  res.status(201).json({ ...quote, line_items: items ?? [] })
})

// ── PUT /api/quotes/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: existing } = await supabase
    .from('quotes')
    .select('status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }
  if (existing.status !== 'draft') {
    res.status(400).json({ error: 'Only draft quotes can be edited' })
    return
  }

  const b = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof b['title'] === 'string') updates['title'] = b['title'].trim()
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (typeof b['tax_rate'] === 'number') updates['tax_rate'] = b['tax_rate']
  if (typeof b['valid_until'] === 'string') updates['valid_until'] = b['valid_until']

  // Replace line items if provided
  if (Array.isArray(b['line_items'])) {
    const lineItems = b['line_items'] as LineItemInput[]
    const taxRate =
      (updates['tax_rate'] as number) ?? (typeof b['tax_rate'] === 'number' ? b['tax_rate'] : 0)
    const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate)
    updates['subtotal'] = subtotal
    updates['tax_amount'] = taxAmount
    updates['total'] = total

    await supabase.from('quote_line_items').delete().eq('quote_id', req.params['id'])
    const itemRows = lineItems.map((item, i) => ({
      quote_id: req.params['id'],
      service_id: item.service_id || null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: Number((item.quantity * item.unit_price).toFixed(2)),
      sort_order: i,
    }))
    await supabase.from('quote_line_items').insert(itemRows)
  }

  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

// ── DELETE /api/quotes/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .eq('status', 'draft')

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

// ── POST /api/quotes/:id/send ────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: quote } = await supabase
    .from('quotes')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  await supabase
    .from('quotes')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', quote.id)

  const shareUrl = `${API_BASE_URL}/quotes/view/${quote.share_token}`
  const contact = quote.contacts as { full_name?: string; phone?: string; email?: string } | null
  const contactName = contact?.full_name ?? 'Customer'

  // Get business name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()
  const businessName = tenant?.name ?? ''

  // SMS
  if (contact?.phone) {
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_number')
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .maybeSingle()

    const apiKey = process.env['TELNYX_API_KEY']
    if (location?.telnyx_number && apiKey) {
      const validDate = quote.valid_until
        ? new Date(quote.valid_until).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : ''
      void fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: location.telnyx_number,
          to: contact.phone,
          text: `You've received a quote from ${businessName}. View and accept: ${shareUrl}${validDate ? `. Valid until ${validDate}` : ''}${contact?.email ? '. A copy was also sent to your email.' : ''}.`,
        }),
      }).catch((err) => console.error('[quotes] SMS send error:', err))
    }
  }

  // Email with PDF attachment
  if (contact?.email) {
    void (async () => {
      try {
        const pdfResult = await buildPdfForQuote(supabase, quote.id)
        await sendEmail({
          to: contact!.email!,
          subject: `Quote ${quote.quote_number} from ${businessName}`,
          html: quoteEmailHtml({
            contactName,
            businessName,
            quoteNumber: quote.quote_number,
            quoteTotal: `$${Number(quote.total).toFixed(2)}`,
            quoteUrl: shareUrl,
            validUntil: quote.valid_until
              ? new Date(quote.valid_until).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '',
          }),
          attachments: pdfResult
            ? [{ filename: pdfResult.filename, content: pdfResult.buffer }]
            : undefined,
        })
      } catch (err) {
        console.error('[quotes] email+pdf error:', err)
      }
    })()
  }

  void dispatchWebhook(authed.tenantId, 'quote.sent', {
    quote_id: quote.id,
    quote_number: quote.quote_number,
    contact_id: quote.contact_id,
  })

  res.json({ sent: true, share_url: shareUrl })
})

// ── POST /api/quotes/:id/duplicate ───────────────────────────────────────────
router.post('/:id/duplicate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: original } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!original) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  const quoteNumber = await nextQuoteNumber(supabase, authed.tenantId)

  const { data: newQuote, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: original.contact_id,
      quote_number: quoteNumber,
      title: original.title,
      status: 'draft',
      subtotal: original.subtotal,
      tax_rate: original.tax_rate,
      tax_amount: original.tax_amount,
      total: original.total,
      notes: original.notes,
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      share_token: randomUUID(),
      created_by: authed.userId,
    })
    .select('*')
    .single()

  if (error || !newQuote) {
    res.status(500).json({ error: 'Failed to duplicate' })
    return
  }

  // Copy line items
  const { data: items } = await supabase
    .from('quote_line_items')
    .select('*')
    .eq('quote_id', original.id)
  if (items && items.length > 0) {
    await supabase.from('quote_line_items').insert(
      items.map((i) => ({
        quote_id: newQuote.id,
        service_id: i.service_id,
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: i.total,
        sort_order: i.sort_order,
      }))
    )
  }

  res.status(201).json(newQuote)
})

// ── PDF helper ───────────────────────────────────────────────────────────────

async function buildPdfForQuote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  quoteId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: quote } = await supabase
    .from('quotes')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', quoteId)
    .single()
  if (!quote) return null

  const { data: items } = await supabase
    .from('quote_line_items')
    .select('description, quantity, unit_price, total')
    .eq('quote_id', quoteId)
    .order('sort_order')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', quote.tenant_id)
    .single()
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', quote.tenant_id)
    .eq('is_primary', true)
    .maybeSingle()

  const contact = quote.contacts as { full_name?: string; phone?: string; email?: string } | null

  const buffer = await generateQuotePdf({
    quoteNumber: quote.quote_number,
    title: quote.title,
    createdAt: quote.created_at,
    validUntil: quote.valid_until,
    contactName: contact?.full_name ?? 'Customer',
    contactEmail: contact?.email ?? null,
    contactPhone: contact?.phone ?? null,
    businessName: tenant?.name ?? '',
    businessPhone: location?.telnyx_number ?? null,
    subtotal: Number(quote.subtotal),
    taxRate: Number(quote.tax_rate),
    taxAmount: Number(quote.tax_amount),
    total: Number(quote.total),
    notes: quote.notes,
    lineItems: (items ?? []).map(
      (i: { description: string; quantity: number; unit_price: number; total: number }) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        total: Number(i.total),
      })
    ),
  })

  return { buffer, filename: `Quote-${quote.quote_number}.pdf` }
}

// ── GET /api/quotes/:id/pdf ──────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify ownership
  const { data: check } = await supabase
    .from('quotes')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!check) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  const result = await buildPdfForQuote(supabase, req.params['id']!)
  if (!result) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  res.send(result.buffer)
})

// ── PUBLIC: GET /api/quotes/view/:token ──────────────────────────────────────
router.get('/view/:token', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
  const token = req.params['token']

  const { data: quote } = await supabase
    .from('quotes')
    .select('*, contacts(full_name, phone, email)')
    .eq('share_token', token)
    .single()

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  // Mark as viewed
  if (quote.status === 'sent') {
    await supabase.from('quotes').update({ status: 'viewed' }).eq('id', quote.id)
  }

  const { data: items } = await supabase
    .from('quote_line_items')
    .select('*')
    .eq('quote_id', quote.id)
    .order('sort_order')
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', quote.tenant_id)
    .single()

  res.json({ ...quote, line_items: items ?? [], business_name: tenant?.name ?? '' })
})

// ── PUBLIC: GET /api/quotes/view/:token/pdf ──────────────────────────────────
router.get('/view/:token/pdf', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
  const { data: quote } = await supabase
    .from('quotes')
    .select('id')
    .eq('share_token', req.params['token'])
    .single()

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  const result = await buildPdfForQuote(supabase, quote.id)
  if (!result) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  res.send(result.buffer)
})

// ── PUBLIC: POST /api/quotes/view/:token/accept ──────────────────────────────
router.post('/view/:token/accept', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, contact_id, quote_number, total')
    .eq('share_token', req.params['token'])
    .single()

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  await supabase
    .from('quotes')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', quote.id)

  // Look up contact name
  let contactName = 'Customer'
  if (quote.contact_id) {
    const { data: c } = await supabase
      .from('contacts')
      .select('full_name')
      .eq('id', quote.contact_id)
      .single()
    if (c) contactName = c.full_name || contactName
  }

  const totalFormatted = `$${Number(quote.total).toFixed(2)}`

  void dispatchWebhook(quote.tenant_id, 'quote.accepted', {
    quote_id: quote.id,
    quote_number: quote.quote_number,
    total: quote.total,
    contact_name: contactName,
  })

  void sendPushNotification(quote.tenant_id, {
    title: 'Quote Accepted!',
    body: `${contactName} accepted Quote ${quote.quote_number} for ${totalFormatted}`,
    url: `/quotes/${quote.id}`,
  })

  void logAuditEvent({
    tenantId: quote.tenant_id,
    action: 'quote_accepted',
    resourceType: 'quotes',
    resourceId: quote.id,
    details: { total: quote.total, contact_name: contactName },
  })

  // SMS to business owner
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number, escalation_phone')
    .eq('tenant_id', quote.tenant_id)
    .eq('is_primary', true)
    .maybeSingle()

  const apiKey = process.env['TELNYX_API_KEY']
  const ownerPhone = location?.escalation_phone
  if (apiKey && location?.telnyx_number && ownerPhone) {
    void fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: location.telnyx_number,
        to: ownerPhone,
        text: `Quote ${quote.quote_number} was accepted by ${contactName} for ${totalFormatted}!`,
      }),
    }).catch((err) => console.error('[quotes] owner SMS error:', err))
  }

  res.json({ accepted: true })
})

// ── PUBLIC: POST /api/quotes/view/:token/decline ─────────────────────────────
router.post('/view/:token/decline', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, quote_number, contact_id')
    .eq('share_token', req.params['token'])
    .single()

  if (!quote) {
    res.status(404).json({ error: 'Quote not found' })
    return
  }

  await supabase
    .from('quotes')
    .update({ status: 'declined', declined_at: new Date().toISOString() })
    .eq('id', quote.id)

  let contactName = 'Customer'
  if (quote.contact_id) {
    const { data: c } = await supabase
      .from('contacts')
      .select('full_name')
      .eq('id', quote.contact_id)
      .single()
    if (c) contactName = c.full_name || contactName
  }

  void dispatchWebhook(quote.tenant_id, 'quote.declined', {
    quote_id: quote.id,
    quote_number: quote.quote_number,
    reason,
  })

  void sendPushNotification(quote.tenant_id, {
    title: 'Quote Declined',
    body: `${contactName} declined Quote ${quote.quote_number}`,
    url: `/quotes/${quote.id}`,
  })

  void logAuditEvent({
    tenantId: quote.tenant_id,
    action: 'quote_declined',
    resourceType: 'quotes',
    resourceId: quote.id,
    details: { contact_name: contactName, reason },
  })

  res.json({ declined: true })
})

// ── Quote email HTML helper ──────────────────────────────────────────────────
function quoteEmailHtml(vars: {
  contactName: string
  businessName: string
  quoteNumber: string
  quoteTotal: string
  quoteUrl: string
  validUntil: string
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
<h1>Quote ${vars.quoteNumber}</h1>
<p>Hi ${vars.contactName},</p>
<p>You've received a quote from <strong>${vars.businessName}</strong>.</p>
<div class="total">${vars.quoteTotal}</div>
${vars.validUntil ? `<p style="font-size:13px;color:#999">Valid until ${vars.validUntil}</p>` : ''}
<p style="margin-top:24px"><a class="btn" href="${vars.quoteUrl}">View Quote</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}

export default router

// Export for internal use (auto-quote from calls)
export { nextQuoteNumber, calcTotals }
