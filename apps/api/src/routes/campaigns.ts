import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'
import { aiGenerationLimiter } from '../middleware/rate-limit.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { buildBrandVoicePromptBlock } from '../lib/brand-voice.js'
import {
  generateCampaignCopy,
  type CampaignChannel,
  type CampaignObjective,
  type BrandVoiceConfig,
} from '../services/campaigns/ai-copy-generator.js'
import { resolveSegmentDescription } from '../services/campaigns/segment-resolver.js'
import type { Campaign, BrandVoice, CampaignStats, CampaignRecipientStatus } from '@nuatis/shared'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_OBJECTIVES: CampaignObjective[] = [
  'reactivate_lapsed',
  'announce_promo',
  'request_review',
  'seasonal',
  'custom',
]
const VALID_CHANNELS: CampaignChannel[] = ['sms', 'email', 'social']

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// Format ('+1 512 ***-1234') is intentionally distinct from the canonical
// pre-call-lookup maskPhone ('****1234') — settings UI display choice. Do not consolidate.
function maskPhone(phone: string): string {
  const usMatch = phone.match(/^(\+1)(\d{3})(\d{3})(\d{4})$/)
  if (usMatch) return `${usMatch[1]} ${usMatch[2]} ***-${usMatch[4]}`
  const genericMatch = phone.match(/^(\+\d{1,3})(\d{1,4})(\d+)(\d{4})$/)
  if (genericMatch) return `${genericMatch[1]} ${genericMatch[2]} ***-${genericMatch[4]}`
  return `***-${phone.slice(-4)}`
}

function mapTone(tone?: string): BrandVoiceConfig['tone'] {
  if (tone === 'professional' || tone === 'authoritative') return 'professional'
  if (tone === 'friendly' || tone === 'warm') return 'friendly'
  if (tone === 'casual') return 'casual'
  return 'professional'
}

function parseContactCount(desc: string): number | null {
  const match = desc.match(/(\d+)\s+contacts?/)
  return match ? parseInt(match[1]!, 10) : null
}

// ── Lazy BullMQ queue singleton ───────────────────────────────────────────────

let _campaignQueue: Queue | null = null

function getCampaignQueue(): Queue {
  if (!_campaignQueue) {
    _campaignQueue = new Queue('campaign-send', {
      connection: createBullMQConnection(),
      skipVersionCheck: true,
    })
  }
  return _campaignQueue
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router()

// Phase 9: subscription + module gate. 'campaigns' is in Pro + Scale.
router.use(requireAuth, requirePlan('campaigns'))

// ── POST /api/campaigns ───────────────────────────────────────────────────────
// Accepts both old format { name, type } and new P13 format { name, objective, channels }.
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const body = req.body as Record<string, unknown>
  const name = typeof body['name'] === 'string' ? body['name'].trim() : ''

  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  // ── P13 fields ────────────────────────────────────────────────────────────
  const objective = body['objective'] as string | undefined
  const channels = body['channels'] as unknown[] | undefined
  const segment_id = typeof body['segment_id'] === 'string' ? body['segment_id'] : undefined

  if (objective !== undefined) {
    if (!VALID_OBJECTIVES.includes(objective as CampaignObjective)) {
      res.status(400).json({
        error: `objective must be one of: ${VALID_OBJECTIVES.join(', ')}`,
      })
      return
    }
  }

  if (channels !== undefined) {
    if (!Array.isArray(channels) || channels.length === 0) {
      res.status(400).json({ error: 'channels must be a non-empty array' })
      return
    }
    const invalid = channels.filter((c) => !VALID_CHANNELS.includes(c as CampaignChannel))
    if (invalid.length > 0) {
      res.status(400).json({
        error: `invalid channel(s): ${invalid.join(', ')}. Must be: ${VALID_CHANNELS.join(', ')}`,
      })
      return
    }
  }

  // ── Old fields (backward compat) ──────────────────────────────────────────
  const type = (typeof body['type'] === 'string' ? body['type'] : 'email') as
    | 'email'
    | 'sms'
    | undefined
  const subject = typeof body['subject'] === 'string' ? body['subject'] : undefined
  const smart_list_id =
    typeof body['smart_list_id'] === 'string' ? body['smart_list_id'] : undefined

  const insert: Record<string, unknown> = {
    tenant_id: authed.tenantId,
    name,
    status: 'draft',
    created_by: authed.appUserId ?? null,
    type: type ?? 'email',
  }
  if (objective) insert['objective'] = objective
  if (channels) insert['channels'] = channels
  if (segment_id) insert['segment_id'] = segment_id
  if (subject) insert['subject'] = subject
  if (smart_list_id) insert['smart_list_id'] = smart_list_id

  const { data, error } = await supabase
    .from('campaigns')
    .insert(insert)
    .select('*')
    .single<Campaign>()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create campaign' })
    return
  }

  res.status(201).json({ campaign: data })
})

