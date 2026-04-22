import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000md00001'
const { isModuleEnabled } = await import('./modules.js')

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
})

describe('isModuleEnabled', () => {
  it('returns true when module key is true in modules jsonb', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { crm: true } })

    const result = await isModuleEnabled(TENANT_ID, 'crm')

    expect(result).toBe(true)
  })

  it('returns false when module key is false', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { cpq: false } })

    const result = await isModuleEnabled(TENANT_ID, 'cpq')

    expect(result).toBe(false)
  })

  it('returns true (fail-open) when modules jsonb is null', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: null })

    const result = await isModuleEnabled(TENANT_ID, 'crm')

    expect(result).toBe(true)
  })

  it('returns true when module key is absent from jsonb (undefined → fail-open)', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, modules: { maya: true } })

    const result = await isModuleEnabled(TENANT_ID, 'crm')

    expect(result).toBe(true)
  })
})
