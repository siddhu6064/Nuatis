import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('./activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ip00001'
const { processImportRows } = await import('./import-processor.js')

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  logActivity.mockClear()
})

describe('processImportRows', () => {
  it('imports a valid row and returns imported count 1', async () => {
    const result = await processImportRows(
      TENANT_ID,
      [{ full_name: 'Jane Doe', phone: '+15125550001', email: 'jane@example.com' }],
      { full_name: 'full_name', phone: 'phone', email: 'email' },
      { skip_duplicates: true, update_existing: false }
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors.length).toBe(0)
  })

  it('skips row with no name, phone, or email', async () => {
    const result = await processImportRows(
      TENANT_ID,
      [{ notes: 'Some note only' }],
      { notes: 'notes' },
      { skip_duplicates: true, update_existing: false }
    )

    expect(result.imported).toBe(0)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]!.message).toContain('no name, phone, or email')
  })

  it('skips duplicate when skip_duplicates is true', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Existing Bob',
      phone: '+15125550002',
      email: null,
    })

    const result = await processImportRows(
      TENANT_ID,
      [{ full_name: 'Bob Smith', phone: '+15125550002' }],
      { full_name: 'full_name', phone: 'phone' },
      { skip_duplicates: true, update_existing: false }
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('updates duplicate when update_existing is true', async () => {
    const existingId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: existingId,
      tenant_id: TENANT_ID,
      full_name: 'Old Name',
      phone: '+15125550003',
      email: null,
    })

    const result = await processImportRows(
      TENANT_ID,
      [{ full_name: 'New Name', phone: '+15125550003' }],
      { full_name: 'full_name', phone: 'phone' },
      { skip_duplicates: false, update_existing: true }
    )

    // Update path increments imported (not skipped) — distinguishes from skip branch.
    expect(result.skipped).toBe(0)
    expect(result.imported).toBe(1)
    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === existingId)
    expect(row).toBeDefined()
    expect(row?.['phone']).toBe('+15125550003')
  })

  it('handles mixed batch: 1 valid + 1 error', async () => {
    const result = await processImportRows(
      TENANT_ID,
      [{ full_name: 'Valid Person', phone: '+15125550004' }, { notes: 'invalid row only' }],
      { full_name: 'full_name', phone: 'phone' },
      { skip_duplicates: true, update_existing: false }
    )

    expect(result.imported).toBe(1)
    expect(result.errors.length).toBe(1)
  })
})