// ── GET /api/campaigns ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const offset = (page - 1) * limit

  let query = supabase
    .from('campaigns')
    .select(
      `id, name, status, objective, channels, segment_id, contact_count,
       schedule_at, sent_at, created_at,
       smart_lists!segment_id(name)`,
      { count: 'exact' }
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  type CampaignRow = {
    id: string
    name: string
    status: string
    objective: string | null
    channels: string[] | null
    segment_id: string | null
    contact_count: number | null
    schedule_at: string | null
    sent_at: string | null
    created_at: string
    smart_lists: { name: string }[] | null
  }

  const rows = (data ?? []) as unknown as CampaignRow[]
  const responseData = rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    objective: row.objective,
    channels: row.channels,
    segment_name: (Array.isArray(row.smart_lists) ? row.smart_lists[0]?.name : null) ?? null,
    contact_count: row.contact_count,
    schedule_at: row.schedule_at,
    sent_at: row.sent_at,
    created_at: row.created_at,
  }))

  res.json({ data: responseData, total: count ?? 0, page })
})

// ── GET /api/campaigns/:id ────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  const [campaignResult, messagesResult, performanceResult] = await Promise.all([
    supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .single<Campaign>(),
    supabase.from('campaign_messages').select('*').eq('campaign_id', id),
    supabase.from('campaign_performance').select('*').eq('campaign_id', id),
  ])

  if (campaignResult.error || !campaignResult.data) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  type PerformanceRow = {
    channel: string
    total_sent: number
    delivered: number
    opened: number
    clicked: number
    opted_out: number
    failed: number
  }

  res.json({
    campaign: campaignResult.data,
    messages: messagesResult.data ?? [],
    performance: (performanceResult.data ?? []) as PerformanceRow[],
  })
})

// ── PATCH /api/campaigns/:id ──────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  const { data: existing, error: fetchErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id' | 'status'>>()

  if (fetchErr || !existing) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (!['draft', 'scheduled'].includes(existing.status)) {
    res.status(400).json({
      error: `Cannot edit a campaign with status '${existing.status}'`,
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body['name'] === 'string') updates['name'] = body['name']
  if (typeof body['schedule_at'] === 'string') updates['schedule_at'] = body['schedule_at']

  const { data, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single<Campaign>()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update campaign' })
    return
  }

  res.json({ campaign: data })
})

// ── PUT /api/campaigns/:id — kept for backward compat ────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: existing, error: fetchErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id' | 'status'>>()

  if (fetchErr || !existing) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (existing.status !== 'draft') {
    res.status(400).json({ error: 'Only draft campaigns can be edited' })
    return
  }

  const { name, subject, body_html, body_text, smart_list_id, scheduled_at } = req.body as Record<
    string,
    string | undefined
  >

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) updates['name'] = name
  if (subject !== undefined) updates['subject'] = subject
  if (body_html !== undefined) updates['body_html'] = body_html
  if (body_text !== undefined) updates['body_text'] = body_text
  if (smart_list_id !== undefined) updates['smart_list_id'] = smart_list_id
  if (scheduled_at !== undefined) updates['scheduled_at'] = scheduled_at

  const { data, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single<Campaign>()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update campaign' })
    return
  }

  res.json({ campaign: data })
})

