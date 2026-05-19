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

function getStripe(): Stripe | null {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) return null
  return new Stripe(key)
}

interface LedgerEntry {
  id: string
  source: 'stripe' | 'cash' | 'check' | 'other'
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
}

// ── GET /api/payments/ledger ──────────────────────────────────────────────────
router.get('/ledger', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const entries: LedgerEntry[] = []

  // Stripe charges
  const stripe = getStripe()
  if (stripe) {
    try {
      const charges = await stripe.charges.list({ limit: 100 })
      for (const charge of charges.data) {
        // Only include charges whose metadata tenantId matches this tenant
        if (charge.metadata['tenantId'] && charge.metadata['tenantId'] !== authed.tenantId) continue
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
      'id, amount, method, recorded_at, notes, quote_id, quotes(quote_number, contacts(full_name))'
    )
    .eq('tenant_id', authed.tenantId)
    .order('recorded_at', { ascending: false })
    .limit(200)

  for (const mp of manualPayments ?? []) {
    const quote = mp.quotes as {
      quote_number?: string
      contacts?: { full_name?: string } | null
    } | null
    entries.push({
      id: `manual_${mp.id}`,
      source: (mp.method as 'cash' | 'check' | 'other') ?? 'other',
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
  const supabase = getSupabase()

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
  const stripe = getStripe()
  if (stripe) {
    try {
      const charges = await stripe.charges.list({
        limit: 100,
        created: { gte: Math.floor(Date.now() / 1000 - 30 * 24 * 60 * 60) },
      })
      for (const c of charges.data) {
        if (c.metadata['tenantId'] && c.metadata['tenantId'] !== authed.tenantId) continue
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
