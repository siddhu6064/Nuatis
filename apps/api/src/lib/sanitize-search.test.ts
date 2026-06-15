import { describe, it, expect } from '@jest/globals'
import { sanitizeSearchTerm } from './sanitize-search.js'

describe('sanitizeSearchTerm', () => {
  it('neutralizes comma injection (cannot add an or() condition)', () => {
    const result = sanitizeSearchTerm('a,name.ilike.*')
    expect(result).not.toContain(',')
    expect(result).toBe('aname.ilike.*')
  })

  it('neutralizes paren injection', () => {
    const result = sanitizeSearchTerm('a)(name.ilike.*)')
    expect(result).not.toContain('(')
    expect(result).not.toContain(')')
    expect(result).toBe('aname.ilike.*')
  })

  it('strips double-quote and backslash', () => {
    expect(sanitizeSearchTerm('a"b\\c')).toBe('abc')
  })

  it('passes through apostrophes, dots, and hyphens intact', () => {
    expect(sanitizeSearchTerm("O'Brien")).toBe("O'Brien")
    expect(sanitizeSearchTerm('john.doe')).toBe('john.doe')
    expect(sanitizeSearchTerm('smith-jones')).toBe('smith-jones')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeSearchTerm('  hello  ')).toBe('hello')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeSearchTerm('   ')).toBe('')
    expect(sanitizeSearchTerm('')).toBe('')
  })

  it('caps length at 100 characters', () => {
    const result = sanitizeSearchTerm('x'.repeat(250))
    expect(result).toHaveLength(100)
  })
})
