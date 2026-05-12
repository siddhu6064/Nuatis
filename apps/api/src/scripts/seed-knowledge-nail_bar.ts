/**
 * Seed script: inserts sample nail_bar-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-nail_bar.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-nail_bar.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'What nail services do you offer?',
    content:
      'We offer classic manicures and pedicures, gel manicures and pedicures, acrylic full sets and fills, dip powder manicures, nail art add-ons, and gel removal.',
    category: 'faq',
  },
  {
    title: 'How long does a gel manicure last?',
    content:
      'Gel manicures typically last 2–3 weeks without chipping. We recommend fills or removal after 3 weeks.',
    category: 'faq',
  },
  {
    title: 'Do you do nail art?',
    content:
      'Yes! We offer custom nail art starting at $5 per nail. Design complexity and detail may affect pricing — ask your tech at your appointment.',
    category: 'faq',
  },
  {
    title: 'Can I walk in or do I need an appointment?',
    content:
      'Walk-ins are welcome based on availability, but we recommend booking an appointment to guarantee your preferred time and nail tech.',
    category: 'faq',
  },
  {
    title: 'How much does an acrylic full set cost?',
    content:
      'A full set of acrylics starts at $65. Nail art and specialty shapes may be additional.',
    category: 'faq',
  },
  {
    title: 'Do you offer loyalty rewards or packages?',
    content:
      'Yes, we offer a loyalty membership with monthly visit credits and exclusive member pricing. Ask about our loyalty program when you visit or call to book.',
    category: 'faq',
  },
]

async function main() {
  console.info(
    `[seed-knowledge-nail_bar] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-nail_bar] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-nail_bar] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-nail_bar] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-nail_bar] Fatal error:', err)
  process.exit(1)
})
