/**
 * Seed script: inserts sample pet_grooming-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-pet_grooming.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-pet_grooming.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'What grooming services do you offer?',
    content:
      'We offer bath & brush, full grooming, nail trims, ear cleaning, teeth brushing, de-shedding treatments, and specialty services for puppies and cats.',
    category: 'faq',
  },
  {
    title: 'How long does a full groom take?',
    content:
      "A full groom typically takes 1.5 to 2 hours depending on your pet's breed, size, and coat condition.",
    category: 'faq',
  },
  {
    title: 'Do you groom cats?',
    content:
      'Yes! We offer cat grooming including baths, brush-outs, and nail trims. We recommend booking in advance as cat appointments fill quickly.',
    category: 'faq',
  },
  {
    title: "What should I expect for my pet's first visit?",
    content:
      "For a first visit, bring your pet's vaccination records. We recommend a bath & brush or puppy's first groom so your pet gets comfortable with the environment.",
    category: 'faq',
  },
  {
    title: 'How often should I bring my pet for grooming?',
    content:
      'Most dogs benefit from grooming every 4 to 8 weeks depending on their breed and coat type. We can recommend a schedule at your first appointment.',
    category: 'faq',
  },
  {
    title: 'Do you use sedation?',
    content:
      'We never use sedation. Our groomers are trained in gentle handling techniques to keep your pet calm and comfortable throughout the visit.',
    category: 'faq',
  },
]

async function main() {
  console.info(
    `[seed-knowledge-pet_grooming] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-pet_grooming] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-pet_grooming] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-pet_grooming] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-pet_grooming] Fatal error:', err)
  process.exit(1)
})
