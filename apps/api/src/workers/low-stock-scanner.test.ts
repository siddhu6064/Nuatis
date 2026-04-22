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
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000ls0001'
const { scan } = await import('./low-stock-scanner.js')

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['inventory_items'] = []
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('low-stock-scanner processor', () => {
  it('notifies owner when item quantity is at threshold', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { crm: true } })
    store.tables['inventory_items']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Gloves',
      quantity: 3,
      reorder_threshold: 3,
      last_low_stock_notified_at: null,
      deleted_at: null,
    })

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, eventKey] = notifyOwner.mock.calls[0]!
    expect(eventKey).toBe('inventory_low_stock')
    const item = (store.tables['inventory_items'] as Row[])[0]!
    expect(item['last_low_stock_notified_at']).not.toBeNull()
  })

  it('notifies owner when item quantity is below threshold', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { crm: true } })
    store.tables['inventory_items']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Syringes',
      quantity: 1,
      reorder_threshold: 5,
      last_low_stock_notified_at: null,
      deleted_at: null,
    })

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('does not notify when last_low_stock_notified_at is within 24h cooldown', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { crm: true } })
    store.tables['inventory_items']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Tape',
      quantity: 1,
      reorder_threshold: 5,
      last_low_stock_notified_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      deleted_at: null,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('does not notify for tenant with modules.crm=false', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { crm: false } })
    store.tables['inventory_items']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Paper',
      quantity: 0,
      reorder_threshold: 5,
      last_low_stock_notified_at: null,
      deleted_at: null,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
