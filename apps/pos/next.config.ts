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

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next still requires 'unsafe-inline' for its bootstrap/hydration scripts.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''}`,
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
  // Workspace packages ship as TypeScript/CJS source, not built output.
  transpilePackages: ['@nuatis/pos-core', '@nuatis/pos-web', '@nuatis/design-tokens'],
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
