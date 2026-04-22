import { Router, type Request, type Response } from 'express'
import { randomUUID, createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendEmail } from '../lib/email-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { sendPushNotification } from '../lib/push-client.js'
import { logAuditEvent } from '../middleware/audit-logger.js'
import { generateQuotePdf } from '../services/pdf-generator.js'
import { API_BASE_URL } from '../config/urls.js'
import { getFollowupQueue } from '../workers/quote-followup-worker.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'
import { maybeAdvanceLifecycle } from '../lib/lifecycle.js'
import type { NextFunction } from 'express'

const router = Router()

// CPQ module gate — applied after requireAuth on authenticated routes
async function requireCpq(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'cpq')
  if (!enabled) {
    res.status(403).json({
      error: 'CPQ module is not enabled for your workspace. Enable it in Settings → Modules.',
    })
    return
  }
  next()
}

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

function calcTotals(items: LineItemInput[], taxRate: number, discountAmount = 0) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const discountedSubtotal = Math.max(0, subtotal - discountAmount)
  const taxAmount = Number(((discountedSubtotal * taxRate) / 100).toFixed(2))
  const total = Number((discountedSubtotal + taxAmount).toFixed(2))
  return { subtotal: Number(subtotal.toFixed(2)), taxAmount, total }
}

interface CpqSettings {
  max_discount_pct: number
  require_approval_above: number
  deposit_pct: number
}

const DEFAULT_CPQ: CpqSettings = {
  max_discount_pct: 20,
  require_approval_above: 15,
  deposit_pct: 50,
}

async function getCpqSettings(
  supabase: ReturnType<typeof getSupabase>,
  tenantId: string
): Promise<CpqSettings> {
  const { data } = await supabase.from('tenants').select('cpq_settings').eq('id', tenantId).single()
  return { ...DEFAULT_CPQ, ...(data?.cpq_settings as Partial<CpqSettings> | null) }
}

