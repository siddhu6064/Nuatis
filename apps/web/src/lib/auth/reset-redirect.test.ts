import { resolveResetRedirectUrl } from './reset-redirect'

const env = process.env as Record<string, string | undefined>
const ORIGINAL = {
  NEXTAUTH_URL: env['NEXTAUTH_URL'],
  NEXT_PUBLIC_APP_URL: env['NEXT_PUBLIC_APP_URL'],
  NODE_ENV: env['NODE_ENV'],
}

afterEach(() => {
  env['NEXTAUTH_URL'] = ORIGINAL.NEXTAUTH_URL
  env['NEXT_PUBLIC_APP_URL'] = ORIGINAL.NEXT_PUBLIC_APP_URL
  env['NODE_ENV'] = ORIGINAL.NODE_ENV
})

describe('resolveResetRedirectUrl', () => {
  it('resolves to https://app.nuatis.com/reset-password with the prod NEXTAUTH_URL', () => {
    env['NEXTAUTH_URL'] = 'https://app.nuatis.com'
    delete env['NEXT_PUBLIC_APP_URL']
    env['NODE_ENV'] = 'production'

    expect(resolveResetRedirectUrl()).toBe('https://app.nuatis.com/reset-password')
  })

  it('strips a trailing slash from the base URL', () => {
    env['NEXTAUTH_URL'] = 'https://app.nuatis.com/'
    env['NODE_ENV'] = 'production'

    expect(resolveResetRedirectUrl()).toBe('https://app.nuatis.com/reset-password')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when NEXTAUTH_URL is unset', () => {
    delete env['NEXTAUTH_URL']
    env['NEXT_PUBLIC_APP_URL'] = 'https://app.nuatis.com'
    env['NODE_ENV'] = 'production'

    expect(resolveResetRedirectUrl()).toBe('https://app.nuatis.com/reset-password')
  })

  it('throws in production when the base URL resolves to localhost', () => {
    env['NEXTAUTH_URL'] = 'http://localhost:3000'
    env['NODE_ENV'] = 'production'

    expect(() => resolveResetRedirectUrl()).toThrow(/localhost in production/)
  })

  it('throws in production when no base URL env is set (localhost fallback)', () => {
    delete env['NEXTAUTH_URL']
    delete env['NEXT_PUBLIC_APP_URL']
    env['NODE_ENV'] = 'production'

    expect(() => resolveResetRedirectUrl()).toThrow(/localhost in production/)
  })

  it('allows the localhost fallback in development', () => {
    delete env['NEXTAUTH_URL']
    delete env['NEXT_PUBLIC_APP_URL']
    env['NODE_ENV'] = 'development'

    expect(resolveResetRedirectUrl()).toBe('http://localhost:3000/reset-password')
  })
})
