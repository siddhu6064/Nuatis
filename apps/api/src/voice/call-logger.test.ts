import { describe, it, expect, jest, beforeAll } from '@jest/globals'

// Mock @supabase/supabase-js so no real DB call is made
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}))

import { logCall } from './call-logger.js'

describe('logCall', () => {
  beforeAll(() => {
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-key'
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('logs call details to console', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {})

    logCall({
      tenant_id: 'tenant-abc',
      duration_seconds: 42,
      language: 'en',
      timestamp: new Date('2026-04-02T10:00:00Z'),
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const logged = spy.mock.calls[0]?.[0] as string
    expect(logged).toContain('tenant-abc')
    expect(logged).toContain('42')
    expect(logged).toContain('en')

    spy.mockRestore()
  })
})
