import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type { GenerateParams } from './ai-copy-generator.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['GEMINI_API_KEY'] = 'test-gemini-key'

// ── Gemini mock ───────────────────────────────────────────────────────────────
const mockGenerateContent = jest.fn()

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// ── Dynamic import (after mock) ───────────────────────────────────────────────
const { generateCampaignCopy } = await import('./ai-copy-generator.js')

// ── Base params ───────────────────────────────────────────────────────────────
const BASE_PARAMS: GenerateParams = {
  tenantId: 'tenant-1',
  objective: 'reactivate_lapsed',
  channels: ['sms'],
  segmentDescription: '50 lapsed clients',
  brandVoice: {
    tone: 'friendly',
    business_name: 'Test Spa',
    industry_terms: [],
    avoid_phrases: [],
  },
  businessContext: 'A day spa in Austin, TX',
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockGenerateContent.mockReset()
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('generateCampaignCopy — ai-copy-generator', () => {
  // ── Test 1: SMS body enforces 160 char limit ────────────────────────────────
  it('SMS body is truncated to ≤160 chars with "..." suffix when Gemini returns over-length body', async () => {
    const longBody = 'A'.repeat(200)
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ body: longBody }) })

    const drafts = await generateCampaignCopy({ ...BASE_PARAMS, channels: ['sms'] })

    expect(drafts).toHaveLength(1)
    const sms = drafts[0]!
    expect(sms.body.length).toBeLessThanOrEqual(160)
    expect(sms.body.endsWith('...')).toBe(true)
  })

  // ── Test 2: Email subject enforces 50 char limit, body unchanged ────────────
  it('email subject is truncated to ≤50 chars with "..." and body is returned unchanged', async () => {
    const longSubject = 'S'.repeat(60)
    const validBody =
      'Valid email body text that is well within the character limits and serves as a proper marketing message.'
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ subject: longSubject, body: validBody }),
    })

    const drafts = await generateCampaignCopy({ ...BASE_PARAMS, channels: ['email'] })

    expect(drafts).toHaveLength(1)
    const email = drafts[0]!
    expect(email.subject!.length).toBeLessThanOrEqual(50)
    expect(email.subject!.endsWith('...')).toBe(true)
    expect(email.body).toBe(validBody)
  })

  // ── Test 3: Social body enforces 100 char limit ─────────────────────────────
  it('social body is truncated to ≤100 chars when Gemini returns over-length body', async () => {
    const longBody = 'T'.repeat(120)
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ body: longBody }) })

    const drafts = await generateCampaignCopy({ ...BASE_PARAMS, channels: ['social'] })

    expect(drafts).toHaveLength(1)
    const social = drafts[0]!
    expect(social.body.length).toBeLessThanOrEqual(100)
  })

  // ── Test 4: Brand voice terms appear in prompts ─────────────────────────────
  it('industry_terms and avoid_phrases from brandVoice appear in the prompt sent to Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ body: 'Hi {first_name}, try our whitening treatment!' }),
    })

    await generateCampaignCopy({
      ...BASE_PARAMS,
      channels: ['sms'],
      brandVoice: {
        tone: 'friendly',
        business_name: 'Test Spa',
        industry_terms: ['crown', 'whitening'],
        avoid_phrases: ['cheap'],
      },
    })

    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    const call = mockGenerateContent.mock.calls[0]![0] as {
      contents: Array<{ parts: Array<{ text: string }> }>
    }
    const prompt = call.contents[0]!.parts[0]!.text
    expect(prompt).toContain('crown')
    expect(prompt).toContain('whitening')
    expect(prompt).toContain('cheap')
  })

  // ── Test 5: Multiple channels call Gemini 3× concurrently ──────────────────
  it('returns 3 drafts with correct channel fields and calls Gemini exactly 3 times', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ body: 'Hi {first_name}, SMS here!' }) })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          subject: 'Hello from us',
          body: 'Email body with enough content to be a valid marketing message.',
        }),
      })
      .mockResolvedValueOnce({ text: JSON.stringify({ body: 'Social post! #spa #wellness' }) })

    const drafts = await generateCampaignCopy({
      ...BASE_PARAMS,
      channels: ['sms', 'email', 'social'],
    })

    expect(drafts).toHaveLength(3)
    expect(mockGenerateContent).toHaveBeenCalledTimes(3)

    const channels = drafts.map((d) => d.channel)
    expect(channels).toContain('sms')
    expect(channels).toContain('email')
    expect(channels).toContain('social')
  })

  // ── Test 6: Invalid JSON from Gemini propagates as SyntaxError ─────────────
  // The service does NOT catch JSON.parse errors inside generateForChannel.
  // Invalid Gemini output (even after fence-stripping) propagates as SyntaxError.
  it('throws SyntaxError when Gemini returns plaintext that cannot be parsed as JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Here is your campaign: sorry, no JSON',
    })

    await expect(generateCampaignCopy({ ...BASE_PARAMS, channels: ['sms'] })).rejects.toThrow(
      SyntaxError
    )
  })
})
