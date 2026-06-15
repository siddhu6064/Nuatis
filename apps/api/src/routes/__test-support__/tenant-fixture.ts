/**
 * Shared tenant fixture for mock-store integration tests.
 *
 * Returns a fully-provisioned tenant — the production-normal state: a paid
 * suite tenant on the top tier with an active subscription. Use this whenever
 * a test needs the entitlement gates (isModuleEnabled / requirePlan) to pass;
 * the null-product / null-plan / null-modules state they previously relied on
 * is an unprovisioned state that no longer exists in production.
 *
 * NOT a test file — lives under __test-support__ so Jest's testMatch
 * ('**\/*.test.ts') does not pick it up.
 */
import type { MockStore, Row } from './supabase-mock.js'

export function entitledTenantRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    name: 'Test Biz',
    brand_voice: null,
    vertical: null,
    product: 'suite',
    subscription_plan: 'scale',
    subscription_status: 'active',
    modules: {},
    ...overrides,
  }
}

/** Seed (replacing any existing) the entitled tenant into the mock store. */
export function seedEntitledTenant(store: MockStore, id: string, overrides: Row = {}): void {
  store.tables['tenants'] = [entitledTenantRow(id, overrides)]
}
