/**
 * Resolves the absolute redirect URL for Supabase password-reset emails.
 *
 * NEXTAUTH_URL is the canonical public base URL on the web container
 * (https://app.nuatis.com in prod); NEXT_PUBLIC_APP_URL is accepted as a
 * fallback, then localhost for local dev.
 *
 * Fails loudly instead of silently emailing a broken localhost link: in
 * production a missing/localhost base URL is a deploy misconfiguration.
 */
export function resolveResetRedirectUrl(): string {
  const base =
    process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (process.env.NODE_ENV === 'production' && base.includes('localhost')) {
    throw new Error(
      'Password reset base URL misconfigured: localhost in production — set NEXTAUTH_URL'
    )
  }

  return `${base.replace(/\/+$/, '')}/reset-password`
}
