import { createPosProxy } from '@nuatis/pos-web'

/**
 * Next 16 picks this up by convention — proxy.ts, not middleware.ts.
 *
 * Byte-for-byte the register's proxy, from the same factory: the KDS holds the
 * same 12h PIN-minted cookie and needs the same CSRF check and the same
 * bearer-token rewrite. A second hand-written copy is how one of them ends up
 * without the CSRF guard.
 */
export const proxy = createPosProxy({ signInPath: '/sign-in' })

export const config = {
  // Exclude ALL of /_next, not just static and image — Next's dev hot-reload
  // runs over /_next/webpack-hmr, and a narrower exclusion 307s it to the
  // sign-in page. HMR then dies with no symptom except edits not appearing.
  matcher: ['/((?!_next/|favicon.ico).*)'],
}
