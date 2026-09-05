import { getServiceClient } from './supabase.js'

// NOTE: Uses select-then-update which has a theoretical race condition at very
// high concurrency. Acceptable for expense generation rates in this codebase.
export async function generateExpenseNumber(tenantId: string): Promise<string> {
  const supabase = getServiceClient()

  const { data: tenant, error: selectErr } = await supabase
    .from('tenants')
    .select('expense_counter')
    .eq('id', tenantId)
    .single()

  if (selectErr || !tenant) {
    throw new Error(`Tenant not found: ${selectErr?.message}`)
  }

  const nextCounter = (tenant.expense_counter ?? 1000) + 1

  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ expense_counter: nextCounter })
    .eq('id', tenantId)

  if (updateErr) {
    throw new Error(`Failed to increment expense counter: ${updateErr.message}`)
  }

  return `EXP-${nextCounter}`
}
