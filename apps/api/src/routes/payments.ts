import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { getStripeOrNull } from '../lib/stripe-client.js'
import { getTenantConnectAccount, connectRequestOptions } from '../lib/stripe-connect.js'

const router = Router()

interface LedgerEntry {
  id: string
  source: 'stripe' | 'cash' | 'check' | 'square' | 'other'
  amount: number
  currency: string
  status: string
  created_at: string
  description: string | null
  customer: string | null
  receipt_url: string | null
  quote_id: string | null
  contact_name: string | null
  metadata: Record<string, string>
  // Refund action data — only ever set for a manual/Square quote_payments row
  // (id format `manual_<uuid>`, uuid = quote_payments.id). Stripe ledger
  // entries pulled live from stripe.charges.list() are never refundable from
  // here — see migration 0189's comment for why.
  quote_payment_id: string | null
  refundable_amount: number | null
  refund_status: 'none' | 'partial' | 'full' | null
}

// ── GET /api/payments/ledger ──────────────────────────────────────────────────
router.get('/ledger', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const entries: LedgerEntry[] = []

  // Stripe charges. A connected tenant's charges live entirely on their own
  // account (charges.list there is already tenant-scoped by construction —
  // no other tenant's charge can appear), so the metadata filter below is
  // only needed for the shared-platform-account branch.
  const stripe = getStripeOrNull()
  const connectAccount = stripe ? await getTenantConnectAccount(supabase, authed.tenantId) : null
  if (stripe) {
    try {
      const charges = await stripe.charges.list(
        { limit: 100 },
        connectRequestOptions(connectAccount)
      )
      for (const charge of charges.data) {
        // Only include charges whose metadata tenantId matches this tenant.
        // Charges without metadata.tenantId are skipped (safe default — Stripe
        // account is shared across tenants). Skipped entirely on a connected
        // account, since every charge there already belongs to this tenant.
        if (!connectAccount && charge.metadata['tenantId'] !== authed.tenantId) continue
        entries.push({
          id: `stripe_${charge.id}`,
          source: 'stripe',
          amount: charge.amount / 100,
          currency: charge.currency,
          status: charge.status,
          created_at: new Date(charge.created * 1000).toISOString(),
          description: charge.description ?? null,
          customer:
            typeof charge.billing_details?.email === 'string' ? charge.billing_details.email : null,
          receipt_url: charge.receipt_url ?? null,
          quote_id: charge.metadata['quote_id'] ?? null,
          contact_name: null,
          metadata: charge.metadata as Record<string, string>,
          quote_payment_id: null,
          refundable_amount: null,
          refund_status: null,
        })
      }
    } catch (err) {
      console.error('[payments] stripe charges fetch error:', err)
    }
  }

  // Manual (offline) payments from quote_payments
  const { data: manualPayments } = await supabase
    .from('quote_payments')
    .select(
      'id, amount, method, provider, square_payment_id, refunded_amount, refund_status, recorded_at, notes, quote_id, quotes(quote_number, contacts(full_name))'
    )
    .eq('tenant_id', authed.tenantId)
    .order('recorded_at', { ascending: false })
    .limit(200)

  for (const mp of manualPayments ?? []) {
    const quote = mp.quotes as {
      quote_number?: string
      contacts?: { full_name?: string } | null
    } | null
    const refundable = mp.provider === 'square' && mp.square_payment_id
    entries.push({
      id: `manual_${mp.id}`,
      source: (mp.method as LedgerEntry['source']) ?? 'other',
      amount: Number(mp.amount),
      currency: 'usd',
      status: 'succeeded',
      created_at: mp.recorded_at,
      description: mp.notes ?? (quote?.quote_number ? `Quote ${quote.quote_number}` : null),
      customer: quote?.contacts?.full_name ?? null,
      receipt_url: null,
      quote_id: mp.quote_id ?? null,
      contact_name: quote?.contacts?.full_name ?? null,
      metadata: {},
      quote_payment_id: refundable ? mp.id : null,
      refundable_amount: refundable
        ? Number((Number(mp.amount) - Number(mp.refunded_amount ?? 0)).toFixed(2))
        : null,
      refund_status: refundable
        ? ((mp.refund_status as LedgerEntry['refund_status']) ?? 'none')
        : null,
    })
  }

  // Sort by date desc
  entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const stripeVolume = entries
    .filter((e) => e.source === 'stripe' && e.status === 'succeeded')
    .reduce((s, e) => s + e.amount, 0)
  const manualVolume = entries
    .filter((e) => e.source !== 'stripe')
    .reduce((s, e) => s + e.amount, 0)
  const totalVolume = stripeVolume + manualVolume

  res.json({
    transactions: entries,
    totalVolume: Number(totalVolume.toFixed(2)),
    totalCount: entries.length,
    stripeVolume: Number(stripeVolume.toFixed(2)),
    manualVolume: Number(manualVolume.toFixed(2)),
  })
})

// ── GET /api/payments/summary ─────────────────────────────────────────────────
router.get('/summary', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Manual payments last 30 days
  const { data: recentManual } = await supabase
    .from('quote_payments')
    .select('id, amount, method, recorded_at')
    .eq('tenant_id', authed.tenantId)
    .gte('recorded_at', since30)

  const byMethod: Record<string, { count: number; amount: number }> = {
    stripe: { count: 0, amount: 0 },
    cash: { count: 0, amount: 0 },
    check: { count: 0, amount: 0 },
    square: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  }

  let manualTotal = 0
  for (const mp of recentManual ?? []) {
    const method = (mp.method as string) ?? 'other'
    const amt = Number(mp.amount)
    const bucket = byMethod[method] ?? byMethod['other']!
    bucket.count++
    bucket.amount += amt
    manualTotal += amt
  }

  // Stripe volume last 30 days (best-effort)
  let stripeTotal = 0
  let stripeCount = 0
  const stripe = getStripeOrNull()
  const connectAccount = stripe ? await getTenantConnectAccount(supabase, authed.tenantId) : null
  if (stripe) {
    try {
      const charges = await stripe.charges.list(
        {
          limit: 100,
          created: { gte: Math.floor(Date.now() / 1000 - 30 * 24 * 60 * 60) },
        },
        connectRequestOptions(connectAccount)
      )
      for (const c of charges.data) {
        if (!connectAccount && c.metadata['tenantId'] !== authed.tenantId) continue
        if (c.status === 'succeeded') {
          stripeTotal += c.amount / 100
          stripeCount++
        }
      }
    } catch (err) {
      console.error('[payments] stripe summary error:', err)
    }
  }

  byMethod['stripe']!.count = stripeCount
  byMethod['stripe']!.amount = stripeTotal

  const totalCollected = manualTotal + stripeTotal
  const totalCount = (recentManual?.length ?? 0) + stripeCount
  const avgTransaction = totalCount > 0 ? totalCollected / totalCount : 0

  res.json({
    last30Days: {
      totalCollected: Number(totalCollected.toFixed(2)),
      transactionCount: totalCount,
      avgTransaction: Number(avgTransaction.toFixed(2)),
    },
    byMethod,
  })
})

export default router
