import type { NextConfig } from 'next'

/**
 * The KDS socket connects to the API host directly — proxied HTTP calls are
 * same-origin, but a WebSocket upgrade cannot be rewritten by middleware, so
 * connect-src has to name the API host. Both are env-driven rather than
 * hardcoded so the same build works on localhost and on whatever hostname
 * this app is eventually deployed to.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3001'
const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws')

const isDev = process.env.NODE_ENV !== 'production'

// Note: Next's dev hot-reload socket is same-origin, and `'self'` in
// connect-src covers it — no dev-only CSP exception is needed. (When HMR
// appeared broken it was the proxy matcher swallowing /_next/webpack-hmr,
// not this policy.)

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next still requires 'unsafe-inline' for its bootstrap/hydration scripts.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const config: NextConfig = {
  output: 'standalone',
  // pos-web and design-tokens ship as source (TypeScript / CJS) so they need
  // transpiling; pos-core ships built ESM from dist and does not.
  transpilePackages: ['@nuatis/pos-web', '@nuatis/design-tokens'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }],
      },
    ]
  },
}

export default config
