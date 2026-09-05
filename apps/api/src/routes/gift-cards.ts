import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { giftCardBalanceLimiter } from '../middleware/rate-limit.js'
import { logActivity } from '../lib/activity.js'
import { getStripeOrNull } from '../lib/stripe-client.js'
import { getTenantConnectAccount, connectRequestOptions } from '../lib/stripe-connect.js'

const router = Router()

const PAYMENT_METHODS = ['cash', 'card', 'stripe', 'other'] as const
type PaymentMethod = (typeof PAYMENT_METHODS)[number]

// GET /api/gift-cards — list for tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('gift_cards')
    .select(
      'id, code, amount_cents, balance_cents, status, recipient_name, recipient_email, expires_at, created_at'
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ gift_cards: data ?? [] })
})

// POST /api/gift-cards — create
// Requires payment_method — a gift card can no longer be issued for free.
// 'cash'/'card'/'other' mean payment was already collected through an
// external channel (in-person sale, terminal) and the tenant is just
// recording it, same as quote_payments' offline methods. 'stripe' actually
// collects payment: the card is created 'pending_payment' with a Stripe
// Payment Link, and only activates once that link is paid (see
// stripe-webhooks.ts's checkout.session.completed handler).
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { amount_cents, recipient_name, recipient_email, purchased_by_contact_id, payment_method } =
    req.body as {
      amount_cents?: number
      recipient_name?: string
      recipient_email?: string
      purchased_by_contact_id?: string
      payment_method?: string
    }
  if (!amount_cents || amount_cents <= 0) {
    res.status(400).json({ error: 'amount_cents required and must be > 0' })
    return
  }
  if (!payment_method || !PAYMENT_METHODS.includes(payment_method as PaymentMethod)) {
    res.status(400).json({ error: `payment_method must be one of ${PAYMENT_METHODS.join(', ')}` })
    return
  }

  const supabase = getServiceClient()
  const isStripe = payment_method === 'stripe'

  const { data, error } = await supabase
    .from('gift_cards')
    .insert({
      tenant_id: authed.tenantId,
      amount_cents,
      balance_cents: amount_cents,
      recipient_name: recipient_name ?? null,
      recipient_email: recipient_email ?? null,
      purchased_by_contact_id: purchased_by_contact_id ?? null,
      payment_method,
      status: isStripe ? 'pending_payment' : 'active',
    })
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  let paymentUrl: string | null = null
  if (isStripe) {
    const stripe = getStripeOrNull()
    if (!stripe) {
      res.status(503).json({ error: 'Online payment is not configured for this business yet' })
      return
    }
    const connectAccount = await getTenantConnectAccount(supabase, authed.tenantId)
    const connectOptions = connectRequestOptions(connectAccount)
    const price = await stripe.prices.create(
      {
        currency: 'usd',
        unit_amount: amount_cents,
        product_data: { name: `Gift card — ${data.code as string}` },
      },
      connectOptions
    )
    const link = await stripe.paymentLinks.create(
      {
        line_items: [{ price: price.id, quantity: 1 }],
        after_completion: {
          type: 'hosted_confirmation',
          hosted_confirmation: { custom_message: 'Thank you! Your gift card is now active.' },
        },
        metadata: {
          kind: 'gift_card_purchase',
          tenantId: authed.tenantId,
          giftCardId: data.id as string,
        },
        // No application_fee_amount here — Payment Links don't support it
        // (see payment-link.ts's createPaymentLink for the full note).
      },
      connectOptions
    )
    await supabase.from('gift_cards').update({ stripe_payment_link_id: link.id }).eq('id', data.id)
    paymentUrl = link.url
  }

  // Best-effort email notification (just log for now)
  if (recipient_email) {
    console.info(
      `[gift-cards] gift card ${data.code} issued to ${recipient_email}, balance: ${amount_cents}, method: ${payment_method}`
    )
  }
  res.status(201).json({
    ...data,
    payment_method,
    status: isStripe ? 'pending_payment' : 'active',
    payment_url: paymentUrl,
  })
})

