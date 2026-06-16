import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import {
  getOrCreateStripeCustomer,
  createStripeSubscription,
  cancelStripeSubscription,
  pauseStripeSubscription,
  resumeStripeSubscription,
} from '../lib/stripe-subscriptions.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const VALID_INTERVALS = ['weekly', 'monthly', 'quarterly', 'annually']

// ── GET /api/subscriptions ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const status = req.query['status'] ? String(req.query['status']) : null
  const contactId = req.query['contact_id'] ? String(req.query['contact_id']) : null
  const offset = (page - 1) * limit

  let query = supabase
    .from('client_subscriptions')
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
  res.json({ subscriptions: data ?? [], total, page, pages: Math.ceil(total / limit) })
})

// ── GET /api/subscriptions/:id ────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: subscription, error } = await supabase
    .from('client_subscriptions')
    .select('*, contacts(full_name)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !subscription) {
    res.status(404).json({ error: 'Subscription not found' })
    return
  }

  res.json(subscription)
})

// ── POST /api/subscriptions ───────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest

    if (!process.env['STRIPE_SECRET_KEY']) {
      res.status(503).json({ error: 'Stripe not configured' })
      return
    }

    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    // Validate required fields
    if (!b['contact_id'] || typeof b['contact_id'] !== 'string') {
      res.status(400).json({ error: 'contact_id is required' })
      return
    }
    if (!b['name'] || typeof b['name'] !== 'string') {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const amount =
      typeof b['amount'] === 'number' ? b['amount'] : parseFloat(String(b['amount'] ?? ''))
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' })
      return
    }
    const interval = typeof b['interval'] === 'string' ? b['interval'] : ''
    if (!VALID_INTERVALS.includes(interval)) {
      res.status(400).json({ error: `interval must be one of: ${VALID_INTERVALS.join(', ')}` })
      return
    }

    const contactId = b['contact_id'] as string
    const name = b['name'] as string
    const description = typeof b['description'] === 'string' ? b['description'] : undefined
    const currency = typeof b['currency'] === 'string' ? b['currency'] : 'usd'

    // 1. Fetch contact for this tenant
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('email, full_name')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (contactErr || !contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    try {
      // 2. Get or create Stripe customer
      const customerId = await getOrCreateStripeCustomer({
        tenantId: authed.tenantId,
        contactId,
        email: contact.email as string,
        name: (contact.full_name as string) ?? name,
      })

      // 3. Create Stripe subscription
      const result = await createStripeSubscription({
        tenantId: authed.tenantId,
        contactId,
        customerId,
        amount,
        currency,
        interval,
        name,
        description,
      })

      // 4. Insert into client_subscriptions
      const { data: subscription, error: insertErr } = await supabase
        .from('client_subscriptions')
        .insert({
          tenant_id: authed.tenantId,
          contact_id: contactId,
          name,
          description: description ?? null,
          amount,
          currency,
          interval,
          interval_count: 1,
          status: result.status,
          stripe_subscription_id: result.subscriptionId,
          stripe_customer_id: customerId,
          stripe_price_id: result.priceId,
        })
        .select('*, contacts(full_name)')
        .single()

      if (insertErr || !subscription) {
        res.status(500).json({ error: insertErr?.message ?? 'Failed to create subscription' })
        return
      }

      res.status(201).json({ subscription, client_secret: result.clientSecret })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      res.status(502).json({ error: message })
    }
  }
)

// ── POST /api/subscriptions/:id/cancel ───────────────────────────────────────
router.post(
  '/:id/cancel',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    const immediately = Boolean(b['immediately'])

    const { data: subscription, error: fetchErr } = await supabase
      .from('client_subscriptions')
      .select('id, stripe_subscription_id, status, current_period_end')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (fetchErr || !subscription) {
      res.status(404).json({ error: 'Subscription not found' })
      return
    }

    try {
      await cancelStripeSubscription(subscription.stripe_subscription_id as string, immediately)

      const cancelledAt = new Date().toISOString()
      const updateFields: Record<string, unknown> = {
        cancelled_at: cancelledAt,
        updated_at: cancelledAt,
      }

      if (immediately) {
        updateFields['status'] = 'cancelled'
      } else {
        // Stripe will cancel at period end — store the period-end as cancel_at
        updateFields['cancel_at'] = subscription.current_period_end ?? null
        // Status stays active until the webhook fires customer.subscription.deleted
      }

      const { error: updateErr } = await supabase
        .from('client_subscriptions')
        .update(updateFields)
        .eq('id', subscription.id)

      if (updateErr) {
        res.status(500).json({ error: updateErr.message })
        return
      }

      res.json({ cancelled_at: cancelledAt })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      res.status(502).json({ error: message })
    }
  }
)

