import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { logActivity } from '../lib/activity.js'
import { notifyOwner } from '../lib/notifications.js'
import { bookingLimiter } from '../middleware/rate-limit.js'

// PUBLIC router — no auth. Mounted at /api/customer-referrals. Distinct
// prefix from /api/referrals (Nuatis's own tenant-affiliate program) —
// this is an SMB tenant's own customers referring their friends.
const router = Router()

// ── GET /:code — resolve a referral code for the landing page ──────────────────
router.get('/:code', bookingLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code } = req.params
  const supabase = getServiceClient()

  const { data: referral, error } = await supabase
    .from('contact_referral_codes')
    .select('id, tenant_id, contact_id, status, clicks')
    .eq('code', (code ?? '').toUpperCase())
    .maybeSingle()

  if (error || !referral || referral.status !== 'active') {
    res.status(404).json({ error: 'Referral link not found' })
    return
  }

  const [{ data: tenant }, { data: referrer }] = await Promise.all([
    supabase
      .from('tenants')
      .select('name, booking_page_enabled, booking_page_slug')
      .eq('id', referral.tenant_id)
      .single(),
    supabase.from('contacts').select('full_name').eq('id', referral.contact_id).maybeSingle(),
  ])

  await supabase
    .from('contact_referral_codes')
    .update({ clicks: (referral.clicks ?? 0) + 1 })
    .eq('id', referral.id)

  res.json({
    business_name: (tenant?.name as string | null) ?? '',
    referrer_first_name: (referrer?.full_name as string | null)?.split(' ')[0] ?? null,
    booking_page_enabled: tenant?.booking_page_enabled ?? false,
    booking_page_slug: (tenant?.booking_page_slug as string | null) ?? null,
  })
})

// ── POST /:code/lead — fallback lead-capture form ───────────────────────────────
router.post('/:code/lead', bookingLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code } = req.params
  const { full_name, phone, email, notes } = req.body as {
    full_name?: string
    phone?: string
    email?: string
    notes?: string
  }

  if (!full_name?.trim() || (!phone?.trim() && !email?.trim())) {
    res.status(400).json({ error: 'full_name and at least one of phone/email are required' })
    return
  }

  const supabase = getServiceClient()

  const { data: referral } = await supabase
    .from('contact_referral_codes')
    .select('tenant_id, contact_id, status')
    .eq('code', (code ?? '').toUpperCase())
    .maybeSingle()

  if (!referral || referral.status !== 'active') {
    res.status(404).json({ error: 'Referral link not found' })
    return
  }

  const tenantId = referral.tenant_id as string
  const referrerContactId = referral.contact_id as string

  // Find or create contact — match by phone first, then email, same as
  // booking-public.ts's confirm route.
  let contactId: string | null = null

  if (phone?.trim()) {
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('id, referred_by_contact_id')
      .eq('tenant_id', tenantId)
      .eq('phone', phone.trim())
      .maybeSingle()
    if (byPhone) {
      contactId = byPhone.id as string
      if (!byPhone.referred_by_contact_id) {
        await supabase
          .from('contacts')
          .update({
            referred_by_contact_id: referrerContactId,
            referral_source_detail: 'Referral link',
          })
          .eq('id', contactId)
      }
    }
  }

  if (!contactId && email?.trim()) {
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id, referred_by_contact_id')
      .eq('tenant_id', tenantId)
      .eq('email', email.trim())
      .maybeSingle()
    if (byEmail) {
      contactId = byEmail.id as string
      if (!byEmail.referred_by_contact_id) {
        await supabase
          .from('contacts')
          .update({
            referred_by_contact_id: referrerContactId,
            referral_source_detail: 'Referral link',
          })
          .eq('id', contactId)
      }
    }
  }

  if (!contactId) {
    const { data: newContact, error: insertError } = await supabase
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        full_name: full_name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        source: 'referral',
        referred_by_contact_id: referrerContactId,
        referral_source_detail: 'Referral link',
        sms_opt_in: Boolean(phone?.trim()),
      })
      .select('id')
      .single()

    if (insertError || !newContact) {
      res.status(500).json({ error: 'Failed to save your info' })
      return
    }
    contactId = newContact.id as string
  }

  void logActivity({
    tenantId,
    contactId,
    type: 'note',
    body: notes?.trim() ? `Referral lead: ${notes.trim()}` : 'Referral lead captured',
    metadata: { referred_by_contact_id: referrerContactId, trigger: 'customer_referral_lead' },
    actorType: 'contact',
  })

  void notifyOwner(tenantId, 'referral_lead_captured', {
    pushTitle: 'New Referral Lead',
    pushBody: `${full_name.trim()} came from a customer referral`,
  })

  res.status(201).json({ success: true })
})

export default router
