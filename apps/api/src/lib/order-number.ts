import { getServiceClient } from './supabase.js'

// NOTE: Uses select-then-update which has a theoretical race condition at very
// high concurrency. Acceptable for order generation rates in this codebase.
export async function generateOrderNumber(tenantId: string): Promise<string> {
  const supabase = getServiceClient()

  // Read current counter
  const { data: tenant, error: selectErr } = await supabase
    .from('tenants')
    .select('order_counter')
    .eq('id', tenantId)
    .single()

  if (selectErr || !tenant) {
    throw new Error(`Tenant not found: ${selectErr?.message}`)
  }

  const nextCounter = (tenant.order_counter ?? 1000) + 1

  // Increment counter
  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ order_counter: nextCounter })
    .eq('id', tenantId)

  if (updateErr) {
    throw new Error(`Failed to increment order counter: ${updateErr.message}`)
  }

  return `ORD-${nextCounter}`
}
