import { createPosProxy } from '@nuatis/pos-web'

/**
 * Next 16 picks this up by convention — the file is named proxy.ts, not
 * middleware.ts (apps/web does the same). All the logic lives in
 * @nuatis/pos-web so the register and the KDS cannot drift apart on
 * authentication or CSRF.
 */
export const proxy = createPosProxy({ signInPath: '/sign-in' })

export const config = {
  // Exclude ALL of /_next, not just static and image. Next's dev hot-reload
  // runs over /_next/webpack-hmr, and a narrower exclusion sends that request
  // to the sign-in redirect below — HMR then fails on every page load, with no
  // symptom except edits silently not appearing.
  matcher: ['/((?!_next/|favicon.ico).*)'],
}
