import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { createPaymentLink, getStripe } from '../lib/payment-link.js'
import { deactivateSquareCheckoutLink } from '../lib/square-client.js'
import { connectRequestOptions } from '../lib/stripe-connect.js'

const router = Router()

// ── GET /api/payment-links ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

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
  let tipAmount: number | null = null
  if (b['tipAmount'] !== undefined && b['tipAmount'] !== null && b['tipAmount'] !== '') {
    const parsed =
      typeof b['tipAmount'] === 'number' ? b['tipAmount'] : parseFloat(String(b['tipAmount']))
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: 'tipAmount must be a non-negative number' })
      return
    }
    tipAmount = parsed
  }

  try {
    const record = await createPaymentLink({
      tenantId: authed.tenantId,
      amount,
      description,
      contactId,
      label,
      currency,
      tipAmount,
    })
    res.status(201).json(record)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create payment link'
    const isConfigError = message.includes('STRIPE_SECRET_KEY') || message.includes('No Square')
    res.status(500).json({
      error: isConfigError ? 'No payment processor is configured on this server' : message,
    })
  }
})

// ── DELETE /api/payment-links/:id ────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: record } = await supabase
    .from('payment_links')
    .select('id, stripe_link_id, square_payment_link_id, processor, stripe_connect_account_id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!record) {
    res.status(404).json({ error: 'Payment link not found' })
    return
  }

  try {
    if (record.processor === 'square' && record.square_payment_link_id) {
      await deactivateSquareCheckoutLink(authed.tenantId, record.square_payment_link_id)
    } else if (record.stripe_link_id) {
      const stripe = getStripe()
      await stripe.paymentLinks.update(
        record.stripe_link_id,
        { active: false },
        connectRequestOptions(record.stripe_connect_account_id as string | null)
      )
    }
  } catch (err) {
    console.error('[payment-links] processor deactivate error:', err)
  }

  await supabase.from('payment_links').update({ active: false }).eq('id', record.id)

  res.json({ deactivated: true })
})

export default router
