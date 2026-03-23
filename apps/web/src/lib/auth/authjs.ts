import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { Session } from 'next-auth'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TenantInfo {
  vertical: string
  name: string
  subscription_status: string
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

const result = NextAuth({
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email as string,
          password: credentials.password as string,
        })

        if (error || !data.user) return null

        const { data: user } = await supabase
          .from('users')
          .select('id, tenant_id, role, full_name, tenants(vertical, name, subscription_status)')
          .eq('authjs_user_id', data.user.id)
          .single<UserWithTenant>()

        if (!user) return null

        const tenant = getTenant(user.tenants)

        return {
          id: user.id,
          email: data.user.email!,
          name: user.full_name,
          tenantId: user.tenant_id,
          role: user.role,
          vertical: tenant?.vertical ?? '',
          businessName: tenant?.name ?? '',
          subscriptionStatus: tenant?.subscription_status ?? '',
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.tenantId = (user as Record<string, unknown>).tenantId
        token.role = (user as Record<string, unknown>).role
        token.vertical = (user as Record<string, unknown>).vertical
        token.businessName = (user as Record<string, unknown>).businessName
        token.subscriptionStatus = (user as Record<string, unknown>).subscriptionStatus
      }
      return token
    },
    async session({ session, token }) {
      session.user.tenantId = token.tenantId as string
      session.user.role = token.role as string
      session.user.vertical = token.vertical as string
      session.user.businessName = token.businessName as string
      session.user.subscriptionStatus = token.subscriptionStatus as string
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
