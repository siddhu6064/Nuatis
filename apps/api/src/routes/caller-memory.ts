import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logAuditEvent } from '../middleware/audit-logger.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Mask phone to: +1 512 ***-1234
 * Keep country code + area code (first 2 digit groups), mask middle 3 + last 4.
 * For E.164 +15125551234 → "+1 512 ***-1234"
 * Falls back gracefully for non-US or unexpected formats.
 */
function maskPhone(phone: string): string {
  // US/CA: +1AAANNNXXXX (11 digits total)
  const usMatch = phone.match(/^(\+1)(\d{3})(\d{3})(\d{4})$/)
  if (usMatch) {
    return `${usMatch[1]} ${usMatch[2]} ***-${usMatch[4]}`
  }
  // Generic: keep +CC + next 3, mask rest, show last 4
  const genericMatch = phone.match(/^(\+\d{1,3})(\d{1,4})(\d+)(\d{4})$/)
  if (genericMatch) {
    return `${genericMatch[1]} ${genericMatch[2]} ***-${genericMatch[4]}`
  }
  // Fallback: show only last 4
  const last4 = phone.slice(-4)
  return `***-${last4}`
}

// ── GET /api/caller-memory ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10) || 20))
  const offset = (page - 1) * limit

  try {
    const { data, error, count } = await supabase
      .from('caller_memory')
      .select('id, phone, call_count, last_call_at, summary, facts', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error(`[caller-memory] GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch caller memory' })
      return
    }

    type MemoryRow = {
      id: string
      phone: string
      call_count: number
      last_call_at: string | null
      summary: string | null
      facts: Record<string, unknown> | null
    }

    const rows = (data ?? []) as MemoryRow[]

    const responseData = rows.map((row) => {
      const summary = row.summary ?? ''
      const summaryExcerpt = summary.length > 80 ? summary.slice(0, 80) + '...' : summary || null
      const name = (row.facts?.['name'] as string | undefined) ?? null
      return {
        id: row.id,
        phone_masked: maskPhone(row.phone),
        name,
        call_count: row.call_count,
        last_call_at: row.last_call_at,
        summary_excerpt: summaryExcerpt,
      }
    })

    const total = count ?? 0
    res.json({ data: responseData, total, page })
  } catch (err) {
    console.error('[caller-memory] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/caller-memory/:phone ─────────────────────────────────────────
router.delete('/:phone', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const phone = decodeURIComponent(req.params['phone'] ?? '')
  if (!phone) {
    res.status(400).json({ error: 'Phone parameter required' })
    return
  }

  try {
    // Check row exists first
    const { data: existing, error: fetchError } = await supabase
      .from('caller_memory')
      .select('id')
      .eq('tenant_id', authed.tenantId)
      .eq('phone', phone)
      .maybeSingle<{ id: string }>()

    if (fetchError) {
      console.error(`[caller-memory] DELETE fetch error: ${fetchError.message}`)
      res.status(500).json({ error: 'Failed to look up caller memory' })
      return
    }

    if (!existing) {
      res.status(404).json({ error: 'Caller memory not found' })
      return
    }

    const { error: deleteError } = await supabase
      .from('caller_memory')
      .delete()
      .eq('tenant_id', authed.tenantId)
      .eq('phone', phone)

    if (deleteError) {
      console.error(`[caller-memory] DELETE error: ${deleteError.message}`)
      res.status(500).json({ error: 'Failed to delete caller memory' })
      return
    }

    void logAuditEvent({
      tenantId: authed.tenantId,
      userId: authed.userId,
      action: 'delete',
      resourceType: 'caller_memory',
      resourceId: existing.id,
      details: { phone_masked: maskPhone(phone) },
      ipAddress: req.ip ?? req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    })

    console.info(
      `[caller-memory] deleted tenant=${authed.tenantId} phone=${maskPhone(phone)} id=${existing.id}`
    )

    res.status(204).send()
  } catch (err) {
    console.error('[caller-memory] DELETE error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
