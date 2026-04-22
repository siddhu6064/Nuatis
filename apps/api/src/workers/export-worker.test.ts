import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000xw1001'
const USER_ID = 'user-xw-001'
const { processExport } = await import('./export-worker.js')

beforeEach(() => {
  store = createStore()
  store.tables['export_jobs'] = []
  store.tables['contacts'] = []
  store.tables['companies'] = []
  store.tables['tasks'] = []
  notifyOwner.mockClear()
})

describe('processExport', () => {
  it('uploads to storage, updates export_jobs to completed, and notifies owner', async () => {
    const exportJobId = randomUUID()
    ;(store.tables['export_jobs'] as Row[]).push({
      id: exportJobId,
      tenant_id: TENANT_ID,
      status: 'pending',
      tables: ['contacts'],
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Export Eve',
      phone: '+15125559901',
      email: 'eve@example.com',
    })

    await processExport({
      tenantId: TENANT_ID,
      exportJobId,
      requestedBy: USER_ID,
      tables: ['contacts'],
    })

    expect(store.storage.upload).toHaveBeenCalledTimes(1)
    const row = (store.tables['export_jobs'] as Row[]).find((r) => r['id'] === exportJobId)
    expect(row?.['status']).toBe('completed')
    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('does not throw when tables array is empty', async () => {
    const exportJobId = randomUUID()
    ;(store.tables['export_jobs'] as Row[]).push({
      id: exportJobId,
      tenant_id: TENANT_ID,
      status: 'pending',
      tables: [],
    })

    await expect(
      processExport({
        tenantId: TENANT_ID,
        exportJobId,
        requestedBy: USER_ID,
        tables: [],
      })
    ).resolves.toBeUndefined()

    const row = (store.tables['export_jobs'] as Row[]).find((r) => r['id'] === exportJobId)
    expect(row?.['status']).toBe('completed')
  })
})
