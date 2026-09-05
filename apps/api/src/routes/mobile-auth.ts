import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { getServiceClient } from '../lib/supabase.js'
import { SignJWT } from 'jose'

const router = Router()

interface TenantInfo {
  vertical: string
}

interface MobileLoginUser {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: string
  authjs_user_id: string | null
  tenants: TenantInfo | TenantInfo[] | null
}

function getTenant(tenants: TenantInfo | TenantInfo[] | null): TenantInfo | null {
  if (!tenants) return null
  return Array.isArray(tenants) ? (tenants[0] ?? null) : tenants
}

// POST /api/auth/mobile/login — issue JWT for mobile clients
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' })
      return
    }

    const supabase = getServiceClient()

    // Fetch user profile by email
    const { data: user } = await supabase
      .from('users')
      .select('id, tenant_id, email, full_name, role, authjs_user_id, tenants(vertical)')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle<MobileLoginUser>()

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    // Validate password via Supabase Auth
    const supabaseUrl = process.env['SUPABASE_URL']!
    const anonKey = process.env['SUPABASE_ANON_KEY']
    if (!anonKey) {
      res.status(500).json({ error: 'Server configuration error: SUPABASE_ANON_KEY not set' })
      return
    }
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData?.session) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    // authjs_user_id is NOT NULL in the current schema (migration 0058), so this
    // should be unreachable in practice — but sub MUST be the Auth.js identity,
    // never users.id, or every requireAuth-gated request from this token fails
    // to resolve appUserId (see resolveAppUserId's `authjs_user_id = sub` lookup
    // in lib/auth.ts). Fail loudly instead of minting a token that silently
    // breaks appUserId resolution. Checked after the password check above, not
    // before, so this never becomes an email-enumeration signal.
    if (!user.authjs_user_id) {
      console.error('[mobile-auth] user row missing authjs_user_id:', user.id)
      res.status(500).json({ error: 'Account not fully provisioned for mobile login' })
      return
    }

    // Sign our own JWT with HS256 using AUTH_SECRET (matches requireAuth middleware)
    const secret = process.env['AUTH_SECRET']
    if (!secret) {
      res.status(500).json({ error: 'Auth not configured' })
      return
    }

    const tenant = getTenant(user.tenants)

    const secretKey = new TextEncoder().encode(secret)
    const token = await new SignJWT({
      sub: user.authjs_user_id,
      appUserId: user.id,
      email: user.email,
      name: user.full_name,
      tenantId: user.tenant_id,
      role: user.role,
      vertical: tenant?.vertical ?? '',
      ...(user.role === 'staff' ? { portalScope: 'staff' } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('nuatis-mobile')
      .setAudience('nuatis-api')
      .setExpirationTime('7d')
      .sign(secretKey)

    res.json({
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        tenantId: user.tenant_id,
        role: user.role,
      },
    })
  } catch (err) {
    console.error('[mobile-auth] login error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

export default router
