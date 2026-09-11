import { createPosProxy } from '@nuatis/pos-web'

/**
 * Next 16 picks this up by convention — the file is named proxy.ts, not
 * middleware.ts (apps/web does the same). All the logic lives in
 * @nuatis/pos-web so the register and the KDS cannot drift apart on
 * authentication or CSRF.
 */
export const proxy = createPosProxy({ signInPath: '/sign-in' })

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
