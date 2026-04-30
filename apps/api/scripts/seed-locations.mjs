/* global process, console */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const locations = [
  {
    tenant_id: '018323e5-4866-486e-bc90-15cfeb910fc4',
    name: 'Demo Location',
    maya_enabled: true,
    telnyx_number: '+15127376388',
    timezone: 'America/Chicago',
  },
  {
    tenant_id: 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
    name: 'HQ',
    maya_enabled: true,
    telnyx_number: '+15127376388',
    timezone: 'America/Chicago',
  },
]

for (const loc of locations) {
  const { data: existing } = await s
    .from('locations')
    .select('id')
    .eq('tenant_id', loc.tenant_id)
    .maybeSingle()

  if (existing) {
    const { error } = await s
      .from('locations')
      .update({
        maya_enabled: loc.maya_enabled,
        telnyx_number: loc.telnyx_number,
        timezone: loc.timezone,
        name: loc.name,
      })
      .eq('tenant_id', loc.tenant_id)
    console.info(`updated ${loc.name}:`, error ?? 'ok')
  } else {
    const { error } = await s.from('locations').insert(loc)
    console.info(`inserted ${loc.name}:`, error ?? 'ok')
  }
}
