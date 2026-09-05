export interface ExpenseCategory {
  id: string
  tenant_id: string
  name: string
  is_archived: boolean
  created_at: string
  gl_code?: string | null
}

export interface Expense {
  id: string
  expense_number: string
  category_id: string | null
  expense_categories: { name: string } | null
  recurring_expense_id: string | null
  amount: number
  expense_date: string
  vendor: string | null
  notes: string | null
  receipt_storage_path: string | null
  receipt_filename: string | null
  receipt_file_type: string | null
  receipt_file_size: number | null
  receipt_signed_url: string | null
  created_at: string
  approval_status: 'pending' | 'approved' | 'rejected' | null
  approved_by: string | null
  approved_at: string | null
  approval_note: string | null
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'annually'

export interface RecurringExpense {
  id: string
  category_id: string | null
  expense_categories: { name: string } | null
  amount: number
  vendor: string | null
  notes: string | null
  frequency: RecurringFrequency
  day_of_week: number | null
  day_of_month: number | null
  month_of_year: number | null
  enabled: boolean
  last_generated_at: string | null
  created_at: string
}

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
}
