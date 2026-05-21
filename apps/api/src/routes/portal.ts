import { randomBytes } from 'crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── PUBLIC ROUTES (no auth) ──────────────────────────────────────────────────

// GET /api/portal/verify?token=
router.get('/verify', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query
  if (!token || typeof token !== 'string') {
    res.status(400).json({ valid: false, error: 'Token required' })
    return
  }

  const supabase = getSupabase()

  const { data: access } = await supabase
    .from('portal_access')
    .select(
      'contact_id, tenant_id, email, expires_at, contacts(full_name), tenants(name, portal_slug)'
    )
    .eq('access_token', token)
    .maybeSingle()

  if (!access) {
    res.json({ valid: false })
    return
  }

  if (access.expires_at && new Date(access.expires_at) < new Date()) {
    res.json({ valid: false })
    return
  }

  // UPDATE last_accessed_at
  await supabase
    .from('portal_access')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('access_token', token)

  const contact = access.contacts as unknown as { full_name: string | null } | null
  const tenant = access.tenants as unknown as {
    name: string | null
    portal_slug: string | null
  } | null

  res.json({
    valid: true,
    contact_id: access.contact_id,
    tenant_id: access.tenant_id,
    contact_name: contact?.full_name ?? null,
    business_name: tenant?.name ?? null,
    portal_slug: tenant?.portal_slug ?? null,
  })
})

// GET /api/portal/data?token=
router.get('/data', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Token required' })
    return
  }

  const supabase = getSupabase()

  // Verify token
  const { data: access } = await supabase
    .from('portal_access')
    .select('contact_id, tenant_id, expires_at')
    .eq('access_token', token)
    .maybeSingle()

  if (!access || (access.expires_at && new Date(access.expires_at) < new Date())) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const { contact_id, tenant_id } = access

  // Fetch contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('full_name, email, phone')
    .eq('id', contact_id)
    .eq('tenant_id', tenant_id)
    .single()

  // Fetch appointments (upcoming + last 5 past)
  const now = new Date().toISOString()
  const { data: upcomingAppts } = await supabase
    .from('appointments')
    .select('id, scheduled_at, service_name, status, location_id')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .gte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })

  const { data: pastAppts } = await supabase
    .from('appointments')
    .select('id, scheduled_at, service_name, status, location_id')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .lt('scheduled_at', now)
    .order('scheduled_at', { ascending: false })
    .limit(5)

  // Fetch quotes
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_number, description, total, status, created_at, public_token')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .in('status', ['accepted', 'sent'])
    .order('created_at', { ascending: false })
    .limit(10)

  // Fetch invoices
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, balance_due, status, due_date, created_at')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .in('status', ['sent', 'due', 'overdue', 'received'])
    .order('created_at', { ascending: false })
    .limit(10)

  res.json({
    contact: contact ?? null,
    appointments: {
      upcoming: upcomingAppts ?? [],
      past: pastAppts ?? [],
    },
    quotes: quotes ?? [],
    invoices: invoices ?? [],
    documents: [],
  })
})

// GET /api/portal/by-slug/:slug
router.get('/by-slug/:slug', async (req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, portal_enabled')
    .eq('portal_slug', req.params['slug'])
    .maybeSingle()

  if (!tenant || !tenant.portal_enabled) {
    res.status(404).json({ error: 'Portal not found' })
    return
  }

  res.json({ business_name: tenant.name, portal_enabled: true })
})

// POST /api/portal/request-access
router.post('/request-access', async (req: Request, res: Response): Promise<void> => {
  const { slug, email } = req.body as { slug?: string; email?: string }
  if (!slug || !email) {
    res.status(400).json({ error: 'slug and email required' })
    return
  }

  const supabase = getSupabase()

  // Find tenant by slug
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, portal_slug, portal_enabled')
    .eq('portal_slug', slug)
    .maybeSingle()

  if (!tenant || !tenant.portal_enabled) {
    res.json({ message: 'If you have portal access, check your email.' })
    return
  }

  // Find portal_access by email + tenant
  const { data: access } = await supabase
    .from('portal_access')
    .select('access_token')
    .eq('tenant_id', tenant.id)
    .eq('email', email)
    .maybeSingle()

  if (!access) {
    // Don't leak existence
    res.json({ message: 'If you have portal access, check your email.' })
    return
  }

  // Send magic link
  const portalUrl = `https://app.nuatis.com/portal/${slug}`
  const resendApiKey = process.env['RESEND_API_KEY']
  if (resendApiKey) {
    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    await resend.emails
      .send({
        from: process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>',
        to: email,
        subject: `Access your ${tenant.name} portal`,
        html: `<p>Here is your link to access the ${tenant.name} client portal:</p>
<p><a href="${portalUrl}?token=${access.access_token}">${portalUrl}?token=${access.access_token}</a></p>
<p>This link is personal to you — please don't share it.</p>`,
      })
      .catch(() => null)
  }

  res.json({ message: 'If you have portal access, check your email.' })
})

