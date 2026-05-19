import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getStripe() {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(key)
}

// ── GET /api/payment-links ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('payment_links')
    .select('*, contacts(full_name, phone)')
    .eq('tenant_id', authed.tenantId)
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ payment_links: data ?? [] })
})

// ── POST /api/payment-links ───────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const amount = typeof b['amount'] === 'number' ? b['amount'] : parseFloat(String(b['amount']))
  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' })
    return
  }

  const description = typeof b['description'] === 'string' ? b['description'].trim() : ''
  if (!description) {
    res.status(400).json({ error: 'description is required' })
    return
  }

  const contactId = typeof b['contactId'] === 'string' ? b['contactId'] || null : null
  const label = typeof b['label'] === 'string' ? b['label'].trim() || null : null
  const currency = typeof b['currency'] === 'string' ? b['currency'] : 'usd'

  let stripe: Stripe
  try {
    stripe = getStripe()
  } catch {
    res.status(500).json({ error: 'Stripe is not configured on this server' })
    return
  }

  const price = await stripe.prices.create({
    currency,
    unit_amount: Math.round(amount * 100),
    product_data: { name: description },
  })

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: {
      type: 'hosted_confirmation',
      hosted_confirmation: { custom_message: 'Thank you for your payment!' },
    },
    metadata: {
      tenantId: authed.tenantId,
      contactId: contactId ?? '',
      label: label ?? '',
    },
  })

  const { data: record, error: dbErr } = await supabase
    .from('payment_links')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: contactId,
      stripe_link_id: link.id,
      url: link.url,
      amount: Number(amount.toFixed(2)),
      description,
      label,
    })
    .select('*')
    .single()

  if (dbErr || !record) {
    res.status(500).json({ error: dbErr?.message ?? 'Failed to save payment link' })
    return
  }

  res.status(201).json({
    id: record.id,
    url: record.url,
    amount: record.amount,
    description: record.description,
  })
})

// ── DELETE /api/payment-links/:id ────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: record } = await supabase
    .from('payment_links')
    .select('id, stripe_link_id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!record) {
    res.status(404).json({ error: 'Payment link not found' })
    return
  }

  try {
    const stripe = getStripe()
    await stripe.paymentLinks.update(record.stripe_link_id, { active: false })
  } catch (err) {
    console.error('[payment-links] stripe deactivate error:', err)
  }

  await supabase.from('payment_links').update({ active: false }).eq('id', record.id)

  res.json({ deactivated: true })
})

export default router
