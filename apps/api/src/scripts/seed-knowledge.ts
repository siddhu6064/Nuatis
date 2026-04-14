/**
 * Seed script: inserts sample dental-vertical knowledge entries for the
 * internal test tenant. Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge.ts
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const INTERNAL_TENANT = 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b'

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'Services Offered',
    content:
      'We offer dental cleanings, fillings, root canals, crowns, teeth whitening, and emergency dental care.',
    category: 'services',
  },
  {
    title: 'New Patient Special',
    content: 'New patients receive a comprehensive exam, x-rays, and cleaning for $99.',
    category: 'pricing',
  },
  {
    title: 'Insurance',
    content:
      'We accept Delta Dental, Cigna, Aetna, MetLife, and most PPO plans. We also offer a membership plan for uninsured patients at $25/month.',
    category: 'pricing',
  },
  {
    title: 'Cancellation Policy',
    content:
      'Please provide at least 24 hours notice for cancellations. Late cancellations may incur a $50 fee.',
    category: 'policies',
  },
  {
    title: 'Emergency Care',
    content:
      'We offer same-day emergency appointments for severe pain, broken teeth, or dental trauma. Call us anytime.',
    category: 'services',
  },
]

async function main() {
  console.info(
    `[seed-knowledge] Seeding ${SEED_ENTRIES.length} entries for tenant ${INTERNAL_TENANT}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(
        INTERNAL_TENANT,
        entry.title,
        entry.content,
        entry.category
      )
      console.info(`[seed-knowledge] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge] Fatal error:', err)
  process.exit(1)
})