// ── GET /api/quotes ──────────────────────────────────────────────────────────
router.get('/', requireAuth, requireCpq, async (req: Request, res: Response): Promise<void> => {
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
router.get('/:id', requireAuth, requireCpq, async (req: Request, res: Response): Promise<void> => {
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
router.post('/', requireAuth, requireCpq, async (req: Request, res: Response): Promise<void> => {
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

  // Discount validation
  const discountPct = typeof b['discount_pct'] === 'number' ? b['discount_pct'] : 0
  const discountAmountRaw = typeof b['discount_amount'] === 'number' ? b['discount_amount'] : 0

  let approvalStatus: string | null = null
  if (discountPct > 0) {
    const cpq = await getCpqSettings(supabase, authed.tenantId)
    if (discountPct > cpq.max_discount_pct) {
      res.status(400).json({ error: `Discount exceeds maximum allowed (${cpq.max_discount_pct}%)` })
      return
    }
    if (discountPct > cpq.require_approval_above) {
      approvalStatus = 'pending'
    }
  }

  const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate, discountAmountRaw)

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
      discount_pct: discountPct,
      discount_amount: discountAmountRaw,
      approval_status: approvalStatus,
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

  // Notify if approval is needed
  if (approvalStatus === 'pending') {
    void sendPushNotification(authed.tenantId, {
      title: 'Quote Approval Needed',
      body: `Quote ${quoteNumber} has a ${discountPct}% discount ($${Number(total).toFixed(2)}). Tap to review.`,
      url: `/quotes/${quote.id}`,
    })

    // Send approval email to owner
    void (async () => {
      try {
        const { data: ownerUser } = await supabase
          .from('users')
          .select('email')
          .eq('tenant_id', authed.tenantId)
          .eq('role', 'owner')
          .maybeSingle()
        if (ownerUser?.email) {
          const { data: tn } = await supabase
            .from('tenants')
            .select('name')
            .eq('id', authed.tenantId)
            .single()
          await sendEmail({
            to: ownerUser.email,
            subject: `Quote Approval Required — ${quoteNumber}`,
            html: quoteApprovalEmailHtml({
              quoteNumber,
              title,
              contactName: '',
              subtotal: `$${Number(subtotal).toFixed(2)}`,
              discountPct: String(discountPct),
              discountAmount: `$${Number(discountAmountRaw).toFixed(2)}`,
              total: `$${Number(total).toFixed(2)}`,
              quoteUrl: `${process.env['WEB_URL'] ?? 'http://localhost:3000'}/quotes/${quote.id}`,
              businessName: tn?.name ?? '',
            }),
          })
        }
      } catch (err) {
        console.error('[quotes] approval email error:', err)
      }
    })()
  }

  res.status(201).json({ ...quote, line_items: items ?? [] })
})

// ── PUT /api/quotes/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireCpq, async (req: Request, res: Response): Promise<void> => {
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

  // Discount validation on update
  const discountPct = typeof b['discount_pct'] === 'number' ? b['discount_pct'] : undefined
  const discountAmountVal =
    typeof b['discount_amount'] === 'number' ? b['discount_amount'] : undefined

  if (discountPct !== undefined) {
    updates['discount_pct'] = discountPct
    if (discountPct > 0) {
      const cpq = await getCpqSettings(supabase, authed.tenantId)
      if (discountPct > cpq.max_discount_pct) {
        res
          .status(400)
          .json({ error: `Discount exceeds maximum allowed (${cpq.max_discount_pct}%)` })
        return
      }
      // Reset approval if discount increases above threshold
      if (discountPct > cpq.require_approval_above) {
        updates['approval_status'] = 'pending'
      } else {
        updates['approval_status'] = null
      }
    } else {
      updates['approval_status'] = null
    }
  }
  if (discountAmountVal !== undefined) updates['discount_amount'] = discountAmountVal

  // Replace line items if provided
  if (Array.isArray(b['line_items'])) {
    const lineItems = b['line_items'] as LineItemInput[]
    const taxRate =
      (updates['tax_rate'] as number) ?? (typeof b['tax_rate'] === 'number' ? b['tax_rate'] : 0)
    const da = (discountAmountVal ?? 0) as number
    const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate, da)
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
router.delete(
  '/:id',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
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
  }
)

// ── POST /api/quotes/:id/send ────────────────────────────────────────────────
router.post(
  '/:id/send',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
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

    // Block sending if approval is pending or rejected
    if (quote.approval_status === 'pending') {
      const cpq = await getCpqSettings(supabase, authed.tenantId)
      res.status(403).json({
        error: `Quote requires approval before sending. Discount of ${quote.discount_pct}% exceeds the ${cpq.require_approval_above}% approval threshold.`,
      })
      return
    }
    if (quote.approval_status === 'rejected') {
      res.status(403).json({ error: 'Quote was rejected. Revise the discount and resubmit.' })
      return
    }

    // Snapshot deposit settings
    const cpqForDeposit = await getCpqSettings(supabase, authed.tenantId)
    const sendUpdate: Record<string, unknown> = {
      status: 'sent',
      sent_at: new Date().toISOString(),
    }
    if (cpqForDeposit.deposit_pct > 0) {
      const quoteTotal = Number(quote.total)
      const depAmount = Math.round(((quoteTotal * cpqForDeposit.deposit_pct) / 100) * 100) / 100
      const remaining = Math.round((quoteTotal - depAmount) * 100) / 100
      sendUpdate['deposit_pct'] = cpqForDeposit.deposit_pct
      sendUpdate['deposit_amount'] = depAmount
      sendUpdate['remaining_balance'] = remaining
    }

    await supabase.from('quotes').update(sendUpdate).eq('id', quote.id)

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

    // Enqueue 48h follow-up job for unopened quotes
    if (contact?.phone) {
      try {
        const queue = getFollowupQueue()
        const job = await queue.add(
          'unopened-followup',
          {
            quoteId: quote.id,
            tenantId: authed.tenantId,
            contactPhone: contact.phone,
            contactName: contactName,
            quoteNumber: quote.quote_number,
            shareToken: quote.share_token,
          },
          {
            delay: 48 * 60 * 60 * 1000, // 48 hours
            removeOnComplete: true,
            removeOnFail: true,
          }
        )
        await supabase.from('quotes').update({ followup_job_id: job.id }).eq('id', quote.id)
        console.info(
          `[quotes] enqueued 48h follow-up job=${job.id} for quote=${quote.quote_number}`
        )
      } catch (err) {
        console.error('[quotes] failed to enqueue follow-up job:', err)
      }
    }

    void logActivity({
      tenantId: authed.tenantId,
      contactId: quote.contact_id ?? undefined,
      type: 'quote',
      body: `Quote sent: "${quote.title}" — $${Number(quote.total).toFixed(2)}`,
      metadata: { quote_id: quote.id, status: 'sent' },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({ sent: true, share_url: shareUrl })
  }
)

// ── POST /api/quotes/:id/duplicate ───────────────────────────────────────────
router.post(
  '/:id/duplicate',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
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
  }
)

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
    .select('description, quantity, unit_price, total, package_id')
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
    depositPct: quote.deposit_pct != null ? Number(quote.deposit_pct) : null,
    depositAmount: quote.deposit_amount != null ? Number(quote.deposit_amount) : null,
    remainingBalance: quote.remaining_balance != null ? Number(quote.remaining_balance) : null,
    notes: quote.notes,
    lineItems: (items ?? []).map(
      (i: {
        description: string
        quantity: number
        unit_price: number
        total: number
        package_id?: string | null
      }) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        total: Number(i.total),
        package_id: i.package_id ?? null,
      })
    ),
  })

  return { buffer, filename: `Quote-${quote.quote_number}.pdf` }
}

