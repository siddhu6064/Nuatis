import { getServiceClient } from './supabase.js'

const DEFAULT_CATEGORY_NAMES = [
  'Rent',
  'Utilities',
  'Payroll',
  'Supplies/Inventory',
  'Marketing',
  'Software',
  'Insurance',
  'Other',
]

export interface ExpenseCategoryRow {
  id: string
  tenant_id: string
  name: string
  is_archived: boolean
  created_at: string
}

/** Lazily seeds the 8 standard categories for a tenant the first time its
 *  category list is empty, then returns the (possibly just-seeded) list. */
export async function ensureDefaultCategories(tenantId: string): Promise<ExpenseCategoryRow[]> {
  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
    .returns<ExpenseCategoryRow[]>()

  if (existing && existing.length > 0) return existing

  const { data: seeded } = await supabase
    .from('expense_categories')
    .insert(DEFAULT_CATEGORY_NAMES.map((name) => ({ tenant_id: tenantId, name })))
    .select('*')
    .returns<ExpenseCategoryRow[]>()

  return seeded ?? []
}
