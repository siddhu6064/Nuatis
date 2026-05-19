import { describe, it, expect } from '@jest/globals'
import { buildBusinessKnowledgeBlock } from './business-knowledge.js'

describe('buildBusinessKnowledgeBlock', () => {
  it('returns empty string for empty profile', () => {
    expect(buildBusinessKnowledgeBlock({})).toBe('')
  })

  it('returns empty string for profile with empty arrays and no notes', () => {
    const profile = { services: [], staff: [], faqs: [] }
    expect(buildBusinessKnowledgeBlock(profile)).toBe('')
  })

  it('formats open hours correctly', () => {
    const profile = {
      hours: {
        monday: { open: '09:00', close: '17:00', closed: false },
        saturday: { open: '09:00', close: '13:00', closed: true },
      },
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('--- BUSINESS KNOWLEDGE ---')
    expect(result).toContain('Monday: 9am–5pm')
    expect(result).toContain('Saturday: Closed')
    expect(result).toContain('--- END BUSINESS KNOWLEDGE ---')
  })

  it('formats 12pm and 12am correctly', () => {
    const profile = {
      hours: {
        monday: { open: '12:00', close: '00:00', closed: false },
      },
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('Monday: 12pm–12am')
  })

  it('formats services with name, duration and price', () => {
    const profile = {
      services: [
        { name: 'Haircut', duration_min: 45, price: 60, description: '' },
        { name: 'Color', duration_min: 120, price: 150, description: 'Full color' },
      ],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('SERVICES:')
    expect(result).toContain('Haircut | 45 min | $60')
    expect(result).toContain('Color | 120 min | $150')
  })

  it('formats staff list', () => {
    const profile = {
      staff: [
        { name: 'Jane', role: 'Stylist' },
        { name: 'Bob', role: 'Manager' },
      ],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('STAFF: Jane (Stylist), Bob (Manager)')
  })

  it('formats FAQs', () => {
    const profile = {
      faqs: [{ question: 'Do you take walk-ins?', answer: 'Yes, during off-peak hours.' }],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('FAQs:')
    expect(result).toContain('Q: Do you take walk-ins?')
    expect(result).toContain('A: Yes, during off-peak hours.')
  })

  it('includes notes verbatim', () => {
    const profile = { notes: 'Parking is free behind the building.' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('NOTES: Parking is free behind the building.')
  })

  it('skips HOURS section when hours is undefined', () => {
    const profile = { notes: 'Open 24/7' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).not.toContain('HOURS:')
    expect(result).toContain('NOTES: Open 24/7')
  })

  it('wraps block in delimiters', () => {
    const profile = { notes: 'test' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result.startsWith('\n\n--- BUSINESS KNOWLEDGE ---')).toBe(true)
    expect(result.endsWith('--- END BUSINESS KNOWLEDGE ---')).toBe(true)
  })
})
