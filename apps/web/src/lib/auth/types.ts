import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      tenantId: string
      role: string
      vertical: string
      businessName: string
      subscriptionStatus: string
    }
  }
}