// ── GET /api/quotes/:id/pdf ──────────────────────────────────────────────────
router.get(
  '/:id/pdf',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
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
  }
)

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

  // Mark as viewed on first view + cancel follow-up job
  if (quote.status === 'sent') {
    await supabase.from('quotes').update({ status: 'viewed' }).eq('id', quote.id)

    // Cancel 48h follow-up job if it exists
    if (quote.followup_job_id) {
      try {
        const queue = getFollowupQueue()
        const job = await queue.getJob(quote.followup_job_id)
        if (job) await job.remove()
        console.info(`[quotes] cancelled follow-up job — quote viewed`)
      } catch (err) {
        console.error('[quotes] failed to cancel follow-up job:', err)
      }
    }
  }

  // Track view (fire-and-forget)
  try {
    const rawIp = req.ip || req.socket.remoteAddress || ''
    const ipHash = createHash('sha256').update(rawIp).digest('hex')
    const userAgent = req.headers['user-agent'] || null

    // Dedup: skip if same ip_hash viewed same quote within 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('quote_views')
      .select('id')
      .eq('quote_id', quote.id)
      .eq('ip_hash', ipHash)
      .gte('viewed_at', tenMinAgo)
      .limit(1)
      .maybeSingle()

    if (!existing) {
      await supabase.from('quote_views').insert({
        quote_id: quote.id,
        tenant_id: quote.tenant_id,
        ip_hash: ipHash,
        user_agent: userAgent,
      })
      console.info(`[quotes] view tracked for quote=${quote.id}`)

      void logActivity({
        tenantId: quote.tenant_id,
        contactId: quote.contact_id ?? undefined,
        type: 'quote',
        body: 'Quote viewed by client',
        metadata: { quote_id: quote.id, status: 'viewed' },
        actorType: 'contact',
      })
    }
  } catch (err) {
    console.error('[quotes] view tracking error:', err)
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
    .select('id, tenant_id, contact_id, quote_number, total, followup_job_id')
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

  // Cancel 48h follow-up job if it exists
  if (quote.followup_job_id) {
    try {
      const queue = getFollowupQueue()
      const job = await queue.getJob(quote.followup_job_id)
      if (job) await job.remove()
      console.info(`[quotes] cancelled follow-up job — quote accepted`)
    } catch (err) {
      console.error('[quotes] failed to cancel follow-up job:', err)
    }
  }

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

  void logActivity({
    tenantId: quote.tenant_id,
    contactId: quote.contact_id ?? undefined,
    type: 'quote',
    body: `Quote accepted: "${quote.quote_number}" — ${totalFormatted}`,
    metadata: { quote_id: quote.id, status: 'accepted' },
    actorType: 'contact',
  })

  if (quote.contact_id) {
    enqueueScoreCompute(quote.tenant_id, quote.contact_id, 'quote_accepted')
    maybeAdvanceLifecycle(quote.tenant_id, quote.contact_id, 'opportunity')
  }

  // Inventory auto-deduct (P11): decrement linked inventory items when quote accepted.
  // Wrapped in try/catch so any failure never blocks the quote acceptance response.
  try {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', quote.tenant_id)
      .single()

    const settings = (tenantRow?.settings as Record<string, unknown> | null) ?? {}
    if (settings['inventory_auto_deduct'] === true) {
      const { data: lineItems } = await supabase
        .from('quote_line_items')
        .select('inventory_item_id, quantity')
        .eq('quote_id', quote.id)
        .not('inventory_item_id', 'is', null)

      for (const li of lineItems ?? []) {
        const itemId = li['inventory_item_id'] as string | null
        const lineQty = Number(li['quantity'] ?? 0)
        if (!itemId || lineQty <= 0) continue

        const { data: item } = await supabase
          .from('inventory_items')
          .select('id, name, quantity')
          .eq('id', itemId)
          .eq('tenant_id', quote.tenant_id)
          .is('deleted_at', null)
          .single()

        if (!item) continue

        const currentQty = Number(item.quantity ?? 0)
        const newQty = Math.max(0, currentQty - lineQty)
        const clamped = currentQty - lineQty < 0

        await supabase
          .from('inventory_items')
          .update({ quantity: newQty, updated_at: new Date().toISOString() })
          .eq('id', item.id)
          .eq('tenant_id', quote.tenant_id)

        void logActivity({
          tenantId: quote.tenant_id,
          type: 'inventory_adjust',
          body: `Inventory deducted: -${lineQty} ${item.name} (Quote #${quote.quote_number} accepted)`,
          metadata: {
            item_id: item.id,
            item_name: item.name,
            delta: -lineQty,
            new_quantity: newQty,
            quote_id: quote.id,
            clamped,
          },
          actorType: 'ai',
        })
      }
    }
  } catch (err) {
    console.error('[quotes] inventory auto-deduct failed:', err)
    try {
      const { Sentry } = await import('../lib/sentry.js')
      if (err instanceof Error) Sentry.captureException(err)
    } catch {
      // sentry import failure — already logged above
    }
  }

  res.json({ accepted: true })
})

