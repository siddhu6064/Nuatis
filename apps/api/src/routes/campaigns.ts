import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { requireAuth, requireModule, type AuthenticatedRequest } from '../lib/auth.js'
import { buildBrandVoicePromptBlock } from '../lib/brand-voice.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import type { Campaign, BrandVoice, CampaignStats, CampaignRecipientStatus } from '@nuatis/shared'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const router = Router()

// ── GET /api/campaigns ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  const page = Math.max(
    1,
    parseInt(typeof req.query['page'] === 'string' ? req.query['page'] : '1', 10) || 1
  )
  const limit = Math.max(
    1,
    Math.min(
      100,
      parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '20', 10) || 20
    )
  )
  const offset = (page - 1) * limit

  let query = supabase
    .from('campaigns')
    .select(
      'id, name, type, status, subject, recipient_count, sent_count, scheduled_at, sent_at, created_at',
      { count: 'exact' }
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ campaigns: data ?? [], total: count ?? 0, page })
})

// ── GET /api/campaigns/:id ─────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single<Campaign>()

  if (error || !data) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  res.json(data)
})

// ── POST /api/campaigns ────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { name, type, subject, smart_list_id } = req.body as {
      name?: string
      type?: 'email' | 'sms'
      subject?: string
      smart_list_id?: string
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const insert: Record<string, unknown> = {
      tenant_id: authed.tenantId,
      name: name.trim(),
      type: type ?? 'email',
      status: 'draft',
      created_by: authed.userId,
    }
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
  }
)

// ── PUT /api/campaigns/:id ─────────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Fetch campaign first to check status
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

    const { name, subject, body_html, body_text, smart_list_id, scheduled_at } = req.body as {
      name?: string
      subject?: string
      body_html?: string
      body_text?: string
      smart_list_id?: string
      scheduled_at?: string
    }

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
  }
)

// ── DELETE /api/campaigns/:id ──────────────────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
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
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ success: true })
  }
)

// ── POST /api/campaigns/:id/cancel ────────────────────────────────────────
router.post(
  '/:id/cancel',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
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

    if (existing.status !== 'scheduled' && existing.status !== 'sending') {
      res.status(400).json({ error: 'Only scheduled or sending campaigns can be cancelled' })
      return
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single<Campaign>()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to cancel campaign' })
      return
    }

    res.json({ campaign: data })
  }
)

// ── POST /api/campaigns/:id/generate ─────────────────────────────────────
router.post(
  '/:id/generate',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      res.status(503).json({ error: 'AI generation not available: GEMINI_API_KEY not configured' })
      return
    }

    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Fetch campaign
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single<Campaign>()

    if (campErr || !campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    // Fetch tenant (vertical + brand_voice)
    const { data: tenant } = await supabase
      .from('tenants')
      .select('vertical, brand_voice')
      .eq('id', authed.tenantId)
      .single<{ vertical: string | null; brand_voice: BrandVoice | null }>()

    const vertical = tenant?.vertical ?? 'service'
    const brandVoice = tenant?.brand_voice ?? null

    // Build system prompt
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

      // Strip markdown code fences if present
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

      // Update campaign with generated content
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

// ── POST /api/campaigns/:id/schedule ──────────────────────────────────────
router.post(
  '/:id/schedule',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { scheduled_at } = req.body as { scheduled_at?: string }

    if (!scheduled_at) {
      res.status(400).json({ error: 'scheduled_at is required' })
      return
    }

    const scheduledDate = new Date(scheduled_at)
    if (isNaN(scheduledDate.getTime())) {
      res.status(400).json({ error: 'scheduled_at must be a valid ISO date string' })
      return
    }

    const minScheduleTime = Date.now() + 5 * 60 * 1000 // 5 minutes from now
    if (scheduledDate.getTime() <= minScheduleTime) {
      res.status(400).json({ error: 'scheduled_at must be at least 5 minutes in the future' })
      return
    }

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

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      res.status(400).json({ error: 'Only draft or scheduled campaigns can be (re)scheduled' })
      return
    }

    if (!campaign.subject) {
      res.status(400).json({ error: 'Campaign must have a subject before scheduling' })
      return
    }
    if (!campaign.body_html) {
      res.status(400).json({ error: 'Campaign must have email body before scheduling' })
      return
    }
    if (!campaign.smart_list_id) {
      res.status(400).json({ error: 'Campaign must have a recipient list before scheduling' })
      return
    }

    const { data: updated, error: updateErr } = await supabase
      .from('campaigns')
      .update({
        status: 'scheduled',
        scheduled_at: scheduledDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single<Campaign>()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to schedule campaign' })
      return
    }

    // Enqueue BullMQ job
    try {
      const queue = new Queue('campaign-send', { connection: createBullMQConnection() })
      const delay = scheduledDate.getTime() - Date.now()
      await queue.add(
        'campaign-send',
        { campaignId: campaign.id, tenantId: authed.tenantId },
        { delay }
      )
      await queue.close()
    } catch (err) {
      console.error('[campaigns/schedule] BullMQ enqueue error:', err)
      // Don't fail the request — campaign is already marked scheduled in DB
    }

    res.json({ campaign: updated })
  }
)

// ── POST /api/campaigns/:id/send-now ──────────────────────────────────────
router.post(
  '/:id/send-now',
  requireAuth,
  requireModule('campaigns'),
  async (req: Request, res: Response): Promise<void> => {
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
      .update({
        status: 'sending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single<Campaign>()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to update campaign status' })
      return
    }

    // Enqueue BullMQ job with delay=0
    try {
      const queue = new Queue('campaign-send', { connection: createBullMQConnection() })
      await queue.add(
        'campaign-send',
        { campaignId: campaign.id, tenantId: authed.tenantId },
        { delay: 0 }
      )
      await queue.close()
    } catch (err) {
      console.error('[campaigns/send-now] BullMQ enqueue error:', err)
    }

    res.json({ campaign: updated })
  }
)

// ── GET /api/campaigns/:id/stats ───────────────────────────────────────────
router.get('/:id/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify campaign belongs to tenant
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

  // Fetch recipient status counts
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

// ── GET /api/campaigns/:id/recipients ─────────────────────────────────────
router.get('/:id/recipients', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Verify campaign belongs to tenant
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
  const page = Math.max(
    1,
    parseInt(typeof req.query['page'] === 'string' ? req.query['page'] : '1', 10) || 1
  )
  const limit = Math.max(
    1,
    Math.min(
      200,
      parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '50', 10) || 50
    )
  )
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

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ recipients: data ?? [], total: count ?? 0, page })
})

export default router
