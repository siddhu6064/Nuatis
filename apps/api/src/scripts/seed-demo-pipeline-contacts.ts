import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DEMO_TENANT_ID = '018323e5-4866-486e-bc90-15cfeb910fc4'

function getSupabase(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env')
  return createClient(url, key)
}

function toTitle(vertical: string): string {
  return vertical
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ─── Contact data per vertical ────────────────────────────────────────────────

const CONTACTS: Record<
  string,
  Array<{
    full_name: string
    phone: string
    email?: string
    pipeline_stage: string
    source: 'inbound_call' | 'import'
    last_contacted?: string
    tags?: string[]
    notes?: string
  }>
> = {
  car_wash: [
    {
      full_name: 'Marcus Rivera',
      phone: '+15125550101',
      email: 'mrivera@email.com',
      pipeline_stage: 'Lead',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Dana Holloway',
      phone: '+15125550102',
      email: 'dana.h@gmail.com',
      pipeline_stage: 'Lead',
      source: 'import',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Troy Bennett',
      phone: '+15125550103',
      pipeline_stage: 'First Wash',
      source: 'inbound_call',
      last_contacted: daysAgo(5),
    },
    {
      full_name: 'Priya Nair',
      phone: '+15125550104',
      email: 'priya.nair@outlook.com',
      pipeline_stage: 'First Wash',
      source: 'import',
      last_contacted: daysAgo(7),
    },
    {
      full_name: 'Carlos Mendez',
      phone: '+15125550105',
      email: 'cmendez@yahoo.com',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(10),
    },
    {
      full_name: 'Ashley Kim',
      phone: '+15125550106',
      pipeline_stage: 'Regular',
      source: 'inbound_call',
      last_contacted: daysAgo(4),
    },
    {
      full_name: 'Jordan Walsh',
      phone: '+15125550107',
      email: 'jwalsh@email.com',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(14),
    },
    {
      full_name: 'Nadia Osei',
      phone: '+15125550108',
      email: 'nadia.o@gmail.com',
      pipeline_stage: 'Club Member',
      source: 'import',
      last_contacted: daysAgo(2),
      tags: ['vip'],
    },
    {
      full_name: 'Derek Stone',
      phone: '+15125550109',
      pipeline_stage: 'Club Member',
      source: 'inbound_call',
      last_contacted: daysAgo(6),
      tags: ['vip'],
    },
    {
      full_name: 'Melissa Torres',
      phone: '+15125550110',
      email: 'mel.torres@outlook.com',
      pipeline_stage: 'Club Member',
      source: 'import',
      last_contacted: daysAgo(9),
      tags: ['vip'],
    },
  ],
  gym: [
    {
      full_name: 'Evan Park',
      phone: '+15125550201',
      email: 'evan.park@gmail.com',
      pipeline_stage: 'Lead',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Simone Carter',
      phone: '+15125550202',
      pipeline_stage: 'Lead',
      source: 'import',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Brock Navarro',
      phone: '+15125550203',
      email: 'brock.n@yahoo.com',
      pipeline_stage: 'Trial Session',
      source: 'inbound_call',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Kira Okafor',
      phone: '+15125550204',
      email: 'kira.o@email.com',
      pipeline_stage: 'Trial Session',
      source: 'import',
      last_contacted: daysAgo(5),
    },
    {
      full_name: 'Tyler Rush',
      phone: '+15125550205',
      pipeline_stage: 'Active Member',
      source: 'import',
      last_contacted: daysAgo(8),
    },
    {
      full_name: 'Maya Santos',
      phone: '+15125550206',
      email: 'maya.s@gmail.com',
      pipeline_stage: 'Active Member',
      source: 'import',
      last_contacted: daysAgo(12),
      tags: ['vip'],
    },
    {
      full_name: 'Devon Clarke',
      phone: '+15125550207',
      email: 'dclarke@outlook.com',
      pipeline_stage: 'Active Member',
      source: 'inbound_call',
      last_contacted: daysAgo(4),
    },
    {
      full_name: 'Hana Cho',
      phone: '+15125550208',
      pipeline_stage: 'At-Risk Member',
      source: 'import',
      last_contacted: daysAgo(25),
      notes: 'Missed last 3 check-ins',
    },
    {
      full_name: 'Quentin Moss',
      phone: '+15125550209',
      email: 'qmoss@email.com',
      pipeline_stage: 'At-Risk Member',
      source: 'import',
      last_contacted: daysAgo(30),
      notes: 'Contract renewal due soon',
    },
    {
      full_name: 'Fiona Bell',
      phone: '+15125550210',
      pipeline_stage: 'Lapsed',
      source: 'import',
      last_contacted: daysAgo(60),
      notes: 'Win-back candidate',
    },
  ],
  spa: [
    {
      full_name: 'Isabelle Fontaine',
      phone: '+15125550301',
      email: 'isabelle.f@gmail.com',
      pipeline_stage: 'Inquiry',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Nathan Gould',
      phone: '+15125550302',
      pipeline_stage: 'Inquiry',
      source: 'import',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Chloe Marsh',
      phone: '+15125550303',
      email: 'chloe.m@outlook.com',
      pipeline_stage: 'Consultation Booked',
      source: 'inbound_call',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Ravi Sharma',
      phone: '+15125550304',
      email: 'ravi.s@email.com',
      pipeline_stage: 'Consultation Booked',
      source: 'import',
      last_contacted: daysAgo(5),
    },
    {
      full_name: 'Tessa Brown',
      phone: '+15125550305',
      pipeline_stage: 'First Visit',
      source: 'inbound_call',
      last_contacted: daysAgo(7),
    },
    {
      full_name: 'Oliver Hayes',
      phone: '+15125550306',
      email: 'oliver.h@gmail.com',
      pipeline_stage: 'First Visit',
      source: 'import',
      last_contacted: daysAgo(10),
    },
    {
      full_name: 'Amara Diallo',
      phone: '+15125550307',
      email: 'amara.d@yahoo.com',
      pipeline_stage: 'Returning Client',
      source: 'import',
      last_contacted: daysAgo(14),
      tags: ['regular'],
    },
    {
      full_name: 'Leo Vasquez',
      phone: '+15125550308',
      pipeline_stage: 'Returning Client',
      source: 'inbound_call',
      last_contacted: daysAgo(6),
      tags: ['regular'],
    },
    {
      full_name: 'Sophie Winters',
      phone: '+15125550309',
      email: 'sophie.w@email.com',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(4),
      tags: ['vip', 'member'],
    },
    {
      full_name: 'Cameron Reid',
      phone: '+15125550310',
      email: 'creid@outlook.com',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(9),
      tags: ['member'],
    },
  ],
  nail_bar: [
    {
      full_name: 'Bianca Cruz',
      phone: '+15125550401',
      email: 'bianca.c@gmail.com',
      pipeline_stage: 'New Client',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Jade Wilson',
      phone: '+15125550402',
      pipeline_stage: 'New Client',
      source: 'import',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Natalie Ford',
      phone: '+15125550403',
      email: 'natalie.f@email.com',
      pipeline_stage: 'First Appointment',
      source: 'inbound_call',
      last_contacted: daysAgo(4),
    },
    {
      full_name: 'Priscilla James',
      phone: '+15125550404',
      email: 'pjames@yahoo.com',
      pipeline_stage: 'First Appointment',
      source: 'import',
      last_contacted: daysAgo(6),
    },
    {
      full_name: 'Tamara Ellis',
      phone: '+15125550405',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(10),
      tags: ['regular'],
    },
    {
      full_name: 'Keisha Grant',
      phone: '+15125550406',
      email: 'keisha.g@gmail.com',
      pipeline_stage: 'Regular',
      source: 'inbound_call',
      last_contacted: daysAgo(5),
      tags: ['regular'],
    },
    {
      full_name: 'Lydia Pham',
      phone: '+15125550407',
      email: 'lydia.p@outlook.com',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(12),
      tags: ['regular'],
    },
    {
      full_name: 'Rosa Ibáñez',
      phone: '+15125550408',
      pipeline_stage: 'Loyal Member',
      source: 'import',
      last_contacted: daysAgo(3),
      tags: ['vip', 'member'],
    },
    {
      full_name: 'Diane Park',
      phone: '+15125550409',
      email: 'diane.p@email.com',
      pipeline_stage: 'Loyal Member',
      source: 'import',
      last_contacted: daysAgo(7),
      tags: ['member'],
    },
  ],
  pet_grooming: [
    {
      full_name: 'Josh Murphy',
      phone: '+15125550501',
      email: 'josh.m@gmail.com',
      pipeline_stage: 'New Client',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
      notes: 'Golden Retriever – Buddy',
    },
    {
      full_name: 'Sandra Lee',
      phone: '+15125550502',
      pipeline_stage: 'New Client',
      source: 'import',
      last_contacted: daysAgo(3),
      notes: 'Poodle mix – Luna',
    },
    {
      full_name: 'Greg Hoffman',
      phone: '+15125550503',
      email: 'ghoffman@email.com',
      pipeline_stage: 'First Appointment',
      source: 'inbound_call',
      last_contacted: daysAgo(5),
      notes: 'Labrador – Max',
    },
    {
      full_name: 'Alicia Ward',
      phone: '+15125550504',
      email: 'alicia.w@yahoo.com',
      pipeline_stage: 'First Appointment',
      source: 'import',
      last_contacted: daysAgo(7),
      notes: 'Shih Tzu – Coco',
    },
    {
      full_name: 'Brian Tran',
      phone: '+15125550505',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(11),
      notes: 'Husky – Shadow',
    },
    {
      full_name: 'Monica Reyes',
      phone: '+15125550506',
      email: 'monica.r@gmail.com',
      pipeline_stage: 'Regular',
      source: 'inbound_call',
      last_contacted: daysAgo(6),
      notes: 'Dachshund – Otto',
    },
    {
      full_name: 'Kevin Obi',
      phone: '+15125550507',
      email: 'kevin.o@outlook.com',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(15),
      notes: 'Border Collie – Stella',
    },
    {
      full_name: 'Patricia Nunn',
      phone: '+15125550508',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(4),
      tags: ['member'],
      notes: 'Maltese – Daisy',
    },
    {
      full_name: 'Tom Decker',
      phone: '+15125550509',
      email: 'tdecker@email.com',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(8),
      tags: ['member'],
      notes: '2 cats – Milo & Nala',
    },
  ],
  laundry: [
    {
      full_name: 'Alicia Vega',
      phone: '+15125550601',
      email: 'alicia.v@gmail.com',
      pipeline_stage: 'Lead',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Paul Nguyen',
      phone: '+15125550602',
      pipeline_stage: 'Lead',
      source: 'import',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Carmen Rios',
      phone: '+15125550603',
      email: 'carmen.r@email.com',
      pipeline_stage: 'First Order',
      source: 'inbound_call',
      last_contacted: daysAgo(4),
    },
    {
      full_name: 'Steven Yoo',
      phone: '+15125550604',
      email: 'syoo@yahoo.com',
      pipeline_stage: 'First Order',
      source: 'import',
      last_contacted: daysAgo(6),
    },
    {
      full_name: 'Erica Baldwin',
      phone: '+15125550605',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(9),
      tags: ['regular'],
    },
    {
      full_name: 'Marcus Webb',
      phone: '+15125550606',
      email: 'mwebb@gmail.com',
      pipeline_stage: 'Regular',
      source: 'inbound_call',
      last_contacted: daysAgo(5),
      tags: ['regular'],
    },
    {
      full_name: 'Lena Kowalski',
      phone: '+15125550607',
      email: 'lena.k@outlook.com',
      pipeline_stage: 'Regular',
      source: 'import',
      last_contacted: daysAgo(13),
      tags: ['regular'],
    },
    {
      full_name: 'Roy Simmons',
      phone: '+15125550608',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(3),
      tags: ['member'],
    },
    {
      full_name: 'Nina Castillo',
      phone: '+15125550609',
      email: 'nina.c@email.com',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(7),
      tags: ['member'],
    },
    {
      full_name: 'Omar Hassan',
      phone: '+15125550610',
      email: 'ohassan@gmail.com',
      pipeline_stage: 'Member',
      source: 'import',
      last_contacted: daysAgo(11),
      tags: ['member', 'vip'],
    },
  ],
  tattoo: [
    {
      full_name: 'Zach Mercer',
      phone: '+15125550701',
      email: 'zach.m@gmail.com',
      pipeline_stage: 'Inquiry',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Jade Fontaine',
      phone: '+15125550702',
      pipeline_stage: 'Inquiry',
      source: 'import',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Arturo Reyes',
      phone: '+15125550703',
      email: 'arturo.r@email.com',
      pipeline_stage: 'Consultation',
      source: 'inbound_call',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Tiffany Ho',
      phone: '+15125550704',
      email: 'tiffany.h@yahoo.com',
      pipeline_stage: 'Consultation',
      source: 'import',
      last_contacted: daysAgo(5),
    },
    {
      full_name: 'Dante Cruz',
      phone: '+15125550705',
      pipeline_stage: 'Deposit Paid',
      source: 'inbound_call',
      last_contacted: daysAgo(4),
      notes: 'Half-sleeve floral design',
    },
    {
      full_name: 'Riley Carr',
      phone: '+15125550706',
      email: 'riley.c@gmail.com',
      pipeline_stage: 'Deposit Paid',
      source: 'import',
      last_contacted: daysAgo(6),
      notes: 'Geometric back piece',
    },
    {
      full_name: 'Milan Okafor',
      phone: '+15125550707',
      email: 'milan.o@outlook.com',
      pipeline_stage: 'Session Booked',
      source: 'import',
      last_contacted: daysAgo(7),
    },
    {
      full_name: 'Iris Tanaka',
      phone: '+15125550708',
      pipeline_stage: 'Session Booked',
      source: 'inbound_call',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Drew Harmon',
      phone: '+15125550709',
      email: 'drew.h@email.com',
      pipeline_stage: 'Completed',
      source: 'import',
      last_contacted: daysAgo(14),
    },
    {
      full_name: 'Celeste Ruiz',
      phone: '+15125550710',
      email: 'celeste.r@gmail.com',
      pipeline_stage: 'Completed',
      source: 'import',
      last_contacted: daysAgo(20),
    },
  ],

  // Smaller sets for core verticals
  sales_crm: [
    {
      full_name: 'James Whitfield',
      phone: '+15125550801',
      email: 'jwhitfield@corp.com',
      pipeline_stage: 'New lead',
      source: 'import',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Rachel Lam',
      phone: '+15125550802',
      email: 'rlam@techco.io',
      pipeline_stage: 'New lead',
      source: 'inbound_call',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'Derrick Stone',
      phone: '+15125550803',
      email: 'dstone@venture.com',
      pipeline_stage: 'Qualified',
      source: 'import',
      last_contacted: daysAgo(5),
    },
    {
      full_name: 'Amanda Cross',
      phone: '+15125550804',
      email: 'across@agency.com',
      pipeline_stage: 'Demo scheduled',
      source: 'import',
      last_contacted: daysAgo(3),
    },
    {
      full_name: 'Victor Ng',
      phone: '+15125550805',
      email: 'vng@startup.io',
      pipeline_stage: 'Proposal sent',
      source: 'import',
      last_contacted: daysAgo(8),
      tags: ['hot-lead'],
    },
  ],
  medical: [
    {
      full_name: 'Helen Park',
      phone: '+15125550901',
      email: 'hpark@gmail.com',
      pipeline_stage: 'New patient',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
    },
    {
      full_name: 'Sam Obi',
      phone: '+15125550902',
      pipeline_stage: 'New patient',
      source: 'import',
      last_contacted: daysAgo(4),
    },
    {
      full_name: 'Karen Mills',
      phone: '+15125550903',
      email: 'kmills@email.com',
      pipeline_stage: 'Intake scheduled',
      source: 'inbound_call',
      last_contacted: daysAgo(2),
    },
    {
      full_name: 'David Chen',
      phone: '+15125550904',
      email: 'dchen@outlook.com',
      pipeline_stage: 'Active patient',
      source: 'import',
      last_contacted: daysAgo(10),
    },
    {
      full_name: 'Maria Lopez',
      phone: '+15125550905',
      email: 'mlopez@gmail.com',
      pipeline_stage: 'Follow-up',
      source: 'import',
      last_contacted: daysAgo(15),
    },
  ],
  veterinary: [
    {
      full_name: 'Patrick Hill',
      phone: '+15125551001',
      email: 'phill@gmail.com',
      pipeline_stage: 'New inquiry',
      source: 'inbound_call',
      last_contacted: daysAgo(1),
      notes: 'Cat – Whiskers',
    },
    {
      full_name: 'Lisa Grant',
      phone: '+15125551002',
      pipeline_stage: 'New inquiry',
      source: 'import',
      last_contacted: daysAgo(3),
      notes: 'Dog – Biscuit',
    },
    {
      full_name: 'Omar Diaz',
      phone: '+15125551003',
      email: 'odiaz@email.com',
      pipeline_stage: 'Consultation booked',
      source: 'inbound_call',
      last_contacted: daysAgo(2),
      notes: 'Rabbit – Clover',
    },
    {
      full_name: 'Stacy Moon',
      phone: '+15125551004',
      email: 'smoon@yahoo.com',
      pipeline_stage: 'Under care',
      source: 'import',
      last_contacted: daysAgo(7),
    },
    {
      full_name: 'Chris Adeyemi',
      phone: '+15125551005',
      email: 'cadeyemi@outlook.com',
      pipeline_stage: 'Active pet',
      source: 'import',
      last_contacted: daysAgo(12),
    },
  ],
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tenantId = process.argv[2] ?? DEMO_TENANT_ID
  const supabase = getSupabase()

  console.info(`[seed-demo-contacts] Seeding contacts for tenant ${tenantId}`)

  // Load all pipelines for tenant
  const { data: pipelines, error: plErr } = await supabase
    .from('pipelines')
    .select('id, name')
    .eq('tenant_id', tenantId)

  if (plErr || !pipelines) {
    console.error('[seed-demo-contacts] ✗ Failed to load pipelines:', plErr?.message)
    process.exit(1)
  }

  let totalInserted = 0
  let totalSkipped = 0

  for (const vertical of Object.keys(CONTACTS)) {
    const label = toTitle(vertical)
    const candidates = [
      pipelines.find((p) => p.name === `${label} Pipeline`),
      pipelines.find((p) => p.name.toLowerCase().includes(label.toLowerCase())),
      pipelines.find((p) => p.name.toLowerCase().includes(vertical.replace('_', ' '))),
    ]
    const pipeline = candidates.find(Boolean)

    if (!pipeline) {
      console.warn(`[seed-demo-contacts] ⚠ No pipeline found for ${vertical} — skipping`)
      continue
    }

    const contacts = CONTACTS[vertical]!
    let inserted = 0

    for (const c of contacts) {
      // Skip if phone already exists for this tenant
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', c.phone)
        .maybeSingle()

      if (existing) {
        totalSkipped++
        continue
      }

      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        full_name: c.full_name,
        phone: c.phone,
        source: c.source,
        pipeline_stage: c.pipeline_stage,
        sms_opt_in: c.source === 'inbound_call',
      }
      if (c.email) row['email'] = c.email
      if (c.last_contacted) row['last_contacted'] = c.last_contacted
      if (c.tags?.length) row['tags'] = c.tags
      if (c.notes) row['notes'] = c.notes

      const { error: insertErr } = await supabase.from('contacts').insert(row)
      if (insertErr) {
        console.error(
          `[seed-demo-contacts] ✗ Insert failed for ${c.full_name}: ${insertErr.message}`
        )
      } else {
        inserted++
        totalInserted++
      }
    }

    console.info(`[seed-demo-contacts] ✓ ${label} Pipeline — ${inserted} inserted`)
  }

  console.info(
    `[seed-demo-contacts] Done. ${totalInserted} inserted, ${totalSkipped} skipped (already exist).`
  )
}

main().catch((err) => {
  console.error('[seed-demo-contacts] fatal:', err)
  process.exit(1)
})
