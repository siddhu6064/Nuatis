import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// POST /api/auth/mobile/login — issue JWT for mobile clients
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' })
      return
    }

    const supabase = getSupabase()

    // Fetch user profile by email
    const { data: user } = await supabase
      .from('users')
      .select('id, tenant_id, email, full_name, role')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle()

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    // Validate password via Supabase Auth
    const supabaseUrl = process.env['SUPABASE_URL']!
    const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY']!
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData?.session) {
      // TODO: If SUPABASE_ANON_KEY is not set and service role key is used above,
      // signInWithPassword may not work correctly. In that case this returns 401.
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    // Sign our own JWT with HS256 using AUTH_SECRET (matches requireAuth middleware)
    const secret = process.env['AUTH_SECRET']
    if (!secret) {
      res.status(500).json({ error: 'Auth not configured' })
      return
    }

    const secretKey = new TextEncoder().encode(secret)
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      name: user.full_name,
      tenantId: user.tenant_id,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
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
