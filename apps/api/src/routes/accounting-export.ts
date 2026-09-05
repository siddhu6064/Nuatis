/**
 * Accounting-software export — a QuickBooks/Xero-compatible 3-column journal
 * CSV (Date, Description, Account, Debit, Credit) built from the two places
 * financial transactions actually live: quote_payments (revenue) and
 * expenses. Unlike data-export.ts (raw table dumps of CRM data, queued via
 * BullMQ for potentially large all-time exports), a date-bounded financial
 * ledger is small enough to generate synchronously — no job/worker needed.
 */
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface JournalRow {
  date: string
  description: string
  account: string
  debit: number
  credit: number
}

function csvField(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: JournalRow[]): string {
  const header = 'Date,Description,Account,Debit,Credit'
  const lines = rows.map((r) =>
    [
      csvField(r.date),
      csvField(r.description),
      csvField(r.account),
      csvField(r.debit.toFixed(2)),
      csvField(r.credit.toFixed(2)),
    ].join(',')
  )
  return [header, ...lines].join('\n')
}

// ── GET /api/accounting-export ───────────────────────────────────────────────
// Query: start_date, end_date (YYYY-MM-DD, inclusive). Streams a CSV download.
router.get(
  '/',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const startDate = typeof req.query['start_date'] === 'string' ? req.query['start_date'] : ''
    const endDate = typeof req.query['end_date'] === 'string' ? req.query['end_date'] : ''
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      res.status(400).json({ error: 'start_date and end_date (YYYY-MM-DD) are required' })
      return
    }

    const rangeStartIso = `${startDate}T00:00:00.000Z`
    const rangeEndIso = `${endDate}T23:59:59.999Z`

    const [{ data: payments, error: paymentsError }, { data: expenses, error: expensesError }] =
      await Promise.all([
        supabase
          .from('quote_payments')
          .select('recorded_at, amount, method, reference, quotes(quote_number)')
          .eq('tenant_id', authed.tenantId)
          .gte('recorded_at', rangeStartIso)
          .lte('recorded_at', rangeEndIso),
        supabase
          .from('expenses')
          .select('expense_date, amount, vendor, notes, category_id')
          .eq('tenant_id', authed.tenantId)
          .is('deleted_at', null)
          .gte('expense_date', startDate)
          .lte('expense_date', endDate),
      ])

    if (paymentsError || expensesError) {
      res.status(500).json({ error: (paymentsError ?? expensesError)?.message ?? 'Export failed' })
      return
    }

    // expenses.category_id doesn't follow the `<singular table>_id` naming
    // convention (it's not `expense_category_id`), so this is a manual join
    // rather than a nested select — matches the pattern used elsewhere in
    // this codebase (e.g. companies.ts's contact_count) for the same reason.
    const categoryIds = [
      ...new Set((expenses ?? []).map((e) => e['category_id'] as string | null).filter(Boolean)),
    ] as string[]
    let categoryMap: Record<string, { name: string; gl_code: string | null }> = {}
    if (categoryIds.length > 0) {
      const { data: categories } = await supabase
        .from('expense_categories')
        .select('id, name, gl_code')
        .eq('tenant_id', authed.tenantId)
        .in('id', categoryIds)
      categoryMap = Object.fromEntries(
        (categories ?? []).map((c) => [
          c.id as string,
          { name: c.name as string, gl_code: c.gl_code as string | null },
        ])
      )
    }

    const rows: JournalRow[] = []

    for (const p of payments ?? []) {
      const quote = p['quotes'] as { quote_number?: string } | { quote_number?: string }[] | null
      const quoteNumber = Array.isArray(quote) ? quote[0]?.quote_number : quote?.quote_number
      rows.push({
        date: (p['recorded_at'] as string).slice(0, 10),
        description: `Payment${quoteNumber ? ` for ${quoteNumber}` : ''}${p['reference'] ? ` (${p['reference'] as string})` : ''}`,
        account: 'Sales Revenue',
        debit: 0,
        credit: Number(p['amount'] ?? 0),
      })
    }

    for (const e of expenses ?? []) {
      const cat = e['category_id'] ? categoryMap[e['category_id'] as string] : undefined
      const account = cat?.gl_code || cat?.name || 'Uncategorized Expense'
      rows.push({
        date: e['expense_date'] as string,
        description: (e['vendor'] as string | null) || (e['notes'] as string | null) || 'Expense',
        account,
        debit: Number(e['amount'] ?? 0),
        credit: 0,
      })
    }

    rows.sort((a, b) => a.date.localeCompare(b.date))

    const csv = toCsv(rows)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="accounting-export-${startDate}-to-${endDate}.csv"`
    )
    res.send(csv)
  }
)

export default router
