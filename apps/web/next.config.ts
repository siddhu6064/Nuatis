import type { NextConfig } from 'next'

// HDR-01: connect-src must allow every host the client talks to directly:
// the API (proxied calls are same-origin, but the voice WS hits the API host),
// PostHog ingest + asset hosts, and Supabase (sign-in + realtime use the
// project URL directly, so omitting it would break auth).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js still requires 'unsafe-inline' for its bootstrap/hydration scripts;
  // tighten with nonces in a follow-up. PostHog assets load from us-assets.
  "script-src 'self' 'unsafe-inline' https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.nuatis.com wss://api.nuatis.com https://us.i.posthog.com https://us-assets.i.posthog.com https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const config: NextConfig = {
  output: 'standalone',

  // Transpile shared package from monorepo
  transpilePackages: ['@nuatis/shared'],

  // Turbopack: resolve .js imports to .ts source in shared package
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        ],
      },
    ]
  },
}

export default config
