import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requireIncidents } from '../lib/incident-module.js'

const router = Router()

/** Three of the same thing in one place starts looking like a pattern. */
const RECURRENCE_THRESHOLD = 3

/**
 * Composite-key separator for the recurrence bucket. Safe because type_key is
 * constrained to [a-z0-9_] and location_id is a uuid, so neither can contain it.
 */
const KEY_SEP = '|'

interface IncidentRow {
  type_key: string
  cost_cents: number
  status: string
  location_id: string | null
  reported_by_staff_id: string | null
}

interface Bucket {
  count: number
  cost_cents: number
}

/**
 * Manager reporting: what went wrong this month, what it cost, and who logged it.
 *
 * Aggregated in TypeScript rather than SQL. These are per-tenant, per-month
 * volumes — hundreds of rows, not millions — and keeping it here means the same
 * grouping rules are visible and testable rather than buried in a view.
 */
router.get(
  '/summary',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { from, to } = windowFrom(req.query)

    const { data, error } = await supabase
      .from('incidents')
      .select('type_key, cost_cents, status, location_id, reported_by_staff_id, created_at')
      .eq('tenant_id', authed.tenantId)
      .gte('created_at', from)
      .lt('created_at', to)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // A cancelled incident was logged in error. Counting its cost would put
    // money in the month's total that nobody ever gave away.
    const rows = ((data ?? []) as IncidentRow[]).filter((r) => r.status !== 'cancelled')

    const byTypeBuckets = new Map<string, Bucket>()
    const byStaffBuckets = new Map<string, Bucket>()
    const recurrenceBuckets = new Map<string, number>()

    for (const row of rows) {
      add(byTypeBuckets, row.type_key, row.cost_cents)

      // A dashboard-reported incident has no staff member. It still counts
      // towards the month's cost, it just has nobody to attribute it to.
      if (row.reported_by_staff_id) {
        add(byStaffBuckets, row.reported_by_staff_id, row.cost_cents)
      }

      if (row.location_id) {
        const key = `${row.type_key}${KEY_SEP}${row.location_id}`
        recurrenceBuckets.set(key, (recurrenceBuckets.get(key) ?? 0) + 1)
      }
    }

    // Labels are for display only. Grouping is on type_key, so renaming a
    // category does not change last month's numbers, and a deleted one still
    // reports under its key rather than vanishing.
    const labels = await labelsFor(supabase, authed.tenantId)
    const names = await staffNamesFor(supabase, authed.tenantId)

    const byType = [...byTypeBuckets.entries()]
      .map(([type_key, b]) => ({ type_key, label: labels.get(type_key) ?? type_key, ...b }))
      .sort((a, b) => b.cost_cents - a.cost_cents)

    // Sorted by total descending so the outlier is the first row. This table is
    // the control that makes the authorisation threshold safe: a cashier
    // comping just under it all shift is invisible everywhere else and obvious
    // here.
    const byStaff = [...byStaffBuckets.entries()]
      .map(([staff_id, b]) => ({ staff_id, staff_name: names.get(staff_id) ?? null, ...b }))
      .sort((a, b) => b.cost_cents - a.cost_cents)

    const recurring = [...recurrenceBuckets.entries()]
      .filter(([, count]) => count >= RECURRENCE_THRESHOLD)
      .map(([key, count]) => {
        const [typeKey = '', locationId = ''] = key.split(KEY_SEP)
        return {
          type_key: typeKey,
          location_id: locationId,
          label: labels.get(typeKey) ?? typeKey,
          count,
        }
      })
      .sort((a, b) => b.count - a.count)

    res.json({ from, to, byType, byStaff, recurring })
  }
)

function add(buckets: Map<string, Bucket>, key: string, costCents: number): void {
  const bucket = buckets.get(key) ?? { count: 0, cost_cents: 0 }
  bucket.count += 1
  // Integer cents throughout — never parseFloat, never a dollar string.
  bucket.cost_cents += Number.isInteger(costCents) ? costCents : 0
  buckets.set(key, bucket)
}

/** The reporting window, defaulting to the current calendar month. */
function windowFrom(query: Request['query']): { from: string; to: string } {
  const rawFrom = typeof query['from'] === 'string' ? query['from'] : ''
  const rawTo = typeof query['to'] === 'string' ? query['to'] : ''

  const now = new Date()
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const from = Number.isFinite(Date.parse(rawFrom)) ? new Date(rawFrom) : defaultFrom
  const to = Number.isFinite(Date.parse(rawTo)) ? new Date(rawTo) : defaultTo

  return { from: from.toISOString(), to: to.toISOString() }
}

async function labelsFor(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('incident_types')
    .select('key, label')
    .eq('tenant_id', tenantId)

  const labels = new Map<string, string>()
  for (const row of (data ?? []) as { key: string; label: string }[]) {
    labels.set(row.key, row.label)
  }
  return labels
}

async function staffNamesFor(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string
): Promise<Map<string, string>> {
  const { data } = await supabase.from('staff_members').select('id, name').eq('tenant_id', tenantId)

  const names = new Map<string, string>()
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    names.set(row.id, row.name)
  }
  return names
}

export default router
