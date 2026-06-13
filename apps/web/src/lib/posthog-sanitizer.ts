import type { CaptureResult } from 'posthog-js'

/**
 * Attribution query params we deliberately KEEP — everything else is stripped
 * from captured URLs so tokens / PII in querystrings never reach PostHog.
 */
const ATTRIBUTION_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
])

/** Event properties that carry a URL (or path) and must be sanitized. */
const URL_PROPS = ['$current_url', '$pathname', '$referrer', '$referring_domain'] as const

/**
 * Redact dynamic secret segments inside a pathname. A segment is replaced with
 * `redacted` when it follows a known secret-bearing prefix:
 *   /quotes/view/<token>            -> /quotes/view/redacted
 *   /reset-password/<token>         -> /reset-password/redacted
 *   /.../password-reset/<token>     -> /.../password-reset/redacted
 */
function redactPath(pathname: string): string {
  const segments = pathname.split('/')
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    const prev = segments[i - 1]
    const prev2 = segments[i - 2]
    const afterQuoteView = prev === 'view' && prev2 === 'quotes'
    const afterPasswordReset = prev === 'reset-password' || prev === 'password-reset'
    if (afterQuoteView || afterPasswordReset) {
      segments[i] = 'redacted'
    }
  }
  return segments.join('/')
}

/**
 * Sanitize a single URL string: redact secret path segments and strip every
 * query param except attribution ones. Never throws — on a parse failure
 * (e.g. a relative path with no base) it redacts the path and drops the
 * querystring entirely rather than losing the event.
 */
function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.pathname = redactPath(url.pathname)
    const kept = new URLSearchParams()
    url.searchParams.forEach((value, key) => {
      if (ATTRIBUTION_PARAMS.has(key)) kept.set(key, value)
    })
    url.search = kept.toString()
    return url.toString()
  } catch {
    const path = raw.split('?')[0] ?? ''
    return redactPath(path)
  }
}

/**
 * `before_send` hook: redact secrets from URL-bearing properties on the event
 * BEFORE it is sent. Mutates and returns the event; returns `null` events as-is
 * so PostHog's own drop semantics are preserved.
 */
export function sanitizeEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || !event.properties) return event
  const props = event.properties
  for (const key of URL_PROPS) {
    const value = props[key]
    if (typeof value === 'string') {
      props[key] = sanitizeUrl(value)
    }
  }
  return event
}
