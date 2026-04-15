import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

interface ScoringRuleDefinition {
  rule_key: string
  label: string
  points: number
  category: string
  description: string
}

const DEFAULT_RULES: ScoringRuleDefinition[] = [
  // Engagement (positive)
  {
    rule_key: 'call_completed',
    label: 'Completed a phone call',
    points: 10,
    category: 'engagement',
    description: 'Contact had a phone call',
  },
  {
    rule_key: 'appointment_booked',
    label: 'Booked an appointment',
    points: 15,
    category: 'engagement',
    description: 'Contact booked an appointment',
  },
  {
    rule_key: 'appointment_attended',
    label: 'Attended appointment',
    points: 20,
    category: 'engagement',
    description: 'Contact attended their appointment',
  },
  {
    rule_key: 'email_opened',
    label: 'Opened an email',
    points: 5,
    category: 'engagement',
    description: 'Contact opened an email',
  },
  {
    rule_key: 'email_replied',
    label: 'Replied to an email',
    points: 10,
    category: 'engagement',
    description: 'Contact sent an inbound email',
  },
  {
    rule_key: 'sms_replied',
    label: 'Replied via SMS',
    points: 8,
    category: 'engagement',
    description: 'Contact sent an inbound SMS',
  },
  {
    rule_key: 'form_submitted',
    label: 'Submitted an intake form',
    points: 10,
    category: 'engagement',
    description: 'Contact submitted an intake form',
  },
  {
    rule_key: 'quote_viewed',
    label: 'Viewed a quote',
    points: 5,
    category: 'engagement',
    description: 'Contact viewed a quote',
  },
  {
    rule_key: 'quote_accepted',
    label: 'Accepted a quote',
    points: 25,
    category: 'engagement',
    description: 'Contact accepted a quote',
  },
  {
    rule_key: 'booking_page_visit',
    label: 'Visited booking page',
    points: 3,
    category: 'engagement',
    description: 'Contact visited the booking page',
  },

  // Profile (positive)
  {
    rule_key: 'has_email',
    label: 'Email on file',
    points: 5,
    category: 'profile',
    description: 'Contact has an email address',
  },
  {
    rule_key: 'has_phone',
    label: 'Phone on file',
    points: 5,
    category: 'profile',
    description: 'Contact has a phone number',
  },
  {
    rule_key: 'has_address',
    label: 'Address on file',
    points: 3,
    category: 'profile',
    description: 'Contact has address info',
  },
  {
    rule_key: 'referred_contact',
    label: 'Was referred',
    points: 10,
    category: 'profile',
    description: 'Contact was referred by another contact',
  },

  // Behavior (negative)
  {
    rule_key: 'appointment_no_show',
    label: 'No-showed appointment',
    points: -15,
    category: 'behavior',
    description: 'Contact missed an appointment',
  },
  {
    rule_key: 'quote_declined',
    label: 'Declined a quote',
    points: -10,
    category: 'behavior',
    description: 'Contact declined a quote',
  },

  // Decay (negative)
  {
    rule_key: 'inactive_30d',
    label: 'Inactive 30 days',
    points: -10,
    category: 'decay',
    description: 'No activity in 30 days',
  },
  {
    rule_key: 'inactive_60d',
    label: 'Inactive 60 days',
    points: -20,
    category: 'decay',
    description: 'No activity in 60 days',
  },
  {
    rule_key: 'inactive_90d',
    label: 'Inactive 90 days',
    points: -30,
    category: 'decay',
    description: 'No activity in 90 days',
  },
]

async function main() {
  const tenantId = process.argv[2]

  if (!tenantId) {
    console.error('Usage: npx tsx apps/api/src/scripts/seed-lead-scoring-rules.ts <tenant_id>')
    process.exit(1)
  }

  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[seed-lead-scoring-rules] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required'
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Fetch existing rule_keys for this tenant to support idempotent inserts
  const { data: existing, error: fetchError } = await supabase
    .from('lead_scoring_rules')
    .select('rule_key')
    .eq('tenant_id', tenantId)

  if (fetchError) {
    console.error(`[seed-lead-scoring-rules] error fetching existing rules: ${fetchError.message}`)
    process.exit(1)
  }

  const existingKeys = new Set((existing ?? []).map((r: { rule_key: string }) => r.rule_key))

  const toInsert = DEFAULT_RULES.filter((r) => !existingKeys.has(r.rule_key)).map((r) => ({
    tenant_id: tenantId,
    rule_key: r.rule_key,
    label: r.label,
    points: r.points,
    category: r.category,
    description: r.description,
    is_active: true,
  }))

  if (toInsert.length === 0) {
    console.info(
      `[seed-lead-scoring-rules] all rules already exist for tenant=${tenantId} — skipping`
    )
    return
  }

  const { error: insertError } = await supabase.from('lead_scoring_rules').insert(toInsert)

  if (insertError) {
    console.error(`[seed-lead-scoring-rules] insert error: ${insertError.message}`)
    process.exit(1)
  }

  console.info(
    `[seed-lead-scoring-rules] inserted ${toInsert.length} rule(s) for tenant=${tenantId}`
  )

  const skipped = DEFAULT_RULES.length - toInsert.length
  if (skipped > 0) {
    console.info(`[seed-lead-scoring-rules] skipped ${skipped} already-existing rule(s)`)
  }
}

main().catch(console.error)
