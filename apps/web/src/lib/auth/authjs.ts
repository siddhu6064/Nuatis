import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { Session } from 'next-auth'
import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'

// anon key — for signInWithPassword
const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// service role key — for users table query (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TenantInfo {
  vertical: string
  name: string
  subscription_status: string
  modules: Record<string, boolean> | null
}

interface UserWithTenant {
  id: string
  tenant_id: string
  role: string
  full_name: string
  tenants: TenantInfo | TenantInfo[] | null
}

function getTenant(tenants: TenantInfo | TenantInfo[] | null): TenantInfo | null {
  if (!tenants) return null
  return Array.isArray(tenants) ? (tenants[0] ?? null) : tenants
}

// CSRF-01: pin the session cookie attributes explicitly so SameSite can't
// silently regress. `secure` stays adaptive — forcing it on would break local
// http dev login. (Matches Auth.js defaults, made explicit.)
const useSecureCookies = process.env.NODE_ENV === 'production'

const result = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60, updateAge: 5 * 60 },
  cookies: {
    sessionToken: {
      name: `${useSecureCookies ? '__Secure-' : ''}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const { data, error } = await supabaseAuth.auth.signInWithPassword({
          email: credentials.email as string,
          password: credentials.password as string,
        })

        if (error || !data.user) return null

        const { data: user } = await supabaseAdmin
          .from('users')
          .select(
            'id, tenant_id, role, full_name, tenants(vertical, name, subscription_status, modules)'
          )
          .eq('authjs_user_id', data.user.id)
          .single<UserWithTenant>()

        if (!user) return null

        const tenant = getTenant(user.tenants)

        return {
          id: user.id,
          appUserId: user.id,
          email: data.user.email!,
          name: user.full_name,
          tenantId: user.tenant_id,
          role: user.role,
          vertical: tenant?.vertical ?? '',
          businessName: tenant?.name ?? '',
          subscriptionStatus: tenant?.subscription_status ?? '',
          modules: (tenant?.modules as Record<string, boolean>) ?? {},
        }
      },
    }),
    // SSO — the identity check already happened at WorkOS. This provider
    // only trades the single-use exchange code (minted by the Express
    // /api/auth/sso/callback route) for the same session shape the password
    // provider above produces, so the jwt()/session() callbacks below need
    // zero changes to support it.
    Credentials({
      id: 'sso',
      name: 'sso',
      credentials: {
        exchangeCode: { label: 'Exchange code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.exchangeCode) return null

        const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:3001'
        const res = await fetch(`${apiUrl}/api/auth/sso/redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exchangeCode: credentials.exchangeCode }),
        })
        if (!res.ok) return null

        const claims = (await res.json()) as {
          appUserId: string
          tenantId: string
          role: string
          email: string
          name: string
          vertical: string
          businessName: string
          subscriptionStatus: string
          modules: Record<string, boolean>
        }

        return {
          id: claims.appUserId,
          appUserId: claims.appUserId,
          email: claims.email,
          name: claims.name,
          tenantId: claims.tenantId,
          role: claims.role,
          vertical: claims.vertical,
          businessName: claims.businessName,
          subscriptionStatus: claims.subscriptionStatus,
          modules: claims.modules ?? {},
        }
      },
    }),
    // Platform-support "log in as this tenant" — same exchange-code handoff
    // as the sso provider above, but the claims additionally carry an
    // `impersonation` block (which platform admin, why, until when). jwt()
    // below caps the session to that expiry instead of the normal 12h, and
    // forwards the block into the Express-facing token so every request is
    // fingerprinted server-side too (lib/impersonation.ts).
    Credentials({
      id: 'impersonate',
      name: 'impersonate',
      credentials: {
        exchangeCode: { label: 'Exchange code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.exchangeCode) return null

        const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:3001'
        const res = await fetch(`${apiUrl}/api/impersonate/redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exchangeCode: credentials.exchangeCode }),
        })
        if (!res.ok) return null

        const claims = (await res.json()) as {
          appUserId: string
          tenantId: string
          role: string
          email: string
          name: string
          vertical: string
          businessName: string
          subscriptionStatus: string
          modules: Record<string, boolean>
          impersonation: {
            sessionId: string
            platformUserId: string
            platformUserEmail: string
            expiresAt: string
          }
        }

        return {
          id: claims.appUserId,
          appUserId: claims.appUserId,
          email: claims.email,
          name: claims.name,
          tenantId: claims.tenantId,
          role: claims.role,
          vertical: claims.vertical,
          businessName: claims.businessName,
          subscriptionStatus: claims.subscriptionStatus,
          modules: claims.modules ?? {},
          impersonation: claims.impersonation,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as Record<string, unknown>
        token.tenantId = u.tenantId
        token.role = u.role
        token.vertical = u.vertical
        token.businessName = u.businessName
        token.subscriptionStatus = u.subscriptionStatus
        token.modules = u.modules
        // public.users.id — the domain UUID FKs reference. Available here
        // because authorize() already fetched it; storing it avoids a per-request
        // DB lookup in the API auth middleware.
        token.appUserId = u.appUserId as string
        const impersonation = u.impersonation as
          | {
              sessionId: string
              platformUserId: string
              platformUserEmail: string
              expiresAt: string
            }
          | undefined
        if (impersonation) {
          token.impersonation = impersonation
          // Capped to the impersonation session's own short TTL, not the
          // normal 12h — ending is "the token expires," there's no separate
          // revoke-in-place mechanism.
          token.absoluteExpiry = new Date(impersonation.expiresAt).getTime()
        } else {
          // 12h absolute session cap — stamped once at sign-in only, so refresh
          // (every updateAge) does not reset it.
          token.absoluteExpiry = Date.now() + 12 * 60 * 60 * 1000
        }
      }

      // Enforce the 12h hard cap on every invocation (incl. refresh). Also
      // rejects pre-existing tokens minted under the old 30-day default, which
      // lack absoluteExpiry. Returning null invalidates the session (Auth.js v5).
      if (!token.absoluteExpiry || Date.now() > (token.absoluteExpiry as number)) {
        return null
      }

      // Re-read vertical + modules from DB on every token rotation so demo
      // vertical switches and module toggles take effect without re-login
      if (token.tenantId) {
        try {
          const { data: tenant } = await supabaseAdmin
            .from('tenants')
            .select('vertical, name, modules')
            .eq('id', token.tenantId as string)
            .single<{ vertical: string; name: string; modules: Record<string, boolean> | null }>()
          if (tenant) {
            token.vertical = tenant.vertical
            token.businessName = tenant.name
            token.modules = tenant.modules ?? {}
          }
        } catch {
          // DB unavailable — keep cached values
        }
      }

      if (token.tenantId) {
        const secret = process.env['AUTH_SECRET']
        if (secret) {
          const secretBytes = new TextEncoder().encode(secret)
          token.accessToken = await new SignJWT({
            sub: token.sub,
            tenantId: token.tenantId,
            role: token.role,
            vertical: token.vertical,
            businessName: token.businessName,
            subscriptionStatus: token.subscriptionStatus,
            ...(token.appUserId ? { appUserId: token.appUserId } : {}),
            ...(token.impersonation ? { impersonation: token.impersonation } : {}),
          })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setIssuer('nuatis-web')
            .setAudience('nuatis-api')
            .setExpirationTime('60s')
            .sign(secretBytes)
        }
      }

      return token
    },
    async session({ session, token }) {
      session.user.appUserId = token.appUserId as string
      session.user.tenantId = token.tenantId as string
      session.user.role = token.role as string
      session.user.vertical = token.vertical as string
      session.user.businessName = token.businessName as string
      session.user.subscriptionStatus = token.subscriptionStatus as string
      session.user.modules = (token.modules as Record<string, boolean>) ?? {}
      ;(session as unknown as Record<string, unknown>).accessToken = token.accessToken as string
      if (token.impersonation) {
        ;(session as unknown as Record<string, unknown>).impersonation = token.impersonation
      }
      return session
    },
  },
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
})

export const handlers = result.handlers
export const signIn = result.signIn
export const signOut = result.signOut
export const auth = result.auth as () => Promise<Session | null>
