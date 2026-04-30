/**
 * Seed script: inserts sample gym-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-gym.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-gym.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'Services Offered',
    content:
      'We offer personal training sessions, group fitness classes including HIIT, yoga, and pilates, nutrition consultations, body composition assessments, and sports massage.',
    category: 'services',
  },
  {
    title: 'Service Pricing',
    content:
      'Personal Training (60 min) $75. Group Fitness Class (45 min) $25. Nutrition Consultation (45 min) $60. Body Composition Assessment (30 min) $40. Yoga Class (60 min) $20. Pilates Class (50 min) $22. Sports Massage (30 min) $50.',
    category: 'pricing',
  },
  {
    title: 'Business Hours',
    content:
      'We are open Monday through Friday 5am to 10pm, Saturday and Sunday 7am to 8pm. Members have access during all open hours.',
    category: 'hours',
  },
  {
    title: 'Membership Options',
    content:
      'We offer monthly and annual memberships, drop-in passes, and class packs. Ask our staff for current membership pricing and promotions.',
    category: 'services',
  },
  {
    title: 'Trial Session',
    content:
      'New members are welcome to book a trial personal training session or attend a free group fitness class to experience the gym before committing to a membership.',
    category: 'booking',
  },
  {
    title: 'Cancellation Policy',
    content:
      'Please cancel class bookings at least 2 hours in advance. Late cancellations or no-shows may result in a session charge.',
    category: 'policies',
  },
  {
    title: 'Facilities',
    content:
      'Our gym features cardio equipment, free weights, resistance machines, a dedicated yoga and pilates studio, and locker rooms with showers.',
    category: 'services',
  },
  {
    title: 'Personal Training',
    content:
      'Our certified personal trainers create customized workout programs based on your goals, fitness level, and schedule. Sessions are available one-on-one or in small groups.',
    category: 'services',
  },
]

async function main() {
  console.info(`[seed-knowledge-gym] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`)

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-gym] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-gym] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-gym] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-gym] Fatal error:', err)
  process.exit(1)
})
