/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { getTenantBusinessName } from './tenant-helpers.js'

function makeClient(opts: {
  name?: string | null
  error?: unknown
  delayMs?: number
  throwOnQuery?: boolean
}): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => {
            if (opts.throwOnQuery) return Promise.reject(new Error('boom'))
            const payload = {
              data: opts.name === undefined ? null : { name: opts.name },
              error: opts.error ?? null,
            }
            if (opts.delayMs) {
              return new Promise((resolve) => setTimeout(() => resolve(payload), opts.delayMs))
            }
            return Promise.resolve(payload)
          },
        }),
      }),
    }),
  }
}

describe('getTenantBusinessName', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns the tenant name on a fast successful query', async () => {
    const client = makeClient({ name: 'Acme Dental' })
    const result = await getTenantBusinessName(client, 'tenant-1')
    expect(result).toBe('Acme Dental')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns "our office" when the row has no name', async () => {
    const client = makeClient({ name: null })
    const result = await getTenantBusinessName(client, 'tenant-2')
    expect(result).toBe('our office')
  })

  it('returns "our office" on DB error without throwing', async () => {
    const client = makeClient({ error: { message: 'oops' } })
    const result = await getTenantBusinessName(client, 'tenant-3')
    expect(result).toBe('our office')
  })

  it('returns "our office" within 400ms when the query is slow (logs warn)', async () => {
    const client = makeClient({ name: 'Too Slow Corp', delayMs: 1200 })
    const start = Date.now()
    const result = await getTenantBusinessName(client, 'tenant-slow')
    const elapsed = Date.now() - start
    expect(result).toBe('our office')
    expect(elapsed).toBeLessThan(500)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getTenantBusinessName 400ms timeout')
    )
  })

  it('returns "our office" when the query throws', async () => {
    const client = makeClient({ throwOnQuery: true })
    const result = await getTenantBusinessName(client, 'tenant-throw')
    expect(result).toBe('our office')
  })
})