// ── POST /api/campaigns/:id/generate ─────────────────────────────────────────
// Bifurcated: P13 multi-channel if campaign.channels is set; legacy email otherwise.
router.post(
  '/:id/generate',
  aiGenerationLimiter,
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single<Campaign & { objective?: string; channels?: string[]; segment_id?: string }>()

    if (campErr || !campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    // ── P13 path: campaign has channels[] and objective ───────────────────────
    if (
      Array.isArray((campaign as { channels?: unknown }).channels) &&
      (campaign as { channels?: unknown[] }).channels!.length > 0 &&
      (campaign as { objective?: unknown }).objective
    ) {
      const apiKey = process.env['GEMINI_API_KEY']
      if (!apiKey) {
        res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
        return
      }

      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, vertical, brand_voice')
        .eq('id', authed.tenantId)
        .single<{ name: string | null; vertical: string | null; brand_voice: BrandVoice | null }>()

      const bv = tenant?.brand_voice ?? null
      const brandVoiceConfig: BrandVoiceConfig = {
        business_name: tenant?.name ?? 'Business',
        tone: mapTone(bv?.tone),
        industry_terms: bv?.industry_terms ?? [],
        avoid_phrases: bv?.avoid_phrases ?? [],
      }

      const businessContext = `${tenant?.name ?? 'Business'} is a ${tenant?.vertical ?? 'service'} business.`

      const segmentDescription = (campaign as { segment_id?: string }).segment_id
        ? await resolveSegmentDescription(
            (campaign as { segment_id: string }).segment_id,
            authed.tenantId
          )
        : 'all contacts'

      let drafts
      try {
        drafts = await generateCampaignCopy({
          tenantId: authed.tenantId,
          objective: (campaign as { objective: CampaignObjective }).objective,
          channels: (campaign as { channels: CampaignChannel[] }).channels,
          segmentDescription,
          brandVoice: brandVoiceConfig,
          businessContext,
        })
      } catch (err) {
        console.error('[campaigns/generate] P13 Gemini error:', err)
        res.status(500).json({ error: 'AI generation failed' })
        return
      }

      // Fetch existing messages to check which are already approved
      const { data: existingMessages } = await supabase
        .from('campaign_messages')
        .select('channel, approved')
        .eq('campaign_id', campaign.id)

      type MsgRow = { channel: string; approved: boolean }
      const approvedChannels = new Set(
        ((existingMessages ?? []) as MsgRow[]).filter((m) => m.approved).map((m) => m.channel)
      )

      // Upsert non-approved channels
      const toUpsert = drafts.filter((d) => !approvedChannels.has(d.channel))
      if (toUpsert.length > 0) {
        await supabase.from('campaign_messages').upsert(
          toUpsert.map((d) => ({
            campaign_id: campaign.id,
            channel: d.channel,
            subject: d.subject ?? null,
            body: d.body,
            ai_generated: true,
            approved: false,
            approved_by: null,
            approved_at: null,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'campaign_id,channel' }
        )
      }

      const { data: allMessages } = await supabase
        .from('campaign_messages')
        .select('*')
        .eq('campaign_id', campaign.id)

      res.json({ messages: allMessages ?? [] })
      return
    }

    // ── Legacy path: old email-only campaign ──────────────────────────────────
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      res.status(503).json({ error: 'AI generation not available: GEMINI_API_KEY not configured' })
      return
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('vertical, brand_voice')
      .eq('id', authed.tenantId)
      .single<{ vertical: string | null; brand_voice: BrandVoice | null }>()

    const vertical = tenant?.vertical ?? 'service'
    const brandVoice = tenant?.brand_voice ?? null
    const brandVoiceBlock = buildBrandVoicePromptBlock(brandVoice)

    const systemPrompt = [
      brandVoiceBlock,
      `You are an email marketing expert for a ${vertical} business. Generate a complete marketing email. Return JSON only with no markdown: {"subject": string, "body_html": string, "body_text": string}. body_html: complete HTML with inline styles, email-safe, no external resources. Keep it concise (150-250 words). Include a clear call to action.`,
    ]
      .filter(Boolean)
      .join('\n')

    const userPrompt =
      typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : 'Write a re-engagement email for our contact list'

    try {
      const { GoogleGenAI } = await import('@google/genai')
      const genai = new GoogleGenAI({ apiKey })
      const result = await genai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        config: { maxOutputTokens: 800 },
      })
      const raw = result?.text?.trim() ?? ''
      const stripped = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()

      let parsed: { subject: string; body_html: string; body_text: string }
      try {
        parsed = JSON.parse(stripped) as { subject: string; body_html: string; body_text: string }
      } catch {
        console.error('[campaigns/generate] Failed to parse Gemini response:', raw)
        res.status(500).json({ error: 'AI returned invalid JSON response' })
        return
      }

      await supabase
        .from('campaigns')
        .update({
          subject: parsed.subject,
          body_html: parsed.body_html,
          body_text: parsed.body_text,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params['id'])
        .eq('tenant_id', authed.tenantId)

      res.json({
        subject: parsed.subject,
        body_html: parsed.body_html,
        body_text: parsed.body_text,
      })
    } catch (err) {
      console.error('[campaigns/generate] Gemini error:', err)
      res.status(500).json({ error: 'AI generation failed' })
    }
  }
)

// ── PATCH /api/campaigns/:id/messages/:msgId ──────────────────────────────────
router.patch(
  '/:id/messages/:msgId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { id, msgId } = req.params as { id: string; msgId: string }

    // Verify campaign belongs to tenant
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .single<{ id: string }>()

    if (campErr || !campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    // Verify message belongs to campaign
    const { data: existing, error: msgErr } = await supabase
      .from('campaign_messages')
      .select('id')
      .eq('id', msgId)
      .eq('campaign_id', id)
      .single<{ id: string }>()

    if (msgErr || !existing) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    const body = req.body as Record<string, unknown>
    const updates: Record<string, unknown> = {
      ai_generated: false,
      approved: false,
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    }
    if (typeof body['body'] === 'string') updates['body'] = body['body']
    if (typeof body['subject'] === 'string') updates['subject'] = body['subject']

    const { data, error } = await supabase
      .from('campaign_messages')
      .update(updates)
      .eq('id', msgId)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to update message' })
      return
    }

    res.json({ message: data })
  }
)