// ── TENANT-AUTHENTICATED ROUTES ──────────────────────────────────────────────

// POST /api/portal/enable
router.post('/enable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Fetch tenant name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()

  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  // Generate slug
  const { generatePortalSlug } = await import('../lib/portal-slug.js')
  const slug = await generatePortalSlug(authed.tenantId, tenant.name)

  // Enable portal
  await supabase.from('tenants').update({ portal_enabled: true }).eq('id', authed.tenantId)

  const portalUrl = `https://app.nuatis.com/portal/${slug}`
  res.json({ portal_slug: slug, portal_url: portalUrl })
})

// POST /api/portal/disable
router.post('/disable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  await supabase.from('tenants').update({ portal_enabled: false }).eq('id', authed.tenantId)

  res.json({ ok: true })
})

// GET /api/portal/settings
router.get('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('portal_enabled, portal_slug')
    .eq('id', authed.tenantId)
    .single()

  const { count: accessCount } = await supabase
    .from('portal_access')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)

  const portalUrl = tenant?.portal_slug
    ? `https://app.nuatis.com/portal/${tenant.portal_slug}`
    : null

  res.json({
    portal_enabled: tenant?.portal_enabled ?? false,
    portal_slug: tenant?.portal_slug ?? null,
    portal_url: portalUrl,
    access_count: accessCount ?? 0,
  })
})

// POST /api/portal/invite/:contactId
router.post(
  '/invite/:contactId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Fetch contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, full_name, email')
      .eq('id', req.params['contactId'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    if (!contact.email) {
      res.status(400).json({ error: 'Contact has no email address' })
      return
    }

    // Check if portal_access already exists
    const { data: existing } = await supabase
      .from('portal_access')
      .select('access_token')
      .eq('tenant_id', authed.tenantId)
      .eq('contact_id', req.params['contactId'])
      .maybeSingle()

    let accessToken: string
    if (existing) {
      accessToken = existing.access_token
    } else {
      // Insert new portal_access row — generate token in app code (not DB default)
      const newToken = randomBytes(32).toString('hex')
      const { data: newAccess, error } = await supabase
        .from('portal_access')
        .insert({
          tenant_id: authed.tenantId,
          contact_id: req.params['contactId'],
          email: contact.email,
          access_token: newToken,
        })
        .select('access_token')
        .single()

      if (error || !newAccess) {
        res.status(500).json({ error: 'Failed to create portal access' })
        return
      }

      accessToken = newAccess.access_token
    }

    // Fetch tenant for portal_slug and name
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, portal_slug')
      .eq('id', authed.tenantId)
      .single()

    const portalUrl = tenant?.portal_slug
      ? `https://app.nuatis.com/portal/${tenant.portal_slug}`
      : 'https://app.nuatis.com/portal'

    // Send invitation email via Resend
    const resendApiKey = process.env['RESEND_API_KEY']
    if (resendApiKey) {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)
      await resend.emails
        .send({
          from: process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>',
          to: contact.email,
          subject: `Access your ${tenant?.name ?? 'business'} portal`,
          html: `<p>Hi ${contact.full_name ?? 'there'},</p>
<p>${tenant?.name ?? 'Your service provider'} has set up a client portal for you.</p>
<p>View your appointments, documents, and invoices here:<br>
<a href="${portalUrl}?token=${accessToken}">${portalUrl}?token=${accessToken}</a></p>
<p>This link is personal to you — please don't share it.</p>`,
        })
        .catch(() => null) // don't fail if email fails
    }

    res.json({ access_token: accessToken, portal_url: `${portalUrl}?token=${accessToken}` })
  }
)

// GET /api/portal/clients
router.get('/clients', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data } = await supabase
    .from('portal_access')
    .select('contact_id, email, last_accessed_at, created_at, contacts(full_name)')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  res.json({ clients: data ?? [] })
})

// DELETE /api/portal/access/:contactId
router.delete(
  '/access/:contactId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    await supabase
      .from('portal_access')
      .delete()
      .eq('tenant_id', authed.tenantId)
      .eq('contact_id', req.params['contactId'])

    res.json({ ok: true })
  }
)

export default router
