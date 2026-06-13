import type { CaptureResult } from 'posthog-js'
import { sanitizeEvent } from './posthog-sanitizer'

function makeEvent(properties: Record<string, unknown>): CaptureResult {
  return {
    uuid: 'test-uuid',
    event: '$pageview',
    properties: properties as CaptureResult['properties'],
  }
}

describe('sanitizeEvent', () => {
  it('returns null/empty events untouched', () => {
    expect(sanitizeEvent(null)).toBeNull()
    const noProps = { uuid: 'u', event: '$pageview' } as CaptureResult
    expect(sanitizeEvent(noProps)).toBe(noProps)
  })

  it('redacts the quote view token in $current_url', () => {
    const ev = makeEvent({ $current_url: 'https://app.nuatis.com/quotes/view/abc123' })
    sanitizeEvent(ev)
    expect(ev.properties.$current_url).toBe('https://app.nuatis.com/quotes/view/redacted')
  })

  it('redacts the quote view token in a relative $pathname', () => {
    const ev = makeEvent({ $pathname: '/quotes/view/abc123' })
    sanitizeEvent(ev)
    expect(ev.properties.$pathname).toBe('/quotes/view/redacted')
  })

  it('redacts reset-password and password-reset tokens', () => {
    const a = makeEvent({ $current_url: 'https://app.nuatis.com/reset-password/SECRET' })
    sanitizeEvent(a)
    expect(a.properties.$current_url).toBe('https://app.nuatis.com/reset-password/redacted')

    const b = makeEvent({ $current_url: 'https://app.nuatis.com/auth/password-reset/SECRET' })
    sanitizeEvent(b)
    expect(b.properties.$current_url).toBe('https://app.nuatis.com/auth/password-reset/redacted')
  })

  it('strips non-attribution query params but keeps attribution ones', () => {
    const ev = makeEvent({
      $current_url:
        'https://app.nuatis.com/dashboard?token=secret&utm_source=google&gclid=xyz&email=a@b.com',
    })
    sanitizeEvent(ev)
    const url = new URL(ev.properties.$current_url as string)
    expect(url.searchParams.get('utm_source')).toBe('google')
    expect(url.searchParams.get('gclid')).toBe('xyz')
    expect(url.searchParams.get('token')).toBeNull()
    expect(url.searchParams.get('email')).toBeNull()
  })

  it('keeps all attribution params', () => {
    const ev = makeEvent({
      $current_url:
        'https://app.nuatis.com/?utm_source=s&utm_medium=m&utm_campaign=c&utm_term=t&utm_content=co&gclid=g&fbclid=f',
    })
    sanitizeEvent(ev)
    const url = new URL(ev.properties.$current_url as string)
    for (const k of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
    ]) {
      expect(url.searchParams.has(k)).toBe(true)
    }
  })

  it('sanitizes referrer props when present', () => {
    const ev = makeEvent({
      $referrer: 'https://app.nuatis.com/quotes/view/tok?token=secret',
    })
    sanitizeEvent(ev)
    expect(ev.properties.$referrer).toBe('https://app.nuatis.com/quotes/view/redacted')
  })

  it('drops the querystring (never throws) on an unparseable relative url with query', () => {
    const ev = makeEvent({ $pathname: '/quotes/view/tok?token=secret' })
    sanitizeEvent(ev)
    expect(ev.properties.$pathname).toBe('/quotes/view/redacted')
  })

  it('leaves non-string url props untouched', () => {
    const ev = makeEvent({ $current_url: 42 })
    sanitizeEvent(ev)
    expect(ev.properties.$current_url).toBe(42)
  })
})
