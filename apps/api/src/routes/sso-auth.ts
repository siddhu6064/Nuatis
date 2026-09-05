import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { getServiceClient } from '../lib/supabase.js'
import redis from '../lib/redis.js'
import { isWorkosConfigured, getSsoAuthorizationUrl, authenticateWithCode } from '../lib/workos.js'

const router = Router()

interface TenantInfo {
  vertical: string
  name: string
  subscription_status: string
  modules: Record<string, boolean> | null
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? ''
}

// GET /api/auth/sso/check?email= — public. Looks up whether the caller's
// email domain belongs to a tenant with SSO turned on, so the sign-in page
// can swap the password field for a "Sign in with SSO" button.
router.get('/check', async (req: Request, res: Response): Promise<void> => {
  const email = (req.query['email'] as string) || ''
  const domain = emailDomain(email)
  if (!domain) {
    res.json({ ssoEnabled: false })
    return
  }

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('sso_enabled', true)
    .ilike('sso_domain', domain)
    .maybeSingle<{ id: string }>()

  res.json(data ? { ssoEnabled: true, tenantId: data.id } : { ssoEnabled: false })
})

// GET /api/auth/sso/authorize?tenantId= — public (no session exists yet).
// Redirects to the tenant's WorkOS-hosted IdP login.
router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  if (!isWorkosConfigured()) {
    res.status(503).json({ error: 'SSO is not configured on this server' })
    return
  }

  const tenantId = (req.query['tenantId'] as string) || ''
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId is required' })
    return
  }

  const supabase = getServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('sso_enabled, workos_organization_id')
    .eq('id', tenantId)
    .maybeSingle<{ sso_enabled: boolean; workos_organization_id: string | null }>()

  if (!tenant?.sso_enabled || !tenant.workos_organization_id) {
    res.status(400).json({ error: 'SSO is not enabled for this account' })
    return
  }

  // Nonce bound server-side to the tenant, never trusted from a client-supplied
  // value — same shape as google-auth.ts's `state` handling.
  const nonce = randomBytes(32).toString('hex')
  await redis.set(`oauth:sso:${nonce}`, tenantId, 'EX', 600)

  try {
    const url = getSsoAuthorizationUrl(tenant.workos_organization_id, nonce)
    res.redirect(url)
  } catch (err) {
    console.error('[sso-auth] authorize error:', err)
    res.status(500).json({ error: 'Failed to start SSO login' })
  }
})

// GET /api/auth/sso/callback — WorkOS redirects here after IdP login.
// Mints a single-use exchange code (never the session JWT itself in the URL)
// and redirects to the web app, which trades it for a real session via a
// dedicated NextAuth "sso" Credentials provider.
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
  const { code, state } = req.query as { code?: string; state?: string }

  if (!code || !state) {
    res.redirect(`${webUrl}/sign-in?error=sso_failed`)
    return
  }

  const nonceKey = `oauth:sso:${state}`
  const tenantId = await redis.get(nonceKey)
  if (!tenantId) {
    res.redirect(`${webUrl}/sign-in?error=sso_expired`)
    return
  }
  await redis.del(nonceKey)

  try {
    const profile = await authenticateWithCode(code)
    const supabase = getServiceClient()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, vertical, name, subscription_status, modules')
      .eq('id', tenantId)
      .single<TenantInfo & { id: string }>()

    if (!tenant) {
      res.redirect(`${webUrl}/sign-in?error=sso_failed`)
      return
    }

    // authjs_user_id has no Supabase Auth account behind it for an SSO
    // login — WorkOS is the identity source, not Supabase Auth. A stable,
    // namespaced synthetic id keeps it unique and joinable the same way a
    // password user's real Supabase Auth id is.
    const authjsUserId = `workos:${profile.workosUserId}`
    const fullName =
      [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email

    const { data: existing } = await supabase
      .from('users')
      .select('id, role, is_active')
      .eq('authjs_user_id', authjsUserId)
      .maybeSingle<{ id: string; role: string; is_active: boolean }>()

    let appUserId: string
    let role: string
    if (existing) {
      if (!existing.is_active) {
        res.redirect(`${webUrl}/sign-in?error=sso_inactive`)
        return
      }
      appUserId = existing.id
      role = existing.role
    } else {
      // Just-in-time provisioning — first SSO login for this person creates
      // their users row, mirroring tenants.ts's own signup provisioning
      // (minus the Supabase Auth account, which doesn't apply here).
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          tenant_id: tenantId,
          authjs_user_id: authjsUserId,
          email: profile.email,
          full_name: fullName,
          role: 'staff',
          is_active: true,
        })
        .select('id, role')
        .single<{ id: string; role: string }>()
      if (error || !created) {
        console.error('[sso-auth] JIT provisioning failed:', error)
        res.redirect(`${webUrl}/sign-in?error=sso_failed`)
        return
      }
      appUserId = created.id
      role = created.role
    }

    const exchangeCode = randomBytes(32).toString('hex')
    await redis.set(
      `sso-exchange:${exchangeCode}`,
      JSON.stringify({
        appUserId,
        authjsUserId,
        tenantId,
        role,
        email: profile.email,
        name: fullName,
        vertical: tenant.vertical,
        businessName: tenant.name,
        subscriptionStatus: tenant.subscription_status,
        modules: tenant.modules ?? {},
      }),
      'EX',
      60
    )

    res.redirect(`${webUrl}/sign-in?ssoExchange=${exchangeCode}`)
  } catch (err) {
    console.error('[sso-auth] callback error:', err)
    res.redirect(`${webUrl}/sign-in?error=sso_failed`)
  }
})

// POST /api/auth/sso/redeem — server-to-server only, called by the Next.js
// "sso" Credentials provider. The exchange code itself is the credential
// (random, single-use, 60s TTL) — no separate auth needed, same trust model
// as a portal magic-link token.
router.post('/redeem', async (req: Request, res: Response): Promise<void> => {
  const { exchangeCode } = req.body as { exchangeCode?: string }
  if (!exchangeCode) {
    res.status(400).json({ error: 'exchangeCode is required' })
    return
  }

  const key = `sso-exchange:${exchangeCode}`
  const raw = await redis.get(key)
  if (!raw) {
    res.status(400).json({ error: 'Invalid or expired exchange code' })
    return
  }
  await redis.del(key)

  res.json(JSON.parse(raw))
})

export default router
