/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => {
                    const fixture = (globalThis as any).__contactLookupFixture
                    if (fixture?.delayMs) {
                      return new Promise((resolve) => {
                        setTimeout(
                          () =>
                            resolve({ data: fixture.data ?? null, error: fixture.error ?? null }),
                          fixture.delayMs
                        )
                      })
                    }
                    return Promise.resolve({
                      data: fixture?.data ?? null,
                      error: fixture?.error ?? null,
                    })
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

const { lookupCaller, buildSystemPromptSuffix, maskPhone } = await import('./pre-call-lookup.js')

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://test.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-key'
  ;(globalThis as any).__contactLookupFixture = null
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env['SUPABASE_URL']
  delete process.env['SUPABASE_SERVICE_ROLE_KEY']
  delete (globalThis as any).__contactLookupFixture
  jest.restoreAllMocks()
})

describe('maskPhone', () => {
  it('masks all but last 4 digits', () => {
    expect(maskPhone('+15127376388')).toBe('****6388')
  })

  it('handles short strings safely', () => {
    expect(maskPhone('12')).toBe('******12')
  })
})

describe('lookupCaller', () => {
  it('returns matched:true with name + fields when contact exists', async () => {
    ;(globalThis as any).__contactLookupFixture = {
      data: {
        id: 'contact-123',
        full_name: 'Jane Doe',
        last_contacted: '2026-04-01T10:00:00Z',
        vertical_data: { insurance_provider: 'Delta Dental', date_of_birth: '1985-03-22' },
        lifecycle_stage: 'customer',
      },
      error: null,
    }

    const ctx = await lookupCaller('tenant-abc', '+15127376388')

    expect(ctx.matched).toBe(true)
    expect(ctx.contactId).toBe('contact-123')
    expect(ctx.name).toBe('Jane Doe')
    expect(ctx.lastContact).toBe('2026-04-01T10:00:00Z')
    expect(ctx.customFields).toEqual({
      insurance_provider: 'Delta Dental',
      date_of_birth: '1985-03-22',
    })
    expect(ctx.pipelineStage).toBe('customer')
  })

  it('returns matched:false when no contact found; buildSystemPromptSuffix returns empty string', async () => {
    ;(globalThis as any).__contactLookupFixture = { data: null, error: null }

    const ctx = await lookupCaller('tenant-abc', '+15127376388')

    expect(ctx.matched).toBe(false)
    expect(ctx.contactId).toBeUndefined()
    expect(buildSystemPromptSuffix(ctx)).toBe('')
  })

  it('returns matched:false within 400ms when DB exceeds timeout', async () => {
    ;(globalThis as any).__contactLookupFixture = {
      data: {
        id: 'x',
        full_name: 'Too Slow',
        last_contacted: null,
        vertical_data: null,
        lifecycle_stage: null,
      },
      error: null,
      delayMs: 500,
    }

    const warnSpy = jest.spyOn(console, 'warn')
    const t0 = Date.now()
    const ctx = await lookupCaller('tenant-abc', '+15127376388')
    const elapsed = Date.now() - t0

    expect(ctx.matched).toBe(false)
    expect(elapsed).toBeLessThan(500)
    expect(elapsed).toBeGreaterThanOrEqual(390)
    const timeoutLogged = warnSpy.mock.calls.some((call) =>
      String(call[0] ?? '').includes('timeout')
    )
    expect(timeoutLogged).toBe(true)
  })

  it('returns matched:false on invalid E.164 input', async () => {
    const ctx = await lookupCaller('tenant-abc', 'not-a-phone')
    expect(ctx.matched).toBe(false)
  })

  it('returns matched:false when tenantId is empty', async () => {
    const ctx = await lookupCaller('', '+15127376388')
    expect(ctx.matched).toBe(false)
  })

  it('returns matched:false on DB error without throwing', async () => {
    ;(globalThis as any).__contactLookupFixture = {
      data: null,
      error: { message: 'permission denied' },
    }

    const ctx = await lookupCaller('tenant-abc', '+15127376388')
    expect(ctx.matched).toBe(false)
  })

  it('does not leak raw phone number in logs — only last 4 digits', async () => {
    ;(globalThis as any).__contactLookupFixture = { data: null, error: null }
    const logSpy = jest.spyOn(console, 'info')

    await lookupCaller('tenant-abc', '+15127376388')

    const allLogPayloads = logSpy.mock.calls.map((c) => JSON.stringify(c))
    const joined = allLogPayloads.join(' ')
    expect(joined).not.toContain('5127376388')
    expect(joined).toContain('****6388')
  })
})

describe('buildSystemPromptSuffix', () => {
  it('returns empty string on no match', () => {
    expect(buildSystemPromptSuffix({ matched: false })).toBe('')
  })

  it('renders caller context section when matched', () => {
    const out = buildSystemPromptSuffix({
      matched: true,
      contactId: 'c-1',
      name: 'Jane Doe',
      lastContact: '2026-04-01T10:00:00Z',
      customFields: { insurance: 'Delta', dob: '1985-03-22' },
      pipelineStage: 'customer',
    })

    expect(out).toContain('--- CALLER CONTEXT ---')
    expect(out).toContain('This is a returning caller.')
    expect(out).toContain('Name: Jane Doe')
    expect(out).toContain('Last contact: 2026-04-01T10:00:00Z')
    expect(out).toContain('insurance: Delta')
    expect(out).toContain('Pipeline stage: customer')
    expect(out).toContain('Greet the caller by first name')
  })

  it('truncates to 4 most relevant custom fields and skips null/empty', () => {
    const out = buildSystemPromptSuffix({
      matched: true,
      name: 'X',
      customFields: {
        a: '1',
        b: null,
        c: '',
        d: '2',
        e: '3',
        f: '4',
        g: '5',
        h: '6',
      },
    })

    expect(out).toContain('a: 1')
    expect(out).toContain('d: 2')
    expect(out).toContain('e: 3')
    expect(out).toContain('f: 4')
    expect(out).not.toContain('b:')
    expect(out).not.toContain('c:')
    expect(out).not.toContain('g: 5')
    expect(out).not.toContain('h: 6')
  })

  it('truncates individual values over 60 chars', () => {
    const longValue = 'x'.repeat(200)
    const out = buildSystemPromptSuffix({
      matched: true,
      name: 'X',
      customFields: { note: longValue },
    })
    expect(out).toContain('x'.repeat(60) + '…')
    expect(out).not.toContain('x'.repeat(61))
  })

  it('uses "unknown" fallbacks for missing name/lastContact/pipelineStage', () => {
    const out = buildSystemPromptSuffix({ matched: true, contactId: 'c-1' })
    expect(out).toContain('Name: unknown')
    expect(out).toContain('Last contact: unknown')
    expect(out).toContain('Pipeline stage: unknown')
    expect(out).toContain('Known fields: none')
  })
})