// ── POST /api/subscriptions/:id/pause ────────────────────────────────────────
router.post(
  '/:id/pause',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: subscription, error: fetchErr } = await supabase
      .from('client_subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (fetchErr || !subscription) {
      res.status(404).json({ error: 'Subscription not found' })
      return
    }

    if (subscription.status !== 'active') {
      res.status(400).json({ error: 'Only active subscriptions can be paused' })
      return
    }

    try {
      await pauseStripeSubscription(subscription.stripe_subscription_id as string)

      const { error: updateErr } = await supabase
        .from('client_subscriptions')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', subscription.id)

      if (updateErr) {
        res.status(500).json({ error: updateErr.message })
        return
      }

      res.json({ status: 'paused' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      res.status(502).json({ error: message })
    }
  }
)

// ── POST /api/subscriptions/:id/resume ───────────────────────────────────────
router.post(
  '/:id/resume',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: subscription, error: fetchErr } = await supabase
      .from('client_subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (fetchErr || !subscription) {
      res.status(404).json({ error: 'Subscription not found' })
      return
    }

    if (subscription.status !== 'paused') {
      res.status(400).json({ error: 'Only paused subscriptions can be resumed' })
      return
    }

    try {
      await resumeStripeSubscription(subscription.stripe_subscription_id as string)

      const { error: updateErr } = await supabase
        .from('client_subscriptions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', subscription.id)

      if (updateErr) {
        res.status(500).json({ error: updateErr.message })
        return
      }

      res.json({ status: 'active' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      res.status(502).json({ error: message })
    }
  }
)

export default router

// ── calcMonthlyEquivalent — exported for testing ──────────────────────────────
export function calcMonthlyEquivalent(amount: number, interval: string): number {
  switch (interval) {
    case 'weekly':
      return (amount * 52) / 12
    case 'quarterly':
      return amount / 3
    case 'annually':
      return amount / 12
    default:
      return amount // monthly
  }
}

// ── processPauseSubscription — exported for testing ───────────────────────────
export async function processPauseSubscription(
  subscriptionId: string,
  tenantId: string
): Promise<{ status: number; data?: unknown; error?: string }> {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return { status: 500, error: 'Supabase env vars not set' }
  const supabase = createClient(url, key)

  const { data: subscription, error: fetchErr } = await supabase
    .from('client_subscriptions')
    .select('id, stripe_subscription_id, status')
    .eq('id', subscriptionId)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !subscription) {
    return { status: 404, error: 'Subscription not found' }
  }

  if (subscription['status'] !== 'active') {
    return { status: 400, error: 'Only active subscriptions can be paused' }
  }

  const { pauseStripeSubscription: pauseFn } = await import('../lib/stripe-subscriptions.js')
  await pauseFn(subscription['stripe_subscription_id'] as string)

  const { error: updateErr } = await supabase
    .from('client_subscriptions')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', subscription['id'])

  if (updateErr) {
    return { status: 500, error: updateErr.message }
  }

  return { status: 200, data: { status: 'paused' } }
}

// ── getSubscriptionsForTenant — exported for testing ─────────────────────────
export async function getSubscriptionsForTenant(
  tenantId: string
): Promise<{ data: unknown[]; error?: string }> {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return { data: [], error: 'Supabase env vars not set' }
  const supabase = createClient(url, key)

  const { data, error } = await supabase
    .from('client_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data as unknown[]) ?? [] }
}
