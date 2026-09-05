import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ExpenseDetailActions from './ExpenseDetailActions'

interface ExpenseRecord {
  id: string
  expense_number: string
  category_id: string | null
  amount: number
  expense_date: string
  vendor: string | null
  notes: string | null
  receipt_storage_path: string | null
  receipt_filename: string | null
  recurring_expense_id: string | null
  created_at: string
  expense_categories: { name: string } | null
  approval_status: 'pending' | 'approved' | 'rejected' | null
  approval_note: string | null
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ExpenseDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const { data: expense } = await supabase
    .from('expenses')
    .select('*, expense_categories(name)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single<ExpenseRecord>()

  if (!expense) notFound()

  let signedUrl: string | null = null
  if (expense.receipt_storage_path) {
    const { data } = await supabase.storage
      .from('expense-receipts')
      .createSignedUrl(expense.receipt_storage_path, 3600)
    signedUrl = data?.signedUrl ?? null
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <Link
        href="/expenses"
        className="inline-flex items-center gap-1 text-sm text-ink4 hover:text-ink3 mb-6"
      >
        &larr; Back to Expenses
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink">{expense.expense_number}</h1>
            {expense.recurring_expense_id && (
              <span className="text-xs text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded uppercase tracking-wide">
                Recurring
              </span>
            )}
            {expense.approval_status === 'pending' && (
              <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded uppercase tracking-wide">
                Pending Approval
              </span>
            )}
            {expense.approval_status === 'rejected' && (
              <span className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase tracking-wide">
                Rejected
              </span>
            )}
          </div>
          <p className="text-sm text-ink3 mt-1">
            {expense.expense_categories?.name ?? 'Uncategorized'}
            {expense.vendor && ` · ${expense.vendor}`}
          </p>
        </div>
        <p className="text-2xl font-bold text-ink">${Number(expense.amount).toFixed(2)}</p>
      </div>

      <div className="bg-white rounded-xl border border-border-brand p-6 mb-6 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-ink3">Date</span>
          <span className="text-ink font-medium">
            {new Date(expense.expense_date).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </span>
        </div>
        {expense.notes && (
          <div className="flex justify-between text-sm gap-6">
            <span className="text-ink3 shrink-0">Notes</span>
            <span className="text-ink text-right">{expense.notes}</span>
          </div>
        )}
        {expense.approval_status === 'rejected' && expense.approval_note && (
          <div className="flex justify-between text-sm gap-6">
            <span className="text-ink3 shrink-0">Rejection reason</span>
            <span className="text-red-700 text-right">{expense.approval_note}</span>
          </div>
        )}
      </div>

      {expense.receipt_storage_path && (
        <div className="bg-white rounded-xl border border-border-brand p-6 mb-6">
          <h2 className="text-sm font-semibold text-ink mb-3">Receipt</h2>
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-teal-700 hover:underline"
            >
              {expense.receipt_filename ?? 'View receipt'}
            </a>
          ) : (
            <p className="text-sm text-ink4">Receipt attached, link unavailable.</p>
          )}
        </div>
      )}

      <ExpenseDetailActions
        expenseId={expense.id}
        hasReceipt={!!expense.receipt_storage_path}
        approvalStatus={expense.approval_status}
      />
    </div>
  )
}
