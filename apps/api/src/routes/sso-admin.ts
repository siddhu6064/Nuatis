import { Router, type Request, type Response } from 'express'
import { requireAuth, requireRole, requireModule, type AuthenticatedRequest } from '../lib/auth.js'
import { getServiceClient } from '../lib/supabase.js'
import { isWorkosConfigured, createWorkosOrganization, getWorkosPortalLink } from '../lib/workos.js'

const router = Router()

router.use(requireAuth, requireModule('sso'))

// GET /api/sso/connection — current tenant's SSO configuration status.
router.get('/connection', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('sso_enabled, sso_domain, workos_organization_id')
    .eq('id', authed.tenantId)
    .maybeSingle<{
      sso_enabled: boolean
      sso_domain: string | null
      workos_organization_id: string | null
    }>()

  res.json({
    configured: isWorkosConfigured(),
    enabled: tenant?.sso_enabled ?? false,
    domain: tenant?.sso_domain ?? null,
    hasOrganization: Boolean(tenant?.workos_organization_id),
  })
})

// POST /api/sso/connection — owner/admin sets the login email domain and
// provisions (or reuses) a WorkOS Organization for this tenant.
router.post(
  '/connection',
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    if (!isWorkosConfigured()) {
      res.status(503).json({ error: 'SSO is not configured on this server' })
      return
    }

    const authed = req as AuthenticatedRequest
    const { domain } = req.body as { domain?: string }
    const cleanDomain = domain?.trim().toLowerCase()
    if (!cleanDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
      res.status(400).json({ error: 'A valid domain is required (e.g. acme.com)' })
      return
    }

    const supabase = getServiceClient()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, workos_organization_id')
      .eq('id', authed.tenantId)
      .single<{ name: string; workos_organization_id: string | null }>()

    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    try {
      const organizationId =
        tenant.workos_organization_id ?? (await createWorkosOrganization(tenant.name))

      const { error } = await supabase
        .from('tenants')
        .update({ sso_domain: cleanDomain, workos_organization_id: organizationId })
        .eq('id', authed.tenantId)

      if (error) {
        // Most likely cause: another tenant already claimed this domain
        // (idx_tenants_sso_domain is unique).
        res.status(409).json({ error: 'That domain is already in use for SSO' })
        return
      }

      await supabase
        .from('sso_connections')
        .upsert({ tenant_id: authed.tenantId, status: 'draft' }, { onConflict: 'tenant_id' })

      res.json({ organizationId, domain: cleanDomain })
    } catch (err) {
      console.error('[sso-admin] connection setup error:', err)
      res.status(500).json({ error: 'Failed to set up SSO' })
    }
  }
)

// GET /api/sso/connection/portal-link — a hosted WorkOS Admin Portal link
// where the tenant admin pastes their IdP's SAML metadata / OIDC client
// credentials. No SAML/OIDC handling is built here — WorkOS's own UI does it.
router.get(
  '/connection/portal-link',
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    if (!isWorkosConfigured()) {
      res.status(503).json({ error: 'SSO is not configured on this server' })
      return
    }

    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('workos_organization_id')
      .eq('id', authed.tenantId)
      .maybeSingle<{ workos_organization_id: string | null }>()

    if (!tenant?.workos_organization_id) {
      res.status(400).json({ error: 'Set a login domain first' })
      return
    }

    try {
      const link = await getWorkosPortalLink(tenant.workos_organization_id)
      res.json({ url: link })
    } catch (err) {
      console.error('[sso-admin] portal link error:', err)
      res.status(500).json({ error: 'Failed to generate the setup link' })
    }
  }
)

// PATCH /api/sso/connection — turn login-via-SSO on/off once the tenant admin
// has finished configuring their connection in the WorkOS portal. No webhook
// wiring for "connection is actually live" — this is an explicit admin flip.
router.patch(
  '/connection',
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const { enabled } = req.body as { enabled?: boolean }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' })
      return
    }

    const supabase = getServiceClient()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('sso_domain, workos_organization_id')
      .eq('id', authed.tenantId)
      .maybeSingle<{ sso_domain: string | null; workos_organization_id: string | null }>()

    if (enabled && (!tenant?.sso_domain || !tenant.workos_organization_id)) {
      res.status(400).json({ error: 'Set a login domain and complete setup before enabling' })
      return
    }

    await supabase.from('tenants').update({ sso_enabled: enabled }).eq('id', authed.tenantId)
    await supabase
      .from('sso_connections')
      .update({ status: enabled ? 'active' : 'inactive', updated_at: new Date().toISOString() })
      .eq('tenant_id', authed.tenantId)

    res.json({ enabled })
  }
)

export default router
