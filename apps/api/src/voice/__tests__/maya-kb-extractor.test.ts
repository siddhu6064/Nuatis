import { describe, it, expect } from '@jest/globals'
import { buildKbFilesBlock } from '../business-knowledge.js'

const FENCE = 'abc123'

describe('buildKbFilesBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildKbFilesBlock([], FENCE)).toBe('')
  })

  it('skips files with null extracted_text', () => {
    const files = [
      { file_name: 'doc.pdf', extracted_text: null },
      { file_name: 'other.pdf', extracted_text: '' },
    ]
    expect(buildKbFilesBlock(files, FENCE)).toBe('')
  })

  it('returns correct fenced block for 2 ready files', () => {
    const files = [
      { file_name: 'menu.pdf', extracted_text: 'Appetizers: soup, salad' },
      { file_name: 'hours.pdf', extracted_text: 'Mon-Fri 9am-5pm' },
    ]
    const result = buildKbFilesBlock(files, FENCE)
    // PROMPT-02: content is fenced with the per-session random delimiter.
    expect(result).toContain(`KNOWLEDGE_BASE_${FENCE}_START`)
    expect(result).toContain(`KNOWLEDGE_BASE_${FENCE}_END`)
    expect(result.startsWith(`\n\n=== KNOWLEDGE_BASE_${FENCE}_START`)).toBe(true)
    expect(result).toContain('[menu.pdf]:')
    expect(result).toContain('Appetizers: soup, salad')
    expect(result).toContain('[hours.pdf]:')
    expect(result).toContain('Mon-Fri 9am-5pm')
  })
})
