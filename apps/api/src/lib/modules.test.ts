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

describe('isModuleEnabled — explicit overrides', () => {
  it('returns false when the module key is explicitly false (even if the tier grants it)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { cpq: false },
      subscription_plan: 'scale',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'cpq')).toBe(false)
  })

  it('honors an explicit true comp on a lower tier (cpq:true on core)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { cpq: true },
      subscription_plan: 'core',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'cpq')).toBe(true)
  })
})

describe('isModuleEnabled — base suite modules (derived)', () => {
  it('allows an absent base module on a suite tenant (appointments)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'core',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'appointments')).toBe(true)
  })

  it('allows absent companies and deals on a suite tenant', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'core',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'companies')).toBe(true)
    expect(await isModuleEnabled(TENANT_ID, 'deals')).toBe(true)
  })
})

describe('isModuleEnabled — tier-gated modules (derived)', () => {
  it('blocks absent tier-gated modules on core (campaigns, cpq)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'core',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'campaigns')).toBe(false)
    expect(await isModuleEnabled(TENANT_ID, 'cpq')).toBe(false)
  })

  it('allows absent tier-gated modules on scale (campaigns, cpq)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'scale',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'campaigns')).toBe(true)
    expect(await isModuleEnabled(TENANT_ID, 'cpq')).toBe(true)
  })

  it('fails closed for a tier-gated module on an unknown plan', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'mystery',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'campaigns')).toBe(false)
  })
})

describe('isModuleEnabled — product / unprovisioned', () => {
  it('product maya_only → only maya is enabled', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { maya: true },
      subscription_plan: 'core',
      product: 'maya_only',
    })

    expect(await isModuleEnabled(TENANT_ID, 'maya')).toBe(true)
    expect(await isModuleEnabled(TENANT_ID, 'crm')).toBe(false)
    expect(await isModuleEnabled(TENANT_ID, 'appointments')).toBe(false)
  })

  it('modules entirely null → only maya is enabled (fail closed)', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: null,
      subscription_plan: 'core',
      product: 'suite',
    })

    expect(await isModuleEnabled(TENANT_ID, 'maya')).toBe(true)
    expect(await isModuleEnabled(TENANT_ID, 'crm')).toBe(false)
  })

  it('missing tenant row (query error) → only maya is enabled', async () => {
    // no rows pushed → single() returns data:null
    expect(await isModuleEnabled(TENANT_ID, 'maya')).toBe(true)
    expect(await isModuleEnabled(TENANT_ID, 'crm')).toBe(false)
  })
})
