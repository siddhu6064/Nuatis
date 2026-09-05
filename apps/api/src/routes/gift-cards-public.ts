import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { bookingLimiter, giftCardBalanceLimiter } from '../middleware/rate-limit.js'
import { getStripeOrNull } from '../lib/stripe-client.js'
import { getTenantConnectAccount, connectRequestOptions } from '../lib/stripe-connect.js'

// PUBLIC router — no auth. Mounted at /api/gift-cards-public. Tenant is
// resolved by the same booking_page_slug used for the public booking page
// (no dedicated gift-card slug exists — reusing it avoids a new tenant
// column for what's the same "this business has a public storefront" flag).
const router = Router()

const MIN_AMOUNT_CENTS = 500 // $5
const MAX_AMOUNT_CENTS = 100000 // $1,000 — a public, unauthenticated purchase cap

// ── GET /:slug/balance/:code ──────────────────────────────────────────────────
router.get(
  '/:slug/balance/:code',
  giftCardBalanceLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { slug, code } = req.params
    const supabase = getServiceClient()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, booking_page_enabled')
      .eq('booking_page_slug', slug)
      .maybeSingle()

    if (!tenant || !tenant.booking_page_enabled) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data, error } = await supabase
      .from('gift_cards')
      .select('balance_cents, status, expires_at')
      .eq('code', (code ?? '').toUpperCase())
      .eq('tenant_id', tenant.id)
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

// ── POST /:slug — public purchase ─────────────────────────────────────────────
// Always pays online — a self-service buyer can't self-report cash/card as
// already collected the way staff can from gift-cards.ts's authed POST /.
router.post('/:slug', bookingLimiter, async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const { amount_cents, recipient_name, recipient_email, buyer_name, buyer_email, buyer_phone } =
    req.body as {
      amount_cents?: number
      recipient_name?: string
      recipient_email?: string
      buyer_name?: string
      buyer_email?: string
      buyer_phone?: string
    }

  if (
    !amount_cents ||
    !Number.isInteger(amount_cents) ||
    amount_cents < MIN_AMOUNT_CENTS ||
    amount_cents > MAX_AMOUNT_CENTS
  ) {
    res.status(400).json({
      error: `amount_cents must be an integer between ${MIN_AMOUNT_CENTS} and ${MAX_AMOUNT_CENTS}`,
    })
    return
  }
  if (!buyer_name?.trim() || (!buyer_phone?.trim() && !buyer_email?.trim())) {
    res
      .status(400)
      .json({ error: 'buyer_name and at least one of buyer_phone/buyer_email are required' })
    return
  }

  const supabase = getServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, booking_page_enabled')
    .eq('booking_page_slug', slug)
    .maybeSingle()

  if (!tenant || !tenant.booking_page_enabled) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const tenantId = tenant.id as string

  const stripe = getStripeOrNull()
  if (!stripe) {
    res
      .status(503)
      .json({ error: 'Online gift card purchase is not configured for this business yet' })
    return
  }
  const connectAccount = await getTenantConnectAccount(supabase, tenantId)
  const connectOptions = connectRequestOptions(connectAccount)

  // Find-or-create the buyer contact — same phone-then-email pattern as
  // booking-public.ts's confirm route.
  let buyerContactId: string | null = null
  if (buyer_phone?.trim()) {
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('phone', buyer_phone.trim())
      .maybeSingle()
    if (byPhone) buyerContactId = byPhone.id as string
  }
  if (!buyerContactId && buyer_email?.trim()) {
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', buyer_email.trim())
      .maybeSingle()
    if (byEmail) buyerContactId = byEmail.id as string
  }
  if (!buyerContactId) {
    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        full_name: buyer_name.trim(),
        phone: buyer_phone?.trim() || null,
        email: buyer_email?.trim() || null,
        source: 'web_form',
        sms_opt_in: Boolean(buyer_phone?.trim()),
      })
      .select('id')
      .single()
    if (contactError || !newContact) {
      res.status(500).json({ error: 'Failed to save your info' })
      return
    }
    buyerContactId = newContact.id as string
  }

  const { data, error } = await supabase
    .from('gift_cards')
    .insert({
      tenant_id: tenantId,
      amount_cents,
      balance_cents: amount_cents,
      recipient_name: recipient_name?.trim() || buyer_name.trim(),
      recipient_email: recipient_email?.trim() || buyer_email?.trim() || null,
      purchased_by_contact_id: buyerContactId,
      payment_method: 'stripe',
      status: 'pending_payment',
    })
    .select()
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create gift card' })
    return
  }

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
        hosted_confirmation: {
          custom_message: `Thank you! Your ${tenant.name as string} gift card is now active.`,
        },
      },
      metadata: {
        kind: 'gift_card_purchase',
        tenantId,
        giftCardId: data.id as string,
      },
      // No application_fee_amount here — Payment Links don't support it
      // (see payment-link.ts's createPaymentLink for the full note).
    },
    connectOptions
  )
  await supabase.from('gift_cards').update({ stripe_payment_link_id: link.id }).eq('id', data.id)

  res.status(201).json({
    id: data.id,
    code: data.code,
    status: 'pending_payment',
    payment_url: link.url,
  })
})

export default router