// ── PUBLIC: POST /api/quotes/view/:token/decline ─────────────────────────────
router.post('/view/:token/decline', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, quote_number, contact_id, followup_job_id')
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

  // Cancel 48h follow-up job if it exists
  if (quote.followup_job_id) {
    try {
      const queue = getFollowupQueue()
      const job = await queue.getJob(quote.followup_job_id)
      if (job) await job.remove()
      console.info(`[quotes] cancelled follow-up job — quote declined`)
    } catch (err) {
      console.error('[quotes] failed to cancel follow-up job:', err)
    }
  }

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

  void logActivity({
    tenantId: quote.tenant_id,
    contactId: quote.contact_id ?? undefined,
    type: 'quote',
    body: `Quote declined: "${quote.quote_number}"${reason ? ` — ${reason}` : ''}`,
    metadata: { quote_id: quote.id, status: 'declined', reason },
    actorType: 'contact',
  })

  if (quote.contact_id) enqueueScoreCompute(quote.tenant_id, quote.contact_id, 'quote_declined')

  res.json({ declined: true })
})

// ── POST /api/quotes/:id/approve ─────────────────────────────────────────────
router.post(
  '/:id/approve',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: quote } = await supabase
      .from('quotes')
      .select('id, quote_number, approval_status, discount_pct, created_by')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' })
      return
    }
    if (quote.approval_status !== 'pending') {
      res.status(400).json({ error: 'Quote is not pending approval' })
      return
    }

    const note = typeof req.body?.note === 'string' ? req.body.note : null

    await supabase
      .from('quotes')
      .update({
        approval_status: 'approved',
        approved_by: authed.userId,
        approved_at: new Date().toISOString(),
        approval_note: note,
      })
      .eq('id', quote.id)

    void sendPushNotification(authed.tenantId, {
      title: 'Quote Approved',
      body: `Quote ${quote.quote_number} has been approved. You can now send it.`,
      url: `/quotes/${quote.id}`,
    })

    void logAuditEvent({
      tenantId: authed.tenantId,
      action: 'quote_approved',
      resourceType: 'quotes',
      resourceId: quote.id,
      details: { discount_pct: quote.discount_pct, note },
    })

    void logActivity({
      tenantId: authed.tenantId,
      contactId: undefined,
      type: 'quote',
      body: 'Quote approved by owner',
      metadata: { quote_id: quote.id, status: 'approved', note },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({ approved: true, quote_number: quote.quote_number })
  }
)

