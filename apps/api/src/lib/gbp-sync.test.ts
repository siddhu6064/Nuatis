import { jest, describe, it, expect, beforeAll } from '@jest/globals'
import type { GbpInsights } from '@nuatis/shared'

// Must be registered BEFORE dynamic import of gbp-sync.js
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
  })),
}))

// Dynamic import AFTER mock is registered
let starRatingToInt: (rating: string) => number
let buildAiReplyPrompt: (
  tenantName: string,
  vertical: string,
  rating: number,
  comment: string
) => string
let fetchGbpInsights: (tenantId: string) => Promise<GbpInsights | null>

beforeAll(async () => {
  const mod = await import('./gbp-sync.js')
  starRatingToInt = mod.starRatingToInt
  buildAiReplyPrompt = mod.buildAiReplyPrompt
  fetchGbpInsights = mod.fetchGbpInsights
})

describe('starRatingToInt', () => {
  it('maps all GBP star rating strings to integers', () => {
    expect(starRatingToInt('ONE')).toBe(1)
    expect(starRatingToInt('TWO')).toBe(2)
    expect(starRatingToInt('THREE')).toBe(3)
    expect(starRatingToInt('FOUR')).toBe(4)
    expect(starRatingToInt('FIVE')).toBe(5)
  })

  it('returns 0 for unrecognized rating strings', () => {
    expect(starRatingToInt('STAR_RATING_UNSPECIFIED')).toBe(0)
    expect(starRatingToInt('')).toBe(0)
  })
})

describe('buildAiReplyPrompt', () => {
  it('includes tenant name, vertical, rating, and comment in prompt', () => {
    const prompt = buildAiReplyPrompt('Acme Spa', 'beauty', 5, 'Loved the massage!')
    expect(prompt).toContain('Acme Spa')
    expect(prompt).toContain('beauty')
    expect(prompt).toContain('5/5')
    expect(prompt).toContain('Loved the massage!')
  })

  it('includes do-not-mention-name constraint', () => {
    const prompt = buildAiReplyPrompt('Shop', 'retail', 3, 'It was ok')
    expect(prompt).toContain("Do not mention the reviewer's name")
    expect(prompt).toContain('Do not use generic phrases')
  })
})

describe('fetchGbpInsights', () => {
  it('returns null when no gbp_connections row found', async () => {
    const result = await fetchGbpInsights('nonexistent-tenant-id')
    expect(result).toBeNull()
  }, 10000)
})

describe('GbpInsights type shape', () => {
  it('has the expected 8 keys', () => {
    const sample: GbpInsights = {
      queries_direct: 10,
      queries_indirect: 20,
      views_maps: 30,
      views_search: 40,
      actions_website: 5,
      actions_phone: 3,
      actions_driving_directions: 2,
      period_days: 30,
    }
    expect(Object.keys(sample)).toHaveLength(8)
    expect(sample.period_days).toBe(30)
  })
})