// ── POST /api/campaigns/:id/approve ──────────────────────────────────────────
router.post('/:id/approve', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  // Verify campaign and fetch channels
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, channels')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single<{ id: string; channels: string[] | null }>()

  if (campErr || !campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const channels = campaign.channels ?? []

  // Check all channels have a message
  const { data: messages } = await supabase
    .from('campaign_messages')
    .select('id, channel, approved')
    .eq('campaign_id', id)

  type MsgRow = { id: string; channel: string; approved: boolean }
  const existingChannels = new Set(((messages ?? []) as MsgRow[]).map((m) => m.channel))

  for (const channel of channels) {
    if (!existingChannels.has(channel)) {
      res.status(400).json({ error: `Missing message for channel: ${channel}` })
      return
    }
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateErr } = await supabase
    .from('campaign_messages')
    .update({ approved: true, approved_by: authed.appUserId ?? null, approved_at: now })
    .eq('campaign_id', id)
    .select('*')

  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }

  res.json({ messages: updated ?? [] })
})

// ── POST /api/campaigns/:id/schedule ─────────────────────────────────────────
router.post('/:id/schedule', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  const body = req.body as Record<string, unknown>

  // ── P13 schedule path: expects schedule_at ─────────────────────────────────
  const scheduleAt = body['schedule_at'] as string | undefined

  // ── Legacy schedule path: expects scheduled_at ─────────────────────────────
  const scheduledAt = body['scheduled_at'] as string | undefined

  // P13 path
  if (scheduleAt !== undefined) {
    const scheduleDate = new Date(scheduleAt)
    if (isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= Date.now()) {
      res.status(400).json({ error: 'schedule_at must be a valid future ISO timestamp' })
      return
    }

    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id, status, channels, segment_id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .single<{
        id: string
        status: string
        channels: string[] | null
        segment_id: string | null
      }>()

    if (campErr || !campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    if (!['draft', 'scheduled'].includes(campaign.status)) {
      res.status(400).json({
        error: `Cannot schedule a campaign with status '${campaign.status}'`,
      })
      return
    }

    // All messages must be approved
    const { data: messages } = await supabase
      .from('campaign_messages')
      .select('channel, approved')
      .eq('campaign_id', id)

    type MsgRow = { channel: string; approved: boolean }
    const unapproved = ((messages ?? []) as MsgRow[]).filter((m) => !m.approved)
    if (unapproved.length > 0) {
      res.status(400).json({ error: 'Approve all messages before scheduling' })
      return
    }

    // Snapshot contact_count
    let contactCount: number | null = null
    if (campaign.segment_id) {
      const desc = await resolveSegmentDescription(campaign.segment_id, authed.tenantId)
      contactCount = parseContactCount(desc)
    }

    const { data: updated, error: updateErr } = await supabase
      .from('campaigns')
      .update({
        status: 'scheduled',
        schedule_at: scheduleDate.toISOString(),
        contact_count: contactCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single<Campaign>()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to schedule campaign' })
      return
    }

    try {
      const delay = Math.max(0, scheduleDate.getTime() - Date.now())
      await getCampaignQueue().add('send', { campaignId: id, tenantId: authed.tenantId }, { delay })
    } catch (err) {
      console.error('[campaigns/schedule] BullMQ enqueue error:', err)
      // Non-fatal — campaign is marked scheduled in DB
    }

    res.json({ campaign: updated })
    return
  }

  // ── Legacy path: expects scheduled_at + validates smart_list_id/subject/body ─
  if (!scheduledAt) {
    res.status(400).json({ error: 'scheduled_at is required' })
    return
  }

  const scheduledDate = new Date(scheduledAt)
  if (isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: 'scheduled_at must be a valid ISO date string' })
    return
  }

  const minScheduleTime = Date.now() + 5 * 60 * 1000
  if (scheduledDate.getTime() <= minScheduleTime) {
    res.status(400).json({ error: 'scheduled_at must be at least 5 minutes in the future' })
    return
  }

  const { data: campaignLegacy, error: fetchErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single<Campaign>()

  if (fetchErr || !campaignLegacy) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (campaignLegacy.status !== 'draft' && campaignLegacy.status !== 'scheduled') {
    res.status(400).json({
      error: 'Only draft or scheduled campaigns can be (re)scheduled',
    })
    return
  }

  if (!campaignLegacy.subject) {
    res.status(400).json({ error: 'Campaign must have a subject before scheduling' })
    return
  }
  if (!campaignLegacy.body_html) {
    res.status(400).json({ error: 'Campaign must have email body before scheduling' })
    return
  }
  if (!campaignLegacy.smart_list_id) {
    res.status(400).json({
      error: 'Campaign must have a recipient list before scheduling',
    })
    return
  }

  const { data: updatedLegacy, error: updateErr } = await supabase
    .from('campaigns')
    .update({
      status: 'scheduled',
      scheduled_at: scheduledDate.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single<Campaign>()

  if (updateErr || !updatedLegacy) {
    res.status(500).json({ error: updateErr?.message ?? 'Failed to schedule campaign' })
    return
  }

  try {
    const delay = scheduledDate.getTime() - Date.now()
    await getCampaignQueue().add(
      'campaign-send',
      { campaignId: campaignLegacy.id, tenantId: authed.tenantId },
      { delay }
    )
  } catch (err) {
    console.error('[campaigns/schedule] BullMQ enqueue error:', err)
  }

  res.json({ campaign: updatedLegacy })
})

// ── POST /api/campaigns/:id/cancel ────────────────────────────────────────────
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  const { data: existing, error: fetchErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id' | 'status'>>()

  if (fetchErr || !existing) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (existing.status !== 'scheduled' && existing.status !== 'sending') {
    res.status(400).json({
      error: 'Only scheduled or sending campaigns can be cancelled',
    })
    return
  }

  const { data: updated, error: updateErr } = await supabase
    .from('campaigns')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single<Campaign>()

  if (updateErr || !updated) {
    res.status(500).json({ error: updateErr?.message ?? 'Failed to cancel campaign' })
    return
  }

  // Best-effort: remove delayed BullMQ job if findable
  try {
    const queue = getCampaignQueue()
    const delayed = await queue.getDelayed()
    const job = delayed.find((j) => (j.data as { campaignId?: string }).campaignId === id)
    if (job) await job.remove()
  } catch {
    // Silently ignored — worker checks campaign status before sending
  }

  res.json({ campaign: updated })
})

// ── POST /api/campaigns/:id/send-now — legacy, kept for compat ────────────────
router.post('/:id/send-now', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: campaign, error: fetchErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Campaign>()

  if (fetchErr || !campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (!campaign.subject) {
    res.status(400).json({ error: 'Campaign must have a subject before sending' })
    return
  }
  if (!campaign.body_html) {
    res.status(400).json({ error: 'Campaign must have email body before sending' })
    return
  }
  if (!campaign.smart_list_id) {
    res.status(400).json({ error: 'Campaign must have a recipient list before sending' })
    return
  }

  const { data: updated, error: updateErr } = await supabase
    .from('campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single<Campaign>()

  if (updateErr || !updated) {
    res.status(500).json({ error: updateErr?.message ?? 'Failed to update campaign status' })
    return
  }

  try {
    await getCampaignQueue().add(
      'campaign-send',
      { campaignId: campaign.id, tenantId: authed.tenantId },
      { delay: 0 }
    )
  } catch (err) {
    console.error('[campaigns/send-now] BullMQ enqueue error:', err)
  }

  res.json({ campaign: updated })
})

// ── GET /api/campaigns/:id/stats — legacy, kept for compat ───────────────────
router.get('/:id/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, recipient_count, sent_count')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id' | 'recipient_count' | 'sent_count'>>()

  if (campErr || !campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const { data: recipientRows, error: recipientErr } = await supabase
    .from('campaign_recipients')
    .select('status')
    .eq('campaign_id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (recipientErr) {
    res.status(500).json({ error: recipientErr.message })
    return
  }

  const statusCounts: Record<string, number> = {}
  for (const row of recipientRows ?? []) {
    const s = row.status as string
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
  }

  const delivered = statusCounts['delivered'] ?? 0
  const opened = statusCounts['opened'] ?? 0
  const clicked = statusCounts['clicked'] ?? 0
  const bounced = statusCounts['bounced'] ?? 0
  const failed = statusCounts['failed'] ?? 0

  const stats: CampaignStats = {
    recipient_count: campaign.recipient_count,
    sent_count: campaign.sent_count,
    delivered,
    opened,
    clicked,
    bounced,
    failed,
    open_rate: delivered > 0 ? opened / delivered : 0,
    click_rate: delivered > 0 ? clicked / delivered : 0,
    bounce_rate: delivered > 0 ? bounced / delivered : 0,
    status_breakdown: statusCounts as Record<CampaignRecipientStatus, number>,
  }

  res.json(stats)
})

// ── GET /api/campaigns/:id/sends — P13 per-contact delivery log ───────────────
router.get('/:id/sends', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const id = req.params['id']

  // Verify campaign belongs to tenant
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single<{ id: string }>()

  if (campErr || !campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const channel = typeof req.query['channel'] === 'string' ? req.query['channel'] : undefined
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
  const offset = (page - 1) * limit

  let query = supabase
    .from('campaign_sends')
    .select(
      `id, channel, status, sent_at, delivered_at, opened_at, clicked_at, error_msg, contact_id,
       contacts!contact_id(first_name, last_name, phone, email)`,
      { count: 'exact' }
    )
    .eq('campaign_id', id)
    .range(offset, offset + limit - 1)

  if (channel) query = query.eq('channel', channel)
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  type SendRow = {
    id: string
    channel: string
    status: string
    sent_at: string | null
    delivered_at: string | null
    opened_at: string | null
    clicked_at: string | null
    error_msg: string | null
    contact_id: string | null
    contacts:
      | {
          first_name: string | null
          last_name: string | null
          phone: string | null
          email: string | null
        }[]
      | null
  }

  const rows = (data ?? []) as unknown as SendRow[]
  const responseData = rows.map((row) => {
    const c = Array.isArray(row.contacts) ? (row.contacts[0] ?? null) : null
    const firstName = c?.first_name ?? ''
    const lastName = c?.last_name ?? ''
    const contactName = [firstName, lastName].filter(Boolean).join(' ') || null
    const phoneMasked = c?.phone ? maskPhone(c.phone) : null

    return {
      id: row.id,
      contact_name: contactName,
      phone_masked: phoneMasked,
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at,
      delivered_at: row.delivered_at,
      opened_at: row.opened_at,
      clicked_at: row.clicked_at,
      error_msg: row.error_msg,
    }
  })

  res.json({ data: responseData, total: count ?? 0, page })
})

// ── GET /api/campaigns/:id/recipients — legacy, kept for compat ───────────────
router.get('/:id/recipients', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id'>>()

  if (campErr || !campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
  const offset = (page - 1) * limit

  let query = supabase
    .from('campaign_recipients')
    .select(
      `id, campaign_id, contact_id, email, status, sent_at, delivered_at, opened_at, clicked_at, error_message,
         contacts!inner(first_name, last_name)`,
      { count: 'exact' }
    )
    .eq('campaign_id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  res.json({ recipients: data ?? [], total: count ?? 0, page })
})

// ── DELETE /api/campaigns/:id — legacy soft-delete, kept for compat ───────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: existing, error: fetchErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Pick<Campaign, 'id' | 'status'>>()

  if (fetchErr || !existing) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  if (existing.status === 'sent') {
    res.status(400).json({ error: 'Sent campaigns cannot be deleted' })
    return
  }

  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  res.json({ success: true })
})