// ── POST /api/quotes/:id/reject ─────────────────────────────────────────────
router.post(
  '/:id/reject',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: quote } = await supabase
      .from('quotes')
      .select('id, quote_number, approval_status, discount_pct')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' })
      return
    }
    if (quote.approval_status !== 'pending') {
      res.status(400).json({ error: 'Quote is not pending approval' })
      return
    }

    const note = typeof req.body?.note === 'string' ? req.body.note : null

    await supabase
      .from('quotes')
      .update({ approval_status: 'rejected', approval_note: note })
      .eq('id', quote.id)

    void sendPushNotification(authed.tenantId, {
      title: 'Quote Rejected',
      body: `Quote ${quote.quote_number} was rejected: ${note || 'No reason given'}`,
      url: `/quotes/${quote.id}`,
    })

    void logAuditEvent({
      tenantId: authed.tenantId,
      action: 'quote_rejected',
      resourceType: 'quotes',
      resourceId: quote.id,
      details: { discount_pct: quote.discount_pct, note },
    })

    void logActivity({
      tenantId: authed.tenantId,
      contactId: undefined,
      type: 'quote',
      body: `Quote rejected: "${quote.quote_number}"${note ? ` — ${note}` : ''}`,
      metadata: { quote_id: quote.id, status: 'rejected', note },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({ rejected: true, quote_number: quote.quote_number })
  }
)

// ── POST /api/quotes/:id/add-package ────────────────────────────────────────
router.post(
  '/:id/add-package',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const packageId = typeof req.body?.package_id === 'string' ? req.body.package_id : null

    if (!packageId) {
      res.status(400).json({ error: 'package_id is required' })
      return
    }

    // Verify quote belongs to tenant
    const { data: quote } = await supabase
      .from('quotes')
      .select('id, tenant_id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' })
      return
    }

    // Verify package belongs to same tenant
    const { data: pkg } = await supabase
      .from('service_packages')
      .select('id, name, items, bundle_price')
      .eq('id', packageId)
      .eq('tenant_id', authed.tenantId)
      .eq('is_active', true)
      .single()

    if (!pkg) {
      res.status(404).json({ error: 'Package not found' })
      return
    }

    const pkgItems = pkg.items as Array<{ service_id: string; qty: number }>

    // Resolve service records
    const serviceIds = pkgItems.map((i) => i.service_id)
    const { data: services } = await supabase
      .from('services')
      .select('id, name, unit_price')
      .in('id', serviceIds)

    const serviceMap = new Map(
      (services ?? []).map((s) => [
        s.id,
        { name: s.name as string, unit_price: Number(s.unit_price) },
      ])
    )

    // Get current max sort_order
    const { data: existingItems } = await supabase
      .from('quote_line_items')
      .select('sort_order')
      .eq('quote_id', quote.id)
      .order('sort_order', { ascending: false })
      .limit(1)
    const maxSort = existingItems?.[0]?.sort_order ?? -1

    // Build line item rows for each package service
    let listPriceTotal = 0
    const rows: Array<Record<string, unknown>> = []
    let sortIdx = maxSort + 1

    for (const item of pkgItems) {
      const svc = serviceMap.get(item.service_id)
      if (!svc) continue
      const lineTotal = Number((item.qty * svc.unit_price).toFixed(2))
      listPriceTotal += lineTotal
      rows.push({
        quote_id: quote.id,
        service_id: item.service_id,
        package_id: packageId,
        description: svc.name,
        quantity: item.qty,
        unit_price: svc.unit_price,
        total: lineTotal,
        sort_order: sortIdx++,
      })
    }

    // Add the discount row (negative amount)
    const savings = Number((listPriceTotal - Number(pkg.bundle_price)).toFixed(2))
    if (savings > 0) {
      rows.push({
        quote_id: quote.id,
        service_id: null,
        package_id: packageId,
        description: `${pkg.name} — Bundle Savings`,
        quantity: 1,
        unit_price: -savings,
        total: -savings,
        sort_order: sortIdx,
      })
    }

    const { error: insertErr } = await supabase.from('quote_line_items').insert(rows)
    if (insertErr) {
      res.status(500).json({ error: insertErr.message })
      return
    }

    // Return updated quote with all line items
    const { data: updatedQuote } = await supabase
      .from('quotes')
      .select('*, contacts(full_name, phone, email)')
      .eq('id', quote.id)
      .single()
    const { data: allItems } = await supabase
      .from('quote_line_items')
      .select('*')
      .eq('quote_id', quote.id)
      .order('sort_order', { ascending: true })

    res.json({ ...updatedQuote, line_items: allItems ?? [] })
  }
)

