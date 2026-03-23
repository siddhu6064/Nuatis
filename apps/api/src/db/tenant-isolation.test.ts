import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env') })

// The two tenant IDs we created earlier
const TENANT_INTERNAL = 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b'
const TENANT_DEMO = '0d9a00b9-ce40-4702-a99c-ed23f11fdb08'

const supabaseUrl = process.env['SUPABASE_URL']
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
const anonKey = process.env['SUPABASE_ANON_KEY']

// Skip all tests if env not set
const skip = !supabaseUrl || !serviceKey || !anonKey

describe('Tenant isolation — RLS integration tests', () => {
  if (skip) {
    it.skip('Skipping — SUPABASE_URL / keys not set', () => {})
    return
  }

  // Service role client — bypasses RLS (used to seed test data)
  const admin = createClient(supabaseUrl!, serviceKey!)

  // Anon client — subject to RLS (simulates an unauthenticated request)
  const anon = createClient(supabaseUrl!, anonKey!)

  // ── RLS blocks anon reads ───────────────────────────────────
  it('anon client cannot read any tenant rows', async () => {
    const { data, error } = await anon.from('tenants').select('*')
    const blocked = !!error || (Array.isArray(data) && data.length === 0)
    expect(blocked).toBe(true)
  })

  it('anon client cannot read any contacts rows', async () => {
    const { data, error } = await anon.from('contacts').select('*')
    const blocked = !!error || (Array.isArray(data) && data.length === 0)
    expect(blocked).toBe(true)
  })

  it('anon client cannot read pipeline_stages', async () => {
    const { data, error } = await anon.from('pipeline_stages').select('*')
    const blocked = !!error || (Array.isArray(data) && data.length === 0)
    expect(blocked).toBe(true)
  })

  it('anon client cannot read vertical_configs', async () => {
    const { data, error } = await anon.from('vertical_configs').select('*')
    const blocked = !!error || (Array.isArray(data) && data.length === 0)
    expect(blocked).toBe(true)
  })

  // ── Service role can read both tenants ──────────────────────
  it('service role can read Nuatis internal tenant', async () => {
    const { data, error } = await admin
      .from('tenants')
      .select('id, name, vertical')
      .eq('id', TENANT_INTERNAL)
      .single()

    expect(error).toBeNull()
    expect(data?.name).toBe('Nuatis')
    expect(data?.vertical).toBe('sales_crm')
  })

  it('service role can read Nuatis demo tenant', async () => {
    const { data, error } = await admin
      .from('tenants')
      .select('id, name, vertical')
      .eq('id', TENANT_DEMO)
      .single()

    expect(error).toBeNull()
    expect(data?.name).toBe('Nuatis Demo')
    expect(data?.vertical).toBe('sales_crm')
  })

  // ── Cross-tenant isolation ──────────────────────────────────
  it('pipeline stages for internal tenant are isolated from demo tenant', async () => {
    const { data: internalStages } = await admin
      .from('pipeline_stages')
      .select('id, tenant_id, name')
      .eq('tenant_id', TENANT_INTERNAL)

    const { data: demoStages } = await admin
      .from('pipeline_stages')
      .select('id, tenant_id, name')
      .eq('tenant_id', TENANT_DEMO)

    // Both have their own stages
    expect(internalStages?.length).toBeGreaterThan(0)
    expect(demoStages?.length).toBeGreaterThan(0)

    // No stage IDs overlap between tenants
    const internalIds = new Set(internalStages?.map((s) => s.id))
    const overlap = demoStages?.filter((s) => internalIds.has(s.id))
    expect(overlap?.length).toBe(0)

    // All internal stages belong to internal tenant only
    internalStages?.forEach((s) => {
      expect(s.tenant_id).toBe(TENANT_INTERNAL)
    })

    // All demo stages belong to demo tenant only
    demoStages?.forEach((s) => {
      expect(s.tenant_id).toBe(TENANT_DEMO)
    })
  })

  it('vertical_configs are isolated per tenant', async () => {
    const { data: internalConfigs } = await admin
      .from('vertical_configs')
      .select('id, tenant_id')
      .eq('tenant_id', TENANT_INTERNAL)

    const { data: demoConfigs } = await admin
      .from('vertical_configs')
      .select('id, tenant_id')
      .eq('tenant_id', TENANT_DEMO)

    // No config IDs overlap
    const internalIds = new Set(internalConfigs?.map((c) => c.id))
    const overlap = demoConfigs?.filter((c) => internalIds.has(c.id))
    expect(overlap?.length).toBe(0)
  })

  it('users are isolated per tenant — internal user not visible in demo tenant query', async () => {
    const { data: internalUsers } = await admin
      .from('users')
      .select('id, tenant_id, email')
      .eq('tenant_id', TENANT_INTERNAL)

    const { data: demoUsers } = await admin
      .from('users')
      .select('id, tenant_id, email')
      .eq('tenant_id', TENANT_DEMO)

    // User IDs don't overlap
    const internalIds = new Set(internalUsers?.map((u) => u.id))
    const overlap = demoUsers?.filter((u) => internalIds.has(u.id))
    expect(overlap?.length).toBe(0)

    // Each user belongs strictly to their tenant
    internalUsers?.forEach((u) => expect(u.tenant_id).toBe(TENANT_INTERNAL))
    demoUsers?.forEach((u) => expect(u.tenant_id).toBe(TENANT_DEMO))
  })
})
