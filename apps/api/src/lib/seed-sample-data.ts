import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const SAMPLE_CONTACTS: Array<{
  name: string
  email: string
  source: 'inbound_call' | 'web_form' | 'referral' | 'manual'
}> = [
  { name: 'Maria Hernandez', email: 'maria.hernandez@example.com', source: 'inbound_call' },
  { name: 'James Okonkwo', email: 'james.okonkwo@example.com', source: 'web_form' },
  { name: 'Priya Sharma', email: 'priya.sharma@example.com', source: 'referral' },
  { name: 'Tyler Brooks', email: 'tyler.brooks@example.com', source: 'inbound_call' },
  { name: 'Leila Nguyen', email: 'leila.nguyen@example.com', source: 'web_form' },
  { name: 'Carlos Reyes', email: 'carlos.reyes@example.com', source: 'referral' },
  { name: 'Ashley Kim', email: 'ashley.kim@example.com', source: 'inbound_call' },
  { name: 'Devon Patel', email: 'devon.patel@example.com', source: 'manual' },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function getVerticalTags(vertical: string): string[][] {
  const map: Record<string, string[][]> = {
    dental: [
      ['new patient'],
      ['cleaning'],
      ['new patient', 'recall'],
      ['cleaning', 'x-ray'],
      ['treatment plan'],
      ['recall'],
      ['new patient'],
      ['cleaning'],
    ],
    medical: [
      ['new patient'],
      ['follow-up'],
      ['new patient', 'annual'],
      ['chronic care'],
      ['follow-up'],
      ['new patient'],
      ['annual'],
      ['chronic care'],
    ],
    veterinary: [
      ['new patient'],
      ['wellness'],
      ['new patient', 'dental'],
      ['wellness', 'senior'],
      ['follow-up'],
      ['new patient'],
      ['dental'],
      ['wellness'],
    ],
    salon: [
      ['color'],
      ['cut'],
      ['color', 'new client'],
      ['extensions'],
      ['new client'],
      ['highlights'],
      ['cut'],
      ['balayage'],
    ],
    contractor: [
      ['estimate requested'],
      ['high value'],
      ['estimate requested', 'repeat customer'],
      ['referral'],
      ['high value'],
      ['estimate requested'],
      ['repeat customer'],
      ['referral'],
    ],
    law_firm: [
      ['intake'],
      ['retainer'],
      ['intake', 'high value'],
      ['consultation'],
      ['retainer'],
      ['intake'],
      ['consultation'],
      ['high value'],
    ],
    spa: [
      ['membership'],
      ['new client'],
      ['membership', 'VIP'],
      ['package holder'],
      ['new client'],
      ['VIP'],
      ['membership'],
      ['package holder'],
    ],
    gym: [
      ['personal training'],
      ['new member'],
      ['personal training', 'VIP'],
      ['class package'],
      ['new member'],
      ['renewal'],
      ['personal training'],
      ['class package'],
    ],
    restaurant: [
      ['VIP'],
      ['regular'],
      ['VIP', 'birthday'],
      ['group booking'],
      ['regular'],
      ['event'],
      ['VIP'],
      ['new guest'],
    ],
    real_estate: [
      ['buyer'],
      ['seller'],
      ['buyer', 'pre-approved'],
      ['investor'],
      ['seller'],
      ['buyer'],
      ['investor'],
      ['referral'],
    ],
    sales_crm: [
      ['hot lead'],
      ['follow-up'],
      ['hot lead', 'decision maker'],
      ['demo scheduled'],
      ['follow-up'],
      ['hot lead'],
      ['nurture'],
      ['decision maker'],
    ],
    nail_bar: [
      ['new client'],
      ['regular'],
      ['new client', 'gel'],
      ['acrylic'],
      ['regular'],
      ['new client'],
      ['gel'],
      ['pedicure'],
    ],
    pet_grooming: [
      ['new client'],
      ['regular'],
      ['new client', 'large breed'],
      ['senior pet'],
      ['regular'],
      ['new client'],
      ['large breed'],
      ['puppy'],
    ],
    tattoo: [
      ['new client'],
      ['deposit paid'],
      ['new client', 'large piece'],
      ['touch-up'],
      ['deposit paid'],
      ['new client'],
      ['cover-up'],
      ['walk-in'],
    ],
    car_wash: [
      ['membership'],
      ['new customer'],
      ['membership', 'detail'],
      ['fleet'],
      ['new customer'],
      ['membership'],
      ['detail'],
      ['fleet'],
    ],
    laundry: [
      ['pickup'],
      ['drop-off'],
      ['pickup', 'regular'],
      ['commercial'],
      ['regular'],
      ['new customer'],
      ['pickup'],
      ['commercial'],
    ],
  }
  return (
    map[vertical] ?? [
      ['new'],
      ['follow-up'],
      ['new', 'priority'],
      ['referral'],
      ['new'],
      ['priority'],
      ['follow-up'],
      ['referral'],
    ]
  )
}

function getDealValue(vertical: string): number {
  const map: Record<string, number> = {
    dental: 800,
    medical: 600,
    veterinary: 350,
    contractor: 4500,
    law_firm: 3000,
    salon: 120,
    spa: 250,
    gym: 400,
    restaurant: 200,
    real_estate: 8500,
    sales_crm: 2500,
    nail_bar: 80,
    pet_grooming: 90,
    tattoo: 300,
    car_wash: 50,
    laundry: 75,
  }
  return map[vertical] ?? 500
}

function getAppointmentDurationMs(vertical: string): number {
  const minutesMap: Record<string, number> = {
    dental: 60,
    medical: 30,
    veterinary: 30,
    salon: 45,
    contractor: 90,
    law_firm: 60,
    spa: 60,
    gym: 60,
    restaurant: 90,
    real_estate: 60,
    sales_crm: 30,
    nail_bar: 45,
    pet_grooming: 60,
    tattoo: 120,
    car_wash: 30,
    laundry: 60,
  }
  return (minutesMap[vertical] ?? 30) * 60 * 1000
}

export async function seedSampleData(
  tenantId: string,
  locationId: string | null,
  vertical: string
): Promise<void> {
  const supabase = getSupabase()

  // Fetch pipeline stages
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })

  const stageList = stages ?? []
  const tagSets = getVerticalTags(vertical)
  const baseValue = getDealValue(vertical)
  const apptDurationMs = getAppointmentDurationMs(vertical)

  // ── Contacts ──────────────────────────────────────────────────
  const contactRows = SAMPLE_CONTACTS.map((c, i) => ({
    tenant_id: tenantId,
    full_name: c.name,
    email: c.email,
    phone: `+1512555010${i + 1}`,
    source: c.source,
    tags: tagSets[i] ?? [],
    pipeline_stage: stageList[i % Math.max(stageList.length, 1)]?.name ?? null,
    created_at: daysAgo(5 + i * 3),
  }))

  const { data: insertedContacts } = await supabase
    .from('contacts')
    .insert(contactRows)
    .select('id')

  const contactIds = (insertedContacts ?? []).map((c) => c.id as string)
  if (contactIds.length === 0) return

  // ── Appointments ──────────────────────────────────────────────
  const apptDefs: Array<{ daysOffset: number; status: string }> = [
    { daysOffset: -25, status: 'completed' },
    { daysOffset: -15, status: 'completed' },
    { daysOffset: -20, status: 'no_show' },
    { daysOffset: -8, status: 'canceled' },
    { daysOffset: 4, status: 'confirmed' },
  ]

  const apptRows = apptDefs.map((def, i) => {
    const start = new Date()
    start.setDate(start.getDate() + def.daysOffset)
    start.setHours(9 + i * 2, 0, 0, 0)
    start.setSeconds(0, 0)
    const end = new Date(start.getTime() + apptDurationMs)
    const contactIndex = i % contactIds.length
    return {
      tenant_id: tenantId,
      contact_id: contactIds[contactIndex]!,
      location_id: locationId ?? null,
      title: `Appointment — ${SAMPLE_CONTACTS[contactIndex]!.name}`,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: def.status,
    }
  })

  await supabase.from('appointments').insert(apptRows)

  // ── Voice sessions (call logs) ────────────────────────────────
  const callDefs: Array<{ daysAgoN: number; duration: number; outcome: string }> = [
    { daysAgoN: 1, duration: 95, outcome: 'booked' },
    { daysAgoN: 3, duration: 145, outcome: 'booked' },
    { daysAgoN: 5, duration: 67, outcome: 'booked' },
    { daysAgoN: 7, duration: 178, outcome: 'info' },
    { daysAgoN: 10, duration: 52, outcome: 'info' },
    { daysAgoN: 13, duration: 113, outcome: 'transferred' },
  ]

  const callRows = callDefs.map((def, i) => ({
    tenant_id: tenantId,
    contact_id: contactIds[i % contactIds.length] ?? null,
    caller_phone: `+1512555010${(i % 8) + 1}`,
    direction: 'inbound',
    status: 'completed',
    duration_seconds: def.duration,
    outcome: def.outcome,
    created_at: daysAgo(def.daysAgoN),
  }))

  await supabase.from('voice_sessions').insert(callRows)

  // ── Deals ─────────────────────────────────────────────────────
  if (stageList.length === 0) return

  const s0 = stageList[0]!
  const s1 = stageList[Math.min(1, stageList.length - 1)]!
  const s2 = stageList[Math.min(2, stageList.length - 1)]!

  const dealRows = [
    {
      tenant_id: tenantId,
      contact_id: contactIds[0]!,
      title: `${SAMPLE_CONTACTS[0]!.name} — ${s0.name}`,
      value: baseValue,
      pipeline_stage_id: s0.id,
      is_closed_won: false,
      is_closed_lost: false,
      created_at: daysAgo(22),
    },
    {
      tenant_id: tenantId,
      contact_id: contactIds[1]!,
      title: `${SAMPLE_CONTACTS[1]!.name} — ${s1.name}`,
      value: Math.round(baseValue * 1.5),
      pipeline_stage_id: s1.id,
      is_closed_won: false,
      is_closed_lost: false,
      created_at: daysAgo(14),
    },
    {
      tenant_id: tenantId,
      contact_id: contactIds[2]!,
      title: `${SAMPLE_CONTACTS[2]!.name} — Won`,
      value: Math.round(baseValue * 2),
      pipeline_stage_id: s2.id,
      is_closed_won: true,
      is_closed_lost: false,
      created_at: daysAgo(18),
    },
    {
      tenant_id: tenantId,
      contact_id: contactIds[3]!,
      title: `${SAMPLE_CONTACTS[3]!.name} — Lost`,
      value: Math.round(baseValue * 0.8),
      pipeline_stage_id: s0.id,
      is_closed_won: false,
      is_closed_lost: true,
      created_at: daysAgo(28),
    },
  ]

  await supabase.from('deals').insert(dealRows)
}
