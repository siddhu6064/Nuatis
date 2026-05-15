import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

const DEMO_TENANT_ID = '018323e5-4866-486e-bc90-15cfeb910fc4'

function getSupabase(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env')
  return createClient(url, key)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ─── Stage color palette ──────────────────────────────────────────────────────

const C = {
  grey: '#888780',
  blue: '#378ADD',
  amber: '#EF9F27',
  purple: '#7F77DD',
  teal: '#2DA89C',
  green: '#1D9E75',
  orange: '#D85A30',
  darkGrey: '#6B7280',
} as const

// ─── Pipeline definitions ─────────────────────────────────────────────────────

interface StageSpec {
  name: string
  color: string
  is_default?: boolean
  is_terminal?: boolean
}

interface ContactSpec {
  full_name: string
  phone: string
  email?: string
  pipeline_stage: string
  source: 'inbound_call' | 'import'
  last_contacted?: string
  tags?: string[]
  notes?: string
}

interface VerticalSpec {
  pipelineName: string
  stages: StageSpec[]
  contacts: ContactSpec[]
}

const VERTICALS: Record<string, VerticalSpec> = {
  dental: {
    pipelineName: 'Dental Pipeline',
    stages: [
      { name: 'New Patient', color: C.grey, is_default: true },
      { name: 'Consultation', color: C.blue },
      { name: 'Treatment Plan', color: C.amber },
      { name: 'Active', color: C.teal },
      { name: 'Recall', color: C.green },
    ],
    contacts: [
      {
        full_name: 'Sarah Mitchell',
        phone: '+15125551101',
        email: 'sarah.mitchell@gmail.com',
        pipeline_stage: 'New Patient',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
      },
      {
        full_name: 'James Kowalski',
        phone: '+15125551102',
        pipeline_stage: 'New Patient',
        source: 'import',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Elena Rodrigues',
        phone: '+15125551103',
        email: 'elena.r@outlook.com',
        pipeline_stage: 'Consultation',
        source: 'inbound_call',
        last_contacted: daysAgo(4),
        notes: 'Needs crown on upper right molar',
      },
      {
        full_name: 'David Park',
        phone: '+15125551104',
        email: 'dpark@email.com',
        pipeline_stage: 'Consultation',
        source: 'import',
        last_contacted: daysAgo(6),
      },
      {
        full_name: 'Patricia Webb',
        phone: '+15125551105',
        pipeline_stage: 'Treatment Plan',
        source: 'import',
        last_contacted: daysAgo(8),
        notes: 'Invisalign + 2 fillings',
      },
      {
        full_name: 'Christopher Lane',
        phone: '+15125551106',
        email: 'clane@yahoo.com',
        pipeline_stage: 'Treatment Plan',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
      },
      {
        full_name: 'Maria Gonzalez',
        phone: '+15125551107',
        email: 'mgonzalez@gmail.com',
        pipeline_stage: 'Active',
        source: 'import',
        last_contacted: daysAgo(12),
        tags: ['regular'],
      },
      {
        full_name: 'Robert Chen',
        phone: '+15125551108',
        pipeline_stage: 'Active',
        source: 'inbound_call',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Linda Thompson',
        phone: '+15125551109',
        email: 'linda.t@email.com',
        pipeline_stage: 'Recall',
        source: 'import',
        last_contacted: daysAgo(90),
        notes: '6-month recall due — send reminder',
      },
    ],
  },

  medical: {
    pipelineName: 'Medical Pipeline',
    stages: [
      { name: 'New Patient', color: C.grey, is_default: true },
      { name: 'Initial Visit', color: C.blue },
      { name: 'Treatment', color: C.amber },
      { name: 'Follow-up', color: C.purple },
      { name: 'Discharged', color: C.green, is_terminal: true },
    ],
    contacts: [
      {
        full_name: 'Anthony Harris',
        phone: '+15125551201',
        email: 'aharris@gmail.com',
        pipeline_stage: 'New Patient',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
      },
      {
        full_name: 'Jessica Patel',
        phone: '+15125551202',
        pipeline_stage: 'New Patient',
        source: 'import',
        last_contacted: daysAgo(2),
      },
      {
        full_name: 'Michael Torres',
        phone: '+15125551203',
        email: 'mtorres@outlook.com',
        pipeline_stage: 'Initial Visit',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
      },
      {
        full_name: 'Amanda Reynolds',
        phone: '+15125551204',
        pipeline_stage: 'Initial Visit',
        source: 'import',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Daniel Kim',
        phone: '+15125551205',
        email: 'dkim@email.com',
        pipeline_stage: 'Treatment',
        source: 'import',
        last_contacted: daysAgo(10),
        notes: 'Ongoing hypertension management',
      },
      {
        full_name: 'Nicole Walker',
        phone: '+15125551206',
        pipeline_stage: 'Treatment',
        source: 'inbound_call',
        last_contacted: daysAgo(8),
      },
      {
        full_name: 'Kevin Brooks',
        phone: '+15125551207',
        email: 'kbrooks@yahoo.com',
        pipeline_stage: 'Follow-up',
        source: 'import',
        last_contacted: daysAgo(14),
      },
      {
        full_name: 'Stephanie Moore',
        phone: '+15125551208',
        pipeline_stage: 'Follow-up',
        source: 'import',
        last_contacted: daysAgo(18),
        notes: 'Post-procedure check scheduled',
      },
      {
        full_name: 'Brian Edwards',
        phone: '+15125551209',
        email: 'bedwards@gmail.com',
        pipeline_stage: 'Discharged',
        source: 'import',
        last_contacted: daysAgo(45),
        notes: 'Full recovery — discharged with clear plan',
      },
    ],
  },

  veterinary: {
    pipelineName: 'Veterinary Pipeline',
    stages: [
      { name: 'New Pet Parent', color: C.grey, is_default: true },
      { name: 'First Visit', color: C.blue },
      { name: 'Treatment', color: C.amber },
      { name: 'Regular', color: C.teal },
      { name: 'Wellness Plan', color: C.green },
    ],
    contacts: [
      {
        full_name: 'Ashley Cooper',
        phone: '+15125551301',
        email: 'ashley.c@gmail.com',
        pipeline_stage: 'New Pet Parent',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
        notes: 'Golden retriever puppy "Max", 4 months',
      },
      {
        full_name: 'Tyler Morrison',
        phone: '+15125551302',
        pipeline_stage: 'New Pet Parent',
        source: 'import',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Rachel Green',
        phone: '+15125551303',
        email: 'rgreen@email.com',
        pipeline_stage: 'First Visit',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
        notes: 'Cat "Luna" — annual vaccines due',
      },
      {
        full_name: 'Joshua Bell',
        phone: '+15125551304',
        pipeline_stage: 'First Visit',
        source: 'import',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Lauren Price',
        phone: '+15125551305',
        email: 'lprice@outlook.com',
        pipeline_stage: 'Treatment',
        source: 'inbound_call',
        last_contacted: daysAgo(6),
        notes: 'Dog post-surgery recovery — check incision site',
      },
      {
        full_name: 'Andrew Foster',
        phone: '+15125551306',
        pipeline_stage: 'Treatment',
        source: 'import',
        last_contacted: daysAgo(9),
      },
      {
        full_name: 'Megan Hughes',
        phone: '+15125551307',
        email: 'mhughes@gmail.com',
        pipeline_stage: 'Regular',
        source: 'import',
        last_contacted: daysAgo(30),
        tags: ['regular'],
      },
      {
        full_name: 'Sean Butler',
        phone: '+15125551308',
        pipeline_stage: 'Regular',
        source: 'inbound_call',
        last_contacted: daysAgo(21),
      },
      {
        full_name: 'Amber Collins',
        phone: '+15125551309',
        email: 'amber.c@yahoo.com',
        pipeline_stage: 'Wellness Plan',
        source: 'import',
        last_contacted: daysAgo(14),
        notes: 'Annual wellness plan — renewal in 2 months',
        tags: ['vip'],
      },
    ],
  },

  salon: {
    pipelineName: 'Salon Pipeline',
    stages: [
      { name: 'New Client', color: C.grey, is_default: true },
      { name: 'First Visit', color: C.blue },
      { name: 'Regular', color: C.teal },
      { name: 'VIP', color: C.green },
    ],
    contacts: [
      {
        full_name: 'Brittany Walsh',
        phone: '+15125551401',
        email: 'bwalsh@gmail.com',
        pipeline_stage: 'New Client',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
      },
      {
        full_name: 'Michelle Rivera',
        phone: '+15125551402',
        pipeline_stage: 'New Client',
        source: 'import',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Kayla Thompson',
        phone: '+15125551403',
        email: 'kayla.t@email.com',
        pipeline_stage: 'First Visit',
        source: 'inbound_call',
        last_contacted: daysAgo(6),
        notes: 'Color + cut — loved the result, booked again',
      },
      {
        full_name: 'Brandon Scott',
        phone: '+15125551404',
        pipeline_stage: 'First Visit',
        source: 'import',
        last_contacted: daysAgo(8),
      },
      {
        full_name: 'Jasmine Powell',
        phone: '+15125551405',
        email: 'jasmine.p@outlook.com',
        pipeline_stage: 'Regular',
        source: 'import',
        last_contacted: daysAgo(20),
        tags: ['regular'],
      },
      {
        full_name: 'Dylan Morris',
        phone: '+15125551406',
        pipeline_stage: 'Regular',
        source: 'inbound_call',
        last_contacted: daysAgo(15),
      },
      {
        full_name: 'Tiffany Campbell',
        phone: '+15125551407',
        email: 'tcampbell@gmail.com',
        pipeline_stage: 'VIP',
        source: 'import',
        last_contacted: daysAgo(7),
        tags: ['vip'],
      },
      {
        full_name: 'Marcus Anderson',
        phone: '+15125551408',
        pipeline_stage: 'VIP',
        source: 'import',
        last_contacted: daysAgo(12),
        tags: ['vip'],
        notes: 'Monthly standing appointment — Thursdays 2pm',
      },
    ],
  },

  restaurant: {
    pipelineName: 'Restaurant Pipeline',
    stages: [
      { name: 'New Guest', color: C.grey, is_default: true },
      { name: 'Regular', color: C.blue },
      { name: 'VIP', color: C.teal },
      { name: 'Loyalty Member', color: C.green },
    ],
    contacts: [
      {
        full_name: 'Victoria James',
        phone: '+15125551501',
        email: 'vjames@gmail.com',
        pipeline_stage: 'New Guest',
        source: 'inbound_call',
        last_contacted: daysAgo(2),
      },
      {
        full_name: 'Nathan Chen',
        phone: '+15125551502',
        pipeline_stage: 'New Guest',
        source: 'import',
        last_contacted: daysAgo(4),
      },
      {
        full_name: 'Cassandra White',
        phone: '+15125551503',
        email: 'cassandra.w@outlook.com',
        pipeline_stage: 'Regular',
        source: 'import',
        last_contacted: daysAgo(10),
      },
      {
        full_name: 'Jordan Taylor',
        phone: '+15125551504',
        pipeline_stage: 'Regular',
        source: 'inbound_call',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Dominique Lee',
        phone: '+15125551505',
        email: 'dlee@email.com',
        pipeline_stage: 'VIP',
        source: 'import',
        last_contacted: daysAgo(5),
        tags: ['vip'],
        notes: 'Prefers corner booth, dietary restriction: gluten-free',
      },
      {
        full_name: 'Caleb Martin',
        phone: '+15125551506',
        pipeline_stage: 'VIP',
        source: 'inbound_call',
        last_contacted: daysAgo(9),
        tags: ['vip'],
      },
      {
        full_name: 'Vanessa Hall',
        phone: '+15125551507',
        email: 'vanessa.h@gmail.com',
        pipeline_stage: 'Loyalty Member',
        source: 'import',
        last_contacted: daysAgo(3),
        tags: ['vip'],
      },
      {
        full_name: 'Marcus Young',
        phone: '+15125551508',
        pipeline_stage: 'Loyalty Member',
        source: 'import',
        last_contacted: daysAgo(6),
        tags: ['vip'],
        notes: 'Hosts monthly team dinners — 15-20 guests',
      },
    ],
  },

  contractor: {
    pipelineName: 'Contractor Pipeline',
    stages: [
      { name: 'Lead', color: C.grey, is_default: true },
      { name: 'Estimate Sent', color: C.blue },
      { name: 'Contract Signed', color: C.amber },
      { name: 'In Progress', color: C.orange },
      { name: 'Completed', color: C.green, is_terminal: true },
    ],
    contacts: [
      {
        full_name: 'Steve Patterson',
        phone: '+15125551601',
        email: 'steve.p@gmail.com',
        pipeline_stage: 'Lead',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
        notes: 'Kitchen remodel — open to $40-60k budget',
      },
      {
        full_name: 'Barbara Nichols',
        phone: '+15125551602',
        pipeline_stage: 'Lead',
        source: 'import',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Frank DiMaggio',
        phone: '+15125551603',
        email: 'fdimagio@outlook.com',
        pipeline_stage: 'Estimate Sent',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
        notes: 'Deck addition + pergola — estimate: $28k',
      },
      {
        full_name: 'Sandra Olson',
        phone: '+15125551604',
        pipeline_stage: 'Estimate Sent',
        source: 'import',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Gregory Harrison',
        phone: '+15125551605',
        email: 'gharrison@email.com',
        pipeline_stage: 'Contract Signed',
        source: 'inbound_call',
        last_contacted: daysAgo(4),
        notes: 'Bathroom renovation — start date next Monday',
      },
      {
        full_name: 'Denise Fleming',
        phone: '+15125551606',
        pipeline_stage: 'Contract Signed',
        source: 'import',
        last_contacted: daysAgo(8),
      },
      {
        full_name: 'Harold Jensen',
        phone: '+15125551607',
        email: 'hjensen@yahoo.com',
        pipeline_stage: 'In Progress',
        source: 'inbound_call',
        last_contacted: daysAgo(2),
        notes: 'Basement finishing — week 3 of 6',
      },
      {
        full_name: 'Carolyn Burke',
        phone: '+15125551608',
        pipeline_stage: 'In Progress',
        source: 'import',
        last_contacted: daysAgo(6),
      },
      {
        full_name: 'Raymond Murray',
        phone: '+15125551609',
        email: 'rmurray@gmail.com',
        pipeline_stage: 'Completed',
        source: 'import',
        last_contacted: daysAgo(30),
        notes: 'Satisfied — referred two neighbors',
        tags: ['regular'],
      },
    ],
  },

  law_firm: {
    pipelineName: 'Law Firm Pipeline',
    stages: [
      { name: 'Inquiry', color: C.grey, is_default: true },
      { name: 'Consultation', color: C.blue },
      { name: 'Retained', color: C.amber },
      { name: 'Active Case', color: C.purple },
      { name: 'Closed', color: C.green, is_terminal: true },
    ],
    contacts: [
      {
        full_name: 'Eleanor Simmons',
        phone: '+15125551701',
        email: 'esimmons@gmail.com',
        pipeline_stage: 'Inquiry',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
        notes: 'Personal injury — slip and fall at commercial property',
      },
      {
        full_name: 'Walter Griffin',
        phone: '+15125551702',
        pipeline_stage: 'Inquiry',
        source: 'import',
        last_contacted: daysAgo(2),
      },
      {
        full_name: 'Dorothy Hoffman',
        phone: '+15125551703',
        email: 'dorothy.h@outlook.com',
        pipeline_stage: 'Consultation',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
        notes: 'Estate planning — trust setup for two adult children',
      },
      {
        full_name: 'Eugene Morrison',
        phone: '+15125551704',
        pipeline_stage: 'Consultation',
        source: 'import',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Ruth Warren',
        phone: '+15125551705',
        email: 'rwarren@email.com',
        pipeline_stage: 'Retained',
        source: 'import',
        last_contacted: daysAgo(9),
        notes: 'Family law — contested divorce, custody dispute',
      },
      {
        full_name: 'Arthur Fleming',
        phone: '+15125551706',
        pipeline_stage: 'Retained',
        source: 'inbound_call',
        last_contacted: daysAgo(6),
      },
      {
        full_name: 'Phyllis Crawford',
        phone: '+15125551707',
        email: 'pcrawford@gmail.com',
        pipeline_stage: 'Active Case',
        source: 'import',
        last_contacted: daysAgo(4),
        notes: 'Civil litigation — breach of contract, discovery phase',
      },
      {
        full_name: 'Bernard Shaw',
        phone: '+15125551708',
        pipeline_stage: 'Active Case',
        source: 'inbound_call',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Helen Webb',
        phone: '+15125551709',
        email: 'hwebb@yahoo.com',
        pipeline_stage: 'Closed',
        source: 'import',
        last_contacted: daysAgo(60),
        notes: 'Favorable settlement — strong referral source',
        tags: ['regular'],
      },
    ],
  },

  real_estate: {
    pipelineName: 'Real Estate Pipeline',
    stages: [
      { name: 'Lead', color: C.grey, is_default: true },
      { name: 'Showing', color: C.blue },
      { name: 'Offer Made', color: C.amber },
      { name: 'Under Contract', color: C.orange },
      { name: 'Closed', color: C.green, is_terminal: true },
    ],
    contacts: [
      {
        full_name: 'Dennis Sullivan',
        phone: '+15125551801',
        email: 'dsullivan@gmail.com',
        pipeline_stage: 'Lead',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
        notes: 'Buyer — 3/2 min, NW Austin, budget $450k',
      },
      {
        full_name: 'Patricia Armstrong',
        phone: '+15125551802',
        pipeline_stage: 'Lead',
        source: 'import',
        last_contacted: daysAgo(3),
      },
      {
        full_name: 'Charles Ingram',
        phone: '+15125551803',
        email: 'cingram@outlook.com',
        pipeline_stage: 'Showing',
        source: 'inbound_call',
        last_contacted: daysAgo(4),
        notes: '3 showings completed — narrowing to 2 properties',
      },
      {
        full_name: 'Donna Perkins',
        phone: '+15125551804',
        pipeline_stage: 'Showing',
        source: 'import',
        last_contacted: daysAgo(6),
      },
      {
        full_name: 'George Hammond',
        phone: '+15125551805',
        email: 'ghammond@email.com',
        pipeline_stage: 'Offer Made',
        source: 'inbound_call',
        last_contacted: daysAgo(2),
        notes: 'Offer at ask — competing offer expected',
      },
      {
        full_name: 'Frances Dunn',
        phone: '+15125551806',
        pipeline_stage: 'Offer Made',
        source: 'import',
        last_contacted: daysAgo(5),
        notes: 'Counter-offer in negotiation',
      },
      {
        full_name: 'Harold Watts',
        phone: '+15125551807',
        email: 'hwatts@gmail.com',
        pipeline_stage: 'Under Contract',
        source: 'import',
        last_contacted: daysAgo(8),
      },
      {
        full_name: 'Mildred Cross',
        phone: '+15125551808',
        pipeline_stage: 'Under Contract',
        source: 'inbound_call',
        last_contacted: daysAgo(7),
        notes: 'Inspection passed — appraisal scheduled',
      },
      {
        full_name: 'Norman Garrett',
        phone: '+15125551809',
        email: 'ngarrett@yahoo.com',
        pipeline_stage: 'Closed',
        source: 'import',
        last_contacted: daysAgo(45),
        notes: 'Closed — referred by Linda Thompson',
        tags: ['regular'],
      },
    ],
  },

  sales_crm: {
    pipelineName: 'Sales CRM Pipeline',
    stages: [
      { name: 'New Lead', color: C.grey, is_default: true },
      { name: 'Contacted', color: C.blue },
      { name: 'Qualified', color: C.amber },
      { name: 'Proposal', color: C.purple },
      { name: 'Closed Won', color: C.green, is_terminal: true },
    ],
    contacts: [
      {
        full_name: 'Preston Clarke',
        phone: '+15125551901',
        email: 'pclarke@gmail.com',
        pipeline_stage: 'New Lead',
        source: 'inbound_call',
        last_contacted: daysAgo(1),
        notes: 'Enterprise inquiry — 200 seat opportunity',
      },
      {
        full_name: 'Deborah Lawson',
        phone: '+15125551902',
        pipeline_stage: 'New Lead',
        source: 'import',
        last_contacted: daysAgo(2),
      },
      {
        full_name: 'Edwin Bradley',
        phone: '+15125551903',
        email: 'ebradley@outlook.com',
        pipeline_stage: 'Contacted',
        source: 'inbound_call',
        last_contacted: daysAgo(4),
      },
      {
        full_name: 'Loretta Bishop',
        phone: '+15125551904',
        pipeline_stage: 'Contacted',
        source: 'import',
        last_contacted: daysAgo(6),
      },
      {
        full_name: 'Calvin Stone',
        phone: '+15125551905',
        email: 'cstone@email.com',
        pipeline_stage: 'Qualified',
        source: 'inbound_call',
        last_contacted: daysAgo(5),
        notes: 'Budget confirmed — decision Q3, champion identified',
      },
      {
        full_name: 'Muriel Holt',
        phone: '+15125551906',
        pipeline_stage: 'Qualified',
        source: 'import',
        last_contacted: daysAgo(9),
      },
      {
        full_name: 'Clifford Mann',
        phone: '+15125551907',
        email: 'cmann@yahoo.com',
        pipeline_stage: 'Proposal',
        source: 'import',
        last_contacted: daysAgo(3),
        notes: 'Proposal sent — committee review in progress',
      },
      {
        full_name: 'Blanche Tucker',
        phone: '+15125551908',
        pipeline_stage: 'Proposal',
        source: 'inbound_call',
        last_contacted: daysAgo(7),
      },
      {
        full_name: 'Winston Cole',
        phone: '+15125551909',
        email: 'wcole@gmail.com',
        pipeline_stage: 'Closed Won',
        source: 'import',
        last_contacted: daysAgo(20),
        notes: 'Closed $84k ARR — high expansion potential',
        tags: ['vip'],
      },
    ],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMaxStagePosition(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { data } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { position?: number } | null)?.position ?? 0
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const supabase = getSupabase()
  const tenantId = DEMO_TENANT_ID

  let totalPipelines = 0
  let totalContacts = 0
  let totalSkipped = 0

  for (const [vertical, spec] of Object.entries(VERTICALS)) {
    // ── Idempotency: skip pipeline if already exists ──────────────────────────
    const { data: existing, error: existErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', spec.pipelineName)
      .maybeSingle()

    if (existErr) {
      console.error(`[seed] ✗ ${vertical} existence check: ${existErr.message}`)
      continue
    }

    let pipelineId: string

    if (existing) {
      console.info(`[seed] ↷ ${spec.pipelineName} — already exists, skipping pipeline insert`)
      pipelineId = (existing as { id: string }).id
    } else {
      // ── Create pipeline ───────────────────────────────────────────────────
      const { data: pipeline, error: pErr } = await supabase
        .from('pipelines')
        .insert({ tenant_id: tenantId, name: spec.pipelineName, is_default: false })
        .select('id')
        .single()

      if (pErr || !pipeline) {
        console.error(`[seed] ✗ ${spec.pipelineName} insert: ${pErr?.message ?? 'no data'}`)
        continue
      }

      pipelineId = (pipeline as { id: string }).id

      // ── Insert stages, offset from current max to avoid UNIQUE collision ──
      const offset = await getMaxStagePosition(supabase, tenantId)
      const stageRows = spec.stages.map((s, i) => ({
        tenant_id: tenantId,
        pipeline_id: pipelineId,
        name: s.name,
        position: offset + i + 1,
        color: s.color,
        is_default: s.is_default ?? false,
        is_terminal: s.is_terminal ?? false,
      }))

      const { error: sErr } = await supabase.from('pipeline_stages').insert(stageRows)
      if (sErr) {
        console.error(`[seed] ✗ ${spec.pipelineName} stages: ${sErr.message}`)
        continue
      }

      console.info(`[seed] ✓ ${spec.pipelineName} — ${stageRows.length} stages created`)
      totalPipelines++
    }

    // ── Seed contacts ─────────────────────────────────────────────────────────
    let inserted = 0
    for (const c of spec.contacts) {
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', c.phone)
        .maybeSingle()

      if (existingContact) {
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

      const { error: cErr } = await supabase.from('contacts').insert(row)
      if (cErr) {
        console.error(`[seed] ✗ Contact ${c.full_name}: ${cErr.message}`)
      } else {
        inserted++
        totalContacts++
      }
    }

    console.info(`[seed] ✓ ${spec.pipelineName} contacts — ${inserted} inserted`)
  }

  // ── Strip is_default from all vertical-specific pipelines ────────────────────
  const { error: updateErr } = await supabase
    .from('pipelines')
    .update({ is_default: false })
    .eq('tenant_id', tenantId)
    .neq('name', 'Default Pipeline')

  if (updateErr) {
    console.error(`[seed] ✗ is_default cleanup: ${updateErr.message}`)
  } else {
    console.info(`[seed] ✓ is_default=false set on all non-Default pipelines`)
  }

  console.info(
    `[seed] Done. ${totalPipelines} pipelines created, ${totalContacts} contacts inserted, ${totalSkipped} skipped.`
  )
}

main().catch((err) => {
  console.error('[seed] fatal:', err)
  process.exit(1)
})
