/**
 * Seed script: inserts sample car_wash-vertical knowledge entries for a tenant.
 * Generates embeddings via Google text-embedding-004.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/seed-knowledge-car_wash.ts <tenant_id>
 *
 * Requires env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { upsertKnowledgeEntry } from '../services/embeddings.js'

const _tenantArg = process.argv[2]
if (!_tenantArg) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-knowledge-car_wash.ts <tenant_id>')
  process.exit(1)
}
const tenantId: string = _tenantArg

const SEED_ENTRIES: Array<{ title: string; content: string; category: string }> = [
  {
    title: 'What wash packages do you offer?',
    content:
      'We offer Basic ($15), Deluxe ($25), and Premium ($40) washes, plus interior detail, full detail packages, hand wax, tire and rim cleaning, and engine bay cleaning.',
    category: 'faq',
  },
  {
    title: 'How long does a car wash take?',
    content:
      'A basic wash takes about 20 minutes. A full detail package takes 2 to 4 hours — we recommend booking an appointment for detail services.',
    category: 'faq',
  },
  {
    title: 'Do you offer memberships?',
    content:
      'Yes, we offer wash club memberships that give you unlimited washes at a fixed monthly rate. Ask about our membership options when you visit or call to sign up.',
    category: 'faq',
  },
  {
    title: 'Do I need an appointment?',
    content:
      'Basic, Deluxe, and Premium washes are walk-in friendly. Interior detail, full detail, hand wax, and engine bay cleaning require a scheduled appointment.',
    category: 'faq',
  },
  {
    title: 'Do you detail the interior?',
    content:
      'Yes, our interior detail service covers vacuuming, surface wipe-down, window cleaning, and odor treatment. The full detail package combines interior and exterior.',
    category: 'faq',
  },
  {
    title: 'What payment methods do you accept?',
    content:
      'We accept all major credit and debit cards, Apple Pay, and cash. Memberships are billed monthly to a card on file.',
    category: 'faq',
  },
]

async function main() {
  console.info(
    `[seed-knowledge-car_wash] Seeding ${SEED_ENTRIES.length} entries for tenant ${tenantId}`
  )

  for (const entry of SEED_ENTRIES) {
    try {
      const id = await upsertKnowledgeEntry(tenantId, entry.title, entry.content, entry.category)
      console.info(`[seed-knowledge-car_wash] ✓ "${entry.title}" → id=${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seed-knowledge-car_wash] ✗ "${entry.title}" failed: ${msg}`)
    }
  }

  console.info('[seed-knowledge-car_wash] Done.')
}

main().catch((err) => {
  console.error('[seed-knowledge-car_wash] Fatal error:', err)
  process.exit(1)
})
