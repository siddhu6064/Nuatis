import { describe, it, expect } from '@jest/globals'
import { starRatingToInt, buildAiReplyPrompt } from './gbp-sync.js'

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
