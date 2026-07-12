import { describe, it, expect, jest } from '@jest/globals'

// Track every supabase table access — an expired-trial booking must not
// touch the DB at all.
const fromCalls: string[] = []
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {}
    chain['from'] = (table: unknown) => {
      fromCalls.push(String(table))
      return chain
    }
    chain['select'] = () => chain
    chain['eq'] = () => chain
    chain['limit'] = () => chain
    chain['order'] = () => chain
    chain['insert'] = () => chain
    chain['update'] = () => chain
    chain['maybeSingle'] = () => Promise.resolve({ data: null, error: null })
    chain['single'] = () => Promise.resolve({ data: null, error: null })
    return chain
  },
}))

const { executeToolCall } = await import('./tool-handlers.js')

const EXPIRED_CONTEXT = {
  tenantId: 'tenant-expired',
  vertical: 'dental',
  callerId: '+15551234567',
  streamId: 'stream-1',
  callControlId: '',
  product: 'suite' as const,
  trialExpired: true,
}

describe('book_appointment under an expired trial', () => {
  it('returns booked:false with the receptionist message, writes nothing, does not throw', async () => {
    const result = await executeToolCall(
      'book_appointment',
      { date: '2026-07-10', start_time: '10:00', caller_name: 'Pat' },
      EXPIRED_CONTEXT
    )
    expect(result['booked']).toBe(false)
    expect(result['message']).toBe(
      "I've made a note of that and someone will call you back to confirm."
    )
    // Never mention billing to the caller.
    expect(JSON.stringify(result).toLowerCase()).not.toContain('billing')
    expect(JSON.stringify(result).toLowerCase()).not.toContain('trial')
    // No DB access on the blocked path.
    expect(fromCalls).toEqual([])
  })

  it('does not end the call — no end/transfer flags in the result', async () => {
    const result = await executeToolCall('book_appointment', {}, EXPIRED_CONTEXT)
    expect(result['ended']).toBeUndefined()
    expect(result['transferred']).toBeUndefined()
  })
})
