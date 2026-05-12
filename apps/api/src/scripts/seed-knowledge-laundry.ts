/**
 * Seed script: inserts sample laundry-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-laundry.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-laundry.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'What services do you offer?',
    content:
      'We offer wash and fold, dry cleaning for shirts, suits, and specialty items, shirt pressing, comforter and wedding dress cleaning, stain treatment, and rush same-day service.',
    category: 'faq',
  },
  {
    title: 'How long does laundry take?',
    content:
      'Wash and fold is typically ready same day or next day. Dry cleaning takes 1 to 2 business days. Rush same-day service is available for an additional fee.',
    category: 'faq',
  },
  {
    title: 'How much does wash and fold cost?',
    content:
      'Wash and fold is priced per pound starting at $2 per pound. We weigh your items at drop-off and give you a total before we begin.',
    category: 'faq',
  },
  {
    title: 'Do you do dry cleaning?',
    content:
      'Yes, we dry clean shirts, suits, dresses, comforters, and specialty garments including wedding dresses. Turnaround is 1 to 2 business days standard.',
    category: 'faq',
  },
  {
    title: 'Do you offer pickup and delivery?',
    content:
      'Contact us for current pickup and delivery availability in your area. Drop-off at our location is always available during business hours.',
    category: 'faq',
  },
  {
    title: 'Do you offer memberships or loyalty plans?',
    content:
      'Yes, we offer monthly membership plans that give you discounted rates on wash and fold and dry cleaning. Ask about our membership options at drop-off or over the phone.',
    category: 'faq',
  },
]

async function main() {
  console.info(
    `[seed-knowledge-laundry] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-laundry] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-laundry] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-laundry] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-laundry] Fatal error:', err)
  process.exit(1)
})
