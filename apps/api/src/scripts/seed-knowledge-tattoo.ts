/**
 * Seed script: inserts sample tattoo-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-tattoo.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-tattoo.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'How much does a tattoo cost?',
    content:
      'Pricing depends on the size, complexity, placement, and artist. We offer free consultations to give you an accurate quote before you commit. Flash tattoos start at $80.',
    category: 'faq',
  },
  {
    title: 'Do you require a deposit?',
    content:
      'Yes, all tattoo sessions require a deposit to secure your appointment. The deposit amount is discussed during your consultation and goes toward your final session cost.',
    category: 'faq',
  },
  {
    title: 'How long does a tattoo take?',
    content:
      'A small tattoo can take 1 to 2 hours. Medium pieces take 2 to 3 hours, and large or detailed work can take 4 to 6 hours or multiple sessions.',
    category: 'faq',
  },
  {
    title: 'How should I prepare for my appointment?',
    content:
      'Stay hydrated, eat a full meal beforehand, wear comfortable clothing that gives easy access to the area being tattooed, and avoid alcohol for 24 hours before your session.',
    category: 'faq',
  },
  {
    title: 'What is the aftercare process?',
    content:
      'We provide full aftercare instructions after every session. Generally this includes keeping the area clean, applying unscented moisturizer, avoiding sun exposure, and not soaking the tattoo for 2 weeks.',
    category: 'faq',
  },
  {
    title: 'Do you do cover-ups?',
    content:
      'Yes, we specialize in cover-up work. Book a cover-up consultation so our artists can assess the existing tattoo and design the best approach.',
    category: 'faq',
  },
]

async function main() {
  console.info(
    `[seed-knowledge-tattoo] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-tattoo] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-tattoo] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-tattoo] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-tattoo] Fatal error:', err)
  process.exit(1)
})