// POST /api/gift-cards/redeem — { code, amount_cents }
// MUST be registered before /:code to avoid route conflict
router.post('/redeem', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { code, amount_cents } = req.body as { code?: string; amount_cents?: number }
  if (!code || !amount_cents || amount_cents <= 0) {
    res.status(400).json({ error: 'code and amount_cents required' })
    return
  }
  const supabase = getServiceClient()
  const { data: card, error: fetchErr } = await supabase
    .from('gift_cards')
    .select('id, balance_cents, status')
    .eq('code', code.toUpperCase())
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!card) {
    res.status(404).json({ error: 'Gift card not found' })
    return
  }
  if (card.status !== 'active') {
    res.status(400).json({ error: `Gift card is ${card.status}` })
    return
  }
  if (card.balance_cents < amount_cents) {
    res.status(400).json({ error: 'Insufficient balance', balance_cents: card.balance_cents })
    return
  }
  const new_balance_cents = card.balance_cents - amount_cents
  const new_status = new_balance_cents === 0 ? 'redeemed' : 'active'
  const { error: updateErr } = await supabase
    .from('gift_cards')
    .update({ balance_cents: new_balance_cents, status: new_status })
    .eq('id', card.id)
  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }
  res.json({ success: true, new_balance_cents })
})

// PATCH /api/gift-cards/:id/transfer — reassign a gift card to a new owner
router.patch('/:id/transfer', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { contact_id, recipient_name, recipient_email } = req.body as {
    contact_id?: string | null
    recipient_name?: string
    recipient_email?: string
  }

  if (contact_id === undefined && recipient_name === undefined && recipient_email === undefined) {
    res.status(400).json({ error: 'Nothing to transfer' })
    return
  }

  const supabase = getServiceClient()
  const { data: card, error: fetchErr } = await supabase
    .from('gift_cards')
    .select('id, code, status, purchased_by_contact_id, recipient_name, recipient_email')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!card) {
    res.status(404).json({ error: 'Gift card not found' })
    return
  }
  if (card.status !== 'active') {
    res.status(400).json({ error: `Cannot transfer a ${card.status} gift card` })
    return
  }

  if (contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contact_id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()
    if (!contact) {
      res.status(400).json({ error: 'Contact not found' })
      return
    }
  }

  const updates: Record<string, unknown> = {}
  if (contact_id !== undefined) updates['purchased_by_contact_id'] = contact_id
  if (recipient_name !== undefined) updates['recipient_name'] = recipient_name
  if (recipient_email !== undefined) updates['recipient_email'] = recipient_email

  const { data: updated, error: updateErr } = await supabase
    .from('gift_cards')
    .update(updates)
    .eq('id', card.id)
    .select()
    .single()

  if (updateErr || !updated) {
    res.status(500).json({ error: updateErr?.message ?? 'Failed to transfer' })
    return
  }

  void logActivity({
    tenantId: authed.tenantId,
    contactId: contact_id ?? undefined,
    type: 'system',
    body: `Gift card ${card.code} transferred${recipient_name ? ` to ${recipient_name}` : ''}`,
    metadata: { gift_card_id: card.id },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.json(updated)
})

// GET /api/gift-cards/:code/balance — authed, tenant-scoped
router.get(
  '/:code/balance',
  requireAuth,
  giftCardBalanceLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const code = req.params['code']
    if (!code) {
      res.status(400).json({ error: 'code param required' })
      return
    }
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('gift_cards')
      .select('balance_cents, status, expires_at')
      .eq('code', code.toUpperCase())
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    if (!data) {
      res.status(404).json({ error: 'Gift card not found' })
      return
    }
    res.json({
      balance_cents: data.balance_cents,
      status: data.status,
      expires_at: data.expires_at,
    })
  }
)

export default router
