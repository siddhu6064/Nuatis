import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Mocks ─────────────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const { processQuoteSignature } = await import('../routes/quotes.js')

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_SIG = 'data:image/png;base64,' + 'A'.repeat(100)

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('esignature', () => {
  beforeEach(() => {
    store = createStore()
  })

  // ── Test 1: Valid signature sets status='accepted' + signature_status='signed' ──

  it('valid signature submission sets status=accepted + signature_status=signed', async () => {
    store.tables['quotes'] = [
      {
        id: 'quote-1',
        share_token: 'tok1',
        requires_signature: true,
        signature_status: 'waiting',
        status: 'sent',
      },
    ]

    const result = await processQuoteSignature('tok1', VALID_SIG, 'Jane Doe', '1.2.3.4')

    expect('success' in result && result.success).toBe(true)

    const row = store.tables['quotes']?.[0]
    expect(row?.['status']).toBe('accepted')
    expect(row?.['signature_status']).toBe('signed')
    expect(row?.['signed_by_name']).toBe('Jane Doe')
    expect(row?.['signed_ip']).toBe('1.2.3.4')
  })

  // ── Test 2: Invalid base64 prefix returns 400 ────────────────────────────────

  it('invalid signature format returns status 400', async () => {
    store.tables['quotes'] = [
      {
        id: 'quote-2',
        share_token: 'tok2',
        requires_signature: true,
        signature_status: 'waiting',
        status: 'sent',
      },
    ]

    const result = await processQuoteSignature('tok2', 'not-valid-base64', 'Jane Doe', '1.2.3.4')

    expect('error' in result).toBe(true)
    expect((result as { error: string; status: number }).status).toBe(400)
  })

  // ── Test 3: Already signed returns 409 ───────────────────────────────────────

  it('already signed quote returns status 409', async () => {
    store.tables['quotes'] = [
      {
        id: 'quote-3',
        share_token: 'tok3',
        requires_signature: true,
        signature_status: 'signed',
        status: 'accepted',
      },
    ]

    const result = await processQuoteSignature('tok3', VALID_SIG, 'Jane Doe', '1.2.3.4')

    expect('error' in result).toBe(true)
    expect((result as { error: string; status: number }).status).toBe(409)
  })

  // ── Test 4: requires_signature=false returns 400 ─────────────────────────────

  it('quote with requires_signature=false returns status 400', async () => {
    store.tables['quotes'] = [
      {
        id: 'quote-4',
        share_token: 'tok4',
        requires_signature: false,
        signature_status: 'waiting',
        status: 'sent',
      },
    ]

    const result = await processQuoteSignature('tok4', VALID_SIG, 'Jane Doe', '1.2.3.4')

    expect('error' in result).toBe(true)
    expect((result as { error: string; status: number }).status).toBe(400)
  })

  // ── Test 5: signed_ip is extracted and stored correctly ───────────────────────

  it('signed_ip is stored from the provided clientIp argument', async () => {
    store.tables['quotes'] = [
      {
        id: 'quote-5',
        share_token: 'tok5',
        requires_signature: true,
        signature_status: 'waiting',
        status: 'sent',
      },
    ]

    await processQuoteSignature('tok5', VALID_SIG, 'John Smith', '10.0.0.1')

    const row = store.tables['quotes']?.[0]
    expect(row?.['signed_ip']).toBe('10.0.0.1')
    expect(row?.['signed_by_name']).toBe('John Smith')
  })
})
