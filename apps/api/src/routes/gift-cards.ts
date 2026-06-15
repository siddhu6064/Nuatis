import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { giftCardBalanceLimiter } from '../middleware/rate-limit.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/gift-cards — list for tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
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
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { amount_cents, recipient_name, recipient_email, purchased_by_contact_id } = req.body as {
    amount_cents?: number
    recipient_name?: string
    recipient_email?: string
    purchased_by_contact_id?: string
  }
  if (!amount_cents || amount_cents <= 0) {
    res.status(400).json({ error: 'amount_cents required and must be > 0' })
    return
  }
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('gift_cards')
    .insert({
      tenant_id: authed.tenantId,
      amount_cents,
      balance_cents: amount_cents,
      recipient_name: recipient_name ?? null,
      recipient_email: recipient_email ?? null,
      purchased_by_contact_id: purchased_by_contact_id ?? null,
    })
    .select()
    .single()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  // Best-effort email notification (just log for now)
  if (recipient_email) {
    console.info(
      `[gift-cards] gift card ${data.code} issued to ${recipient_email}, balance: ${amount_cents}`
    )
  }
  res.status(201).json(data)
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
  const supabase = getSupabase()
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
    const supabase = getSupabase()
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
