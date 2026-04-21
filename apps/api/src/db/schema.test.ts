import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env') })

const EXPECTED_TABLES = [
  'tenants',
  'subscriptions',
  'locations',
  'users',
  'contacts',
  'phone_numbers',
  'calls',
  'call_transcripts',
  'appointments',
  'pipeline_stages',
  'pipeline_entries',
  'automation_rules',
  'automation_jobs',
  'notifications',
  'knowledge_docs',
  'knowledge_chunks',
  'schema_versions',
]

const TABLES_WITH_RLS = EXPECTED_TABLES.filter((t) => t !== 'schema_versions')

describe('Schema migration tests', () => {
  const supabaseUrl = process.env['SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !anonKey || !serviceKey) {
    it.skip('Skipping — SUPABASE_URL and keys not set', () => {})
    return
  }

  // Anon client — subject to RLS; used for RLS-blocking assertions
  const supabase = createClient(supabaseUrl, anonKey)
  // Service role client — bypasses RLS; used to verify tables exist
  const admin = createClient(supabaseUrl, serviceKey)

  it('anon user cannot read contacts table (RLS active)', async () => {
    const { data, error } = await supabase.from('contacts').select('*').limit(1)
    if (error) {
      expect(error.message).toBeTruthy()
      console.info('RLS working — anon read blocked:', error.message)
    } else {
      expect(data).toHaveLength(0)
    }
  })

  it('anon user cannot read tenants table (RLS active)', async () => {
    const { data, error } = await supabase.from('tenants').select('*').limit(1)
    if (error) {
      expect(error.message).toBeTruthy()
    } else {
      expect(data).toHaveLength(0)
    }
  })

  it('anon user cannot read calls table (RLS active)', async () => {
    const { data, error } = await supabase.from('calls').select('*').limit(1)
    if (error) {
      expect(error.message).toBeTruthy()
    } else {
      expect(data).toHaveLength(0)
    }
  })

  it('anon user cannot read appointments table (RLS active)', async () => {
    const { data, error } = await supabase.from('appointments').select('*').limit(1)
    if (error) {
      expect(error.message).toBeTruthy()
    } else {
      expect(data).toHaveLength(0)
    }
  })

  it(`all ${EXPECTED_TABLES.length} expected tables exist`, async () => {
    // Use service role so we can distinguish "table missing" from
    // "anon blocked / permission denied". A service-role query on a
    // missing table returns a 42P01 error; on an existing table it
    // returns data (or an empty set) with no error.
    const checks = await Promise.all(
      EXPECTED_TABLES.map(async (table) => {
        const { error } = await admin.from(table).select('count').limit(0)
        const tableMissing = error?.code === '42P01' || error?.message?.includes('does not exist')
        return { table, exists: !tableMissing }
      })
    )
    const missing = checks.filter((c) => !c.exists).map((c) => c.table)
    expect(missing).toHaveLength(0)
  })

  it(`RLS blocks all ${TABLES_WITH_RLS.length} tenant tables for anon user`, async () => {
    const results = await Promise.all(
      TABLES_WITH_RLS.map(async (table) => {
        const { data, error } = await supabase.from(table).select('*').limit(1)
        const blocked = !!error || (Array.isArray(data) && data.length === 0)
        return { table, blocked }
      })
    )
    const notBlocked = results.filter((r) => !r.blocked).map((r) => r.table)
    if (notBlocked.length > 0) {
      console.error('RLS NOT blocking these tables:', notBlocked)
    }
    expect(notBlocked).toHaveLength(0)
  })
})