// ── DELETE /api/quotes/:quoteId/items/:itemId ───────────────────────────────
router.delete(
  '/:quoteId/items/:itemId',
  requireAuth,
  requireCpq,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Verify quote belongs to tenant
    const { data: quote } = await supabase
      .from('quotes')
      .select('id')
      .eq('id', req.params['quoteId'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' })
      return
    }

    // Check if item has a package_id
    const { data: item } = await supabase
      .from('quote_line_items')
      .select('id, package_id')
      .eq('id', req.params['itemId'])
      .eq('quote_id', quote.id)
      .single()

    if (!item) {
      res.status(404).json({ error: 'Line item not found' })
      return
    }

    let warning: string | null = null

    if (item.package_id) {
      // Delete entire package group
      await supabase
        .from('quote_line_items')
        .delete()
        .eq('quote_id', quote.id)
        .eq('package_id', item.package_id)
      warning = 'Entire package group removed.'
    } else {
      // Delete single item
      await supabase.from('quote_line_items').delete().eq('id', item.id)
    }

    res.json({ deleted: true, ...(warning ? { warning } : {}) })
  }
)

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

// ── Quote approval email HTML helper ────────────────────────────────────────
function quoteApprovalEmailHtml(vars: {
  quoteNumber: string
  title: string
  contactName: string
  subtotal: string
  discountPct: string
  discountAmount: string
  total: string
  quoteUrl: string
  businessName: string
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.c{max-width:560px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.discount{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:16px 0}
.discount strong{color:#d97706}
.total{font-size:24px;font-weight:700;color:#0d9488;margin:12px 0}
.btn{display:inline-block;padding:14px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}
table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:6px 0;font-size:14px;color:#444}
td:last-child{text-align:right}</style>
</head><body><div class="c"><div class="card">
<h1>Quote Approval Required</h1>
<p>A quote needs your approval before it can be sent.</p>
<table>
<tr><td style="color:#999">Quote</td><td><strong>${vars.quoteNumber}</strong></td></tr>
<tr><td style="color:#999">Title</td><td>${vars.title}</td></tr>
${vars.contactName ? `<tr><td style="color:#999">Contact</td><td>${vars.contactName}</td></tr>` : ''}
<tr><td style="color:#999">Subtotal</td><td>${vars.subtotal}</td></tr>
</table>
<div class="discount">
<strong>${vars.discountPct}% discount applied</strong> &mdash; ${vars.discountAmount} off
</div>
<div class="total">${vars.total}</div>
<p style="margin-top:24px"><a class="btn" href="${vars.quoteUrl}">Review This Quote</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}

export default router

// Export for internal use (auto-quote from calls)
export { nextQuoteNumber, calcTotals }
