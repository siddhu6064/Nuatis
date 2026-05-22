import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

let _queue: Queue | null = null
function getOutboundQueue(): Queue {
  if (!_queue)
    _queue = new Queue('outbound-calls', {
      connection: createBullMQConnection(),
      skipVersionCheck: true,
    })
  return _queue
}

// ── POST /api/outbound-calls — create + enqueue outbound call ────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { contact_id, call_context } = req.body as {
    contact_id?: string
    call_context?: string
  }

  if (!contact_id) {
    res.status(400).json({ error: 'contact_id is required' })
    return
  }

  const supabase = getSupabase()

  // Fetch contact
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('phone, full_name')
    .eq('id', contact_id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (contactError) {
    res.status(500).json({ error: contactError.message })
    return
  }

  if (!contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  if (!contact.phone) {
    res.status(400).json({ error: 'Contact has no phone number' })
    return
  }

  // Verify tenant has a telnyx_number
  const { data: location, error: locationError } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', authed.tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  if (locationError) {
    res.status(500).json({ error: locationError.message })
    return
  }

  if (!location?.telnyx_number) {
    res.status(400).json({ error: 'No Telnyx number configured for this account' })
    return
  }

  // Insert outbound_call_jobs row
  const { data: job, error: insertError } = await supabase
    .from('outbound_call_jobs')
    .insert({
      tenant_id: authed.tenantId,
      contact_id,
      trigger_type: 'manual',
      trigger_config: { call_context: call_context ?? 'A team member requested this call' },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      max_attempts: 3,
    })
    .select('id')
    .single()

  if (insertError || !job) {
    res.status(500).json({ error: insertError?.message ?? 'Failed to create job' })
    return
  }

  // Enqueue to BullMQ
  await getOutboundQueue().add('dial', { jobId: job.id }, { jobId: job.id })

  res.status(201).json({
    job_id: job.id,
    status: 'pending',
    contact_name: contact.full_name,
    to_number: contact.phone,
  })
})

// ── GET /api/outbound-calls — list recent jobs for tenant ───────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  const limit = Math.max(
    1,
    Math.min(
      200,
      parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '50', 10) || 50
    )
  )

  let query = supabase
    .from('outbound_call_jobs')
    .select(
      'id, trigger_type, status, scheduled_at, started_at, completed_at, attempts, max_attempts, notes, call_id, created_at, contacts(full_name, phone)'
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ jobs: data ?? [] })
})

// ── GET /api/outbound-calls/:id — single job detail ────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('outbound_call_jobs')
    .select(
      'id, trigger_type, status, scheduled_at, started_at, completed_at, attempts, max_attempts, notes, call_id, created_at, contacts(full_name, phone)'
    )
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  if (!data) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json(data)
})

// ── POST /api/outbound-calls/:id/cancel ────────────────────────────────────
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: job, error: fetchError } = await supabase
    .from('outbound_call_jobs')
    .select('id, status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchError) {
    res.status(500).json({ error: fetchError.message })
    return
  }

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  if ((job as { status: string }).status !== 'pending') {
    res.status(400).json({ error: 'Can only cancel pending jobs' })
    return
  }

  const { error: updateError } = await supabase
    .from('outbound_call_jobs')
    .update({ status: 'cancelled' })
    .eq('id', req.params['id'])

  if (updateError) {
    res.status(500).json({ error: updateError.message })
    return
  }

  res.json({ ok: true })
})

export default router
