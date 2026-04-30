/**
 * Seed script: inserts sample spa-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-spa.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-spa.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'Services Offered',
    content:
      'We offer Swedish massage, deep tissue massage, hot stone massage, aromatherapy massage, and couples massages. We also provide classic facials, body wraps, and scalp treatments.',
    category: 'services',
  },
  {
    title: 'Service Pricing',
    content:
      'Swedish Massage (60 min) $90. Deep Tissue Massage (60 min) $110. Hot Stone Massage (90 min) $130. Classic Facial (60 min) $85. Body Wrap (90 min) $120. Couples Massage (60 min) $180. Aromatherapy Massage (60 min) $95. Scalp Treatment (30 min) $55.',
    category: 'pricing',
  },
  {
    title: 'Business Hours',
    content:
      'We are open Monday through Saturday 9am to 8pm and Sunday 10am to 6pm. Appointments are recommended.',
    category: 'hours',
  },
  {
    title: 'Appointment Booking',
    content:
      'Appointments are recommended to ensure your preferred therapist and time slot are available. You can book by calling us or asking our AI receptionist Maya to schedule for you.',
    category: 'booking',
  },
  {
    title: 'Cancellation Policy',
    content:
      'Please provide at least 24 hours notice for cancellations or rescheduling. Late cancellations may incur a fee.',
    category: 'policies',
  },
  {
    title: 'Gift Cards',
    content:
      'We offer gift cards for all services and dollar amounts. Please speak with a staff member for details on purchasing gift cards.',
    category: 'services',
  },
  {
    title: 'Memberships',
    content:
      'We offer membership packages for regular clients. Please speak with a staff member for details on membership options and pricing.',
    category: 'services',
  },
  {
    title: 'What to Expect',
    content:
      'Please arrive 10 minutes before your appointment to complete any intake forms and begin relaxing. We provide robes, slippers, and all amenities. Please inform your therapist of any health conditions, allergies, or areas to avoid.',
    category: 'policies',
  },
]

async function main() {
  console.info(`[seed-knowledge-spa] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`)

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-spa] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-spa] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-spa] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-spa] Fatal error:', err)
  process.exit(1)
})
