import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'
import { generateExpenseNumber } from '../lib/expense-number.js'

const QUEUE_NAME = 'recurring-expense-scanner'

interface RecurringExpense {
  id: string
  tenant_id: string
  category_id: string | null
  amount: number
  vendor: string | null
  notes: string | null
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  day_of_week: number | null
  day_of_month: number | null
  month_of_year: number | null
  last_generated_at: string | null
}

function isDue(r: RecurringExpense): boolean {
  const now = new Date()
  const dow = now.getDay()
  const dom = now.getDate()
  const moy = now.getMonth() + 1

  if (r.frequency === 'weekly') {
    if (r.day_of_week === null || r.day_of_week !== dow) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 6 * 86400000
  }
  if (r.frequency === 'monthly') {
    if (r.day_of_month === null || r.day_of_month !== dom) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 25 * 86400000
  }
  if (r.frequency === 'quarterly') {
    if (r.day_of_month === null || r.day_of_month !== dom) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 80 * 86400000
  }
  if (r.frequency === 'annually') {
    if (r.day_of_month === null || r.month_of_year === null) return false
    if (r.day_of_month !== dom || r.month_of_year !== moy) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 350 * 86400000
  }
  return false
}

export async function scanRecurringExpenses(): Promise<void> {
  console.info('[recurring-expense-scanner] scanning...')

  try {
    const supabase = getServiceClient()

    const { data: rules, error } = await supabase
      .from('recurring_expenses')
      .select(
        'id, tenant_id, category_id, amount, vendor, notes, frequency, day_of_week, day_of_month, month_of_year, last_generated_at'
      )
      .eq('enabled', true)
      .is('deleted_at', null)

    if (error) {
      console.error(`[recurring-expense-scanner] query error: ${error.message}`)
      return
    }

    const due = ((rules ?? []) as RecurringExpense[]).filter(isDue)
    if (due.length === 0) {
      console.info('[recurring-expense-scanner] no rules due')
      return
    }

    for (const rule of due) {
      const expenseNumber = await generateExpenseNumber(rule.tenant_id)
      const now = new Date().toISOString()

      const { data: expense, error: insertErr } = await supabase
        .from('expenses')
        .insert({
          tenant_id: rule.tenant_id,
          category_id: rule.category_id,
          recurring_expense_id: rule.id,
          expense_number: expenseNumber,
          amount: rule.amount,
          expense_date: now.slice(0, 10),
          vendor: rule.vendor,
          notes: rule.notes,
        })
        .select('id')
        .single()

      if (insertErr || !expense) {
        console.error(
          `[recurring-expense-scanner] insert failed rule=${rule.id}: ${insertErr?.message}`
        )
        continue
      }

      await supabase
        .from('recurring_expenses')
        .update({ last_generated_at: now })
        .eq('id', rule.id)
        .eq('tenant_id', rule.tenant_id)

      void logActivity({
        tenantId: rule.tenant_id,
        type: 'expense',
        body: `Recurring expense generated: ${expenseNumber} — $${Number(rule.amount).toFixed(2)}`,
        metadata: { expense_id: expense.id, recurring_expense_id: rule.id },
        actorType: 'system',
      })
    }

    console.info(`[recurring-expense-scanner] generated ${due.length} expense(s)`)
  } catch (err) {
    console.error('[recurring-expense-scanner] scan error:', err)
  }
}

export function createRecurringExpenseScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scanRecurringExpenses(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[recurring-expense-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
