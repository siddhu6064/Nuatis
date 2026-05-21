import { describe, it, expect } from '@jest/globals'
import { mergeFacts } from './memory-prompts.js'

describe('mergeFacts', () => {
  it('returns incoming as-is when existing is null (first call)', () => {
    const incoming = { name: 'John', topics: ['booking'], sentiment: 'positive' }
    const result = mergeFacts(null, incoming)

    expect(result.name).toBe('John')
    expect(result.topics).toContain('booking')
    expect(result).toEqual(incoming)
  })

  it('unions arrays with case-insensitive deduplication', () => {
    const existing = { topics: ['booking', 'insurance'] }
    const incoming = { topics: ['Insurance', 'pricing'] }
    const result = mergeFacts(existing, incoming)

    const topics = result.topics as string[]
    expect(topics).toContain('booking')
    expect(topics).toContain('pricing')
    // 'insurance' and 'Insurance' are the same — only one entry
    const insuranceCount = topics.filter((t) => t.toLowerCase() === 'insurance').length
    expect(insuranceCount).toBe(1)
    expect(topics.length).toBe(3)
  })

  it('incoming scalar wins when non-null; null does not overwrite existing', () => {
    const existing = { name: 'John', language: 'en' }
    const incoming = { name: 'Johnny', language: null }
    const result = mergeFacts(existing, incoming)

    expect(result.name).toBe('Johnny') // incoming non-null wins
    expect(result.language).toBe('en') // null does not overwrite
  })

  it('sentiment always overrides — latest call wins', () => {
    const existing = { sentiment: 'positive' }
    const incoming = { sentiment: 'frustrated' }
    const result = mergeFacts(existing, incoming)

    expect(result.sentiment).toBe('frustrated')
  })

  it('preserves all existing values when incoming is empty', () => {
    const existing = { name: 'Maria', topics: ['spa'] }
    const result = mergeFacts(existing, {})

    expect(result.name).toBe('Maria')
    expect(result.topics as string[]).toContain('spa')
    expect(result.topics).toHaveLength(1)
  })
})
