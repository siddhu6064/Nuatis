import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/search?q=<query> ────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''

  if (q.length < 2) {
    res.status(400).json({ error: 'q must be at least 2 characters' })
    return
  }

  const supabase = getSupabase()
  const pattern = `%${q}%`

  const crmEnabled = await isModuleEnabled(authed.tenantId, 'crm')

  const [contactsRes, appointmentsRes, quotesRes, inventoryRes] = await Promise.all([
    // Contacts: name, phone, email
    supabase
      .from('contacts')
      .select('id, full_name, phone, email, pipeline_stage')
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)
      .or(`full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
      .order('full_name', { ascending: true })
      .limit(5),

    // Appointments: title
    supabase
      .from('appointments')
      .select('id, title, start_time, contact_id, contacts(full_name)')
      .eq('tenant_id', authed.tenantId)
      .ilike('title', pattern)
      .order('start_time', { ascending: false })
      .limit(3),

    // Quotes: title
    supabase
      .from('quotes')
      .select('id, title, status, total, contact_id, contacts(full_name)')
      .eq('tenant_id', authed.tenantId)
      .ilike('title', pattern)
      .order('created_at', { ascending: false })
      .limit(3),

    // Inventory: name, sku — only queried when CRM module is enabled
    crmEnabled
      ? supabase
          .from('inventory_items')
          .select('id, name, sku, quantity, reorder_threshold')
          .eq('tenant_id', authed.tenantId)
          .is('deleted_at', null)
          .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
          .order('name', { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])

  const contacts = (contactsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.full_name,
    phone: c.phone,
    email: c.email,
    pipeline_stage_name: c.pipeline_stage,
  }))

  const appointments = (appointmentsRes.data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    start_time: a.start_time,
    contact_name: (a.contacts as { full_name?: string } | null)?.full_name ?? null,
    contact_id: a.contact_id,
  }))

  const quotes = (quotesRes.data ?? []).map((q) => ({
    id: q.id,
    title: q.title,
    status: q.status,
    total: q.total,
    contact_name: (q.contacts as { full_name?: string } | null)?.full_name ?? null,
    contact_id: q.contact_id,
  }))

  const inventory = crmEnabled
    ? (inventoryRes.data ?? []).map((i) => ({
        id: i['id'] as string,
        name: i['name'] as string,
        sku: (i['sku'] as string | null) ?? null,
        quantity: Number(i['quantity'] ?? 0),
        reorder_threshold: Number(i['reorder_threshold'] ?? 0),
        type: 'inventory' as const,
      }))
    : []

  res.json({
    contacts,
    appointments,
    quotes,
    inventory,
    total: contacts.length + appointments.length + quotes.length + inventory.length,
  })
})

export default router