// ── GET /api/campaigns/:id/performance/summary ────────────────────────────────
router.get(
  '/:id/performance/summary',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const id = req.params['id']

    // Verify campaign belongs to tenant
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .single<{ id: string }>()

    if (campErr || !campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    // Fetch combined totals from campaign_sends directly (parallel count queries)
    const [totalRes, deliveredRes, openedRes, clickedRes, optedOutRes, failedRes, perfRes] =
      await Promise.all([
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id),
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .in('status', ['delivered', 'opened', 'clicked']),
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .in('status', ['opened', 'clicked']),
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .eq('status', 'clicked'),
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .eq('status', 'opted_out'),
        supabase
          .from('campaign_sends')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', id)
          .eq('status', 'failed'),
        supabase.from('campaign_performance').select('*').eq('campaign_id', id),
      ])

    const totalSent = totalRes.count ?? 0
    const delivered = deliveredRes.count ?? 0
    const opened = openedRes.count ?? 0
    const clicked = clickedRes.count ?? 0
    const optedOut = optedOutRes.count ?? 0
    const failed = failedRes.count ?? 0

    function rate(num: number, den: number): number {
      if (den === 0) return 0
      return Math.round((num / den) * 1000) / 10
    }

    type PerfRow = {
      channel: string
      total_sent: number
      delivered: number
      opened: number
      clicked: number
      opted_out: number
      failed: number
    }

    res.json({
      total_sent: totalSent,
      delivered,
      opened,
      clicked,
      opted_out: optedOut,
      failed,
      delivery_rate: rate(delivered, totalSent),
      open_rate: rate(opened, delivered),
      click_rate: rate(clicked, opened),
      opt_out_rate: rate(optedOut, totalSent),
      by_channel: (perfRes.data ?? []) as PerfRow[],
    })
  }
)

export default router
