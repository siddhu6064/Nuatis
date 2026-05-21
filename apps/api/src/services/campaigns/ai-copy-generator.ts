import { GoogleGenAI } from '@google/genai'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignChannel = 'sms' | 'email' | 'social'

export type CampaignObjective =
  | 'reactivate_lapsed'
  | 'announce_promo'
  | 'request_review'
  | 'seasonal'
  | 'custom'

export interface BrandVoiceConfig {
  tone: 'professional' | 'friendly' | 'casual'
  industry_terms?: string[]
  avoid_phrases?: string[]
  business_name: string
}

export interface GenerateParams {
  tenantId: string
  objective: CampaignObjective
  channels: CampaignChannel[]
  segmentDescription: string
  brandVoice: BrandVoiceConfig
  businessContext: string
}

export interface CampaignMessageDraft {
  channel: CampaignChannel
  subject?: string
  body: string
  char_count: number
  ai_generated: true
}

// ── Objective label map ────────────────────────────────────────────────────────

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  reactivate_lapsed: 'win back lapsed clients',
  announce_promo: 'announce a promotion',
  request_review: 'request a review',
  seasonal: 'seasonal campaign',
  custom: 'general campaign',
}

// ── Character-limit enforcement ────────────────────────────────────────────────

function truncateAtWordBoundary(text: string, hardLimit: number, suffix = '...'): string {
  if (text.length <= hardLimit) return text
  const cutoff = hardLimit - suffix.length
  const truncated = text.slice(0, cutoff)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + suffix
}

function enforceSmsSoft(body: string): string {
  if (body.length <= 160) return body
  console.info('[ai-copy-generator] SMS body truncated to 160 chars')
  return truncateAtWordBoundary(body, 160)
}

function enforceEmailSubject(subject: string): string {
  if (subject.length <= 50) return subject
  console.info('[ai-copy-generator] email subject truncated to 50 chars')
  return truncateAtWordBoundary(subject, 50)
}

function enforceSocial(body: string): string {
  if (body.length <= 100) return body
  console.info('[ai-copy-generator] social body truncated to 100 chars')
  return truncateAtWordBoundary(body, 100)
}

// ── Base context builder ────────────────────────────────────────────────────────

function buildBaseContext(params: GenerateParams): string {
  const { brandVoice, businessContext, segmentDescription, objective } = params
  const industryTerms =
    brandVoice.industry_terms && brandVoice.industry_terms.length > 0
      ? brandVoice.industry_terms.join(', ')
      : 'none specified'
  const avoidPhrases =
    brandVoice.avoid_phrases && brandVoice.avoid_phrases.length > 0
      ? brandVoice.avoid_phrases.join(', ')
      : 'none'

  return [
    `Business: ${brandVoice.business_name}`,
    `Context: ${businessContext}`,
    `Audience: ${segmentDescription}`,
    `Objective: ${OBJECTIVE_LABELS[objective]}`,
    `Tone: ${brandVoice.tone}`,
    `Industry terms to use naturally: ${industryTerms}`,
    `Phrases to avoid: ${avoidPhrases}`,
  ].join('\n')
}

// ── Channel prompt builders ────────────────────────────────────────────────────

function buildSmsPrompt(baseContext: string): string {
  return [
    baseContext,
    '',
    'Return ONLY valid JSON with this shape: { "body": string }',
    '- body MUST be 160 characters or fewer — count carefully before responding',
    '- Include {first_name} exactly once',
    '- End with one clear call to action',
    '- No corporate speak',
  ].join('\n')
}

function buildEmailPrompt(baseContext: string): string {
  return [
    baseContext,
    '',
    'Return ONLY valid JSON with this shape: { "subject": string, "body": string }',
    '- subject MUST be 50 characters or fewer',
    '- body between 180 and 280 words',
    '- Open with "Hi {first_name},"',
    '- One clear CTA paragraph near the end',
    '- Plain prose only — no bullet points, no markdown, no HTML',
  ].join('\n')
}

function buildSocialPrompt(baseContext: string): string {
  return [
    baseContext,
    '',
    'Return ONLY valid JSON with this shape: { "body": string }',
    '- body MUST be 100 characters or fewer INCLUDING hashtags',
    '- Add 2-3 relevant hashtags (count toward the 100-char limit)',
    '- Conversational tone regardless of brand voice setting',
    '- No {first_name} — broadcast post, not personalised',
  ].join('\n')
}

// ── Per-channel generator ─────────────────────────────────────────────────────

async function generateForChannel(
  genai: GoogleGenAI,
  channel: CampaignChannel,
  baseContext: string
): Promise<CampaignMessageDraft> {
  const prompt =
    channel === 'sms'
      ? buildSmsPrompt(baseContext)
      : channel === 'email'
        ? buildEmailPrompt(baseContext)
        : buildSocialPrompt(baseContext)

  const result = await genai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json' },
  })

  const raw = result.text?.trim() ?? ''

  // Strip markdown fences if model ignores responseMimeType hint
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  if (channel === 'sms') {
    const parsed = JSON.parse(stripped) as { body: string }
    const body = enforceSmsSoft(parsed.body ?? '')
    return { channel, body, char_count: body.length, ai_generated: true }
  }

  if (channel === 'email') {
    const parsed = JSON.parse(stripped) as { subject: string; body: string }
    const subject = enforceEmailSubject(parsed.subject ?? '')
    const body = parsed.body ?? ''
    return { channel, subject, body, char_count: body.length, ai_generated: true }
  }

  // social
  const parsed = JSON.parse(stripped) as { body: string }
  const body = enforceSocial(parsed.body ?? '')
  return { channel, body, char_count: body.length, ai_generated: true }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateCampaignCopy(
  params: GenerateParams
): Promise<CampaignMessageDraft[]> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const genai = new GoogleGenAI({ apiKey })
  const baseContext = buildBaseContext(params)

  const drafts = await Promise.all(
    params.channels.map((channel) => generateForChannel(genai, channel, baseContext))
  )

  return drafts
}
