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
  const supabaseKey = process.env['SUPABASE_ANON_KEY']

  if (!supabaseUrl || !supabaseKey) {
    it.skip('Skipping — SUPABASE_URL and SUPABASE_ANON_KEY not set', () => {})
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

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
    const checks = await Promise.all(
      EXPECTED_TABLES.map(async (table) => {
        const { error } = await supabase.from(table).select('count').limit(0)
        const blocked =
          error?.message?.includes('RLS') ||
          error?.message?.includes('policy') ||
          error?.code === 'PGRST301' ||
          !error
        return { table, exists: blocked || !error }
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
