import { describe, it, expect } from '@jest/globals'
import { buildKbFilesBlock } from '../business-knowledge.js'

describe('buildKbFilesBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildKbFilesBlock([])).toBe('')
  })

  it('skips files with null extracted_text', () => {
    const files = [
      { file_name: 'doc.pdf', extracted_text: null },
      { file_name: 'other.pdf', extracted_text: '' },
    ]
    expect(buildKbFilesBlock(files)).toBe('')
  })

  it('returns correct block for 2 ready files', () => {
    const files = [
      { file_name: 'menu.pdf', extracted_text: 'Appetizers: soup, salad' },
      { file_name: 'hours.pdf', extracted_text: 'Mon-Fri 9am-5pm' },
    ]
    const result = buildKbFilesBlock(files)
    expect(result).toContain('--- UPLOADED DOCUMENTS ---')
    expect(result).toContain('[menu.pdf]:')
    expect(result).toContain('Appetizers: soup, salad')
    expect(result).toContain('[hours.pdf]:')
    expect(result).toContain('Mon-Fri 9am-5pm')
    expect(result.startsWith('\n\n--- UPLOADED DOCUMENTS ---')).toBe(true)
  })
})
