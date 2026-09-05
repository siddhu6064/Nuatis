import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { getFirstName } from '@nuatis/shared'

// PUBLIC router — no auth. Mounted at /api/nps-surveys.
const router = Router()

// ── GET /api/nps-surveys/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const supabase = getServiceClient()

  const { data: npsResponse } = await supabase
    .from('nps_responses')
    .select('id, tenant_id, contact_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!npsResponse) {
    res.status(404).json({ error: 'Survey not found' })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', npsResponse.tenant_id)
    .single()

  let contactName: string | null = null
  if (npsResponse.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('full_name')
      .eq('id', npsResponse.contact_id)
      .maybeSingle()
    contactName = getFirstName(contact?.full_name as string | null | undefined, '') || null
  }

  res.json({
    business_name: (tenant?.name as string | null) ?? '',
    contact_name: contactName,
    status: npsResponse.status,
  })
})

// ── POST /api/nps-surveys/:id/respond ─────────────────────────────────────────
router.post('/:id/respond', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { score, comment } = req.body as { score?: number; comment?: string }

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) {
    res.status(400).json({ error: 'score must be an integer between 0 and 10' })
    return
  }

  const supabase = getServiceClient()

  const { data: npsResponse } = await supabase
    .from('nps_responses')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (!npsResponse) {
    res.status(404).json({ error: 'Survey not found' })
    return
  }

  if (npsResponse.status === 'responded') {
    res.status(400).json({ error: 'This survey has already been responded to' })
    return
  }

  const { error } = await supabase
    .from('nps_responses')
    .update({
      score,
      comment: typeof comment === 'string' ? comment.trim().slice(0, 2000) : null,
      status: 'responded',
      responded_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

export default router
