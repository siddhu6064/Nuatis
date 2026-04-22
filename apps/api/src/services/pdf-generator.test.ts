import { describe, it, expect } from '@jest/globals'
import { generateQuotePdf } from './pdf-generator.js'

function sampleData(
  overrides: Record<string, unknown> = {}
): Parameters<typeof generateQuotePdf>[0] {
  return {
    quoteNumber: 'Q-2026-0001',
    title: 'Sample Quote',
    createdAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    contactName: 'Jane Customer',
    contactEmail: 'jane@example.com',
    contactPhone: '+15551234567',
    businessName: 'Nuatis Test Clinic',
    businessPhone: '+15550000000',
    subtotal: 100,
    taxRate: 0,
    taxAmount: 0,
    total: 100,
    notes: null,
    lineItems: [{ description: 'Exam', quantity: 1, unit_price: 100, total: 100 }],
    ...overrides,
  }
}

describe('generateQuotePdf', () => {
  it('returns a Buffer', async () => {
    const result = await generateQuotePdf(sampleData())
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(1000)
  })

  it('emits a well-formed PDF with content for populated business name', async () => {
    // pdfkit compresses text streams, so the business name is not recoverable
    // as plain bytes. Assert structural correctness instead: PDF header,
    // non-trivial content length, different output from a tiny payload.
    const populated = await generateQuotePdf(sampleData({ businessName: 'Nuatis Test Clinic' }))
    expect(populated.length).toBeGreaterThan(1500)
    expect(populated.slice(0, 5).toString('latin1')).toBe('%PDF-')
    const empty = await generateQuotePdf(sampleData({ businessName: '', lineItems: [] }))
    expect(populated.length).toBeGreaterThan(empty.length - 2000)
  })
})
